const CONFIGURED_API = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const MAIN_WEB = (process.env.NEXT_PUBLIC_WEB_ORIGIN ?? 'http://localhost:3000').replace(/\/$/, '');
/**
 * White-label custom domains (docs/WHITE_LABEL.md): when turned on and the app is opened on an
 * address other than the main one, the API is reached through this web server (/api/v1 is
 * proxied by next.config.mjs), so the sign-in cookie belongs to the custom domain.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_CUSTOM_DOMAINS === 'true' && typeof window !== 'undefined' && window.location.origin !== MAIN_WEB ? window.location.origin : CONFIGURED_API;

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues: string[] = [], public code?: string) {
    super(message);
  }
}

/**
 * Super Admin feature switches (docs/SUPER_ADMIN.md): every response carries X-Features-Version.
 * When it changes, the app reloads what this person may use, so a switch applies at once.
 */
export const FEATURES_EVENT = 'projexa:features';
let featuresVersion: string | null = null;
function watchFeatures(res: Response) {
  const v = res.headers.get('X-Features-Version');
  if (!v || typeof window === 'undefined') return;
  if (featuresVersion && v !== featuresVersion) window.dispatchEvent(new CustomEvent(FEATURES_EVENT, { detail: v }));
  featuresVersion = v;
}

function issueText(i: unknown): string {
  if (typeof i === 'string') return i;
  if (i && typeof i === 'object') {
    const o = i as { path?: string; message?: string; status?: string; scope?: { countryCode?: string; vendorId?: string } };
    const where = [o.status, o.scope?.countryCode, o.path].filter(Boolean).join(' · ');
    return where ? `${where}: ${o.message}` : String(o.message);
  }
  return String(i);
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    credentials: 'include',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  watchFeatures(res);
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) {
      window.location.href = '/login';
    }
    // The organization requires two-step sign-in and this person has not set it up yet.
    if (res.status === 403 && data?.code === 'MFA_SETUP_REQUIRED' && typeof window !== 'undefined' && window.location.pathname !== '/account/security') {
      window.location.href = '/account/security';
    }
    const msg = data?.message && typeof data.message === 'object' ? data.message.message : data?.message;
    const issues = (data?.issues ?? data?.message?.issues ?? []).map(issueText);
    // A feature was switched off, or the organisation was paused: refresh the menu.
    if (res.status === 403 && ['FEATURE_DISABLED', 'ORG_SUSPENDED', 'SUBSCRIPTION_INACTIVE', 'ORG_PENDING'].includes(data?.code) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FEATURES_EVENT, { detail: data.code }));
    }
    throw new ApiError(res.status, msg ?? `Request failed (${res.status})`, issues, data?.code);
  }
  return data as T;
}

export const get = <T,>(p: string) => api<T>(p);
export const post = <T,>(p: string, json?: unknown) => api<T>(p, { method: 'POST', json: json ?? {} });
export const patch = <T,>(p: string, json?: unknown) => api<T>(p, { method: 'PATCH', json: json ?? {} });
