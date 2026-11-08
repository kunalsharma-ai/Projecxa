/**
 * The product tour shown after sign-in (docs/PRODUCT_TOUR.md).
 *
 * Each step points at something on screen through a `data-tour` attribute: `nav:<href>` for a
 * sidebar link, or a name such as `search` for a header button. A step without a target, or whose
 * target is not on screen, shows as a centred card. Steps for pages a role cannot open are left out.
 */

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Short list of what lives there. */
  points?: string[];
  /** data-tour value of the element to highlight. */
  target?: string;
  /** Only for admins / only for people who can edit (admins and project managers). */
  adminOnly?: boolean;
  editorsOnly?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to {app}',
    body: 'Take a two-minute tour of what you can do here. You can skip it now and replay it any time from your account menu.',
  },
  {
    id: 'command-center',
    target: 'nav:/',
    title: 'Dashboard',
    body: 'Your home screen: projects by status, clients, vendors, and clicks, completes and revenue for today, yesterday, this week and this month.',
    points: ['Click any number to open the list or report behind it', 'Show details for charts, top lists, finance and the project board', 'Star any page in the menu to pin it to Favorites'],
  },
  {
    id: 'search',
    target: 'search',
    title: 'Search and commands',
    body: 'Press Ctrl K (or /) anywhere to jump to a project, client, vendor or page, or to run an action such as switching to dark mode.',
  },
  {
    id: 'projects',
    target: 'nav:/projects',
    title: 'Projects',
    body: 'Every multi-country project, with its own tabs for the whole fieldwork setup.',
    points: ['Vendors, entry links and quotas per market', 'Gate survey, security checks and respondent pages', 'Redirects, QA studio, reconciliation and invoicing'],
  },
  {
    id: 'create-project',
    target: 'nav:/projects/new',
    editorsOnly: true,
    title: 'Create a project',
    body: 'Start from scratch, from a saved template, or from a client brief document. Drafts save themselves as you type.',
  },
  {
    id: 'won-bids',
    target: 'nav:/won-bids',
    title: 'Won bids',
    body: 'Bids you win in SampBidx arrive here automatically, ready to turn into a project in one click.',
  },
  {
    id: 'monitor',
    target: 'nav:/monitor',
    title: 'Fieldwork monitor',
    body: 'Watches pace, incidence and quality across live projects and raises alerts before targets slip.',
    points: ['Autopilot can pause or close links for you', 'Quota reallocation suggestions with one-click apply'],
  },
  {
    id: 'redirect-health',
    target: 'nav:/redirect-health',
    title: 'Redirect health',
    body: 'Spot broken survey links, slow destinations, fallbacks and failed callbacks before respondents do.',
  },
  {
    id: 'reports',
    target: 'nav:/reports',
    title: 'Reports',
    body: 'Overall, conversion, client, vendor and clicks reports, with filters you can save and share.',
    points: ['Export to CSV or PDF', 'Schedule reports by email'],
  },
  {
    id: 'finance',
    target: 'nav:/invoices',
    title: 'Invoices and payables',
    body: 'Bill clients from reconciled completes and track what you owe vendors, with tax and currency handled.',
    points: ['Vendor payables and bills', 'Accounting exports and sync to Zoho Books, Xero, QuickBooks and Tally'],
  },
  {
    id: 'vendors',
    target: 'nav:/vendors',
    title: 'Clients and vendors',
    body: 'Keep your client and vendor records in one place. Vendors get a score from their delivery history, capacity per market and a sign-up link.',
  },
  {
    id: 'portals',
    target: 'nav:/portal-access',
    title: 'Client and vendor portals',
    body: 'Give clients and vendors their own sign-in. Clients see their projects and invoices; vendors see their links, respondents and payouts.',
    points: ['Their questions and disputes arrive in Requests', 'Share files such as questionnaires and compliance documents'],
  },
  {
    id: 'tasks',
    target: 'nav:/tasks',
    title: 'Tasks',
    body: 'Your to-do list, with reminders in the bell. Tasks can be assigned to teammates and linked to projects.',
  },
  {
    id: 'copilot',
    target: 'copilot',
    title: 'AI copilot',
    body: 'Ask questions about your projects in plain words, by typing or by voice. It always asks before it changes anything.',
  },
  {
    id: 'notifications',
    target: 'notifications',
    title: 'Alerts and insights',
    body: 'The bell shows fieldwork alerts and task reminders. Press ] to open the insights panel beside any page.',
  },
  {
    id: 'integrations',
    target: 'nav:/settings/integrations',
    adminOnly: true,
    title: 'Settings and integrations',
    body: 'Connect email, sign-in, AI, accounting and SampBidx right here, without a developer.',
    points: ['Team members and roles', 'Branding, privacy and security rules'],
  },
  {
    id: 'theme',
    target: 'nav:/settings/appearance',
    title: 'Make it yours',
    body: 'Theme Studio changes colours, dark mode, density and motion just for you. Star any page in the sidebar to pin it to Favorites.',
  },
  {
    id: 'account',
    target: 'account',
    title: 'You are all set',
    body: 'Replay this tour any time from your account menu, or search for "tour" with Ctrl K.',
  },
];

/** Steps this person should see. */
export function tourStepsFor(role: string | undefined): TourStep[] {
  const editor = role === 'ADMIN' || role === 'PROJECT_MANAGER';
  return TOUR_STEPS.filter((s) => (!s.adminOnly || role === 'ADMIN') && (!s.editorsOnly || editor));
}

/** Where to put the card next to a highlighted box, kept inside the viewport. */
export function placeCard(
  target: { top: number; left: number; width: number; height: number } | null,
  card: { width: number; height: number },
  view: { width: number; height: number },
  gap = 14,
  margin = 12,
): { top: number; left: number; side: 'right' | 'bottom' | 'top' | 'center' } {
  const clampX = (x: number) => Math.max(margin, Math.min(x, view.width - card.width - margin));
  const clampY = (y: number) => Math.max(margin, Math.min(y, view.height - card.height - margin));
  if (!target) return { top: clampY((view.height - card.height) / 2), left: clampX((view.width - card.width) / 2), side: 'center' };
  // Beside it (sidebar links), when there is room on the right.
  if (target.left + target.width + gap + card.width + margin <= view.width && target.width < view.width / 2) {
    return { top: clampY(target.top + target.height / 2 - card.height / 2), left: target.left + target.width + gap, side: 'right' };
  }
  // Below it (header buttons), else above.
  const left = clampX(target.left + target.width / 2 - card.width / 2);
  if (target.top + target.height + gap + card.height + margin <= view.height) return { top: target.top + target.height + gap, left, side: 'bottom' };
  if (target.top - gap - card.height >= margin) return { top: target.top - gap - card.height, left, side: 'top' };
  return { top: clampY(view.height - card.height - margin), left, side: 'bottom' };
}
