import { hmacSha256, randomToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApiPayload } from './redirect-engine';

/** Largest answer read from an endpoint. */
const MAX_BYTES = 16_384;

/**
 * Asks an API destination endpoint where to send a respondent. POSTs the payload as JSON, signed with
 * the organisation's redirect signing secret:
 *   X-Projexa-Timestamp: unix seconds
 *   X-Projexa-Signature: sha256=hex(HMAC-SHA256(secret, timestamp + "." + body))
 * Expects 2xx JSON { "url": "https://..." }. Never follows redirects, never throws.
 */
export async function askApiDestination(endpoint: string, payload: ApiPayload & { test?: boolean }, secret: string, timeoutMs: number): Promise<{ url?: string; error?: string; ms: number }> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'PROJEXA-redirects/1', 'X-Projexa-Timestamp': ts, 'X-Projexa-Signature': `sha256=${hmacSha256(secret, `${ts}.${body}`)}` },
      body,
    });
    if (res.status < 200 || res.status > 299) return { error: `endpoint answered HTTP ${res.status}`, ms: ms() };
    const text = await res.text();
    if (text.length > MAX_BYTES) return { error: 'answer too large', ms: ms() };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { error: 'answer is not JSON', ms: ms() };
    }
    const url = (json as { url?: unknown })?.url;
    if (typeof url !== 'string' || !url) return { error: 'answer has no "url"', ms: ms() };
    return { url, ms: ms() };
  } catch (e) {
    const name = (e as Error).name;
    return { error: name === 'TimeoutError' || name === 'AbortError' ? `no answer within ${timeoutMs} ms` : 'endpoint could not be reached', ms: ms() };
  }
}

/** The organisation's redirect signing secret, created on first use. */
export async function redirectSigningSecret(prisma: PrismaService, organizationId: string): Promise<string> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { redirectSigningSecret: true } });
  if (org.redirectSigningSecret) return org.redirectSigningSecret;
  const secret = `rss_${randomToken(32)}`;
  // Only set it if nobody else did in the meantime.
  await prisma.organization.updateMany({ where: { id: organizationId, redirectSigningSecret: null }, data: { redirectSigningSecret: secret } });
  const again = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { redirectSigningSecret: true } });
  return again.redirectSigningSecret!;
}
