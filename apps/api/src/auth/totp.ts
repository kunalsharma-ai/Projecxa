import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt } from 'crypto';

/** RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 seconds), as used by every authenticator app. */
export const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 encoded. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function stepAt(ms = Date.now()): number {
  return Math.floor(ms / 1000 / STEP_SECONDS);
}

/** HOTP (RFC 4226) value for one counter. */
export function hotp(secret: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function totp(secret: string, ms = Date.now()): string {
  return hotp(secret, stepAt(ms));
}

/**
 * Checks a code against the current step and one step either side (clock drift). Returns the
 * matching step, or null. Steps at or before `lastStep` are refused so a code works only once.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null = null, ms = Date.now()): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = stepAt(ms);
  for (const s of [now, now - 1, now + 1]) {
    if (lastStep !== null && s <= lastStep) continue;
    if (hotp(secret, s) === c) return s;
  }
  return null;
}

export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ─── Secrets at rest ───

const keyOf = (k: string) => createHash('sha256').update(`projexa-mfa:${k}`).digest();

/** AES-256-GCM; output is `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function encryptSecret(plain: string, key: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(key), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(box: string, key: string): string {
  const [v, iv, tag, enc] = box.split('.');
  if (v !== 'v1' || !iv || !tag || !enc) throw new Error('Unknown secret format');
  const d = createDecipheriv('aes-256-gcm', keyOf(key), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64url')), d.final()]).toString('utf8');
}

// ─── Recovery codes ───

const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (i, l, o, 0, 1)

/** Ten codes like `k7mq-2xpt-9h`, each usable once. */
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const raw = Array.from({ length: 10 }, () => RC_ALPHABET[randomInt(RC_ALPHABET.length)]).join('');
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(`projexa-rc:${normalizeRecoveryCode(code)}`).digest('hex');
}
