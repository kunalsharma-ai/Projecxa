import { createHash } from 'crypto';
import { hmacSha256, safeEqualHex } from '../common/crypto';
import TIMEZONES from './timezones.json';

/**
 * Respondent security checks. Each returns a CheckResult; the caller decides whether a failure
 * is enforced (live links) or only logged (test links).
 *
 * Reason codes are stored in RespondentSession.statusDetail and shown in reports.
 */
export interface CheckResult {
  check: string;
  ok: boolean;
  /** Reason code when the check fails, or a short note (e.g. "not configured") when it could not run. */
  reason?: string;
  /** Status the session gets when this failure is enforced. */
  status?: 'SECURITY_REJECT' | 'DUPLICATE' | 'TERMINATE' | 'QUOTA_FULL' | 'PARTIAL';
  note?: string;
}

export const REASON_LABELS: Record<string, string> = {
  BAD_SIGNATURE: 'Entry link signature missing or wrong',
  DEVICE_NOT_ALLOWED: 'Device type not allowed',
  MOBILE_OS_NOT_ALLOWED: 'Phone system (Android / iOS) not allowed',
  TOR_EXIT: 'Connected through TOR',
  GEO_MISMATCH: 'Located outside the survey country',
  CAPTCHA_FAILED: 'Failed the background bot check',
  LANGUAGE_MISMATCH: 'Browser language does not match',
  TIMEZONE_MISMATCH: 'Time zone outside the survey country',
  COOKIES_BLOCKED: 'Cookies blocked',
  SAME_BROWSER: 'Same browser entered before',
  SAME_FINGERPRINT: 'Same device fingerprint entered before',
  SAME_DEVICE: 'Same IP and browser entered before',
  PRESCREEN: 'Did not qualify on the prescreener',
  GATE_SCREENOUT: 'Did not qualify on the gate survey',
  GATE_INCOMPLETE: 'Gave missing or invalid gate answers',
  CONSENT_DECLINED: 'Did not agree to the consent notice',
  HUMAN_CHECK_FAILED: 'Failed the human check',
  GATE_SKIPPED: 'Skipped the entry checks',
  EXPIRED: 'Session expired',
};

export type DeviceType = 'desktop' | 'mobile' | 'tablet';

/** Device class from the user agent. iPads on iPadOS 13+ report a Mac UA and count as desktop. */
export function deviceType(ua: string | undefined): DeviceType {
  const u = ua ?? '';
  if (/iPad|Tablet|PlayBook|Silk|Kindle|(Android(?!.*Mobile))/i.test(u)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|Opera Mini/i.test(u)) return 'mobile';
  return 'desktop';
}

export type DeviceOs = 'android' | 'ios' | 'other';

/** Operating system from the user agent (phones and tablets; desktops report "other"). */
export function deviceOs(ua: string | undefined): DeviceOs {
  const u = ua ?? '';
  if (/Android/i.test(u)) return 'android';
  if (/iPhone|iPod|iPad/i.test(u)) return 'ios';
  return 'other';
}

/**
 * Device type must be allowed; on a phone, the operating system too when the project allows only
 * Android or only iOS (a phone on another system is then refused as well).
 */
export function checkDevice(devices: { desktop?: boolean; mobile?: boolean; tablet?: boolean; android?: boolean; ios?: boolean } | null | undefined, ua: string | undefined): CheckResult {
  const type = deviceType(ua);
  if (devices?.[type] === false) return { check: 'device', ok: false, reason: 'DEVICE_NOT_ALLOWED', status: 'SECURITY_REJECT', note: type };
  if (type === 'mobile') {
    const android = devices?.android !== false;
    const ios = devices?.ios !== false;
    const os = deviceOs(ua);
    const allowed = os === 'android' ? android : os === 'ios' ? ios : android && ios;
    if (!allowed) return { check: 'device', ok: false, reason: 'MOBILE_OS_NOT_ALLOWED', status: 'SECURITY_REJECT', note: type };
  }
  return { check: 'device', ok: true, note: type };
}

/**
 * URL protection: the vendor signs each entry link.
 * sig = hex HMAC-SHA256(vendor signing secret, uid). Stops respondents from inventing or
 * swapping respondent IDs in the link.
 */
export function signEntry(secret: string, uid: string): string {
  return hmacSha256(secret, uid);
}
export function checkEntrySignature(secret: string, uid: string, sig: string | undefined): CheckResult {
  const ok = !!sig && /^[0-9a-f]{64}$/i.test(sig) && safeEqualHex(signEntry(secret, uid), sig.toLowerCase());
  return ok ? { check: 'urlProtection', ok } : { check: 'urlProtection', ok, reason: 'BAD_SIGNATURE', status: 'SECURITY_REJECT' };
}

/** Countries a time zone is used in (IANA zone.tab / zone1970.tab, plus legacy aliases). */
export function timezoneCountries(tz: string | undefined): string[] {
  if (!tz) return [];
  return (TIMEZONES as Record<string, string[]>)[tz] ?? [];
}

export function checkTimezone(tz: string | undefined, countryCode: string): CheckResult {
  const countries = timezoneCountries(tz);
  // Unknown or generic zones (UTC, Etc/*) cannot prove a mismatch, so they pass.
  if (!countries.length) return { check: 'timezone', ok: true, note: tz ? `unmapped ${tz}` : 'not reported' };
  if (countries.includes(countryCode.toUpperCase())) return { check: 'timezone', ok: true, note: tz };
  return { check: 'timezone', ok: false, reason: 'TIMEZONE_MISMATCH', status: 'SECURITY_REJECT', note: tz };
}

/** At least one of the browser's languages has the same primary subtag as the survey language. */
export function checkLanguage(languages: string[] | undefined, surveyLanguage: string): CheckResult {
  const want = primary(surveyLanguage);
  const have = (languages ?? []).map(primary).filter(Boolean);
  if (!have.length) return { check: 'language', ok: true, note: 'not reported' };
  return have.includes(want)
    ? { check: 'language', ok: true, note: have.join(',') }
    : { check: 'language', ok: false, reason: 'LANGUAGE_MISMATCH', status: 'SECURITY_REJECT', note: have.slice(0, 5).join(',') };
}
function primary(lang: string) {
  return (lang ?? '').trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * Captcha: a proof-of-work challenge solved by the gate page in the background (no third party,
 * nothing for the respondent to type). Bots must spend CPU per entry; scripted link-hitting
 * without a browser fails.
 * The challenge is derived from the session token, so nothing has to be stored.
 */
export const POW_BITS = 16;
export function powChallenge(serverSecret: string, token: string): string {
  return hmacSha256(serverSecret, `pow:${token}`).slice(0, 32);
}
export function checkPow(challenge: string, nonce: unknown, bits = POW_BITS): CheckResult {
  const n = typeof nonce === 'number' || typeof nonce === 'string' ? String(nonce) : '';
  const ok = /^\d{1,12}$/.test(n) && leadingZeroBits(createHash('sha256').update(`${challenge}:${n}`).digest()) >= bits;
  return ok ? { check: 'captcha', ok } : { check: 'captcha', ok, reason: 'CAPTCHA_FAILED', status: 'SECURITY_REJECT' };
}
export function leadingZeroBits(buf: Buffer): number {
  let bits = 0;
  for (const byte of buf) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

/** Geolocation from the edge/CDN country header (e.g. CF-IPCountry). */
export function checkGeo(headerValue: string | undefined, countryCode: string): CheckResult {
  const v = (headerValue ?? '').trim().toUpperCase();
  // XX = unknown, T1 = TOR (Cloudflare); neither is evidence of a different country.
  if (!/^[A-Z]{2}$/.test(v) || v === 'XX' || v === 'T1') return { check: 'geolocation', ok: true, note: v ? `unknown (${v})` : 'not reported' };
  return v === countryCode.toUpperCase()
    ? { check: 'geolocation', ok: true, note: v }
    : { check: 'geolocation', ok: false, reason: 'GEO_MISMATCH', status: 'SECURITY_REJECT', note: v };
}

