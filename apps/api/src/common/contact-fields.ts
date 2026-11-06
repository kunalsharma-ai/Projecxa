import { z } from 'zod';

/**
 * Shared checks for client and vendor contact details (docs/CLIENTS_VENDORS_EDITING.md).
 * The same rules run in the forms (apps/web/lib/contact-rules.ts) so people see the problem before saving.
 */

/** Adds https:// when the scheme is missing and keeps scheme://host/path only. */
export function normaliseWebsite(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  // A real public host: at least one dot and a 2+ letter top-level domain.
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname)) return null;
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}${path}`;
}

export const PHONE_RE = /^\+?[0-9][0-9 ().-]{5,24}$/;

export const websiteField = z
  .string()
  .trim()
  .max(300)
  .transform((s, ctx) => {
    if (!s) return null;
    const w = normaliseWebsite(s);
    if (!w) {
      ctx.addIssue({ code: 'custom', message: 'Use a website like example.com or https://www.example.com' });
      return z.NEVER;
    }
    return w;
  });

export const emailField = z.string().trim().toLowerCase().max(200).email('Use an email address like name@example.com');
export const phoneField = z
  .string()
  .trim()
  .max(30)
  .refine((s) => PHONE_RE.test(s) && s.replace(/\D/g, '').length >= 6, 'Use a phone number with 6 to 20 digits, e.g. +44 20 7946 0000');

/** Blank strings mean "not set", so optional fields can be cleared from a form or a CSV. */
export const optional = <T extends z.ZodTypeAny>(f: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), f.nullable().optional());

export const codeField = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_-]{2,20}$/i, 'Use 2 to 20 letters, digits, - or _')
  .transform((s) => s.toUpperCase());

/** A short unique code from a name, e.g. "Acme Research" -> "ACMERE" (ACMERE2, ACMERE3 … when taken). */
export function codeFromName(name: string, taken: Set<string>): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  let base = (words.length > 1 ? words.map((w) => w.slice(0, 3)).join('') : words[0] ?? 'CODE').slice(0, 8);
  if (base.length < 2) base = `${base}XX`.slice(0, 2);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const c = `${base.slice(0, 20 - String(n).length)}${n}`;
    if (!taken.has(c)) return c;
  }
  return `${base}${Date.now() % 100000}`;
}
