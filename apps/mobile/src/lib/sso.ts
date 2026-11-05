/**
 * Sign in with Google, Microsoft or Zoho from the app.
 *
 * The app opens the server's normal sign-in in the phone's secure browser (ASWebAuthenticationSession
 * on iOS, Custom Tabs on Android), so the client IDs and secrets set in Settings → Integrations are
 * the only ones used and nothing about the providers lives in the app. The server sends the browser
 * back to projexa://sso with a one-time code that only works together with a secret the app made
 * for this sign-in (PKCE), so another app that catches the link cannot use it.
 * Contract: docs/MOBILE_APP.md → "Single sign-on".
 */
import { query } from './api';
import { toBase64Url } from './pcm';

export type SsoProviderId = 'google' | 'microsoft' | 'zoho';
export interface SsoProviderInfo { id: SsoProviderId; label: string }

export interface Pkce { verifier: string; challenge: string }

/** 32 random bytes → verifier; SHA-256 of it → challenge (both base64url). */
export async function makePkce(random: (n: number) => Uint8Array, sha256Base64: (s: string) => Promise<string>): Promise<Pkce> {
  const verifier = toBase64Url(random(32));
  const digest = await sha256Base64(verifier);
  return { verifier, challenge: digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
}

export function startUrl(apiRoot: string, provider: SsoProviderId, redirect: string, challenge: string, org?: string) {
  return `${apiRoot}/auth/sso/${provider}/start${query({ client: 'mobile', redirect, challenge, org: org?.trim().toLowerCase() || undefined })}`;
}

export type SsoReturn = { code: string } | { error: string } | { cancelled: true };

/** Reads projexa://sso?code=… or ?error=… */
export function parseReturn(url: string): SsoReturn {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const params: Record<string, string> = {};
  for (const pair of q.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    try {
      params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      params[k] = v;
    }
  }
  if (params.code) return { code: params.code };
  if (params.error) return { error: params.error };
  return { error: 'Sign-in did not finish. Try again.' };
}
