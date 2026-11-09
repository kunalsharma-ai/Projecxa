/** SAMPLEON (SampAudience) settings and the Sampledge service signature, shared by the controller and the outbox. */
import { hmacSha256, sha256 } from '../common/crypto';

/** Read on every call so the settings can change without a restart (and in tests). */
export const sampleonConfig = () => ({
  url: (process.env.SAMPLEON_URL ?? '').replace(/\/+$/, ''),
  clientId: process.env.SAMPLEON_CLIENT_ID || 'projexa',
  secret: process.env.SAMPLEON_CLIENT_SECRET ?? '',
  configured: !!(process.env.SAMPLEON_URL && process.env.SAMPLEON_CLIENT_SECRET),
});

/**
 * Sampledge service signature (SAMPLEON §5.0):
 * v1=hex HMAC-SHA256(secret, ts + "." + METHOD + "." + path + "." + sha256hex(body)).
 */
export function sampledgeHeaders(clientId: string, secret: string, method: string, path: string, body: string, nowMs = Date.now()) {
  const ts = String(Math.floor(nowMs / 1000));
  return {
    'X-Sampledge-Client': clientId,
    'X-Sampledge-Timestamp': ts,
    'X-Sampledge-Signature': `v1=${hmacSha256(secret, `${ts}.${method.toUpperCase()}.${path}.${sha256(body)}`)}`,
  };
}
