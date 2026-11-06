/**
 * Minimal OpenID Connect client for Google, Microsoft (Entra ID) and Zoho: discovery, PKCE and
 * id_token verification (RS256 against the provider's published keys). No extra libraries.
 */
import { createHash, createPublicKey, verify as verifySig } from 'crypto';
import type { webcrypto } from 'crypto';
import { randomToken } from '../common/crypto';

// Recent @types/node (26) no longer exports JsonWebKey from the top of 'crypto'.
type JsonWebKey = webcrypto.JsonWebKey;

export const SSO_PROVIDERS = ['google', 'microsoft', 'zoho'] as const;
export type SsoProvider = (typeof SSO_PROVIDERS)[number];
export const PROVIDER_LABEL: Record<SsoProvider, string> = { google: 'Google', microsoft: 'Microsoft', zoho: 'Zoho' };

/** Zoho runs one accounts server per data centre; its callback says which one the person uses. */
export const ZOHO_ACCOUNTS_HOSTS = ['accounts.zoho.com', 'accounts.zoho.in', 'accounts.zoho.eu', 'accounts.zoho.com.au', 'accounts.zoho.jp', 'accounts.zoho.ca', 'accounts.zoho.sa', 'accounts.zohocloud.ca'];

export interface ProviderSettings { clientId: string; clientSecret: string; discoveryUrl: string; scope: string; extraAuthParams: Record<string, string> }

export function providerSettings(p: SsoProvider, env = process.env): ProviderSettings | null {
  const up = p.toUpperCase();
  const clientId = env[`${up}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${up}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  switch (p) {
    case 'google':
      return { clientId, clientSecret, discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration', scope: 'openid email profile', extraAuthParams: { prompt: 'select_account' } };
    case 'microsoft':
      // Work and school accounts from any tenant; each organization pins its own tenant in Settings.
      return { clientId, clientSecret, discoveryUrl: 'https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration', scope: 'openid email profile', extraAuthParams: { prompt: 'select_account' } };
    case 'zoho': {
      const base = (env.ZOHO_ACCOUNTS_URL?.trim() || 'https://accounts.zoho.com').replace(/\/$/, '');
      return { clientId, clientSecret, discoveryUrl: `${base}/.well-known/openid-configuration`, scope: 'openid email profile', extraAuthParams: { prompt: 'consent', access_type: 'online' } };
    }
  }
}

export interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; userinfo_endpoint?: string }
export type Http = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

export const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function pkce() {
  const verifier = randomToken(32);
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

export class OidcError extends Error {}

export interface IdClaims { iss: string; aud: string | string[]; sub: string; exp: number; iat?: number; nonce?: string; email?: string; email_verified?: boolean | string; preferred_username?: string; tid?: string; oid?: string; name?: string }

/** Verifies an RS256 id_token and its standard claims. `issuer` may contain {tenantid} (Microsoft multi-tenant). */
export function verifyIdToken(token: string, keys: (JsonWebKey & { kid?: string })[], o: { issuer: string; audience: string; nonce: string; now?: number }): IdClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OidcError('Malformed id_token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256') throw new OidcError(`Unsupported signing algorithm ${header.alg}`);
  const jwk = keys.find((k) => k.kid === header.kid) ?? (keys.length === 1 && !header.kid ? keys[0] : undefined);
  if (!jwk) throw new OidcError('Unknown signing key');
  const ok = verifySig('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new OidcError('Bad signature');
  const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as IdClaims;
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  const expectedIss = o.issuer.includes('{tenantid}') ? o.issuer.replace('{tenantid}', c.tid ?? '') : o.issuer;
  if (c.iss !== expectedIss) throw new OidcError('Wrong issuer');
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(o.audience)) throw new OidcError('Token is for another application');
  if (typeof c.exp !== 'number' || c.exp < now - 300) throw new OidcError('Token expired');
  if (c.iat && c.iat > now + 300) throw new OidcError('Token from the future');
  if (c.nonce !== o.nonce) throw new OidcError('Nonce mismatch');
  if (!c.sub) throw new OidcError('No subject');
  return c;
}

/**
 * The verified email and the stable subject for a provider. Google needs a verified email;
 * Microsoft's email is not verified, so organizations pin their tenant (checked by the caller).
 */
export function identityOf(p: SsoProvider, c: IdClaims): { subject: string; email: string | null; tenant?: string } {
  const email = (c.email ?? (p === 'microsoft' ? c.preferred_username : undefined))?.trim().toLowerCase() ?? null;
  const verified = c.email_verified === true || c.email_verified === 'true';
  switch (p) {
    case 'google':
      return { subject: c.sub, email: verified ? email : null };
    case 'microsoft':
      return { subject: `${c.tid}:${c.oid ?? c.sub}`, email, tenant: c.tid };
    case 'zoho':
      return { subject: c.sub, email: c.email_verified === false || c.email_verified === 'false' ? null : email };
  }
}
