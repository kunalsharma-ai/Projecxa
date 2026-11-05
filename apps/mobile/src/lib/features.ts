/**
 * Which parts of PROJEXA this person may open in the app.
 *
 * Super Admin decides per organisation (subscription) and per user, separately for web and mobile.
 * The API answers GET /auth/me/features with the effective switches; this file turns that answer
 * plus the person's role into the list of screens to show. Pure functions only, so it is unit tested.
 * Contract: docs/MOBILE_APP.md → "Feature switches".
 */

export type Role = 'ADMIN' | 'PROJECT_MANAGER' | 'SALES' | 'VIEWER' | 'CLIENT_USER' | 'VENDOR_USER';

export const STAFF: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER'];
export const EDITORS: Role[] = ['ADMIN', 'PROJECT_MANAGER'];

export type IconName =
  | 'home' | 'cpu' | 'folder' | 'plus-circle' | 'check-square' | 'message-square' | 'award' | 'activity'
  | 'git-branch' | 'bar-chart-2' | 'file-text' | 'credit-card' | 'book-open' | 'briefcase' | 'truck' | 'key'
  | 'link' | 'users' | 'shield' | 'feather' | 'settings' | 'bell' | 'grid' | 'zap';

export interface Feature {
  key: string;
  label: string;
  /** One line for the More screen. */
  hint: string;
  icon: IconName;
  /** In-app route; features without one open on the web app. */
  route?: string;
  /** Path on the web app, for "Open on web". */
  web?: string;
  roles: Role[];
  group: 'Workspace' | 'Fieldwork' | 'Finance' | 'People' | 'Admin' | 'Portal';
}

/** Keys match the web navigation and the Super Admin feature list. Unknown keys from the server are ignored. */
export const FEATURES: Feature[] = [
  { key: 'dashboard', label: 'Command center', hint: 'KPIs, live projects and what needs attention', icon: 'home', route: '/home', web: '/', roles: STAFF, group: 'Workspace' },
  { key: 'copilot', label: 'AI copilot', hint: 'Ask about projects, pace, money and vendors', icon: 'cpu', route: '/copilot', web: '/copilot', roles: STAFF, group: 'Workspace' },
  { key: 'projects', label: 'Projects', hint: 'All studies, markets, vendors and links', icon: 'folder', route: '/projects', web: '/projects', roles: STAFF, group: 'Workspace' },
  { key: 'projects.create', label: 'Create project', hint: 'Start a new study', icon: 'plus-circle', web: '/projects/new', roles: EDITORS, group: 'Workspace' },
  { key: 'tasks', label: 'Tasks', hint: 'Your to-dos, reminders and overdue work', icon: 'check-square', route: '/tasks', web: '/tasks', roles: STAFF, group: 'Workspace' },
  { key: 'requests', label: 'Requests', hint: 'Client and vendor tickets and disputes', icon: 'message-square', route: '/requests', web: '/requests', roles: STAFF, group: 'Workspace' },
  { key: 'won_bids', label: 'Won bids', hint: 'Bids won in Bidzo, waiting for setup', icon: 'award', route: '/won-bids', web: '/won-bids', roles: STAFF, group: 'Workspace' },
  { key: 'notifications', label: 'Notifications', hint: 'Alerts, reminders and activity', icon: 'bell', route: '/notifications', web: '/', roles: STAFF, group: 'Workspace' },
  { key: 'monitor', label: 'Fieldwork monitor', hint: 'Pace, alerts and autopilot', icon: 'activity', route: '/monitor', web: '/monitor', roles: STAFF, group: 'Fieldwork' },
  { key: 'redirect_health', label: 'Redirect health', hint: 'Fallbacks, errors and callbacks', icon: 'git-branch', route: '/redirect-health', web: '/redirect-health', roles: STAFF, group: 'Fieldwork' },
  { key: 'reports', label: 'Reports', hint: 'Client, vendor, project and country reports', icon: 'bar-chart-2', route: '/reports', web: '/reports', roles: STAFF, group: 'Fieldwork' },
  { key: 'invoices', label: 'Invoices', hint: 'Client invoices and payments', icon: 'file-text', route: '/invoices', web: '/invoices', roles: STAFF, group: 'Finance' },
  { key: 'payables', label: 'Vendor payables', hint: 'What you owe vendors', icon: 'credit-card', route: '/payables', web: '/payables', roles: STAFF, group: 'Finance' },
  { key: 'accounting', label: 'Accounting', hint: 'Zoho Books, Tally, QuickBooks, Xero', icon: 'book-open', web: '/accounting', roles: EDITORS, group: 'Finance' },
  { key: 'clients', label: 'Clients', hint: 'Client companies and contacts', icon: 'briefcase', route: '/clients', web: '/clients', roles: STAFF, group: 'People' },
  { key: 'vendors', label: 'Vendors', hint: 'Panels, suppliers and scores', icon: 'truck', route: '/vendors', web: '/vendors', roles: STAFF, group: 'People' },
  { key: 'portal_access', label: 'Portal access', hint: 'Client and vendor logins', icon: 'key', web: '/portal-access', roles: STAFF, group: 'People' },
  { key: 'integrations', label: 'Integrations', hint: 'Email, SSO, AI and accounting connections', icon: 'link', web: '/settings/integrations', roles: ['ADMIN'], group: 'Admin' },
  { key: 'team', label: 'Team', hint: 'Staff, roles and sign-ins', icon: 'users', web: '/settings/team', roles: ['ADMIN'], group: 'Admin' },
  { key: 'privacy', label: 'Privacy', hint: 'Retention, consent and erasure', icon: 'shield', web: '/settings/privacy', roles: ['ADMIN'], group: 'Admin' },
  { key: 'branding', label: 'Branding', hint: 'White-label name, logo and colours', icon: 'feather', web: '/settings/branding', roles: ['ADMIN'], group: 'Admin' },
  { key: 'settings', label: 'Settings', hint: 'Organisation and redirect defaults', icon: 'settings', web: '/settings', roles: STAFF, group: 'Admin' },
  { key: 'portal.client', label: 'Client portal', hint: 'Your projects and approvals', icon: 'briefcase', route: '/portal/client', web: '/portal/client', roles: ['CLIENT_USER'], group: 'Portal' },
  { key: 'portal.vendor', label: 'Vendor portal', hint: 'Your links, completes and payouts', icon: 'truck', route: '/portal/vendor', web: '/portal/vendor', roles: ['VENDOR_USER'], group: 'Portal' },
];

/** The answer of GET /auth/me/features. */
export interface FeatureSwitches {
  version: string;
  plan: string | null;
  web: Record<string, boolean>;
  mobile: { enabled: boolean; features: Record<string, boolean> };
  /** Set by the server when the whole account has no access. */
  block?: Block;
}

/** Why the app shows nothing: the whole account or the mobile app is switched off. */
export type Block = null | 'MOBILE_DISABLED' | 'ORG_SUSPENDED' | 'ORG_PENDING' | 'SUBSCRIPTION_INACTIVE';

export interface Access {
  /** Feature keys this person can open in the app. */
  allowed: Set<string>;
  /** Set when the switches came from Super Admin; null means the server has no switches yet (role rules only). */
  version: string | null;
  plan: string | null;
  block: Block;
}

export function roleAllows(role: Role | undefined, f: Feature) {
  return !!role && (role === 'ADMIN' ? f.roles.includes('ADMIN') || STAFF.some((r) => f.roles.includes(r)) : f.roles.includes(role));
}

/**
 * The features this person can open on mobile. A feature is on only when the role allows it AND
 * Super Admin's mobile switch is on. Without switches from the server (older API), role rules decide.
 */
export function computeAccess(role: Role | undefined, switches: FeatureSwitches | null, block: Block = null): Access {
  const allowed = new Set<string>();
  block = block ?? switches?.block ?? null;
  if (!block && !(switches && !switches.mobile?.enabled)) {
    for (const f of FEATURES) {
      if (!roleAllows(role, f)) continue;
      // In-app screens follow the mobile switches; web-only pages (opened from More) follow the web switches.
      if (switches && (f.route ? switches.mobile.features[f.key] : switches.web[f.key]) !== true) continue;
      allowed.add(f.key);
    }
  }
  return {
    allowed,
    version: switches?.version ?? null,
    plan: switches?.plan ?? null,
    block: block ?? (switches && !switches.mobile?.enabled ? 'MOBILE_DISABLED' : null),
  };
}

/** Accepts only the documented shape; anything else counts as "no switches". */
export function parseSwitches(body: unknown): FeatureSwitches | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Partial<FeatureSwitches>;
  if (typeof b.version !== 'string' || !b.mobile || typeof b.mobile !== 'object') return null;
  const bools = (o: unknown) => Object.fromEntries(Object.entries((o && typeof o === 'object' ? o : {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>;
  const block = typeof b.block === 'string' && (BLOCK_CODES as readonly string[]).includes(b.block) ? (b.block as Block) : null;
  return { version: b.version, plan: typeof b.plan === 'string' ? b.plan : null, web: bools(b.web), mobile: { enabled: b.mobile.enabled === true, features: bools(b.mobile.features) }, ...(block ? { block } : {}) };
}

/** The feature that owns an in-app route, for guarding deep links. */
export function featureForRoute(path: string): Feature | undefined {
  const clean = path.split('?')[0];
  if (clean.startsWith('/project/')) return FEATURES.find((f) => f.key === 'projects');
  if (clean.startsWith('/request/')) return FEATURES.find((f) => f.key === 'requests');
  return FEATURES.filter((f) => f.route).sort((a, b) => b.route!.length - a.route!.length).find((f) => clean === f.route || clean.startsWith(`${f.route}/`));
}

/** The first screen to open after sign-in. */
export function homeRoute(role: Role | undefined, access: Access): string {
  if (access.block) return '/blocked';
  if (role === 'CLIENT_USER') return access.allowed.has('portal.client') ? '/portal/client' : '/blocked';
  if (role === 'VENDOR_USER') return access.allowed.has('portal.vendor') ? '/portal/vendor' : '/blocked';
  const first = ['dashboard', 'projects', 'monitor', 'tasks', 'copilot'].find((k) => access.allowed.has(k));
  return first ? FEATURES.find((f) => f.key === first)!.route! : '/more';
}

/** Error codes the API uses when Super Admin has switched something off. */
export const BLOCK_CODES = ['MOBILE_DISABLED', 'ORG_SUSPENDED', 'ORG_PENDING', 'SUBSCRIPTION_INACTIVE'] as const;
