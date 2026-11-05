/**
 * Settings → Integrations (docs/INTEGRATIONS.md). Admins set up email, sign-in, AI, accounting and
 * Bidzo in the app; nothing has to be edited on the server. Secrets are AES-256-GCM encrypted at
 * rest and never sent back to the browser. When an organisation has not saved an integration, the
 * old environment variables still apply, so existing servers keep working.
 */
import { promises as dns } from 'dns';
import { isIP } from 'net';
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Global, HttpCode, Injectable, Logger, Module, NotFoundException, Param, Post, Put } from '@nestjs/common';
import { IntegrationSetting } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { decryptSecret, encryptSecret } from '../auth/totp';
import { providerSettings, ProviderSettings, SsoProvider } from '../auth/oidc';
import { aiFrom, AiConfig, config, EnvMap, ledgersFrom, smtpFrom, SmtpConfig, zohoBooksFrom, ZohoBooksConfig, zohoBooksMissingFrom } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService } from '../super-admin/entitlements';
import { BOOTSTRAP_ENV, CATALOG, FieldDef, IntegrationKind, isKind, isPaymentKind, KIND, KindDef } from './catalog';

export type Source = 'app' | 'env' | null;
export interface Resolved { source: Source; env: EnvMap; row: IntegrationSetting | null }
export interface TestResult { ok: boolean; message: string }

export interface HttpReply { status: number; text(): Promise<string> }
export type IntegrationsHttp = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HttpReply>;

const SSO_KIND: Record<SsoProvider, IntegrationKind> = { google: 'sso_google', microsoft: 'sso_microsoft', zoho: 'sso_zoho' };
const LABEL_OF: Record<SsoProvider, string> = { google: 'Google', microsoft: 'Microsoft', zoho: 'Zoho' };
const secretKey = () => `integrations:${config.integrationsEncryptionKey}`;

export const ssoRedirectUri = (p: SsoProvider) => `${config.publicBaseUrl}/api/v1/auth/sso/${p}/callback`;
export const ledgerRedirectUri = (p: 'xero' | 'quickbooks') => `${config.publicBaseUrl}/api/v1/accounting/ledgers/${p}/callback`;

/** 10.x, 172.16-31.x, 192.168.x, loopback, link-local, CGNAT, unique-local IPv6 and similar. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return isPrivateAddress(x.slice(7));
    return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80');
  }
  return true;
}

const line = z.string().max(2000).regex(/^[^\r\n]*$/, 'Use one line');
export const saveSchema = z.object({ values: z.record(z.string(), line.nullable()).default({}) });

@Injectable()
export class IntegrationsService {
  private readonly log = new Logger(IntegrationsService.name);
  /** Swappable in tests. */
  http: IntegrationsHttp = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  lookup: (host: string) => Promise<string[]> = async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address);
  /** Checks SMTP sign-in and sends the test email. Swappable in tests. */
  smtpCheck: (c: SmtpConfig, to: string, fromName: string) => Promise<void> = async (c, to, fromName) => {
    const t = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 20_000 });
    try {
      await t.verify();
      const address = /<([^>]+)>/.exec(c.from)?.[1] ?? c.from;
      await t.sendMail({ from: `"${fromName.replace(/["\\<>]/g, '')}" <${address}>`, to, subject: 'PROJEXA test email', text: 'Email sending from PROJEXA works. You can close this message.', html: '<p>Email sending from PROJEXA works. You can close this message.</p>' });
    } finally {
      t.close();
    }
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** The Super Admin can take an integration away from an organisation (docs/SUPER_ADMIN.md). */
  async allowed(org: string, kind: IntegrationKind): Promise<boolean> {
    if (isPaymentKind(kind)) return true;
    return this.entitlements.orgAllows(org, `integration.${kind}`);
  }

  // ───────────── Reading settings (used by the rest of the app) ─────────────

  /** The organisation that runs this server: marked platformOwner, else the oldest one. */
  async ownerId(): Promise<string | null> {
    const o =
      (await this.prisma.organization.findFirst({ where: { platformOwner: true }, orderBy: { createdAt: 'asc' }, select: { id: true } })) ??
      (await this.prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }));
    return o?.id ?? null;
  }

  private open(row: IntegrationSetting): EnvMap {
    let secrets: EnvMap = {};
    if (row.secrets) {
      try {
        secrets = JSON.parse(decryptSecret(row.secrets, secretKey())) as EnvMap;
      } catch {
        this.log.error(`Could not decrypt the ${row.kind} secrets of organisation ${row.organizationId}. Was MFA_ENCRYPTION_KEY changed?`);
      }
    }
    return { ...(row.values as EnvMap), ...secrets };
  }

  private defaults(def: KindDef): EnvMap {
    return Object.fromEntries(def.fields.filter((f) => f.default !== undefined).map((f) => [f.key, f.default]));
  }

  /** A saved integration for the organisation (or the server owner for platform ones), else the env. */
  async resolve(org: string | null, kind: IntegrationKind): Promise<Resolved> {
    const def = KIND[kind];
    if (org && !(await this.allowed(org, kind))) return { source: null, env: {}, row: null };
    const holder = def.scope === 'platform' ? await this.ownerId() : org;
    const row = holder ? await this.prisma.integrationSetting.findUnique({ where: { organizationId_kind: { organizationId: holder, kind } } }) : null;
    if (row) {
      const env: EnvMap = { ...this.defaults(def), ...this.open(row) };
      // Saved per organisation, so it is bound to the one that saved it.
      if (kind === 'zoho_books' || kind === 'tally') {
        const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: row.organizationId }, select: { slug: true } });
        env[kind === 'tally' ? 'TALLY_TENANT' : 'ZOHO_BOOKS_TENANT'] = o.slug;
      }
      return { source: 'app', env, row };
    }
    return { source: configuredIn(kind, process.env) ? 'env' : null, env: process.env, row: null };
  }

  async smtp(org: string): Promise<SmtpConfig | null> {
    return smtpFrom((await this.resolve(org, 'smtp')).env);
  }
  async sso(p: SsoProvider): Promise<ProviderSettings | null> {
    return providerSettings(p, (await this.resolve(null, SSO_KIND[p])).env);
  }
  async ai(org: string): Promise<AiConfig | null> {
    return aiFrom({ GEMINI_API_URL: process.env.GEMINI_API_URL, ...(await this.resolve(org, 'gemini')).env });
  }
  /** Zoho Books for this organisation, or null when it is not set up (or the env one belongs to another). */
  async zohoBooks(org: string): Promise<{ config: ZohoBooksConfig | null; missing: string[]; otherTenant: boolean; source: Source }> {
    const r = await this.resolve(org, 'zoho_books');
    const c = zohoBooksFrom({ ...urlOverrides('ZOHO_BOOKS_'), ...r.env });
    const missing = zohoBooksMissingFrom(r.env).filter((k) => !(r.source === 'app' && k === 'ZOHO_BOOKS_TENANT'));
    if (!c) return { config: null, missing, otherTenant: false, source: r.source };
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { slug: true } });
    return o.slug === c.tenant ? { config: c, missing: [], otherTenant: false, source: r.source } : { config: null, missing: [], otherTenant: true, source: r.source };
  }
  /** Organisations that may run Zoho Books on a schedule. */
  async zohoBooksOrgs(): Promise<string[]> {
    const rows = await this.prisma.integrationSetting.findMany({ where: { kind: 'zoho_books' }, select: { organizationId: true } });
    const ids = new Set(rows.map((r) => r.organizationId));
    const envTenant = config.zohoBooks?.tenant;
    if (envTenant) {
      const o = await this.prisma.organization.findUnique({ where: { slug: envTenant }, select: { id: true } });
      if (o) ids.add(o.id);
    }
    return [...ids];
  }
  async ledgerApp<P extends 'xero' | 'quickbooks'>(p: P): Promise<NonNullable<ReturnType<typeof ledgersFrom>[P]> | null> {
    const r = await this.resolve(null, p);
    return (ledgersFrom({ ...urlOverrides(p === 'xero' ? 'XERO_' : 'QUICKBOOKS_'), ...r.env })[p] ?? null) as NonNullable<ReturnType<typeof ledgersFrom>[P]> | null;
  }
  /** Tally for this organisation: a saved address, or the env one when TALLY_TENANT is this organisation. */
  async tally(org: string): Promise<{ config: { url: string; tenant: string } | null; otherTenant: boolean; configured: boolean }> {
    const r = await this.resolve(org, 'tally');
    const t = ledgersFrom(r.env).tally;
    if (!t) return { config: null, otherTenant: false, configured: false };
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { slug: true } });
    return o.slug === t.tenant ? { config: t, otherTenant: false, configured: true } : { config: null, otherTenant: true, configured: true };
  }
  async tallyOrgs(): Promise<string[]> {
    const rows = await this.prisma.integrationSetting.findMany({ where: { kind: 'tally' }, select: { organizationId: true } });
    const ids = new Set(rows.map((r) => r.organizationId));
    const envTenant = config.ledgers.tally?.tenant;
    if (envTenant) {
      const o = await this.prisma.organization.findUnique({ where: { slug: envTenant }, select: { id: true } });
      if (o) ids.add(o.id);
    }
    return [...ids];
  }
  async bidzoUrl(org: string): Promise<string | null> {
    const r = await this.resolve(org, 'bidzo');
    return r.source === 'app' ? r.env.BIDZO_URL?.trim() || null : null;
  }

  // ───────────── Settings screen ─────────────

  private async canEdit(u: AuthUser, def: KindDef) {
    if (u.role !== 'ADMIN') return false;
    if (!(await this.allowed(u.organizationId, def.kind))) return false;
    if (def.scope === 'platform' || def.ownerOnly) return (await this.ownerId()) === u.organizationId;
    return true;
  }

  private redirectUri(kind: IntegrationKind): string | null {
    if (kind.startsWith('sso_')) return ssoRedirectUri(kind.slice(4) as SsoProvider);
    if (kind === 'xero' || kind === 'quickbooks') return ledgerRedirectUri(kind);
    return null;
  }

  async list(u: AuthUser) {
    const owner = (await this.ownerId()) === u.organizationId;
    const users = new Map<string, string>();
    const out = [];
    for (const def of CATALOG) {
      // Payment gateways belong to the server owner only; other organisations never see them.
      if (isPaymentKind(def.kind) && !owner) continue;
      const r = await this.resolve(u.organizationId, def.kind);
      const configured = configuredIn(def.kind, r.env);
      let detail: string | null = null;
      let state: 'connected' | 'env' | 'off' | 'other' = r.source === 'app' && configured ? 'connected' : r.source === 'env' ? 'env' : 'off';
      if (def.kind === 'zoho_books') {
        const z = await this.zohoBooks(u.organizationId);
        if (z.otherTenant) { state = 'other'; detail = 'The server settings for Zoho Books belong to another organisation. Save your own here.'; }
      }
      if (def.kind === 'tally') {
        const t = await this.tally(u.organizationId);
        if (t.otherTenant) { state = 'other'; detail = 'The server settings for Tally belong to another organisation.'; }
      }
      if (r.source === 'app' && !configured) detail = 'Saved, but some required fields are empty.';
      const by = r.row?.updatedById;
      if (by && !users.has(by)) users.set(by, (await this.prisma.user.findUnique({ where: { id: by }, select: { name: true } }))?.name ?? '');
      const redirectUri = this.redirectUri(def.kind);
      const fill = (s: string) => s.replace('{redirectUri}', redirectUri ?? '').replace('{webOrigin}', config.webOrigins[0] ?? '').replace('{apiOrigin}', config.publicBaseUrl);
      const editable = await this.canEdit(u, def);
      const showValues = u.role === 'ADMIN' && (def.scope === 'org' || owner);
      const allowed = await this.allowed(u.organizationId, def.kind);
      if (!allowed) { state = 'off'; detail = 'Not part of your plan. Your PROJEXA provider can turn it on.'; }
      out.push({
        ...def,
        allowed,
        steps: def.steps.map(fill),
        redirectUri,
        editable,
        managedByServerOwner: (def.scope === 'platform' || !!def.ownerOnly) && !owner,
        status: {
          state,
          source: r.source,
          detail,
          updatedAt: r.row?.updatedAt ?? null,
          updatedBy: by ? users.get(by) || null : null,
          lastTestAt: r.row?.lastTestAt ?? null,
          lastTestOk: r.row?.lastTestOk ?? null,
          lastTestMessage: r.row?.lastTestMessage ?? null,
        },
        values: showValues ? this.visible(def, r) : {},
        secretsSet: showValues ? Object.fromEntries(def.fields.filter((f) => f.type === 'secret' && !f.transient).map((f) => [f.key, !!r.env[f.key]?.trim()])) : {},
      });
    }
    return {
      owner,
      integrations: out,
      bootstrap: BOOTSTRAP_ENV.map((b) => ({ ...b, set: !!process.env[b.name]?.trim() })),
      encryptionKeySet: !!(process.env.INTEGRATIONS_ENCRYPTION_KEY || process.env.ACCOUNTING_ENCRYPTION_KEY || process.env.MFA_ENCRYPTION_KEY),
    };
  }

  /** Non-secret values. For server (env) settings, shown so admins can copy them across. */
  private visible(def: KindDef, r: Resolved): Record<string, string> {
    if (!r.source) return {};
    return Object.fromEntries(def.fields.filter((f) => f.type !== 'secret').map((f) => [f.key, r.env[f.key]?.trim() ?? f.default ?? '']));
  }

  private async validate(u: AuthUser, def: KindDef, f: FieldDef, v: string) {
    if (f.type === 'select' && !f.options!.some((o) => o.value === v)) throw new BadRequestException(`${f.label}: pick one of the options`);
    if (f.type === 'email' && v && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)) throw new BadRequestException(`${f.label}: enter an email address`);
    if (f.type === 'url' && v) {
      let url: URL;
      try { url = new URL(v); } catch { throw new BadRequestException(`${f.label}: enter a full address starting with https://`); }
      const httpOk = def.kind === 'tally' || config.allowHttpRedirects;
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && httpOk)) throw new BadRequestException(`${f.label}: use an https:// address`);
      if (url.username || url.password) throw new BadRequestException(`${f.label}: leave the user name and password out of the address`);
    }
    if (f.key === 'SMTP_HOST' && v) {
      if (!/^[a-z0-9.-]+$/i.test(v)) throw new BadRequestException('SMTP server: enter a host name such as smtp.zoho.in');
      // Only the server owner may point PROJEXA at its own private network.
      if (process.env.NODE_ENV === 'production' && (await this.ownerId()) !== u.organizationId) {
        const ips = await this.lookup(v).catch(() => [] as string[]);
        if (!ips.length) throw new BadRequestException(`SMTP server ${v} could not be found`);
        if (ips.some(isPrivateAddress)) throw new BadRequestException('SMTP server: use a public mail server');
      }
    }
  }

  async save(u: AuthUser, kind: string, body: z.infer<typeof saveSchema>) {
    if (!isKind(kind)) throw new NotFoundException('Unknown integration');
    const def = KIND[kind];
    if (!(await this.canEdit(u, def))) throw new ForbiddenException(def.scope === 'platform' || def.ownerOnly ? 'Only the admins of the organisation that runs this PROJEXA server can change this' : 'Only admins can change integrations');
    const existing = await this.prisma.integrationSetting.findUnique({ where: { organizationId_kind: { organizationId: u.organizationId, kind } } });
    const before = existing ? this.open(existing) : {};
    const values: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    let transient: Record<string, string> = {};
    for (const f of def.fields) {
      const raw = body.values[f.key];
      let v: string | undefined;
      if (f.type === 'secret') {
        // Empty = keep the saved one; null = remove it.
        v = raw === null ? undefined : raw?.trim() ? raw.trim() : before[f.key];
      } else {
        v = raw === undefined ? before[f.key] : raw?.trim() ?? undefined;
      }
      if (!v) continue;
      await this.validate(u, def, f, v);
      if (f.transient) transient = { ...transient, [f.key]: v };
      else if (f.type === 'secret') secrets[f.key] = v;
      else values[f.key] = v;
    }
    let notice: string | null = null;
    if (kind === 'zoho_books' && transient.ZOHO_BOOKS_GRANT_CODE) {
      const r = await this.zohoGrant({ ...values, ...secrets }, transient.ZOHO_BOOKS_GRANT_CODE);
      secrets.ZOHO_BOOKS_REFRESH_TOKEN = r.refreshToken;
      if (!values.ZOHO_BOOKS_ORGANIZATION_ID && r.organizationId) values.ZOHO_BOOKS_ORGANIZATION_ID = r.organizationId;
      notice = r.notice;
    }
    const missing = def.fields.filter((f) => f.required && !values[f.key] && !secrets[f.key]).map((f) => f.label);
    if (kind === 'zoho_books' && !secrets.ZOHO_BOOKS_REFRESH_TOKEN) missing.push('Grant code (or refresh token)');
    if (missing.length) throw new BadRequestException(`Fill in: ${missing.join(', ')}`);
    const sealed = Object.keys(secrets).length ? encryptSecret(JSON.stringify(secrets), secretKey()) : null;
    const changed = def.fields.filter((f) => !f.transient && (f.type === 'secret' ? secrets[f.key] !== before[f.key] : values[f.key] !== before[f.key])).map((f) => f.key);
    await this.prisma.integrationSetting.upsert({
      where: { organizationId_kind: { organizationId: u.organizationId, kind } },
      create: { organizationId: u.organizationId, kind, values, secrets: sealed, updatedById: u.id },
      update: { values, secrets: sealed, updatedById: u.id, ...(changed.length ? { lastTestAt: null, lastTestOk: null, lastTestMessage: null } : {}) },
    });
    // Secrets are never written to the audit log, only which settings changed.
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'integration.saved', entityType: 'IntegrationSetting', entityId: kind, detail: { kind, changed } });
    return { ...(await this.one(u, kind)), notice };
  }

  async remove(u: AuthUser, kind: string) {
    if (!isKind(kind)) throw new NotFoundException('Unknown integration');
    const def = KIND[kind];
    if (!(await this.canEdit(u, def))) throw new ForbiddenException('You cannot change this integration');
    await this.prisma.integrationSetting.deleteMany({ where: { organizationId: u.organizationId, kind } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'integration.removed', entityType: 'IntegrationSetting', entityId: kind, detail: { kind } });
    return this.one(u, kind);
  }

  private async one(u: AuthUser, kind: IntegrationKind) {
    return (await this.list(u)).integrations.find((i) => i.kind === kind)!;
  }

  async test(u: AuthUser, kind: string): Promise<TestResult & { integration: Awaited<ReturnType<IntegrationsService['one']>> }> {
    if (!isKind(kind)) throw new NotFoundException('Unknown integration');
    const def = KIND[kind];
    if (u.role !== 'ADMIN') throw new ForbiddenException('Only admins can test integrations');
    if ((def.scope === 'platform' || def.ownerOnly) && !(await this.canEdit(u, def))) throw new ForbiddenException('Only the server owner can test this');
    let result: TestResult;
    try {
      result = await this.run(u, kind);
    } catch (e) {
      result = { ok: false, message: (e as Error).message.slice(0, 500) };
    }
    const holder = def.scope === 'platform' ? await this.ownerId() : u.organizationId;
    if (holder) await this.prisma.integrationSetting.updateMany({ where: { organizationId: holder, kind }, data: { lastTestAt: new Date(), lastTestOk: result.ok, lastTestMessage: result.message } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'integration.tested', entityType: 'IntegrationSetting', entityId: kind, detail: { kind, ok: result.ok } });
    return { ...result, integration: await this.one(u, kind) };
  }

  // ───────────── Connection tests ─────────────

  private async run(u: AuthUser, kind: IntegrationKind): Promise<TestResult> {
    switch (kind) {
      case 'smtp': {
        const c = await this.smtp(u.organizationId);
        if (!c) return { ok: false, message: 'Enter the mailbox and app password first.' };
        const me = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { email: true } });
        try {
          await this.smtpCheck(c, me.email, 'PROJEXA');
        } catch (e) {
          const m = (e as Error).message;
          if (/auth|535|credentials/i.test(m)) return { ok: false, message: `${c.host} did not accept the mailbox and password. Use a Zoho app password, and check the server matches your data centre (smtp.zoho.in for India). (${m.slice(0, 160)})` };
          return { ok: false, message: `Could not send through ${c.host}:${c.port}: ${m.slice(0, 200)}` };
        }
        return { ok: true, message: `Signed in to ${c.host} and sent a test email to ${me.email}.` };
      }
      case 'sso_google':
      case 'sso_microsoft':
      case 'sso_zoho': {
        const p = kind.slice(4) as SsoProvider;
        const s = await this.sso(p);
        if (!s) return { ok: false, message: 'Enter the client ID and secret first.' };
        return this.oauthClientCheck(LABEL_OF[p], await this.discoveredTokenUrl(s.discoveryUrl), s.clientId, s.clientSecret, ssoRedirectUri(p), 'body');
      }
      case 'xero':
      case 'quickbooks': {
        const a = await this.ledgerApp(kind);
        if (!a) return { ok: false, message: 'Enter the client ID and secret first.' };
        return this.oauthClientCheck(kind === 'xero' ? 'Xero' : 'QuickBooks', a.tokenUrl, a.clientId, a.clientSecret, ledgerRedirectUri(kind), 'basic');
      }
      case 'gemini': {
        const c = await this.ai(u.organizationId);
        if (!c) return { ok: false, message: 'Enter the API key first.' };
        const r = await this.http(`${c.apiUrl}/v1beta/models?pageSize=1000`, { headers: { 'x-goog-api-key': c.apiKey } });
        const j = safeJson(await r.text()) as { models?: { name: string }[]; error?: { message?: string } };
        if (r.status === 400 || r.status === 401 || r.status === 403) return { ok: false, message: `Google did not accept the API key${j.error?.message ? `: ${j.error.message}` : ''}` };
        if (r.status !== 200) return { ok: false, message: `Google answered ${r.status}${j.error?.message ? `: ${j.error.message}` : ''}` };
        const names = new Set((j.models ?? []).map((m) => m.name.replace(/^models\//, '')));
        const unknown = [c.model, c.fallbackModel, c.liveModel].filter((m): m is string => !!m && names.size > 0 && !names.has(m));
        if (unknown.length) return { ok: false, message: `The key works, but these models are not available to it: ${unknown.join(', ')}. Pick names from Google AI Studio.` };
        return { ok: true, message: `The key works. ${c.model} is available.` };
      }
      case 'zoho_books': {
        const z = await this.zohoBooks(u.organizationId);
        if (!z.config) return { ok: false, message: z.otherTenant ? 'The server Zoho Books settings belong to another organisation.' : `Not set up yet. Missing: ${z.missing.join(', ')}` };
        const token = await this.zohoToken(z.config);
        const r = await this.http(`${z.config.apiUrl}/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${token}` } });
        const j = safeJson(await r.text()) as { organizations?: { organization_id: string; name: string }[]; message?: string };
        if (r.status !== 200) return { ok: false, message: `Zoho Books answered ${r.status}${j.message ? `: ${j.message}` : ''}` };
        const hit = j.organizations?.find((o) => String(o.organization_id) === z.config!.organizationId);
        if (!hit) return { ok: false, message: `Signed in, but organization ID ${z.config.organizationId} is not in this Zoho login. Available: ${(j.organizations ?? []).map((o) => `${o.name} (${o.organization_id})`).join(', ') || 'none'}` };
        return { ok: true, message: `Connected to Zoho Books organisation "${hit.name}".` };
      }
      case 'tally': {
        const t = await this.tally(u.organizationId);
        if (!t.config) return { ok: false, message: 'Enter the Tally address first.' };
        const req = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ProjexaCompanies</ID></HEADER><BODY><DESC><TDL><TDLMESSAGE><COLLECTION NAME="ProjexaCompanies"><TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>';
        let r: HttpReply;
        try {
          r = await this.http(t.config.url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8' }, body: req });
        } catch (e) {
          return { ok: false, message: `Tally Prime could not be reached at ${new URL(t.config.url).host}: ${(e as Error).message}. Is Tally open with its XML server on, and reachable from the PROJEXA server?` };
        }
        if (r.status !== 200) return { ok: false, message: `Tally Prime answered ${r.status}` };
        const names = [...(await r.text()).matchAll(/<COMPANY NAME="([^"]*)"/gi)].map((m) => m[1]);
        return { ok: true, message: `Tally Prime answered at ${new URL(t.config.url).host}${names.length ? `. Open: ${names.join(', ')}` : ''}.` };
      }
      case 'bidzo':
        return { ok: true, message: 'Nothing to test.' };
      case 'razorpay': {
        const env = (await this.resolve(null, 'razorpay')).env;
        if (!configuredIn('razorpay', env)) return { ok: false, message: 'Enter the Key ID and Key secret first.' };
        const auth = Buffer.from(`${env.RAZORPAY_KEY_ID!.trim()}:${env.RAZORPAY_KEY_SECRET!.trim()}`).toString('base64');
        const r = await this.http(`${process.env.RAZORPAY_API_URL ?? 'https://api.razorpay.com'}/v1/payments?count=1`, { headers: { Authorization: `Basic ${auth}` } });
        if (r.status === 200) return { ok: true, message: `Razorpay accepted the keys (${env.RAZORPAY_KEY_ID!.startsWith('rzp_test_') ? 'test mode' : 'live mode'}).` };
        return { ok: false, message: r.status === 401 ? 'Razorpay did not accept the Key ID and secret.' : `Razorpay answered ${r.status}.` };
      }
      case 'stripe': {
        const env = (await this.resolve(null, 'stripe')).env;
        if (!configuredIn('stripe', env)) return { ok: false, message: 'Enter the secret key first.' };
        const r = await this.http(`${process.env.STRIPE_API_URL ?? 'https://api.stripe.com'}/v1/balance`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY!.trim()}` } });
        if (r.status === 200) return { ok: true, message: `Stripe accepted the key (${env.STRIPE_SECRET_KEY!.includes('_test_') ? 'test mode' : 'live mode'}).` };
        return { ok: false, message: r.status === 401 ? 'Stripe did not accept the key.' : `Stripe answered ${r.status}.` };
      }
    }
  }

  private async discoveredTokenUrl(discoveryUrl: string): Promise<string> {
    const r = await this.http(discoveryUrl);
    const j = safeJson(await r.text()) as { token_endpoint?: string };
    if (r.status !== 200 || !j.token_endpoint) throw new Error(`The sign-in provider could not be reached (${r.status})`);
    return j.token_endpoint;
  }

  /**
   * Checks a client ID and secret without anyone signing in: a token request with a made-up code
   * fails with invalid_client when the ID or secret is wrong, and with invalid_grant when they are right.
   */
  private async oauthClientCheck(label: string, tokenUrl: string, clientId: string, clientSecret: string, redirect: string, auth: 'body' | 'basic'): Promise<TestResult> {
    const form = new URLSearchParams({ grant_type: 'authorization_code', code: 'projexa-connection-test', redirect_uri: redirect, ...(auth === 'body' ? { client_id: clientId, client_secret: clientSecret } : {}) });
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    if (auth === 'basic') headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    const r = await this.http(tokenUrl, { method: 'POST', headers, body: form.toString() });
    const j = safeJson(await r.text()) as { error?: string; error_description?: string };
    if (j.error === 'invalid_client' || j.error === 'unauthorized_client') return { ok: false, message: `${label} did not accept the client ID and secret${j.error_description ? `: ${j.error_description.split(/\r?\n/)[0].slice(0, 200)}` : ''}.` };
    if (r.status >= 500) return { ok: false, message: `${label} answered ${r.status}. Try again in a minute.` };
    return { ok: true, message: `${label} accepted the client ID and secret. The redirect URI is checked the first time someone signs in.` };
  }

  private async zohoToken(c: { accountsUrl: string; clientId: string; clientSecret: string; refreshToken: string }): Promise<string> {
    const form = new URLSearchParams({ refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'refresh_token' });
    const r = await this.http(`${c.accountsUrl}/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    const j = safeJson(await r.text()) as { access_token?: string; error?: string };
    if (!j.access_token) throw new Error(`Zoho did not accept the refresh token${j.error ? ` (${j.error})` : ''}. Generate a new grant code and save it.`);
    return j.access_token;
  }

  /** Swaps a Self Client grant code for a refresh token, and finds the Books organisation when there is one. */
  private async zohoGrant(v: EnvMap, code: string): Promise<{ refreshToken: string; organizationId: string | null; notice: string | null }> {
    const dc = v.ZOHO_BOOKS_DC || 'com';
    const accountsUrl = (process.env.ZOHO_BOOKS_ACCOUNTS_URL?.trim() || `https://accounts.zoho.${dc}`).replace(/\/$/, '');
    const apiUrl = (process.env.ZOHO_BOOKS_API_URL?.trim() || `https://www.zohoapis.${dc}/books/v3`).replace(/\/$/, '');
    if (!v.ZOHO_BOOKS_CLIENT_ID || !v.ZOHO_BOOKS_CLIENT_SECRET) throw new BadRequestException('Enter the self client ID and secret with the grant code');
    const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: v.ZOHO_BOOKS_CLIENT_ID, client_secret: v.ZOHO_BOOKS_CLIENT_SECRET, code });
    const r = await this.http(`${accountsUrl}/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    const j = safeJson(await r.text()) as { refresh_token?: string; access_token?: string; error?: string };
    if (!j.refresh_token) {
      const why = j.error === 'invalid_code' ? 'The grant code was already used or has expired. Generate a new one (10 minutes) and save again.' : j.error === 'invalid_client' ? 'Zoho did not accept the client ID and secret. Check they are from the Self Client, in the data centre you picked.' : `Zoho said: ${j.error ?? r.status}`;
      throw new BadRequestException(why);
    }
    let organizationId: string | null = null;
    let notice: string | null = null;
    try {
      const o = await this.http(`${apiUrl}/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${j.access_token}` } });
      const orgs = ((safeJson(await o.text()) as { organizations?: { organization_id: string; name: string }[] }).organizations ?? []);
      if (orgs.length === 1) organizationId = String(orgs[0].organization_id);
      else if (orgs.length > 1) notice = `Your Zoho login has several Books organisations: ${orgs.map((x) => `${x.name} (${x.organization_id})`).join(', ')}. Enter the one to use.`;
    } catch {
      notice = 'Got the refresh token. Enter the Zoho Books organization ID.';
    }
    return { refreshToken: j.refresh_token, organizationId, notice };
  }
}

/** URL overrides stay in the env (for tests and private gateways); they are never set from the screen. */
function urlOverrides(prefix: string): EnvMap {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith(prefix) && k.endsWith('_URL') && k !== 'TALLY_URL'));
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return {};
  }
}

export function configuredIn(kind: IntegrationKind, env: EnvMap): boolean {
  switch (kind) {
    case 'smtp': return !!smtpFrom(env);
    case 'sso_google': return !!providerSettings('google', env);
    case 'sso_microsoft': return !!providerSettings('microsoft', env);
    case 'sso_zoho': return !!providerSettings('zoho', env);
    case 'gemini': return !!aiFrom(env);
    case 'zoho_books': return !!zohoBooksFrom(env);
    case 'xero': return !!ledgersFrom(env).xero;
    case 'quickbooks': return !!ledgersFrom(env).quickbooks;
    case 'tally': return !!ledgersFrom(env).tally;
    case 'bidzo': return !!env.BIDZO_URL?.trim();
    case 'razorpay': return !!env.RAZORPAY_KEY_ID?.trim() && !!env.RAZORPAY_KEY_SECRET?.trim();
    case 'stripe': return !!env.STRIPE_SECRET_KEY?.trim();
  }
}

@Controller('integrations/settings')
@Roles('ADMIN')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.integrations.list(u);
  }

  @Put(':kind')
  save(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @Body(new ZodPipe(saveSchema)) body: z.infer<typeof saveSchema>) {
    return this.integrations.save(u, kind, body);
  }

  @Delete(':kind')
  remove(@CurrentUser() u: AuthUser, @Param('kind') kind: string) {
    return this.integrations.remove(u, kind);
  }

  @Post(':kind/test')
  @HttpCode(200)
  test(@CurrentUser() u: AuthUser, @Param('kind') kind: string) {
    return this.integrations.test(u, kind);
  }
}

@Global()
@Module({ providers: [IntegrationsService], controllers: [IntegrationsController], exports: [IntegrationsService] })
export class IntegrationsModule {}

