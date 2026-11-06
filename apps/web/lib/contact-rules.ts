/**
 * Client and vendor contact checks, the same as the API's (apps/api/src/common/contact-fields.ts),
 * so forms and the bulk import preview show problems before anything is saved.
 */
export const PHONE = /^\+?[0-9][0-9 ().-]{5,24}$/;
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normaliseWebsite(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname)) return null;
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}${path}`;
  } catch {
    return null;
  }
}

export const checkWebsite = (v: unknown) => (String(v ?? '').trim() && !normaliseWebsite(String(v)) ? 'Use a website like example.com or https://www.example.com.' : null);
export const checkPhone = (v: unknown) => {
  const s = String(v ?? '').trim();
  return s && (!PHONE.test(s) || s.replace(/\D/g, '').length < 6) ? 'Use a phone number with 6 to 20 digits, e.g. +44 20 7946 0000.' : null;
};

/** Redirect macros a vendor URL may use (the engine fills them per respondent). */
export const REDIRECT_MACROS = ['respondent_uid', 'vendor_id', 'country_code', 'project_code', 'status', 'session_token'];
export function checkRedirectUrl(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  for (const m of s.matchAll(/\{([a-z_]+)\}/g)) if (!REDIRECT_MACROS.includes(m[1])) return `Unknown macro {${m[1]}}. Use {respondent_uid}, {vendor_id}, {country_code}, {project_code} or {status}.`;
  try {
    const u = new URL(s.replace(/\{[a-z_]+\}/g, 'x'));
    if (!/^https?:$/.test(u.protocol)) throw 0;
  } catch {
    return 'Use a full address starting with https://';
  }
  return null;
}

/** The four redirects every vendor gives, then the rest (which reuse one of the four when empty). */
export const VENDOR_REDIRECTS: { status: string; label: string; hint: string; main: boolean; word: string }[] = [
  { status: 'COMPLETE', label: 'Complete', hint: 'Qualified and finished the survey', main: true, word: 'complete' },
  { status: 'TERMINATE', label: 'Terminate (screen-out)', hint: 'Did not qualify', main: true, word: 'terminate' },
  { status: 'QUOTA_FULL', label: 'Quota full (over quota)', hint: 'Qualified, but the quota was already full', main: true, word: 'quotafull' },
  { status: 'SECURITY_REJECT', label: 'Security / quality term', hint: 'Failed a security check. Also used for quality fail and duplicate unless set', main: true, word: 'security' },
  { status: 'QUALITY_FAIL', label: 'Quality fail', hint: 'Speeder, straight-liner, failed attention check. Empty = security URL', main: false, word: 'quality' },
  { status: 'DUPLICATE', label: 'Duplicate', hint: 'Took the survey before. Empty = security URL', main: false, word: 'duplicate' },
  { status: 'PARTIAL', label: 'Partial / dropped', hint: 'Left before finishing. Empty = terminate URL', main: false, word: 'partial' },
  { status: 'TECHNICAL_ERROR', label: 'Technical error', hint: 'Something broke. Empty = terminate URL', main: false, word: 'error' },
];
export const VENDOR_FALLBACK: Record<string, string> = { QUALITY_FAIL: 'SECURITY_REJECT', DUPLICATE: 'SECURITY_REJECT', PARTIAL: 'TERMINATE', TECHNICAL_ERROR: 'TERMINATE' };

/**
 * From the complete URL, guess the others: vendors usually change one word or number
 * (…/complete → …/terminate, or status=1 → status=2).
 */
export function guessFromComplete(complete: string): Record<string, string> {
  const out: Record<string, string> = {};
  const c = complete.trim();
  if (!c) return out;
  const words: Record<string, string> = { TERMINATE: 'terminate', QUOTA_FULL: 'quotafull', SECURITY_REJECT: 'security' };
  const m = c.match(/complete[d]?/i);
  if (m) {
    for (const [s, w] of Object.entries(words)) out[s] = c.replace(m[0], m[0] === m[0].toUpperCase() ? w.toUpperCase() : w);
    return out;
  }
  const n = c.match(/([?&](?:status|st|s|result|code)=)1(?=&|$)/i);
  if (n) {
    out.TERMINATE = c.replace(n[0], `${n[1]}2`);
    out.QUOTA_FULL = c.replace(n[0], `${n[1]}3`);
    out.SECURITY_REJECT = c.replace(n[0], `${n[1]}4`);
  }
  return out;
}

export const VENDOR_REDIRECT_MACRO = '{vendor_redirect}';
