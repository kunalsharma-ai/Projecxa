'use client';
import clsx from 'clsx';
import { Check, Languages } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { Popover } from '@/components/shell/popover';
import { useTheme } from '@/components/theme';
import { ENGLISH, isLang, LANGUAGES, languageOf, makeTranslator, type Lang, type Translator } from '@/lib/i18n';

/**
 * Shows the staff CRM and the portals in the person's language (docs/LANGUAGES.md).
 *
 * The language is a personal preference saved on the user, next to the theme. Dictionaries load
 * only when a language other than English is picked.
 *
 * Two ways text gets translated:
 *  - `useT()` for code that builds strings (document title, confirm boxes, text with numbers).
 *  - The page translator: after React draws, text and the placeholder / title / aria-label / alt
 *    of elements are swapped for their translation when the dictionary has one. The English
 *    original is remembered, so switching back, or React changing the text, always starts from the
 *    English source. Mark anything that must never be translated (names, codes, typed data) with
 *    `translate="no"` or `data-no-translate`.
 */

const Ctx = createContext<Translator>(ENGLISH);
export const useT = () => useContext(Ctx).t;
export const useLang = () => useContext(Ctx).lang;

async function load(lang: Lang): Promise<Translator> {
  if (lang === 'en') return ENGLISH;
  const [ui, help] = await Promise.all([
    import(`@/lib/locales/${lang}/ui.json`).then((m) => m.default as Record<string, string>),
    import(`@/lib/locales/${lang}/help.json`).then((m) => m.default as Record<string, string>),
  ]);
  return makeTranslator(lang, help, ui);
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { prefs } = useTheme();
  const want: Lang = isLang(prefs.language) ? prefs.language : 'en';
  const [tr, setTr] = useState<Translator>(ENGLISH);

  useEffect(() => {
    let live = true;
    load(want).then((t) => live && setTr(t)).catch(() => live && setTr(ENGLISH));
    return () => { live = false; };
  }, [want]);

  useEffect(() => {
    document.documentElement.lang = tr.lang;
    return startPageTranslator(tr);
  }, [tr]);

  return <Ctx.Provider value={tr}>{children}</Ctx.Provider>;
}

// ───────────────────────────── Page translator ─────────────────────────────

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT', 'svg', 'SVG']);

interface Seen { original: string; written: string }

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName)) return true;
    if (e.getAttribute('translate') === 'no' || e.hasAttribute('data-no-translate')) return true;
    if ((e as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function startPageTranslator(tr: Translator): () => void {
  const texts = (window.__samptrekText ??= new WeakMap<Text, Seen>());
  const attrs = (window.__samptrekAttrs ??= new WeakMap<Element, Record<string, Seen>>());
  const english = tr.lang === 'en';

  const doText = (n: Text) => {
    const cur = n.nodeValue ?? '';
    const seen = texts.get(n);
    // React (or anything else) wrote new text since we last looked: that is the new English source.
    const original = seen && seen.written === cur ? seen.original : cur;
    if (!english && skipped(n.parentElement)) return;
    const out = english ? original : tr.lookup(original) ?? original;
    if (out !== cur) n.nodeValue = out;
    if (out !== original || seen) texts.set(n, { original, written: out });
  };

  const doAttrs = (el: Element) => {
    let rec = attrs.get(el);
    for (const a of ATTRS) {
      const cur = el.getAttribute(a);
      if (cur === null) continue;
      const seen = rec?.[a];
      const original = seen && seen.written === cur ? seen.original : cur;
      const out = english ? original : tr.lookup(original) ?? original;
      if (out !== cur) el.setAttribute(a, out);
      if (out !== original || seen) (rec ??= {})[a] = { original, written: out };
    }
    if (rec) attrs.set(el, rec);
  };

  const walk = (root: Node) => {
    if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) {
      const el = root as Element;
      if (!english && skipped(el)) return;
      doAttrs(el);
    }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === Node.ELEMENT_NODE && !english && (SKIP_TAGS.has((n as Element).tagName) || (n as Element).getAttribute('translate') === 'no' || (n as Element).hasAttribute('data-no-translate')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
      else doAttrs(n as Element);
    }
  };

  // English with nothing translated yet: nothing to do or restore.
  if (english && !window.__samptrekTranslated) return () => undefined;
  window.__samptrekTranslated = !english;

  walk(document.body);
  if (english) return () => undefined;

  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes') { if (!skipped(m.target as Element)) doAttrs(m.target as Element); }
      else m.addedNodes.forEach((n) => { if (!n.parentElement || !skipped(n.parentElement)) walk(n); });
    }
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  return () => obs.disconnect();
}

declare global {
  interface Window {
    __samptrekText?: WeakMap<Text, Seen>;
    __samptrekAttrs?: WeakMap<Element, Record<string, Seen>>;
    __samptrekTranslated?: boolean;
  }
}

// ───────────────────────────── Language menu ─────────────────────────────

/** Top-bar language switch for staff and portal users. The choice is saved on the person's profile. */
export function LanguageMenu() {
  const { prefs, update } = useTheme();
  const current = languageOf(prefs.language);
  return (
    <Popover label="Language" trigger={<span className="flex items-center gap-1"><Languages className="h-[18px] w-[18px]" /><span className="hidden text-[11px] font-semibold uppercase sm:inline">{current.id}</span></span>} width="w-56">
      {(close) => (
        <div className="p-1.5 text-sm" role="radiogroup" aria-label="Language">
          {LANGUAGES.map((l) => {
            const on = l.id === current.id;
            return (
              <button key={l.id} role="radio" aria-checked={on} onClick={() => { update({ language: l.id }); close(); }}
                className={clsx('flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-sunken', on && 'font-medium')}>
                <span className="min-w-0 flex-1" translate="no">
                  <span className="block">{l.native}</span>
                  {l.native !== l.name && <span className="block text-xs text-muted">{l.name}</span>}
                </span>
                {on && <Check className="h-4 w-4 text-brand" />}
              </button>
            );
          })}
          <p className="px-3 pb-1 pt-2 text-xs text-muted">Words not translated yet stay in English.</p>
        </div>
      )}
    </Popover>
  );
}
