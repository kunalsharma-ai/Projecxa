import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** Opaque, URL-safe random token (192 bits by default). */
export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

export function hmacSha256(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
