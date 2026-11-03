import { THEMES, contrast, resolve, DEFAULTS } from '../lib/theme.ts';
let bad = 0;
for (const t of THEMES) for (const m of ['light', 'dark'] as const) {
  const p = t[m];
  const checks: [string, number, number][] = [
    ['ink/panel', contrast(p.ink, p.panel), 7], ['ink/bg', contrast(p.ink, p.bg), 7], ['muted/panel', contrast(p.muted, p.panel), 4.5], ['muted/sunken', contrast(p.muted, p.sunken), 4.5],
    ['brand/panel', contrast(p.brand, p.panel), 4.5], ['brand/sunken', contrast(p.brand, p.sunken), 4.5], ['accent2/panel', contrast(p.accent2, p.panel), 3],
  ];
  const fails = checks.filter(([, v, min]) => v < min).map(([n, v]) => `${n}=${v.toFixed(2)}`);
  const r = resolve({ ...DEFAULTS, theme: t.id }, m === 'dark');
  if (fails.length || r.adjusted.length) { bad++; console.log(t.id, m, fails.join(' '), r.adjusted.join(' ')); }
}
if (bad) { console.error(`${bad} palettes fail WCAG AA contrast`); process.exit(1); }
console.log('All 16 palettes pass WCAG AA contrast checks');
