/**
 * Interface languages for the staff CRM and the client/vendor portals (docs/LANGUAGES.md).
 *
 * English text in the code is the source and the key. Each language is a dictionary from the
 * English text, exactly as it appears on screen, to its translation:
 *
 *   lib/locales/<lang>/ui.json    buttons, labels, headings, messages
 *   lib/locales/<lang>/help.json  the "i" help cards (lib/help.ts)
 *
 * Anything without a translation stays in English, so a new screen or a changed sentence never
 * breaks: it shows the English words until the dictionary catches up. `pnpm --filter @projexa/web
 * test` (scripts/check-i18n.ts) checks the dictionaries and prints what is still untranslated.
 *
 * Keys may hold numbered gaps, e.g. "About {0}" or "{0} new". The gap matches any text and the
 * matched text is itself translated when it is a known string.
 *
 * This file has no imports so the check scripts can load it directly.
 */

export const LANGUAGES = [
  { id: 'en', name: 'English', native: 'English', locale: 'en-GB' },
  { id: 'hi', name: 'Hindi', native: 'हिन्दी', locale: 'hi-IN' },
  { id: 'es', name: 'Spanish', native: 'Español', locale: 'es-ES' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['id'];
export type Dictionary = Record<string, string>;

export const isLang = (v: unknown): v is Lang => LANGUAGES.some((l) => l.id === v);
export const languageOf = (id: string | undefined | null) => LANGUAGES.find((l) => l.id === id) ?? LANGUAGES[0];

/** Text that ends with one of these is translated without it, then it is put back. */
const SUFFIXES = ['…', '...', ':', ' *', '*', ' ›', ' →', '.'];

/** The same text written with HTML entities or straight quotes in the source reads the same on screen. */
export const normalise = (s: string) =>
  s
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rarr;/g, '→')
    .replace(/&middot;/g, '·')
    .replace(/&hellip;/g, '…')
    .replace(/\s+/g, ' ')
    .trim();

interface Pattern { re: RegExp; to: string }

export interface Translator {
  lang: Lang;
  /** The translation of an English string, or the string itself when there is none. */
  t: (english: string, vars?: Record<string, string | number>) => string;
  /** The translation, or null when there is none (keeps surrounding whitespace). */
  lookup: (english: string) => string | null;
  size: number;
}

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function makeTranslator(lang: Lang, ...dicts: Dictionary[]): Translator {
  const exact = new Map<string, string>();
  const patterns: Pattern[] = [];
  for (const d of dicts) {
    for (const [k, v] of Object.entries(d)) {
      if (!v || k.startsWith('//')) continue;
      const key = normalise(k);
      if (/\{\d\}/.test(key)) {
        const re = new RegExp(`^${key.split(/(\{\d\})/).map((part) => (/^\{\d\}$/.test(part) ? '(.+?)' : escapeRe(part))).join('')}$`);
        patterns.push({ re, to: v });
      } else exact.set(key, v);
    }
  }
  // Longer patterns first, so "{0} new · now marked read" wins over "{0} new".
  patterns.sort((a, b) => b.re.source.length - a.re.source.length);

  const core = (s: string, depth = 0): string | null => {
    if (!s) return null;
    const hit = exact.get(s);
    if (hit !== undefined) return hit;
    for (const suf of SUFFIXES) {
      if (s.length > suf.length + 1 && s.endsWith(suf)) {
        const stem = exact.get(s.slice(0, -suf.length).trimEnd());
        if (stem !== undefined) return stem + suf;
      }
    }
    if (depth > 1) return null;
    for (const p of patterns) {
      const m = p.re.exec(s);
      if (m) return p.to.replace(/\{(\d)\}/g, (_, i) => { const g = m[Number(i) + 1] ?? ''; return core(g, depth + 1) ?? g; });
    }
    return null;
  };

  const lookup = (english: string): string | null => {
    if (lang === 'en' || !english) return null;
    const key = normalise(english);
    if (!key || !/\p{L}/u.test(key)) return null;
    const out = core(key);
    if (out === null) return null;
    // Keep the spaces around the text so words next to links and numbers do not run together.
    const lead = /^\s*/.exec(english)![0];
    const trail = /\s*$/.exec(english)![0];
    return lead + out + trail;
  };

  return {
    lang,
    lookup,
    t: (english, vars) => fill(lookup(english)?.trim() ?? english, vars),
    size: exact.size + patterns.length,
  };
}

/** English: every string is its own translation. */
export const ENGLISH: Translator = makeTranslator('en');
