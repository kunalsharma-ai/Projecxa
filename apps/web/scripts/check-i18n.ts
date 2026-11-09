/**
 * Checks the interface translations (docs/LANGUAGES.md).
 *
 * Fails on broken entries only: an empty translation, or one that drops or adds a {placeholder}
 * or macro the English text has. Missing translations never fail, because every screen falls back
 * to English; the script prints how much is covered so the gaps are easy to see.
 *
 *   node --experimental-strip-types scripts/check-i18n.ts            summary
 *   node --experimental-strip-types scripts/check-i18n.ts --missing  also list untranslated help text
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HELP } from '../lib/help.ts';
import { LANGUAGES, makeTranslator, normalise } from '../lib/i18n.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const showMissing = process.argv.includes('--missing');
let failures = 0;
const fail = (msg: string) => { failures++; console.error(`✗ ${msg}`); };

const tokens = (s: string) => (s.match(/\{\{?\w+\}?\}|\{\d\}/g) ?? []).sort().join(' ');

const helpTexts = new Set<string>();
for (const e of Object.values(HELP)) for (const v of [e.title, e.what, e.how, e.where]) if (v) helpTexts.add(normalise(v));

for (const lang of LANGUAGES) {
  if (lang.id === 'en') continue;
  const dicts: Record<string, Record<string, string>> = {};
  for (const part of ['ui', 'help'] as const) {
    const file = join(root, 'lib/locales', lang.id, `${part}.json`);
    let d: Record<string, string>;
    try {
      d = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      fail(`${lang.id}/${part}.json does not load: ${(e as Error).message}`);
      continue;
    }
    for (const [en, tr] of Object.entries(d)) {
      if (typeof tr !== 'string' || !tr.trim()) fail(`${lang.id}/${part}.json: empty translation for “${en}”`);
      else if (tokens(en) !== tokens(tr)) fail(`${lang.id}/${part}.json: placeholders differ for “${en}” (${tokens(en) || 'none'} → ${tokens(tr) || 'none'})`);
    }
    dicts[part] = d;
  }
  const t = makeTranslator(lang.id, dicts.help ?? {}, dicts.ui ?? {});
  // Brand names and codes are the same in every language, so "translated" means the dictionary knows it.
  const missing = [...helpTexts].filter((s) => t.lookup(s) === null);
  const pct = helpTexts.size ? Math.round(((helpTexts.size - missing.length) / helpTexts.size) * 100) : 100;
  console.log(`${lang.name}: ${Object.keys(dicts.ui ?? {}).length} screen strings, help cards ${pct}% (${helpTexts.size - missing.length}/${helpTexts.size}).`);
  if (showMissing) for (const m of missing) console.log(`   untranslated help: ${m}`);
}

if (failures) {
  console.error(`\n${failures} broken translation${failures === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log('Translations OK (missing text falls back to English).');
