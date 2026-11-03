import { BadRequestException, Body, Controller, Delete, Get, Injectable, Logger, NotFoundException, Param, Put, Query, Req, Res } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Organization, Prisma, User } from '@prisma/client';
import { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { config } from '../common/config';
import { randomToken } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './auth.types';
import { AllowWithoutMfa, CurrentUser, Public, Roles } from './decorators';
import { IntegrationsService } from '../integrations/integrations.service';
import { Discovery, Http, identityOf, OidcError, pkce, PROVIDER_LABEL, SSO_PROVIDERS, SsoProvider, verifyIdToken, ZOHO_ACCOUNTS_HOSTS } from './oidc';
import { SessionService } from './session.service';

export interface SsoConfig { providers: Record<SsoProvider, boolean>; domains: string[]; microsoftTenantId: string | null; ssoOnly: boolean }
export const ssoConfigOf = (v: unknown): SsoConfig => {
  const c = (v ?? {}) as Partial<SsoConfig>;
  return {
    providers: { google: !!c.providers?.google, microsoft: !!c.providers?.microsoft, zoho: !!c.providers?.zoho },
    domains: c.domains ?? [],
    microsoftTenantId: c.microsoftTenantId ?? null,
    ssoOnly: !!c.ssoOnly,
  };
};

const STATE_COOKIE = 'projexa_sso';
const domainRe = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const ssoSettingsSchema = z
  .object({
    providers: z.object({ google: z.boolean(), microsoft: z.boolean(), zoho: z.boolean() }),
    domains: z.array(z.string().trim().toLowerCase().regex(domainRe, 'Use a domain like yourcompany.com')).max(20),
    microsoftTenantId: z.string().trim().regex(/^[0-9a-f-]{36}$/i, 'Use the Directory (tenant) ID, a GUID from the Microsoft Entra admin centre').nullable(),
    ssoOnly: z.boolean(),
  })
  .refine((c) => !Object.values(c.providers).some(Boolean) || c.domains.length > 0, { message: 'Add at least one email domain', path: ['domains'] })
  .refine((c) => !c.providers.microsoft || !!c.microsoftTenantId, { message: 'Microsoft sign-in needs your tenant ID', path: ['microsoftTenantId'] })
  .refine((c) => !c.ssoOnly || Object.values(c.providers).some(Boolean), { message: 'Turn on a provider before making it the only way in', path: ['ssoOnly'] });

const redirectUri = (p: SsoProvider) => `${config.publicBaseUrl}/api/v1/auth/sso/${p}/callback`;
const web = () => config.webOrigins[0] ?? '';

class SsoFailure extends Error {}

@Injectable()
export class SsoService {
  private readonly log = new Logger(SsoService.name);
  private discoveries = new Map<string, { at: number; d: Discovery }>();
  private jwks = new Map<string, { at: number; keys: Record<string, unknown>[] }>();
  http: Http = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly session: SessionService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** Client ID and secret from Settings → Integrations (server owner), else the server env. */
  settings(p: SsoProvider) {
    return this.integrations.sso(p);
  }

  async configured(): Promise<SsoProvider[]> {
    const on = await Promise.all(SSO_PROVIDERS.map(async (p) => !!(await this.settings(p))));
    return SSO_PROVIDERS.filter((_, i) => on[i]);
  }

  private async getJson<T>(url: string, init?: Parameters<Http>[1]): Promise<T> {
    const r = await this.http(url, init);
    const body = (await r.json()) as T & { error?: string; error_description?: string };
    if (r.status >= 400) throw new SsoFailure(`The provider answered ${r.status}${body?.error ? ` (${body.error_description ?? body.error})` : ''}`);
    return body;
  }

  async discovery(url: string): Promise<Discovery> {
    const hit = this.discoveries.get(url);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.d;
    const d = await this.getJson<Discovery>(url);
    this.discoveries.set(url, { at: Date.now(), d });
    return d;
  }

  private async keys(uri: string, refresh = false) {
    const hit = this.jwks.get(uri);
    if (hit && !refresh && Date.now() - hit.at < 3_600_000) return hit.keys;
    const { keys } = await this.getJson<{ keys: Record<string, unknown>[] }>(uri);
    this.jwks.set(uri, { at: Date.now(), keys });
    return keys;
  }

  /** Step 1: send the browser to the provider, with state, nonce and PKCE kept in a short-lived signed cookie. */
  async start(p: SsoProvider, org: string | undefined, res: Response) {
    const s = await this.settings(p);
    if (!s) throw new SsoFailure(`${PROVIDER_LABEL[p]} sign-in is not set up yet`);
    const d = await this.discovery(s.discoveryUrl);
    const state = randomToken(16);
    const nonce = randomToken(16);
    const { verifier, challenge } = pkce();
    const cookie = await this.jwt.signAsync({ p, state, nonce, verifier, org: org ?? null }, { secret: `${config.jwtSecret}:sso-state`, expiresIn: '10m' });
    res.cookie(STATE_COOKIE, cookie, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60 * 1000, path: '/api/v1/auth/sso' });
    const q = new URLSearchParams({ client_id: s.clientId, response_type: 'code', redirect_uri: redirectUri(p), scope: s.scope, state, nonce, code_challenge: challenge, code_challenge_method: 'S256', ...s.extraAuthParams });
    return `${d.authorization_endpoint}?${q}`;
  }

  /** Step 2: back from the provider. Returns where to send the browser. */
  async callback(p: SsoProvider, q: Record<string, string | undefined>, req: Request, res: Response): Promise<string> {
    res.clearCookie(STATE_COOKIE, { path: '/api/v1/auth/sso' });
    try {
      const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[STATE_COOKIE];
      let st: { p: string; state: string; nonce: string; verifier: string; org: string | null };
      try {
        st = await this.jwt.verifyAsync(raw ?? '', { secret: `${config.jwtSecret}:sso-state` });
      } catch {
        throw new SsoFailure('This sign-in took too long or was started in another browser. Try again.');
      }
      if (q.error) throw new SsoFailure(q.error === 'access_denied' ? 'Sign-in was cancelled.' : `${PROVIDER_LABEL[p]} said: ${q.error_description ?? q.error}`);
      if (st.p !== p || !q.state || q.state !== st.state || !q.code) throw new SsoFailure('Sign-in could not be checked. Try again.');
      const s = await this.settings(p);
      if (!s) throw new SsoFailure(`${PROVIDER_LABEL[p]} sign-in is not set up yet`);

      // Zoho: talk to the data centre the person's account lives in, if it is a real Zoho one.
      let discoveryUrl = s.discoveryUrl;
      if (p === 'zoho' && q['accounts-server']) {
        const host = (() => { try { return new URL(q['accounts-server']!).host; } catch { return ''; } })();
        if (!ZOHO_ACCOUNTS_HOSTS.includes(host)) throw new SsoFailure('Unknown Zoho accounts server');
        discoveryUrl = `https://${host}/.well-known/openid-configuration`;
      }
      const d = await this.discovery(discoveryUrl);
      const tok = await this.getJson<{ id_token?: string; access_token?: string }>(d.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: q.code, redirect_uri: redirectUri(p), client_id: s.clientId, client_secret: s.clientSecret, code_verifier: st.verifier }).toString(),
      });
      if (!tok.id_token) throw new SsoFailure(`${PROVIDER_LABEL[p]} did not return an identity`);
      const verify = (keys: Record<string, unknown>[]) => verifyIdToken(tok.id_token!, keys, { issuer: d.issuer, audience: s.clientId, nonce: st.nonce });
      let claims;
      try {
        claims = verify(await this.keys(d.jwks_uri));
      } catch (e) {
        if (!(e instanceof OidcError) || e.message !== 'Unknown signing key') throw e;
        claims = verify(await this.keys(d.jwks_uri, true)); // keys rotated
      }
      let id = identityOf(p, claims);
      if (!claims.email && p === 'zoho' && d.userinfo_endpoint && tok.access_token) {
        const info = await this.getJson<{ email?: string; Email?: string; email_verified?: boolean }>(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${tok.access_token}` } });
        id = identityOf(p, { ...claims, email: info.email ?? info.Email, email_verified: info.email_verified });
      }

      const user = await this.resolve(p, id, st.org);
      if (user.mfaEnabledAt) {
        this.session.setMfaCookie(res, await this.session.mfaToken(user.id));
        return `${web()}/login?step=code`;
      }
      const out = await this.session.start(user, res);
      return `${web()}${out.home}`;
    } catch (e) {
      const msg = e instanceof SsoFailure ? e.message : e instanceof OidcError ? `Sign-in could not be verified (${e.message}).` : 'Sign-in failed. Try again, or use your email and password.';
      if (!(e instanceof SsoFailure)) this.log.warn(`SSO ${p} failed: ${(e as Error).message}`);
      return `${web()}/login?sso_error=${encodeURIComponent(msg)}`;
    }
  }

  /** Finds the PROJEXA user: by the linked identity, or the first time by email, then links it. */
  private async resolve(p: SsoProvider, id: { subject: string; email: string | null; tenant?: string }, orgSlug: string | null): Promise<User & { organization: Organization }> {
    const allowed = (org: Organization, email: string | null) => {
      const c = ssoConfigOf(org.ssoConfig);
      if (!c.providers[p]) return false;
      if (p === 'microsoft' && (!c.microsoftTenantId || c.microsoftTenantId.toLowerCase() !== id.tenant?.toLowerCase())) return false;
      const domain = email?.split('@')[1];
      return !!domain && c.domains.includes(domain);
    };
    const linked = await this.prisma.ssoIdentity.findUnique({ where: { provider_subject: { provider: p, subject: id.subject } }, include: { user: { include: { organization: true } } } });
    if (linked) {
      const u = linked.user;
      if (!u.active) throw new SsoFailure('Your PROJEXA account is not active.');
      if (!allowed(u.organization, id.email ?? linked.email)) throw new SsoFailure(`${PROVIDER_LABEL[p]} sign-in is not turned on for ${u.organization.name}.`);
      await this.prisma.ssoIdentity.update({ where: { id: linked.id }, data: { lastUsedAt: new Date(), ...(id.email ? { email: id.email } : {}) } });
      return u;
    }
    if (!id.email) throw new SsoFailure(`${PROVIDER_LABEL[p]} did not share a verified email address.`);
    const candidates = (await this.prisma.user.findMany({ where: { email: id.email, active: true, ...(orgSlug ? { organization: { slug: orgSlug } } : {}) }, include: { organization: true } })).filter((u) => allowed(u.organization, id.email));
    if (candidates.length === 0) throw new SsoFailure(`No PROJEXA account for ${id.email} can sign in with ${PROVIDER_LABEL[p]}. Ask your admin to add you, or sign in with your password.`);
    if (candidates.length > 1) throw new SsoFailure('Your email is in several organizations. Enter your organization, then choose the sign-in button again.');
    const u = candidates[0];
    try {
      await this.prisma.ssoIdentity.create({ data: { userId: u.id, provider: p, subject: id.subject, email: id.email } });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'sso.link', entityType: 'User', entityId: u.id, detail: { provider: p, email: id.email } });
    return u;
  }
}

/** Public sign-in routes: which buttons to show, start, and the provider callback. */
@Controller('auth/sso')
@Public()
@AllowWithoutMfa()
export class SsoController {
  constructor(private readonly sso: SsoService) {}

  @Get('providers')
  async providers() {
    return (await this.sso.configured()).map((id) => ({ id, label: PROVIDER_LABEL[id] }));
  }

  @Get(':provider/start')
  async start(@Param('provider') p: string, @Query('org') org: string | undefined, @Res() res: Response) {
    if (!SSO_PROVIDERS.includes(p as SsoProvider)) throw new NotFoundException();
    try {
      res.redirect(302, await this.sso.start(p as SsoProvider, org?.trim().toLowerCase() || undefined, res));
    } catch (e) {
      const msg = e instanceof Error && !/fetch|ECONN|timeout/i.test(e.message) ? e.message : 'Could not reach the sign-in provider. Try again.';
      res.redirect(302, `${web()}/login?sso_error=${encodeURIComponent(msg)}`);
    }
  }

  @Get(':provider/callback')
  async callback(@Param('provider') p: string, @Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    if (!SSO_PROVIDERS.includes(p as SsoProvider)) throw new NotFoundException();
    res.redirect(302, await this.sso.callback(p as SsoProvider, q, req, res));
  }
}

/** Admin settings for single sign-on, and linked accounts. */
@Controller()
@Roles('ADMIN')
export class SsoAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sso: SsoService,
    private readonly audit: AuditService,
  ) {}

  @Get('organization/sso')
  async get(@CurrentUser() u: AuthUser) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { ssoConfig: true } });
    const ids = await this.prisma.ssoIdentity.findMany({ where: { user: { organizationId: u.organizationId } }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { lastUsedAt: 'desc' } });
    return {
      settings: ssoConfigOf(org.ssoConfig),
      available: await Promise.all(SSO_PROVIDERS.map(async (id) => ({ id, label: PROVIDER_LABEL[id], configured: !!(await this.sso.settings(id)), redirectUri: redirectUri(id) }))),
      identities: ids.map((i) => ({ id: i.id, provider: i.provider, email: i.email, lastUsedAt: i.lastUsedAt, user: i.user })),
    };
  }

  @Put('organization/sso')
  async put(@CurrentUser() u: AuthUser, @Body(new ZodPipe(ssoSettingsSchema)) body: z.infer<typeof ssoSettingsSchema>) {
    const ready = await this.sso.configured();
    const missing = SSO_PROVIDERS.filter((p) => body.providers[p] && !ready.includes(p));
    if (missing.length) throw new BadRequestException(`${missing.map((p) => PROVIDER_LABEL[p]).join(', ')} sign-in is not set up yet. Add its client ID and secret in Settings → Integrations first.`);
    const data = { ...body, domains: [...new Set(body.domains)], microsoftTenantId: body.microsoftTenantId?.toLowerCase() ?? null };
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { ssoConfig: data as Prisma.InputJsonValue } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'sso.settings', entityType: 'Organization', entityId: u.organizationId, detail: data });
    return this.get(u);
  }

  /** Unlink an account, e.g. someone left and their Google account was reassigned. */
  @Delete('sso-identities/:id')
  async unlink(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const i = await this.prisma.ssoIdentity.findFirst({ where: { id, user: { organizationId: u.organizationId } } });
    if (!i) throw new NotFoundException();
    await this.prisma.ssoIdentity.delete({ where: { id } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'sso.unlink', entityType: 'User', entityId: i.userId, detail: { provider: i.provider, email: i.email } });
    return { ok: true };
  }
}
