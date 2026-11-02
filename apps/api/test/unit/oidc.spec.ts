import { generateKeyPairSync, sign } from 'crypto';
import { b64url, identityOf, pkce, providerSettings, verifyIdToken } from '../../src/auth/oidc';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
export function idToken(claims: object, key = privateKey, kid = 'k1') {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid }));
  const p = b64url(JSON.stringify(claims));
  return `${h}.${p}.${b64url(sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key))}`;
}
const now = Math.floor(Date.now() / 1000);
const base = { iss: 'https://accounts.google.com', aud: 'cid', sub: '123', exp: now + 600, iat: now, nonce: 'n1', email: 'a@acme.com', email_verified: true };
const opts = { issuer: 'https://accounts.google.com', audience: 'cid', nonce: 'n1' };

describe('OIDC', () => {
  it('verifies a good token', () => {
    expect(verifyIdToken(idToken(base), [jwk], opts).sub).toBe('123');
  });

  it('rejects bad signature, issuer, audience, expiry, nonce and algorithm', () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect(() => verifyIdToken(idToken(base, other), [jwk], opts)).toThrow('Bad signature');
    expect(() => verifyIdToken(idToken({ ...base, iss: 'https://evil.example' }), [jwk], opts)).toThrow('issuer');
    expect(() => verifyIdToken(idToken({ ...base, aud: 'other' }), [jwk], opts)).toThrow('another application');
    expect(() => verifyIdToken(idToken({ ...base, exp: now - 1000 }), [jwk], opts)).toThrow('expired');
    expect(() => verifyIdToken(idToken({ ...base, nonce: 'x' }), [jwk], opts)).toThrow('Nonce');
    expect(() => verifyIdToken(idToken(base, privateKey, 'k2'), [jwk], opts)).toThrow('Unknown signing key');
    const none = `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify(base))}.`;
    expect(() => verifyIdToken(none, [jwk], opts)).toThrow('algorithm');
  });

  it('accepts the Microsoft multi-tenant issuer only for the token tenant', () => {
    const ms = { ...base, iss: 'https://login.microsoftonline.com/t1/v2.0', tid: 't1', oid: 'o1' };
    const o = { ...opts, issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0' };
    expect(verifyIdToken(idToken(ms), [jwk], o).tid).toBe('t1');
    expect(() => verifyIdToken(idToken({ ...ms, tid: 't2' }), [jwk], o)).toThrow('issuer');
  });

  it('maps identities per provider', () => {
    expect(identityOf('google', { ...base, email_verified: false }).email).toBeNull();
    expect(identityOf('google', base)).toEqual({ subject: '123', email: 'a@acme.com' });
    expect(identityOf('microsoft', { ...base, email: undefined, preferred_username: 'B@Acme.com', tid: 't', oid: 'o' })).toEqual({ subject: 't:o', email: 'b@acme.com', tenant: 't' });
    expect(identityOf('zoho', { ...base, email_verified: undefined }).email).toBe('a@acme.com');
  });

  it('reads provider settings from the environment', () => {
    expect(providerSettings('google', {})).toBeNull();
    expect(providerSettings('zoho', { ZOHO_CLIENT_ID: 'z', ZOHO_CLIENT_SECRET: 's', ZOHO_ACCOUNTS_URL: 'https://accounts.zoho.in' })?.discoveryUrl).toBe('https://accounts.zoho.in/.well-known/openid-configuration');
    const p = pkce();
    expect(p.verifier).not.toBe(p.challenge);
  });
});
