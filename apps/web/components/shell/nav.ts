import { hasFeature, type Features } from '@/lib/types';
import { CreditCard, Database, PieChart, Crown, Columns3, Activity, Route, MessagesSquare, ListChecks, Sparkles, BarChart3, BookOpenCheck, Users, HandCoins, Building2, FolderKanban, FormInput, ReceiptText, KeyRound, LayoutDashboard, Palette, PlugZap, PlusCircle, Settings, ShieldCheck, Stamp, Trophy, Truck, type LucideIcon } from 'lucide-react';

export type NavGroup = 'Workspace' | 'Fieldwork' | 'Finance' | 'Network' | 'Admin';
export interface NavItem { href: string; label: string; icon: LucideIcon; group: NavGroup; keywords?: string; editorsOnly?: boolean; adminOnly?: boolean; feature?: string; superAdminOnly?: boolean }

/** Sidebar sections, in order. */
export const NAV_GROUPS: NavGroup[] = ['Workspace', 'Fieldwork', 'Finance', 'Network', 'Admin'];

export const NAV: NavItem[] = [
  { href: '/', label: 'Command center', icon: LayoutDashboard, group: 'Workspace', keywords: 'dashboard home', feature: 'dashboard' },
  { href: '/copilot', label: 'AI copilot', icon: Sparkles, group: 'Workspace', keywords: 'assistant ai gemini voice ask chat summarise report', feature: 'copilot' },
  { href: '/projects', label: 'Projects', icon: FolderKanban, group: 'Workspace', keywords: 'manage projects list', feature: 'projects' },
  { href: '/projects/board', label: 'Project board', icon: Columns3, group: 'Workspace', keywords: 'kanban gantt timeline stages pipeline board', feature: 'projects' },
  { href: '/tasks', label: 'Tasks', icon: ListChecks, group: 'Workspace', keywords: 'to do todo reminders assigned overdue', feature: 'tasks' },
  { href: '/requests', label: 'Requests', icon: MessagesSquare, group: 'Workspace', keywords: 'tickets support client vendor portal disputes questions issues', feature: 'requests' },
  { href: '/won-bids', label: 'Won bids', icon: Trophy, group: 'Workspace', keywords: 'bidzo awarded setup project', feature: 'won_bids' },
  { href: '/projects/new', label: 'Create project', icon: PlusCircle, group: 'Workspace', keywords: 'new project wizard', editorsOnly: true, feature: 'projects.create' },
  { href: '/monitor', label: 'Fieldwork monitor', icon: Activity, group: 'Fieldwork', keywords: 'alerts pace autopilot stalled incidence quality', feature: 'monitor' },
  { href: '/redirect-health', label: 'Redirect health', icon: Route, group: 'Fieldwork', keywords: 'redirects fallback callbacks survey links broken latency errors health', feature: 'redirect_health' },
  { href: '/reports', label: 'Reports', icon: BarChart3, group: 'Fieldwork', keywords: 'overall conversion client vendor clicks', feature: 'reports' },
  { href: '/data-processing', label: 'Data processing', icon: Database, group: 'Fieldwork', keywords: 'data quality cleaning validation pipeline speeders duplicates clean data export reconciliation quota balance', feature: 'data_processing' },
  { href: '/analytics', label: 'Analytics', icon: PieChart, group: 'Fieldwork', keywords: 'crosstab cross tab charts insights results answers analysis deliverables dashboard', feature: 'analytics' },
  { href: '/invoices', label: 'Invoices', icon: ReceiptText, group: 'Finance', keywords: 'billing reconciliation payment finance', feature: 'invoices' },
  { href: '/payables', label: 'Vendor payables', icon: HandCoins, group: 'Finance', keywords: 'bills vendor payments owed finance', feature: 'payables' },
  { href: '/accounting', label: 'Accounting exports', icon: BookOpenCheck, group: 'Finance', keywords: 'zoho books tally quickbooks xero export finance ledger', editorsOnly: true, feature: 'accounting' },
  { href: '/clients', label: 'Clients', icon: Building2, group: 'Network', feature: 'clients' },
  { href: '/vendors', label: 'Vendors', icon: Truck, group: 'Network', keywords: 'panels suppliers', feature: 'vendors' },
  { href: '/portal-access', label: 'Portal access', icon: KeyRound, group: 'Network', keywords: 'client vendor logins', feature: 'portal_access' },
  { href: '/settings/integrations', label: 'Integrations', icon: PlugZap, group: 'Admin', keywords: 'connect email smtp zoho mail google microsoft sso sign-in gemini ai api key zoho books xero quickbooks tally bidzo setup keys', adminOnly: true, feature: 'integrations' },
  { href: '/settings/team', label: 'Team', icon: Users, group: 'Admin', keywords: 'staff users invite people roles deactivate password', adminOnly: true, feature: 'team' },
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

/** Bids live in Bidzo; PROJEXA links there when the URL is set (Settings → Integrations, or the build env). */
export const BIDZO_URL = process.env.NEXT_PUBLIC_BIDZO_URL || '';
export const bidzoUrl = (me: { links?: { bidzoUrl: string | null } } | null) => (me?.links?.bidzoUrl || BIDZO_URL).replace(/\/$/, '');

/** Items this person may see: by role, and by the features the Super Admin gave them (docs/SUPER_ADMIN.md). */
export const visibleNav = (role: string | undefined, features?: Features) =>
  NAV.filter((n) =>
    (!n.editorsOnly || role === 'ADMIN' || role === 'PROJECT_MANAGER') && (!n.adminOnly || role === 'ADMIN') &&
    (n.superAdminOnly ? !!features?.superAdmin : hasFeature({ features }, n.feature)));
