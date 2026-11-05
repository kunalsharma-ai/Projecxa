import { ApiError, apiRoot, createApi, query } from '../src/lib/api';

function res(status: number, body: unknown, headers: Record<string, string> = {}) {
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { ok: status < 400, status, headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null }, text: async () => (body === undefined ? '' : JSON.stringify(body)) } as unknown as Response;
}

describe('apiRoot', () => {
  it('normalises server addresses', () => {
    expect(apiRoot('crm.example.com')).toBe('https://crm.example.com/api/v1');
    expect(apiRoot('http://localhost:4000/')).toBe('http://localhost:4000/api/v1');
    expect(apiRoot('https://x.io/api/v1/')).toBe('https://x.io/api/v1');
    expect(apiRoot('  ')).toBe('');
  });
});

describe('query', () => {
  it('skips empty values', () => expect(query({ a: 'x y', b: '', c: undefined, d: 2 })).toBe('?a=x%20y&d=2'));
});

describe('createApi', () => {
  it('sends the token and the mobile client header', async () => {
    const calls: [string, RequestInit][] = [];
    const api = createApi({ baseUrl: 'https://x/api/v1', token: 't0k', fetch: async (u, i) => (calls.push([u, i]), res(200, { ok: 1 })) });
    await expect(api.get('/projects')).resolves.toEqual({ ok: 1 });
    const h = calls[0][1].headers as Record<string, string>;
    expect(calls[0][0]).toBe('https://x/api/v1/projects');
    expect(h.Authorization).toBe('Bearer t0k');
    expect(h['X-Client']).toBe('mobile');
  });

  it('reports the features version from every answer', async () => {
    const seen: string[] = [];
    const api = createApi({ baseUrl: 'https://x', token: 't', hooks: { onFeaturesVersion: (v) => seen.push(v) }, fetch: async () => res(200, {}, { 'X-Features-Version': 'abc' }) });
    await api.get('/a');
    expect(seen).toEqual(['abc']);
  });

  it('passes Super Admin blocks to the app and raises an error with the code', async () => {
    const blocked: string[] = [];
    const api = createApi({ baseUrl: 'https://x', token: 't', hooks: { onBlocked: (c, f) => blocked.push(`${c}:${f}`) }, fetch: async () => res(403, { code: 'FEATURE_DISABLED', feature: 'reports', message: 'Off' }) });
    await expect(api.get('/reports/summary')).rejects.toMatchObject({ status: 403, code: 'FEATURE_DISABLED', feature: 'reports', message: 'Off' });
    expect(blocked).toEqual(['FEATURE_DISABLED:reports']);
  });

  it('does not treat MFA setup as a Super Admin block', async () => {
    const blocked: string[] = [];
    const api = createApi({ baseUrl: 'https://x', token: 't', hooks: { onBlocked: (c) => blocked.push(c) }, fetch: async () => res(403, { code: 'MFA_SETUP_REQUIRED' }) });
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(blocked).toEqual([]);
  });

  it('signs out on 401 only when signed in', async () => {
    let out = 0;
    const f = async () => res(401, { message: 'Session expired' });
    await expect(createApi({ baseUrl: 'https://x', token: 't', hooks: { onUnauthorized: () => out++ }, fetch: f }).get('/x')).rejects.toThrow('Session expired');
    await expect(createApi({ baseUrl: 'https://x', token: null, hooks: { onUnauthorized: () => out++ }, fetch: f }).post('/auth/login', {})).rejects.toThrow();
    expect(out).toBe(1);
  });

  it('explains network failures', async () => {
    const api = createApi({ baseUrl: 'https://x', token: null, fetch: async () => { throw new TypeError('Network request failed'); } });
    await expect(api.get('/x')).rejects.toMatchObject({ status: 0, message: 'Cannot reach the server. Check your connection.' });
  });

  it('joins validation messages', async () => {
    const api = createApi({ baseUrl: 'https://x', token: 't', fetch: async () => res(400, { message: ['a is wrong', 'b is wrong'] }) });
    await expect(api.post('/x', {})).rejects.toThrow('a is wrong, b is wrong');
  });
});
