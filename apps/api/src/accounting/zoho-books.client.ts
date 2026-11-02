/**
 * A small Zoho Books v3 API client: OAuth refresh-token grant, the organization_id parameter on
 * every call, the { code, message } envelope, and the documented limit of 30 requests a minute.
 */

export interface HttpResponse {
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
}
export type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<HttpResponse>;

export interface ZohoBooksCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  organizationId: string;
  apiUrl: string;
  accountsUrl: string;
}

export class ZohoBooksError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
  }
}
/** The run used its request allowance. The next run carries on where this one stopped. */
export class BudgetSpent extends Error {
  constructor() {
    super('Stopped at the request allowance for one run. The next run carries on.');
  }
}

/** Access tokens last an hour; reuse them across runs instead of asking Zoho for a new one each time. */
const tokens = new Map<string, { value: string; expires: number }>();
export const clearZohoTokens = () => tokens.clear();

export class ZohoBooksClient {
  requests = 0;
  private last = 0;

  constructor(
    private readonly creds: ZohoBooksCredentials,
    private readonly http: Http,
    private readonly opts: { gapMs: number; budget: number; sleep: (ms: number) => Promise<void> },
  ) {}

  private async token(force = false): Promise<string> {
    const key = `${this.creds.accountsUrl}|${this.creds.clientId}`;
    const t = tokens.get(key);
    if (!force && t && t.expires > Date.now() + 60_000) return t.value;
    const form = new URLSearchParams({ refresh_token: this.creds.refreshToken, client_id: this.creds.clientId, client_secret: this.creds.clientSecret, grant_type: 'refresh_token' });
    const res = await this.http(`${this.creds.accountsUrl}/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!j.access_token) throw new ZohoBooksError(`Zoho did not accept the refresh token${j.error ? ` (${j.error})` : ''}. Create a new one as described in docs/ZOHO_BOOKS.md.`, res.status);
    tokens.set(key, { value: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 });
    return j.access_token;
  }

  async call<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'PUT', path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
    const q = new URLSearchParams({ organization_id: this.creds.organizationId, ...(opts.query ?? {}) });
    const url = `${this.creds.apiUrl}${path}?${q}`;
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      if (this.requests >= this.opts.budget) throw new BudgetSpent();
      const wait = this.last + this.opts.gapMs - Date.now();
      if (wait > 0) await this.opts.sleep(wait);
      this.last = Date.now();
      this.requests++;
      const token = await this.token(refreshed);
      const res = await this.http(url, {
        method,
        headers: { Authorization: `Zoho-oauthtoken ${token}`, Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
      if (res.status === 401 && !refreshed) {
        refreshed = true; // token revoked or expired early: get a new one, once
        continue;
      }
      if (res.status === 429 && attempt < 2) {
        const after = Number(res.headers?.get('retry-after'));
        await this.opts.sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 120) * 1000 : 60_000);
        continue;
      }
      const j = (await res.json().catch(() => null)) as ({ code?: number; message?: string } & T) | null;
      if (!j) throw new ZohoBooksError(`Zoho Books answered ${res.status} without a readable body`, res.status);
      if (j.code !== 0) throw new ZohoBooksError(j.message || `Zoho Books error ${j.code ?? res.status}`, res.status, j.code);
      return j;
    }
  }
}
