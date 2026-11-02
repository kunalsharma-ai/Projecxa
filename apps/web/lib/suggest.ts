/**
 * Rule-based form suggestions (docs/SMART_FORMS.md). They run in the browser on what the person
 * typed and on lists already loaded; nothing is sent to an AI service.
 */

/** A short code from a name ("Acme Research Ltd" → "ARL", "Kantar" → "KANT"), unique against `taken`. */
export function suggestCode(name: string, taken: string[] = []): string | null {
  const words = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\b(ltd|llc|inc|gmbh|plc|pvt|private|limited|the|and|of|co|corp|sa|ab|oy|bv)\b\.?/gi, ' ')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return null;
  let base = (words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join('').slice(0, 5)).toUpperCase();
  if (base.length < 2) base = words.join('').slice(0, 3).toUpperCase();
  if (base.length < 2) return null;
  const used = new Set(taken.map((t) => t.toUpperCase()));
  if (!used.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
  return null;
}

/** The host of a URL, as an allow-list entry ("https://panel.example.com/cb?x" → "panel.example.com"). */
export function hostOf(url: string): string | null {
  try {
    const h = new URL(url.trim()).hostname.toLowerCase();
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : null;
  } catch {
    return null;
  }
}

/** The organisation domain of an email address, unless it is a free mailbox. */
const FREE = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'zoho.com', 'yandex.com', 'gmx.com', 'live.com', 'rediffmail.com'];
export function emailDomain(email: string): string | null {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(email.trim());
  return m && !FREE.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
}
