import { hasFeature, type Features } from '@/lib/types';
import { CreditCard, Database, PieChart, Crown, Columns3, Activity, Route, MessagesSquare, ListChecks, Sparkles, BarChart3, BookOpenCheck, Users, HandCoins, Building2, FolderKanban, FormInput, ReceiptText, KeyRound, LayoutDashboard, Palette, PlugZap, PlusCircle, Settings, ShieldCheck, Stamp, ToggleRight, Trophy, Truck, type LucideIcon } from 'lucide-react';

export type NavGroup = 'Main' | 'Fieldwork' | 'Finance' | 'Workspace' | 'Admin';
export interface NavItem { href: string; label: string; icon: LucideIcon; group: NavGroup; keywords?: string; editorsOnly?: boolean; adminOnly?: boolean; feature?: string; superAdminOnly?: boolean }

/**
 * Sidebar sections, in order. "Main" follows the order people work in (Dashboard → Clients → Vendors → Projects → Reports)
 * and is shown without a heading; anyone can pin pages above it with the star (Favorites).
 */
export const NAV_GROUPS: NavGroup[] = ['Main', 'Fieldwork', 'Finance', 'Workspace', 'Admin'];
/** Headings shown in the sidebar; null hides the heading. */
export const NAV_GROUP_LABEL: Record<NavGroup, string | null> = { Main: null, Fieldwork: 'Projects & fieldwork', Finance: 'Finance', Workspace: 'Work', Admin: 'Admin' };

export const NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'Main', keywords: 'dashboard home command center overview', feature: 'dashboard' },
  { href: '/clients', label: 'Clients', icon: Building2, group: 'Main', feature: 'clients' },
  { href: '/vendors', label: 'Vendors', icon: Truck, group: 'Main', keywords: 'panels suppliers', feature: 'vendors' },
  { href: '/projects', label: 'Projects', icon: FolderKanban, group: 'Main', keywords: 'manage projects list', feature: 'projects' },
  { href: '/reports', label: 'Reports', icon: BarChart3, group: 'Main', keywords: 'overall conversion client vendor clicks', feature: 'reports' },
  { href: '/projects/new', label: 'Create project', icon: PlusCircle, group: 'Fieldwork', keywords: 'new project wizard', editorsOnly: true, feature: 'projects.create' },
  { href: '/projects/board', label: 'Project board', icon: Columns3, group: 'Fieldwork', keywords: 'kanban gantt timeline stages pipeline board', feature: 'projects' },
  { href: '/won-bids', label: 'Won bids', icon: Trophy, group: 'Fieldwork', keywords: 'sampbidx bidzo awarded setup project', feature: 'won_bids' },
  { href: '/monitor', label: 'Fieldwork monitor', icon: Activity, group: 'Fieldwork', keywords: 'alerts pace autopilot stalled incidence quality', feature: 'monitor' },
  { href: '/redirect-health', label: 'Redirect health', icon: Route, group: 'Fieldwork', keywords: 'redirects fallback callbacks survey links broken latency errors health', feature: 'redirect_health' },
  { href: '/data-processing', label: 'Data processing', icon: Database, group: 'Fieldwork', keywords: 'data quality cleaning validation pipeline speeders duplicates clean data export reconciliation quota balance', feature: 'data_processing' },
  { href: '/analytics', label: 'Analytics', icon: PieChart, group: 'Fieldwork', keywords: 'crosstab cross tab charts insights results answers analysis deliverables dashboard', feature: 'analytics' },
  { href: '/invoices', label: 'Invoices', icon: ReceiptText, group: 'Finance', keywords: 'billing reconciliation payment finance', feature: 'invoices' },
  { href: '/payables', label: 'Vendor payables', icon: HandCoins, group: 'Finance', keywords: 'bills vendor payments owed finance', feature: 'payables' },
  { href: '/accounting', label: 'Accounting exports', icon: BookOpenCheck, group: 'Finance', keywords: 'zoho books tally quickbooks xero export finance ledger', editorsOnly: true, feature: 'accounting' },
  { href: '/tasks', label: 'Tasks', icon: ListChecks, group: 'Workspace', keywords: 'to do todo reminders assigned overdue', feature: 'tasks' },
  { href: '/requests', label: 'Requests', icon: MessagesSquare, group: 'Workspace', keywords: 'tickets support client vendor portal disputes questions issues', feature: 'requests' },
  { href: '/copilot', label: 'AI copilot', icon: Sparkles, group: 'Workspace', keywords: 'assistant ai gemini voice ask chat summarise report', feature: 'copilot' },
  { href: '/portal-access', label: 'Portal access', icon: KeyRound, group: 'Admin', keywords: 'client vendor logins', feature: 'portal_access' },
  { href: '/settings/integrations', label: 'Integrations', icon: PlugZap, group: 'Admin', keywords: 'connect email smtp zoho mail google microsoft sso sign-in gemini ai api key zoho books xero quickbooks tally sampbidx bidzo setup keys', adminOnly: true, feature: 'integrations' },
  { href: '/settings/team', label: 'Team', icon: Users, group: 'Admin', keywords: 'staff users invite people roles deactivate password', adminOnly: true, feature: 'team' },
  { href: '/settings/features', label: 'Features & access', icon: ToggleRight, group: 'Admin', keywords: 'features access permissions plan allow chat who can use turn off hide users roles', adminOnly: true, feature: 'team' },
  { href: '/settings/privacy', label: 'Privacy', icon: ShieldCheck, group: 'Admin', keywords: 'gdpr retention consent erase delete anonymise personal data', adminOnly: true, feature: 'privacy' },
  { href: '/settings/subscription', label: 'Subscription', icon: CreditCard, group: 'Admin', keywords: 'plan billing pay payment renew upgrade invoice receipt razorpay stripe bank transfer upi', adminOnly: true },
  { href: '/settings/branding', label: 'Branding', icon: Stamp, group: 'Admin', keywords: 'white label logo colours domain custom brand name email sender', adminOnly: true, feature: 'branding' },
  { href: '/settings', label: 'Settings', icon: Settings, group: 'Admin', keywords: 'organization redirects domains', feature: 'settings' },
  { href: '/super-admin', label: 'Super Admin', icon: Crown, group: 'Admin', keywords: 'super admin organisations tenants subscriptions plans features mobile app activity automation registrations', superAdminOnly: true },
  { href: '/settings/appearance', label: 'Theme Studio', icon: Palette, group: 'Admin', keywords: 'appearance theme colours dark light density motion' },
  { href: '/settings/forms', label: 'Form gallery', icon: FormInput, group: 'Admin', keywords: 'smart forms controls components date picker select design system' },
];

export function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  if (href === '/projects') return pathname === '/projects' || (pathname.startsWith('/projects/') && !pathname.startsWith('/projects/new') && !pathname.startsWith('/projects/board'));
  if (href === '/settings') return pathname === '/settings';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Bids live in SampBidx; SampTrek links there when the URL is set (Settings → Integrations, or the build env). */
// NEXT_PUBLIC_BIDZO_URL is the old name (from when SampBidx was called Bidzo) and still works.
export const SAMPBIDX_URL = process.env.NEXT_PUBLIC_SAMPBIDX_URL || process.env.NEXT_PUBLIC_BIDZO_URL || '';
export const sampbidxUrl = (me: { links?: { sampbidxUrl?: string | null; bidzoUrl?: string | null } } | null) =>
  (me?.links?.sampbidxUrl || me?.links?.bidzoUrl || SAMPBIDX_URL).replace(/\/$/, '');

/** Items this person may see: by role, and by the features the Super Admin gave them (docs/SUPER_ADMIN.md). */
export const visibleNav = (role: string | undefined, features?: Features) =>
  NAV.filter((n) =>
    (!n.editorsOnly || role === 'ADMIN' || role === 'PROJECT_MANAGER') && (!n.adminOnly || role === 'ADMIN') &&
    (n.superAdminOnly ? !!features?.superAdmin : hasFeature({ features }, n.feature)));
