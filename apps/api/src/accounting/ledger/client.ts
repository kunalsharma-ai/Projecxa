import { LedgerBudgetSpent, LedgerError, LedgerSignInExpired } from './types';

/** HTTP plumbing shared by the providers: OAuth refresh with token rotation, pacing, a request budget and retries on 429. */

export interface HttpResponse {
  status: number;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}
export type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<HttpResponse>;

export interface TokenSet {
  access: string;
  /** ms since epoch */
  accessExpires: number;
  refresh: string;
  refreshExpires: number | null;
}
export interface OAuthApp { clientId: string; clientSecret: string; tokenUrl: string }

const basic = (app: OAuthApp) => `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`;

/** Exchange an authorization code for tokens (the callback step). */
export async function exchangeCode(http: Http, app: OAuthApp, code: string, redirectUri: string): Promise<TokenSet> {
  return tokenCall(http, app, { grant_type: 'authorization_code', code, redirect_uri: redirectUri });
}

async function tokenCall(http: Http, app: OAuthApp, form: Record<string, string>): Promise<TokenSet> {
  const res = await http(app.tokenUrl, {
    method: 'POST',
    headers: { Authorization: basic(app), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  const j = JSON.parse((await res.text().catch(() => '')) || '{}') as { access_token?: string; refresh_token?: string; expires_in?: number; x_refresh_token_expires_in?: number; error?: string };
  if (!j.access_token || !j.refresh_token) {
    if (j.error === 'invalid_grant' || res.status === 400 || res.status === 401) throw new LedgerSignInExpired(`The sign-in was refused${j.error ? ` (${j.error})` : ''}. Connect again.`);
    throw new LedgerError(`The sign-in service answered ${res.status}`, res.status);
  }
  const now = Date.now();
  return {
    access: j.access_token,
    accessExpires: now + (j.expires_in ?? 1800) * 1000,
    refresh: j.refresh_token,
    refreshExpires: j.x_refresh_token_expires_in ? now + j.x_refresh_token_expires_in * 1000 : null,
  };
}

/** Holds one connection's tokens. Refresh tokens rotate, so every new set is saved before it is used. */
export class OAuthSession {
  private refreshing: Promise<void> | null = null;
  constructor(
    private readonly app: OAuthApp,
    private tokens: TokenSet,
    private readonly persist: (t: TokenSet) => Promise<void>,
    private readonly http: Http,
  ) {}

  async accessToken(force = false): Promise<string> {
    if (force || this.tokens.accessExpires < Date.now() + 60_000) {
      // One refresh at a time: a second refresh with the old (rotated) token would be refused.
      this.refreshing ??= (async () => {
        const next = await tokenCall(this.http, this.app, { grant_type: 'refresh_token', refresh_token: this.tokens.refresh });
        await this.persist(next);
        this.tokens = next;
      })().finally(() => (this.refreshing = null));
      await this.refreshing;
    }
    return this.tokens.access;
  }
}

export interface Reply { status: number; body: string; headers?: HttpResponse['headers'] }

export class PacedClient {
  requests = 0;
  private last = 0;
  constructor(
    private readonly http: Http,
    private readonly session: OAuthSession | null,
    private readonly opts: { gapMs: number; budget: number; sleep: (ms: number) => Promise<void> },
  ) {}

  async send(method: string, url: string, init: { headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      if (this.requests >= this.opts.budget) throw new LedgerBudgetSpent();
      const wait = this.last + this.opts.gapMs - Date.now();
      if (wait > 0) await this.opts.sleep(wait);
      this.last = Date.now();
      this.requests++;
      const auth: Record<string, string> = this.session ? { Authorization: `Bearer ${await this.session.accessToken(refreshed)}` } : {};
      const res = await this.http(url, { method, headers: { ...auth, ...(init.headers ?? {}) }, ...(init.body !== undefined ? { body: init.body } : {}) });
      if (res.status === 401 && this.session && !refreshed) {
        refreshed = true; // access token revoked or expired early: refresh once
        continue;
      }
      if (res.status === 429 && attempt < 2) {
        const after = Number(res.headers?.get('retry-after'));
        await this.opts.sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 120) * 1000 : 60_000);
        continue;
      }
      if (res.status === 401) throw new LedgerSignInExpired('The accounting system no longer accepts this sign-in. Connect again.');
      return { status: res.status, body: await res.text().catch(() => ''), headers: res.headers };
    }
  }

  async json<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T | null; raw: string }> {
    const r = await this.send(method, url, { headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let data: T | null = null;
    try {
      data = r.body ? (JSON.parse(r.body) as T) : null;
    } catch {
      data = null;
    }
    return { status: r.status, data, raw: r.body };
  }
}
