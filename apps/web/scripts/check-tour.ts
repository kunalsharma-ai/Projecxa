import { placeCard, TOUR_STEPS, tourStepsFor } from '../lib/tour.ts';
import { readFileSync } from 'node:fs';

// Sidebar pages, read from the source (nav.ts imports icons, which this script does not load).
const NAV_HREFS = [...readFileSync(new URL('../components/shell/nav.ts', import.meta.url), 'utf8').matchAll(/href: '([^']+)'/g)].map((m) => m[1]);

let failed = 0;
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) { failed++; console.log(`✗ ${name}\n    got  ${a}\n    want ${b}`); }
}

// Steps
eq('unique ids', new Set(TOUR_STEPS.map((s) => s.id)).size, TOUR_STEPS.length);
eq('starts with welcome', TOUR_STEPS[0].id, 'welcome');
eq('welcome has no target', TOUR_STEPS[0].target, undefined);
for (const s of TOUR_STEPS) {
  if (s.target?.startsWith('nav:')) eq(`${s.id} points at a real page`, NAV_HREFS.includes(s.target.slice(4)), true);
  eq(`${s.id} body is short`, s.body.length <= 220, true);
}
const ids = (role: string) => tourStepsFor(role).map((s) => s.id);
eq('admin sees integrations', ids('ADMIN').includes('integrations'), true);
eq('manager sees create project', ids('PROJECT_MANAGER').includes('create-project'), true);
eq('manager no integrations', ids('PROJECT_MANAGER').includes('integrations'), false);
eq('viewer no create project', ids('VIEWER').includes('create-project'), false);
eq('sales no admin steps', ids('SALES').includes('integrations'), false);
eq('everyone ends on account', ids('VIEWER').at(-1), 'account');

// Card placement
const view = { width: 1280, height: 800 };
const card = { width: 360, height: 220 };
eq('centred without target', placeCard(null, card, view), { top: 290, left: 460, side: 'center' });
eq('right of a sidebar link', placeCard({ top: 100, left: 8, width: 240, height: 40 }, card, view), { top: 12, left: 262, side: 'right' });
eq('below a header button', placeCard({ top: 10, left: 1180, width: 40, height: 40 }, card, view), { top: 64, left: 908, side: 'bottom' });
eq('above when no room below', placeCard({ top: 700, left: 600, width: 700, height: 60 }, card, view).side, 'top');
const phone = placeCard({ top: 300, left: 8, width: 240, height: 40 }, { width: 351, height: 260 }, { width: 375, height: 667 });
eq('phone stays on screen', phone.left >= 12 && phone.left + 351 <= 375 - 12 + 0.5, true);

if (failed) { console.log(`${failed} tour check(s) failed`); process.exit(1); }
console.log('tour checks passed');
