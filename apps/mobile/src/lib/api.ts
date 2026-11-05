/**
 * Talks to the PROJEXA API with the signed-in person's token (Authorization: Bearer).
 * Every call says it comes from the mobile app (X-Client: mobile) so the server applies the
 * mobile subscription, and every answer is checked for X-Features-Version so a change made
 * by Super Admin reaches the app on the next request.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly feature?: string,
  ) {
    super(message);
  }
}

export interface ApiHooks {
  /** The server's features version differs from the one the app has. */
  onFeaturesVersion?: (version: string) => void;
  /** 401: the session ended (expired, password changed, signed out everywhere). */
  onUnauthorized?: () => void;
  /** 403 with a Super Admin code (FEATURE_DISABLED, MOBILE_DISABLED, ORG_SUSPENDED, SUBSCRIPTION_INACTIVE). */
  onBlocked?: (code: string, feature?: string) => void;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ApiConfig {
  baseUrl: string;
  token: string | null;
  hooks?: ApiHooks;
  fetch?: FetchLike;
}

/** "https://crm.example.com" or ".../api/v1" → ".../api/v1" without a trailing slash. */
export function apiRoot(server: string) {
  const s = server.trim().replace(/\/+$/, '');
  if (!s) return '';
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return /\/api\/v1$/.test(withScheme) ? withScheme : `${withScheme}/api/v1`;
}

export function query(params: Record<string, string | number | boolean | null | undefined>) {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return q ? `?${q}` : '';
}

export function createApi(cfg: ApiConfig) {
  const doFetch: FetchLike = cfg.fetch ?? ((u, i) => fetch(u, i));

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!cfg.baseUrl) throw new ApiError('Set the server address first', 0);
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Client': 'mobile' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
    let res: Response;
    try {
      res = await doFetch(`${cfg.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ApiError('Cannot reach the server. Check your connection.', 0);
    }
    const version = res.headers.get('x-features-version');
    if (version) cfg.hooks?.onFeaturesVersion?.(version);
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const d = (data && typeof data === 'object' ? data : {}) as { message?: string | string[]; code?: string; feature?: string };
      const message = Array.isArray(d.message) ? d.message.join(', ') : d.message || `Request failed (${res.status})`;
      if (res.status === 401 && cfg.token) cfg.hooks?.onUnauthorized?.();
      if (res.status === 403 && d.code && d.code !== 'MFA_SETUP_REQUIRED') cfg.hooks?.onBlocked?.(d.code, d.feature);
      throw new ApiError(message, res.status, d.code, d.feature);
    }
    return data as T;
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
    patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
    put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  };
}

export type Api = ReturnType<typeof createApi>;
