/**
 * Every feature the Super Admin can give or take away (docs/SUPER_ADMIN.md), and which API routes
 * belong to it. The same keys are used by the web app, the Android/iOS app and GET /auth/me/features.
 */
import { Role } from '@prisma/client';
import { INTEGRATION_KINDS, isPaymentKind } from '../integrations/catalog';

const STAFF: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER'];
const EDITORS: Role[] = ['ADMIN', 'PROJECT_MANAGER'];
const ADMIN: Role[] = ['ADMIN'];

export type FeatureGroup = 'Workspace' | 'Projects' | 'Finance' | 'Partners' | 'Administration' | 'Portals' | 'Integrations';
export interface FeatureDef {
  key: string;
  label: string;
  group: FeatureGroup;
  summary: string;
  /** Roles that can ever use it; the plan and switches decide whether they may. */
  roles: Role[];
  /** Makes sense in the Android/iOS app. */
  mobile: boolean;
}

const INTEGRATION_LABEL: Record<string, string> = {
  smtp: 'Email (Zoho Mail / SMTP)', sso_google: 'Google sign-in', sso_microsoft: 'Microsoft sign-in', sso_zoho: 'Zoho sign-in', gemini: 'Google Gemini AI',
  zoho_books: 'Zoho Books', xero: 'Xero', quickbooks: 'QuickBooks Online', tally: 'Tally Prime', bidzo: 'Bidzo',
};

export const FEATURES: FeatureDef[] = [
  { key: 'dashboard', label: 'Command center', group: 'Workspace', summary: 'Dashboard, KPIs and widgets', roles: STAFF, mobile: true },
  { key: 'copilot', label: 'AI copilot', group: 'Workspace', summary: 'Ask, summarise and act with AI, voice', roles: STAFF, mobile: true },
  { key: 'tasks', label: 'Tasks', group: 'Workspace', summary: 'To-dos and reminders', roles: STAFF, mobile: true },
  { key: 'requests', label: 'Requests', group: 'Workspace', summary: 'Client and vendor tickets, shared files', roles: STAFF, mobile: true },
  { key: 'notifications', label: 'Notifications', group: 'Workspace', summary: 'Bell, alerts and insights panel', roles: STAFF, mobile: true },
  { key: 'projects', label: 'Projects', group: 'Projects', summary: 'Projects, links, quotas, redirects, security, respondent pages', roles: STAFF, mobile: true },
  { key: 'projects.create', label: 'Create projects', group: 'Projects', summary: 'New projects, templates and drafts', roles: EDITORS, mobile: true },
  { key: 'won_bids', label: 'Won bids', group: 'Projects', summary: 'Bids won in Bidzo, ready to set up', roles: STAFF, mobile: true },
  { key: 'monitor', label: 'Fieldwork monitor', group: 'Projects', summary: 'Pace, alerts, autopilot and reallocation', roles: STAFF, mobile: true },
  { key: 'redirect_health', label: 'Redirect health', group: 'Projects', summary: 'Broken links, fallbacks and callbacks', roles: STAFF, mobile: true },
  { key: 'reports', label: 'Reports', group: 'Projects', summary: 'All reports, saved views, scheduled emails', roles: STAFF, mobile: true },
  { key: 'data_processing', label: 'Data processing', group: 'Projects', summary: 'Data pipeline, quality checks, cleaning and clean data export', roles: STAFF, mobile: false },
  { key: 'analytics', label: 'Analytics', group: 'Projects', summary: 'Project results: KPIs, charts, crosstabs, insights and deliverables', roles: STAFF, mobile: false },
  { key: 'invoices', label: 'Invoices', group: 'Finance', summary: 'Reconciliation and client invoices', roles: STAFF, mobile: true },
  { key: 'payables', label: 'Vendor payables', group: 'Finance', summary: 'Vendor bills and payments', roles: STAFF, mobile: true },
  { key: 'accounting', label: 'Accounting', group: 'Finance', summary: 'Exports and sync to accounting software', roles: EDITORS, mobile: false },
  { key: 'clients', label: 'Clients', group: 'Partners', summary: 'Client accounts', roles: STAFF, mobile: true },
  { key: 'vendors', label: 'Vendors', group: 'Partners', summary: 'Vendors, scores, sign-ups and quotes', roles: STAFF, mobile: true },
  { key: 'portal_access', label: 'Portal access', group: 'Partners', summary: 'Logins for client and vendor portals', roles: EDITORS, mobile: true },
  { key: 'integrations', label: 'Integrations', group: 'Administration', summary: 'Settings → Integrations', roles: ADMIN, mobile: false },
  { key: 'developers', label: 'API and webhooks', group: 'Administration', summary: 'Public API keys and event webhooks', roles: ADMIN, mobile: false },
  { key: 'team', label: 'Team', group: 'Administration', summary: 'Invite, roles and deactivate staff', roles: ADMIN, mobile: true },
  { key: 'privacy', label: 'Privacy', group: 'Administration', summary: 'Retention, consent and erasure', roles: ADMIN, mobile: false },
  { key: 'branding', label: 'Branding', group: 'Administration', summary: 'White-label name, logo, colours, domain', roles: ADMIN, mobile: false },
  { key: 'settings', label: 'Settings', group: 'Administration', summary: 'Organisation settings, security, sign-in', roles: STAFF, mobile: true },
  { key: 'portal.client', label: 'Client portal', group: 'Portals', summary: 'Clients see their projects, invoices and files', roles: ['CLIENT_USER'], mobile: true },
  { key: 'portal.vendor', label: 'Vendor portal', group: 'Portals', summary: 'Vendors see links, respondents, bills and quotes', roles: ['VENDOR_USER'], mobile: true },
  ...INTEGRATION_KINDS.filter((k) => !isPaymentKind(k)).map((k): FeatureDef => ({ key: `integration.${k}`, label: INTEGRATION_LABEL[k] ?? k, group: 'Integrations', summary: `May use ${INTEGRATION_LABEL[k] ?? k}`, roles: ADMIN, mobile: false })),
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export const MOBILE_FEATURE_KEYS = FEATURES.filter((f) => f.mobile).map((f) => f.key);
const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));
export const featureDef = (k: string) => BY_KEY.get(k);
export const isFeature = (k: string) => BY_KEY.has(k);

/**
 * Route (without /api/v1) → feature. First match wins. `null` = not gated (sign-in, own account).
 * 'portal' resolves to portal.client or portal.vendor by the caller's role.
 * test/e2e/super-admin.e2e.spec.ts fails when a new route matches nothing here.
 */
const ROUTES: [RegExp, string | null, string?][] = [
  [/^auth(\/|$)/, null],
  [/^super-admin(\/|$)/, 'super-admin'],
  // The organisation's own plan and payments: admins, also after the subscription ended (auth.guard.ts).
  [/^billing(\/|$)/, 'billing'],
  [/^users\/:id\/mfa\/reset$/, 'team'],
  [/^users$/, null, 'GET'],
  [/^users$/, 'team'],
  [/^team(\/|$)/, 'team'],
  [/^sso-identities\//, 'team'],
  [/^organization\/invoice-profile$/, 'invoices'],
  [/^organization\/finance-settings$/, 'payables'],
  [/^organization\/alert-settings/, 'monitor'],
  [/^organization(\/|$)/, 'settings'],
  [/^security\/(captcha|tor)/, 'settings'],
  [/^dashboard(\/|$)/, 'dashboard'],
  [/^insights$/, 'notifications'],
  [/^ai(\/|$)/, 'copilot'],
  [/^tasks(\/|$)/, 'tasks'],
  [/^(requests|files)(\/|$)/, 'requests'],
  [/^integrations\/settings(\/|$)/, 'integrations'],
  [/^integrations\/bidzo/, 'integrations'],
  [/^won-bids(\/|$)/, 'won_bids'],
  [/^(monitor|alerts)(\/|$)/, 'monitor'],
  [/^projects\/:id\/countries\/:countryId\/reallocate$/, 'monitor'],
  [/^redirect-health(\/|$)/, 'redirect_health'],
  [/^(reports|report-schedules)(\/|$)/, 'reports'],
  [/^data-processing(\/|$)/, 'data_processing'],
  [/^analytics(\/|$)/, 'analytics'],
  [/^(invoices)(\/|$)/, 'invoices'],
  [/^projects\/:id\/(reconciliation|invoices)/, 'invoices'],
  [/^payables(\/|$)/, 'payables'],
  [/^accounting(\/|$)/, 'accounting'],
  [/^clients(\/|$)/, 'clients'],
  [/^(vendors|vendor-applications)(\/|$)/, 'vendors'],
  [/^projects\/:id\/countries\/:countryId\/vendor-suggestions$/, 'vendors'],
  [/^portal-users(\/|$)/, 'portal_access'],
  [/^(api-keys|webhooks)(\/|$)/, 'developers'],
  [/^privacy(\/|$)/, 'privacy'],
  [/^branding(\/|$)/, 'branding'],
  [/^portal\/vendor(\/|$)/, 'portal.vendor'],
  [/^portal\/client(\/|$)/, 'portal.client'],
  [/^portal\/(requests|files)(\/|$)/, 'portal'],
  [/^projects$/, 'projects.create', 'POST'],
  [/^project-drafts(\/|$)/, 'projects.create'],
  [/^(projects|project-templates|quotes|callbacks|question-templates|security)(\/|$)/, 'projects'],
];

/** `path` is the Express route pattern, e.g. /api/v1/projects/:id. */
export function featureForRoute(method: string, path: string, role?: Role): string | null | undefined {
  const p = path.replace(/^\/?api\/v1\/?/, '').replace(/^\//, '').replace(/\/$/, '');
  for (const [re, feature, m] of ROUTES) {
    if (m && m !== method.toUpperCase()) continue;
    if (!re.test(p)) continue;
    if (feature === 'portal') return role === 'VENDOR_USER' ? 'portal.vendor' : 'portal.client';
    return feature;
  }
  return undefined;
}
