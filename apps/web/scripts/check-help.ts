import { findHelp, HELP, helpForField, helpForPage, helpForSection, helpForTab, routeKey } from '../lib/help.ts';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Checks the central help text (lib/help.ts, docs/HELP_ICONS.md). */
let failed = 0;
function ok(name: string, cond: boolean) {
  if (!cond) { failed++; console.log(`✗ ${name}`); }
}

const root = new URL('..', import.meta.url).pathname;
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = [...walk(join(root, 'app')), ...walk(join(root, 'components'))].filter((f) => f.endsWith('.tsx'));

// Every entry answers what / how / where, in short plain sentences.
for (const [key, e] of Object.entries(HELP)) {
  ok(`${key}: has what, how and where`, !!e.what?.trim() && !!e.how?.trim() && !!e.where?.trim());
  ok(`${key}: each line is short (≤ 260 chars)`, [e.what, e.how, e.where].every((t) => !t || t.length <= 260));
  ok(`${key}: known key kind`, /^(page|tab|section|field|check):/.test(key) || !key.includes(':'));
}

// Every signed-in staff page and portal page has a page entry.
const pages = files
  .filter((f) => f.endsWith('/page.tsx'))
  .map((f) => '/' + relative(join(root, 'app'), f).replace(/\/?page\.tsx$/, '').replace(/\(app\)\/?/, ''))
  .map((r) => (r === '/' ? '/' : r.replace(/\/$/, '')))
  .filter((r) => r === '/' || /^\/(projects|clients|vendors|monitor|reports|invoices|payables|accounting|requests|redirect-health|portal-access|tasks|copilot|data-processing|analytics|account|settings|super-admin|won-bids|portal)/.test(r));
for (const r of pages) ok(`page ${r} has help`, !!helpForPage(r.replace(/\[[^\]]+\]/g, 'x123')));
ok('ids in a URL map to [id]', routeKey('/projects/abc123') === '/projects/[id]');
ok('board is not taken for an id', routeKey('/projects/board') === '/projects/board');

// Every project tab has help.
const projectPage = readFileSync(join(root, 'app/(app)/projects/[id]/page.tsx'), 'utf8');
const tabs = [...(projectPage.match(/const TABS = \[([^\]]+)\]/)?.[1].matchAll(/'([^']+)'/g) ?? [])].map((m) => m[1]);
ok('found the project tabs', tabs.length > 10);
for (const t of tabs) ok(`tab ${t} has help`, !!helpForTab(t));

// Every help="…" / id="…" passed in the code exists.
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bhelp="([^"]+)"/g)) ok(`${relative(root, f)}: help="${m[1]}" exists`, !!findHelp(m[1]));
  for (const m of src.matchAll(/<InfoTip id="([^"]+)"/g)) ok(`${relative(root, f)}: InfoTip id="${m[1]}" exists`, !!findHelp(m[1]));
}

// Every security check has an entry.
const types = readFileSync(join(root, 'lib/types.ts'), 'utf8');
const checks = [...(types.match(/SECURITY_LABELS[^{]*\{([^}]+)\}/)?.[1].matchAll(/(\w+):/g) ?? [])].map((m) => m[1]);
ok('found the security checks', checks.length > 5);
for (const c of checks) ok(`check ${c} has help`, !!findHelp(`check:${c}`));

// The pages Kunal named: project sections and key fields resolve.
for (const s of ['Gate survey questions', 'Status matrix (project level)', 'Vendors per market', 'Field dates', 'Batches']) ok(`section ${s}`, !!helpForSection(s, '/projects/abc'));
ok('scoped section wins on its page', helpForSection('Gate survey questions', '/projects/new') !== helpForSection('Gate survey questions', '/projects/abc'));
for (const l of ['LOI (min) *', 'IR % *', 'Client CPI (USD)', 'Payout CPI (EUR)', 'Target completes', 'Link variable', 'How many links']) ok(`field ${l}`, !!helpForField(l));
ok('field title drops the star', helpForField('Completes *')?.title === 'Completes');
ok('unknown labels have no icon', helpForField('Name') === null);

console.log(failed ? `\n${failed} help check(s) failed` : `help: ${Object.keys(HELP).length} entries, ${pages.length} pages, ${tabs.length} tabs ok`);
process.exit(failed ? 1 : 0);
