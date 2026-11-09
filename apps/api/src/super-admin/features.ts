/**
 * Every feature the Super Admin can give or take away (docs/SUPER_ADMIN.md), and which API routes
 * belong to it. The same keys are used by the web app, the Android/iOS app and GET /auth/me/features.
 */
import { Role } from '@prisma/client';
import { INTEGRATION_KINDS, isServerOnlyKind } from '../integrations/catalog';

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
  /**
   * Who in the organisation gets it before their Admin decides (docs/FEATURE_ACCESS.md).
   * 'everyone' (default) for features people already use; 'admins' for features the Admin must allow first.
   */
  adminDefault?: AccessMode;
  /** false: the Admin cannot change who gets it (they would lock themselves or everyone out). */
  adminControl?: boolean;
}

/** What the organisation's Admin chose for one feature (Settings → Features & access). */
export type AccessMode = 'everyone' | 'admins' | 'people' | 'off';
export const ACCESS_MODES: AccessMode[] = ['everyone', 'admins', 'people', 'off'];

const INTEGRATION_LABEL: Record<string, string> = {
  smtp: 'Email (Zoho Mail / SMTP)', sso_google: 'Google sign-in', sso_microsoft: 'Microsoft sign-in', sso_zoho: 'Zoho sign-in', gemini: 'Google Gemini AI',
  zoho_books: 'Zoho Books', xero: 'Xero', quickbooks: 'QuickBooks Online', tally: 'Tally Prime', bidzo: 'SampBidx', push: 'Push notifications', ip_reputation: 'IP and proxy reputation',
};

export const FEATURES: FeatureDef[] = [
  { key: 'dashboard', label: 'Command center', group: 'Workspace', summary: 'Dashboard, KPIs and widgets', roles: STAFF, mobile: true },
  { key: 'copilot', label: 'AI copilot', group: 'Workspace', summary: 'Ask, summarise and act with AI, voice', roles: STAFF, mobile: true },
  { key: 'tasks', label: 'Tasks', group: 'Workspace', summary: 'To-dos and reminders', roles: STAFF, mobile: true },
  { key: 'chat', label: 'Team chat', group: 'Workspace', summary: 'Announcements, project rooms, groups and direct messages for staff', roles: STAFF, mobile: false, adminDefault: 'admins' },
  // Team chat options (docs/TEAM_CHAT.md): the Admin gives each one separately, after chat itself.
  { key: 'chat.general', label: 'Team chat: post in General', group: 'Workspace', summary: 'Write in the General channel (everyone with chat can read it)', roles: STAFF, mobile: false, adminDefault: 'admins' },
  { key: 'chat.project_rooms', label: 'Team chat: project rooms', group: 'Workspace', summary: 'A chat room per project, with status updates', roles: STAFF, mobile: false, adminDefault: 'admins' },
  { key: 'chat.groups', label: 'Team chat: make groups', group: 'Workspace', summary: 'Start private group conversations', roles: STAFF, mobile: false, adminDefault: 'admins' },
  { key: 'chat.direct', label: 'Team chat: direct messages', group: 'Workspace', summary: 'One-to-one messages between teammates', roles: STAFF, mobile: false, adminDefault: 'admins' },
  { key: 'collaboration', label: 'Comments and handovers', group: 'Workspace', summary: 'Project comments, @mentions, handovers and the activity feed', roles: STAFF, mobile: true },
  { key: 'languages', label: 'Languages', group: 'Workspace', summary: 'Use SampTrek and the portals in Hindi, Spanish and other languages', roles: [...STAFF, 'CLIENT_USER', 'VENDOR_USER'], mobile: true },
  { key: 'requests', label: 'Requests', group: 'Workspace', summary: 'Client and vendor tickets, shared files', roles: STAFF, mobile: true },
  { key: 'notifications', label: 'Notifications', group: 'Workspace', summary: 'Bell, alerts and insights panel', roles: STAFF, mobile: true },
  { key: 'projects', label: 'Projects', group: 'Projects', summary: 'Projects, links, quotas, redirects, security, respondent pages', roles: STAFF, mobile: true },
  { key: 'projects.create', label: 'Create projects', group: 'Projects', summary: 'New projects, templates and drafts', roles: EDITORS, mobile: true },
  { key: 'won_bids', label: 'Won bids', group: 'Projects', summary: 'Bids won in SampBidx, ready to set up', roles: STAFF, mobile: true },
  { key: 'client_dashboards', label: 'Client dashboard links', group: 'Projects', summary: 'Live, read-only project dashboards shared with clients by link', roles: EDITORS, mobile: false },
  { key: 'vendor_routing', label: 'Vendor auto-routing', group: 'Projects', summary: 'Send traffic to the best vendor by score, cost and room', roles: EDITORS, mobile: false },
  { key: 'fraud_checks', label: 'Advanced fraud checks', group: 'Projects', summary: 'IP and proxy reputation, automated browsers, cross-project duplicates, risk score', roles: STAFF, mobile: false },
  { key: 'monitor', label: 'Fieldwork monitor', group: 'Projects', summary: 'Pace, alerts, autopilot and reallocation', roles: STAFF, mobile: true },
  { key: 'redirect_health', label: 'Redirect health', group: 'Projects', summary: 'Broken links, fallbacks and callbacks', roles: STAFF, mobile: true },
  { key: 'forecasting', label: 'Forecasting', group: 'Projects', summary: 'Forecast finish date, cost and margin for projects in field', roles: STAFF, mobile: true },
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
  { key: 'team', label: 'Team', group: 'Administration', summary: 'Invite, roles and deactivate staff, and who gets which feature', roles: ADMIN, mobile: true, adminControl: false },
  { key: 'privacy', label: 'Privacy', group: 'Administration', summary: 'Retention, consent and erasure', roles: ADMIN, mobile: false },
  { key: 'branding', label: 'Branding', group: 'Administration', summary: 'White-label name, logo and colours on the app, emails and respondent pages', roles: ADMIN, mobile: false },
  { key: 'custom_domain', label: 'Own domain on links', group: 'Administration', summary: 'Survey links, redirects and respondent pages on the organisation’s own domain and name', roles: ADMIN, mobile: false },
  { key: 'settings', label: 'Settings', group: 'Administration', summary: 'Organisation settings, security, sign-in', roles: STAFF, mobile: true, adminControl: false },
  { key: 'portal.client', label: 'Client portal', group: 'Portals', summary: 'Clients see their projects, invoices and files', roles: ['CLIENT_USER'], mobile: true },
  { key: 'portal.vendor', label: 'Vendor portal', group: 'Portals', summary: 'Vendors see links, respondents, bills and quotes', roles: ['VENDOR_USER'], mobile: true },
  ...INTEGRATION_KINDS.filter((k) => !isServerOnlyKind(k)).map((k): FeatureDef => ({ key: `integration.${k}`, label: INTEGRATION_LABEL[k] ?? k, group: 'Integrations', summary: `May use ${INTEGRATION_LABEL[k] ?? k}`, roles: ADMIN, mobile: false })),
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export const MOBILE_FEATURE_KEYS = FEATURES.filter((f) => f.mobile).map((f) => f.key);
const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));
export const featureDef = (k: string) => BY_KEY.get(k);
export const isFeature = (k: string) => BY_KEY.has(k);
/** Can the organisation's Admin choose who gets it? Only features someone other than an admin can use. */
export const adminControllable = (k: string) => {
  const f = BY_KEY.get(k);
  return !!f && f.adminControl !== false && f.roles.some((r) => r !== 'ADMIN');
};

/**
 * Route (without /api/v1) → feature. First match wins. `null` = not gated (sign-in, own account).
 * 'portal' resolves to portal.client or portal.vendor by the caller's role.
 * test/e2e/super-admin.e2e.spec.ts fails when a new route matches nothing here.
 */
const ROUTES: [RegExp, string | null, string?][] = [
  [/^auth(\/|$)/, null],
  // The phone registers itself for push; what it is told about follows the person's role (push/push.ts).
  [/^push(\/|$)/, null],
  [/^super-admin(\/|$)/, 'super-admin'],
  // The organisation's own plan and payments: admins, also after the subscription ended (auth.guard.ts).
  [/^billing(\/|$)/, 'billing'],
  [/^users\/:id\/mfa\/reset$/, 'team'],
  [/^users$/, null, 'GET'],
  [/^users$/, 'team'],
  [/^team(\/|$)/, 'team'],
  // Settings → Features & access: the Admin decides who gets the features the plan includes.
  [/^feature-access(\/|$)/, 'team'],
  [/^sso-identities\//, 'team'],
  [/^organization\/invoice-profile$/, 'invoices'],
  [/^organization\/finance-settings$/, 'payables'],
  [/^organization\/alert-settings/, 'monitor'],
  [/^organization(\/|$)/, 'settings'],
  // Create project reads the next work order; admins change the numbering in Settings.
  [/^numbering$/, 'settings'],
  [/^security\/(captcha|tor)/, 'settings'],
  [/^dashboard(\/|$)/, 'dashboard'],
  [/^insights(\/read)?$/, 'notifications'],
  [/^ai(\/|$)/, 'copilot'],
  [/^tasks(\/|$)/, 'tasks'],
  [/^chat(\/|$)/, 'chat'],
  [/^(requests|files)(\/|$)/, 'requests'],
  [/^integrations\/settings(\/|$)/, 'integrations'],
  [/^integrations\/(sampbidx|bidzo)/, 'integrations'],
  [/^integrations\/sampleon/, 'integrations'],
  [/^won-bids(\/|$)/, 'won_bids'],
  [/^monitor\/forecast/, 'forecasting'],
  [/^projects\/:id\/forecast/, 'forecasting'],
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
  [/^branding\/domain(\/|$)/, 'custom_domain'],
  [/^branding(\/|$)/, 'branding'],
  [/^portal\/vendor(\/|$)/, 'portal.vendor'],
  [/^portal\/client(\/|$)/, 'portal.client'],
  [/^portal\/(requests|files)(\/|$)/, 'portal'],
  // Features that live inside a project; before the catch-all 'projects' below.
  [/^projects\/:id\/dashboard-links(\/|$)/, 'client_dashboards'],
  [/^projects\/:id\/(comments|handovers|activity|mentionable)(\/|$)/, 'collaboration'],
  [/^projects\/:id\/routing(\/|$)/, 'vendor_routing'],
  [/^projects\/:id\/countries\/:countryId\/route$/, 'vendor_routing'],
  [/^projects\/:id\/fraud(\/|$)/, 'fraud_checks'],
  [/^security\/ip-lists(\/|$)/, 'fraud_checks'],
  [/^projects$/, 'projects.create', 'POST'],
  [/^project-drafts(\/|$)/, 'projects.create'],
  [/^(projects|project-templates|quotes|callbacks|question-templates|security|custom-options)(\/|$)/, 'projects'],
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
