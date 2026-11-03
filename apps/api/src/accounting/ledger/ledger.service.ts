import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, Injectable, Logger, NotFoundException, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Interval } from '@nestjs/schedule';
import { LedgerConnection, Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service';
import { AuthUser } from '../../auth/auth.types';
import { CurrentUser, EDITORS, Public, Roles } from '../../auth/decorators';
import { decryptSecret, encryptSecret } from '../../auth/totp';
import { IntegrationsService } from '../../integrations/integrations.service';
import { config } from '../../common/config';
import { randomToken } from '../../common/crypto';
import { ZodPipe } from '../../common/zod.pipe';
import { PayablesService } from '../../finance/payables.service';
import { PrismaService } from '../../prisma/prisma.service';
import { localParts, zonedTime } from '../../schedules/schedule.rules';
import { AccountingService } from '../accounting.service';
import { exchangeCode, Http, OAuthSession, PacedClient, TokenSet } from './client';
import { Counts, DEFAULT_SYNC, RunError, SyncEngine, SyncSettings, zeroCounts } from './engine';
import { QuickBooksLedger, quickBooksCompany } from './quickbooks';
import { TallyLedger } from './tally';
import { Ledger, LEDGER_LABEL, LEDGER_PROVIDERS, LedgerContext, LedgerProvider, LedgerSignInExpired } from './types';
import { XeroLedger, xeroScopes, xeroTenants } from './xero';

/**
 * Direct sync to Xero, QuickBooks Online and Tally Prime (docs/ACCOUNTING_SYNC.md). Xero and
 * QuickBooks: an admin signs in once with OAuth; the tokens are stored encrypted and refreshed as
 * they rotate. Tally: the server's TALLY_URL, bound to one organisation like Zoho Books.
 */

export const syncSettingsSchema = z
  .object({
    hourly: z.boolean(),
    since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-01').nullable(),
    invoices: z.boolean(),
    bills: z.boolean(),
    payments: z.boolean(),
  })
  .strict();

const STATE_COOKIE = 'projexa_ledger';
const STALE_MS = 30 * 60_000;
const HOUR = 3_600_000;
const web = () => config.webOrigins[0] ?? '';
export const redirectUri = (p: 'xero' | 'quickbooks') => `${config.publicBaseUrl}/api/v1/accounting/ledgers/${p}/callback`;
const settingsOf = (v: unknown): SyncSettings => ({ ...DEFAULT_SYNC, ...((v ?? {}) as Partial<SyncSettings>) });

const isProvider = (p: string): p is LedgerProvider => (LEDGER_PROVIDERS as string[]).includes(p);
const isOAuth = (p: LedgerProvider): p is 'xero' | 'quickbooks' => p !== 'tally';

@Injectable()
export class LedgerService {
  private readonly log = new Logger('LedgerSync');
  /** Swapped for fakes in tests. */
  http: Http = (url, init) => fetch(url, init);
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  /** Spacing and request allowance per run, per provider (see docs/ACCOUNTING_SYNC.md for the limits). */
  pace: Record<LedgerProvider, { gapMs: number; budget: number }> = { xero: { gapMs: 1_100, budget: 300 }, quickbooks: { gapMs: 150, budget: 2_000 }, tally: { gapMs: 50, budget: 2_000 } };
  current: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly payables: PayablesService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly integrations: IntegrationsService,
  ) {}

  private provider(p: string): LedgerProvider {
    if (!isProvider(p)) throw new NotFoundException('Unknown accounting system');
    return p;
  }
  /** The Xero or QuickBooks app from Settings → Integrations (server owner), else the server env. */
  private async app<P extends 'xero' | 'quickbooks'>(p: P) {
    const a = await this.integrations.ledgerApp(p);
    if (!a) throw new BadRequestException(`${LEDGER_LABEL[p]} is not set up yet. Add its client ID and secret in Settings → Integrations.`);
    return a;
  }
  private async tallyBound(org: string) {
    return (await this.integrations.tally(org)).config;
  }

  // ───────────── Status and settings ─────────────

  async list(org: string) {
    const [conns, runs, links, slug] = await Promise.all([
      this.prisma.ledgerConnection.findMany({ where: { organizationId: org } }),
      this.prisma.ledgerSync.findMany({ where: { organizationId: org }, orderBy: { startedAt: 'desc' }, take: 60 }),
      this.prisma.ledgerLink.groupBy({ by: ['provider', 'entityType'], where: { organizationId: org }, _count: true }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { slug: true } }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...runs.map((r) => r.createdById), ...conns.map((c) => c.connectedById)].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const name = new Map(users.map((u) => [u.id, u.name]));
    const tally = await this.integrations.tally(org);
    const t = tally.config ?? (tally.otherTenant ? { url: '', tenant: '' } : null);
    const apps = { xero: await this.integrations.ledgerApp('xero'), quickbooks: await this.integrations.ledgerApp('quickbooks') };
    return LEDGER_PROVIDERS.map((p) => {
      const c = conns.find((x) => x.provider === p);
      const mine = runs.filter((r) => r.provider === p).slice(0, 20);
      const connected = p === 'tally' ? !!t && t.tenant === slug.slug : c?.status === 'connected';
      return {
        provider: p,
        label: LEDGER_LABEL[p],
        configured: p === 'tally' ? !!t : !!apps[p],
        sandbox: p === 'quickbooks' ? !!apps.quickbooks?.sandbox : false,
        otherTenant: p === 'tally' ? !!t && t.tenant !== slug.slug : false,
        status: p === 'tally' ? (connected ? 'connected' : 'disconnected') : c?.status ?? 'disconnected',
        connected,
        company: p === 'tally' ? (t && connected ? new URL(t.url).host : null) : c?.remoteName ?? null,
        connectedBy: c?.connectedById ? name.get(c.connectedById) ?? null : null,
        connectedAt: c?.connectedAt ?? null,
        lastError: c?.lastError ?? null,
        redirectUri: isOAuth(p) ? redirectUri(p) : null,
        settings: settingsOf(c?.settings),
        linked: Object.fromEntries(links.filter((l) => l.provider === p).map((l) => [l.entityType, l._count])),
        running: mine.some((r) => r.status === 'running'),
        runs: mine.map((r) => ({ id: r.id, trigger: r.trigger, status: r.status, counts: (r.counts as Counts | null) ?? zeroCounts(), errors: (r.errors as RunError[] | null) ?? [], startedAt: r.startedAt, finishedAt: r.finishedAt, by: r.createdById ? name.get(r.createdById) ?? null : null })),
      };
    });
  }

  async saveSettings(u: AuthUser, p: string, body: SyncSettings) {
    const provider = this.provider(p);
    if (body.hourly && !body.since) throw new BadRequestException('Pick the date to sync from before turning on the hourly sync');
    await this.prisma.ledgerConnection.upsert({
      where: { organizationId_provider: { organizationId: u.organizationId, provider } },
      create: { organizationId: u.organizationId, provider, status: 'disconnected', settings: body as unknown as Prisma.InputJsonValue },
      update: { settings: body as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'ledger.settings', entityType: 'LedgerConnection', entityId: provider, detail: body });
    return body;
  }

  // ───────────── OAuth connect ─────────────

  /** Step 1: send the admin's browser to Xero or QuickBooks, with the state in a short-lived signed cookie. */
  async start(u: AuthUser, p: string, res: Response) {
    const provider = this.provider(p);
    if (!isOAuth(provider)) throw new BadRequestException('Tally Prime is connected by its address in Settings → Integrations');
    const app = await this.app(provider);
    const state = randomToken(16);
    const cookie = await this.jwt.signAsync({ p: provider, state, org: u.organizationId, uid: u.id }, { secret: `${config.jwtSecret}:ledger-state`, expiresIn: '10m' });
    res.cookie(STATE_COOKIE, cookie, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60 * 1000, path: '/api/v1/accounting/ledgers' });
    const scope = provider === 'xero' ? xeroScopes() : 'com.intuit.quickbooks.accounting';
    const q = new URLSearchParams({ response_type: 'code', client_id: app.clientId, redirect_uri: redirectUri(provider), scope, state });
    return `${app.authorizeUrl}?${q}`;
  }

  /** Step 2: the provider sends the browser back with a code. Returns where to send the browser next. */
  async callback(p: string, q: Record<string, string | undefined>, req: Request, res: Response): Promise<string> {
    const back = (msg: string | null, provider = p) => `${web()}/accounting?ledger=${encodeURIComponent(provider)}${msg ? `&ledger_error=${encodeURIComponent(msg)}` : '&connected=1'}#direct-sync`;
    res.clearCookie(STATE_COOKIE, { path: '/api/v1/accounting/ledgers' });
    let st: { p: string; state: string; org: string; uid: string };
    try {
      st = await this.jwt.verifyAsync((req as Request & { cookies?: Record<string, string> }).cookies?.[STATE_COOKIE] ?? '', { secret: `${config.jwtSecret}:ledger-state` });
    } catch {
      return back('The sign-in took too long or was started in another browser. Try again.');
    }
    if (!isProvider(p) || !isOAuth(p) || st.p !== p || !q.state || q.state !== st.state) return back('The sign-in could not be checked. Try again.');
    if (q.error) return back(q.error === 'access_denied' ? 'Access was not granted.' : `${LEDGER_LABEL[p]} refused: ${q.error}`);
    if (!q.code) return back('No authorisation code came back. Try again.');
    const admin = await this.prisma.user.findFirst({ where: { id: st.uid, organizationId: st.org, role: 'ADMIN', active: true } });
    if (!admin) return back('Only an admin can connect an accounting system.');
    try {
      const app = await this.app(p);
      const tokens = await exchangeCode(this.http, app, q.code, redirectUri(p));
      let remoteId: string;
      let remoteName: string | null = null;
      if (p === 'xero') {
        const tenants = await xeroTenants(this.http, app.apiUrl, tokens.access);
        if (!tenants.length) return back('No Xero organisation was shared. Connect again and pick one.');
        // Xero lists every organisation the person has shared with this app, newest last.
        const t = tenants[tenants.length - 1];
        remoteId = t.tenantId;
        remoteName = t.tenantName ?? null;
      } else {
        if (!q.realmId) return back('QuickBooks did not say which company was picked. Try again.');
        remoteId = q.realmId;
        const qb = await this.app('quickbooks');
        remoteName = await quickBooksCompany(this.http, qb.apiUrl, qb.minorVersion, remoteId, tokens.access).catch(() => null);
      }
      const box = this.seal(tokens);
      await this.prisma.ledgerConnection.upsert({
        where: { organizationId_provider: { organizationId: st.org, provider: p } },
        create: { organizationId: st.org, provider: p, status: 'connected', remoteId, remoteName, tokens: box, connectedById: st.uid, connectedAt: new Date() },
        update: { status: 'connected', remoteId, remoteName, tokens: box, connectedById: st.uid, connectedAt: new Date(), lastError: null },
      });
      await this.audit.record({ organizationId: st.org, actorId: st.uid, action: 'ledger.connect', entityType: 'LedgerConnection', entityId: p, detail: { company: remoteName, id: remoteId } });
      return back(null, p);
    } catch (e) {
      this.log.warn(`${p} connect failed: ${(e as Error).message}`);
      return back((e as Error).message.slice(0, 200));
    }
  }

  async disconnect(u: AuthUser, p: string) {
    const provider = this.provider(p);
    if (!isOAuth(provider)) throw new BadRequestException('Tally Prime is set in Settings → Integrations. Remove it there to disconnect.');
    const c = await this.prisma.ledgerConnection.findUnique({ where: { organizationId_provider: { organizationId: u.organizationId, provider } } });
    if (!c || c.status === 'disconnected') return { ok: true };
    if (await this.prisma.ledgerSync.count({ where: { organizationId: u.organizationId, provider, status: 'running' } })) throw new ConflictException('Wait for the running sync to finish');
    // Best effort: tell the provider to forget the app's access too.
    const app = await this.integrations.ledgerApp(provider);
    if (app && c.tokens) {
      try {
        const t = this.open(c.tokens);
        const basic = `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`;
        if (provider === 'xero') await this.http(app.revokeUrl, { method: 'POST', headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t.refresh }).toString() });
        else await this.http(app.revokeUrl, { method: 'POST', headers: { Authorization: basic, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ token: t.refresh }) });
      } catch (e) {
        this.log.warn(`${provider} revoke failed: ${(e as Error).message}`);
      }
    }
    await this.prisma.ledgerConnection.update({ where: { id: c.id }, data: { status: 'disconnected', tokens: null, lastError: null } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'ledger.disconnect', entityType: 'LedgerConnection', entityId: provider, detail: { company: c.remoteName } });
    return { ok: true };
  }

  private seal(t: TokenSet) {
    return encryptSecret(JSON.stringify(t), `ledger:${config.accountingEncryptionKey}`);
  }
  private open(box: string): TokenSet {
    return JSON.parse(decryptSecret(box, `ledger:${config.accountingEncryptionKey}`)) as TokenSet;
  }

  // ───────────── Building a ledger for a run ─────────────

  private async context(org: string): Promise<LedgerContext> {
    const [cfg, fin] = await Promise.all([this.accounting.config(org), this.payables.settings(org)]);
    const rates = new Map(fin.rates.map((r) => [r.currency, r.rate]));
    const day = (d: Date) => {
      const p = localParts(d, cfg.timezone);
      return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
    };
    return { cfg, baseCurrency: fin.baseCurrency, rate: (c) => (c === fin.baseCurrency ? 1 : rates.get(c) ?? null), day };
  }

  private async ledger(org: string, provider: LedgerProvider): Promise<{ ledger: Ledger; conn: LedgerConnection | null }> {
    const ctx = await this.context(org);
    const pace = { ...this.pace[provider], sleep: this.sleep };
    if (provider === 'tally') {
      const t = await this.tallyBound(org);
      if (!t) throw new BadRequestException((await this.integrations.tally(org)).otherTenant ? 'Tally Prime is connected to another PROJEXA organisation' : 'Tally Prime is not set up yet. Add its address in Settings → Integrations.');
      return { ledger: new TallyLedger(new PacedClient(this.http, null, pace), t.url, ctx), conn: null };
    }
    const app = await this.app(provider);
    const conn = await this.prisma.ledgerConnection.findUnique({ where: { organizationId_provider: { organizationId: org, provider } } });
    if (!conn || conn.status !== 'connected' || !conn.tokens || !conn.remoteId) throw new BadRequestException(`Connect ${LEDGER_LABEL[provider]} first`);
    const session = new OAuthSession(app, this.open(conn.tokens), async (t) => {
      await this.prisma.ledgerConnection.update({ where: { id: conn.id }, data: { tokens: this.seal(t) } });
    }, this.http);
    const client = new PacedClient(this.http, session, pace);
    const ledger = provider === 'xero' ? new XeroLedger(client, app.apiUrl, conn.remoteId, ctx) : new QuickBooksLedger(client, app.apiUrl, (app as { minorVersion?: string }).minorVersion ?? '75', conn.remoteId, ctx);
    return { ledger, conn };
  }

  private async expired(org: string, provider: LedgerProvider, message: string) {
    if (provider === 'tally') return;
    await this.prisma.ledgerConnection.updateMany({ where: { organizationId: org, provider }, data: { status: 'expired', lastError: message.slice(0, 500) } });
  }

  async test(org: string, p: string) {
    const provider = this.provider(p);
    const { ledger } = await this.ledger(org, provider);
    try {
      const checks = await ledger.test();
      return { ok: checks.every((c) => c.ok), checks };
    } catch (e) {
      if (e instanceof LedgerSignInExpired) await this.expired(org, provider, e.message);
      return { ok: false, checks: [{ label: 'Connection', ok: false, detail: (e as Error).message }] };
    }
  }

  // ───────────── Runs ─────────────

  async startSync(org: string, p: string, trigger: 'manual' | 'schedule', userId: string | null) {
    const provider = this.provider(p);
    const conn = await this.prisma.ledgerConnection.findUnique({ where: { organizationId_provider: { organizationId: org, provider } } });
    const s = settingsOf(conn?.settings);
    if (!s.since) throw new BadRequestException('Pick the date to sync from first');
    if (!s.invoices && !s.bills) throw new BadRequestException('Turn on invoices or bills to sync');
    const { ledger } = await this.ledger(org, provider);
    await this.prisma.ledgerSync.updateMany({ where: { organizationId: org, provider, status: 'running', startedAt: { lt: new Date(Date.now() - STALE_MS) } }, data: { status: 'failed', finishedAt: new Date(), errors: [{ type: 'run', number: null, message: 'The server stopped during this run' }] } });
    const run = await this.prisma
      .$transaction(async (tx) => {
        if (await tx.ledgerSync.count({ where: { organizationId: org, provider, status: 'running' } })) throw new ConflictException('A sync is already running');
        return tx.ledgerSync.create({ data: { organizationId: org, provider, trigger, status: 'running', createdById: userId } });
      }, { isolationLevel: 'Serializable' })
      .catch((e) => {
        if (e instanceof ConflictException) throw e;
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') throw new ConflictException('A sync is already running');
        throw e;
      });
    this.current = this.run(org, provider, run.id, ledger, s, userId).catch((e) => this.log.error(`${provider} run ${run.id} crashed: ${(e as Error).message}`));
    return { id: run.id, status: 'running' };
  }

  private async run(org: string, provider: LedgerProvider, runId: string, ledger: Ledger, s: SyncSettings, userId: string | null) {
    const cfg = await this.accounting.config(org);
    const [y, m, d] = s.since!.split('-').map(Number);
    const engine = new SyncEngine(this.prisma, org, provider, ledger);
    try {
      await engine.run(zonedTime(y, m, d, 0, cfg.timezone), s);
    } catch (e) {
      if (e instanceof LedgerSignInExpired) await this.expired(org, provider, e.message);
    }
    const status = engine.status;
    await this.prisma.ledgerSync.update({ where: { id: runId }, data: { status, counts: engine.counts as unknown as Prisma.InputJsonValue, errors: engine.errors.slice(0, 200) as Prisma.InputJsonValue, finishedAt: new Date() } });
    await this.audit.record({ organizationId: org, actorId: userId, action: 'ledger.sync', entityType: 'LedgerSync', entityId: runId, detail: { provider, status, counts: engine.counts, errors: engine.errors.length } });
  }

  @Interval(5 * 60_000)
  async tick() {
    if (!config.ledgers.schedulerEnabled) return;
    const conns = await this.prisma.ledgerConnection.findMany({ where: { settings: { path: ['hourly'], equals: true } }, select: { organizationId: true, provider: true, status: true } });
    for (const c of conns) {
      if (!isProvider(c.provider)) continue;
      if (c.provider === 'tally' ? !(await this.tallyBound(c.organizationId)) : c.status !== 'connected') continue;
      const last = await this.prisma.ledgerSync.findFirst({ where: { organizationId: c.organizationId, provider: c.provider }, orderBy: { startedAt: 'desc' } });
      if (last && (last.status === 'running' || last.startedAt.getTime() > Date.now() - HOUR)) continue;
      await this.startSync(c.organizationId, c.provider, 'schedule', null).catch((e) => this.log.warn(`Scheduled ${c.provider} sync not started: ${(e as Error).message}`));
    }
  }
}

@Controller('accounting/ledgers')
export class LedgerController {
  constructor(private readonly svc: LedgerService) {}

  @Get()
  @Roles(...EDITORS)
  list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.organizationId);
  }

  /** Opened in the browser (not fetched): redirects to the provider's sign-in page. */
  @Get(':provider/connect')
  @Roles('ADMIN')
  async connect(@CurrentUser() u: AuthUser, @Param('provider') p: string, @Res() res: Response) {
    try {
      res.redirect(302, await this.svc.start(u, p, res));
    } catch (e) {
      res.redirect(302, `${web()}/accounting?ledger=${encodeURIComponent(p)}&ledger_error=${encodeURIComponent((e as Error).message)}#direct-sync`);
    }
  }

  @Get(':provider/callback')
  @Public()
  async callback(@Param('provider') p: string, @Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    res.redirect(302, await this.svc.callback(p, q, req, res));
  }

  @Put(':provider/settings')
  @Roles('ADMIN')
  save(@CurrentUser() u: AuthUser, @Param('provider') p: string, @Body(new ZodPipe(syncSettingsSchema)) body: SyncSettings) {
    return this.svc.saveSettings(u, p, body);
  }

  @Post(':provider/test')
  @HttpCode(200)
  @Roles('ADMIN')
  test(@CurrentUser() u: AuthUser, @Param('provider') p: string) {
    return this.svc.test(u.organizationId, p);
  }

  @Post(':provider/sync')
  @Roles(...EDITORS)
  sync(@CurrentUser() u: AuthUser, @Param('provider') p: string) {
    return this.svc.startSync(u.organizationId, p, 'manual', u.id);
  }

  @Delete(':provider')
  @Roles('ADMIN')
  disconnect(@CurrentUser() u: AuthUser, @Param('provider') p: string) {
    return this.svc.disconnect(u, p);
  }
}
