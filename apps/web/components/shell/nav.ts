import { Columns3, Activity, Route, MessagesSquare, ListChecks, Sparkles, BarChart3, BookOpenCheck, Users, HandCoins, Building2, FolderKanban, FormInput, ReceiptText, KeyRound, LayoutDashboard, Palette, PlugZap, PlusCircle, Settings, ShieldCheck, Stamp, Trophy, Truck, type LucideIcon } from 'lucide-react';

export type NavGroup = 'Workspace' | 'Fieldwork' | 'Finance' | 'Network' | 'Admin';
export interface NavItem { href: string; label: string; icon: LucideIcon; group: NavGroup; keywords?: string; editorsOnly?: boolean; adminOnly?: boolean }

/** Sidebar sections, in order. */
export const NAV_GROUPS: NavGroup[] = ['Workspace', 'Fieldwork', 'Finance', 'Network', 'Admin'];

export const NAV: NavItem[] = [
  { href: '/', label: 'Command center', icon: LayoutDashboard, group: 'Workspace', keywords: 'dashboard home' },
  { href: '/copilot', label: 'AI copilot', icon: Sparkles, group: 'Workspace', keywords: 'assistant ai gemini voice ask chat summarise report' },
  { href: '/projects', label: 'Projects', icon: FolderKanban, group: 'Workspace', keywords: 'manage projects list' },
  { href: '/projects/board', label: 'Project board', icon: Columns3, group: 'Workspace', keywords: 'kanban gantt timeline stages pipeline board' },
  { href: '/tasks', label: 'Tasks', icon: ListChecks, group: 'Workspace', keywords: 'to do todo reminders assigned overdue' },
  { href: '/requests', label: 'Requests', icon: MessagesSquare, group: 'Workspace', keywords: 'tickets support client vendor portal disputes questions issues' },
  { href: '/won-bids', label: 'Won bids', icon: Trophy, group: 'Workspace', keywords: 'bidzo awarded setup project' },
  { href: '/projects/new', label: 'Create project', icon: PlusCircle, group: 'Workspace', keywords: 'new project wizard', editorsOnly: true },
  { href: '/monitor', label: 'Fieldwork monitor', icon: Activity, group: 'Fieldwork', keywords: 'alerts pace autopilot stalled incidence quality' },
  { href: '/redirect-health', label: 'Redirect health', icon: Route, group: 'Fieldwork', keywords: 'redirects fallback callbacks survey links broken latency errors health' },
  { href: '/reports', label: 'Reports', icon: BarChart3, group: 'Fieldwork', keywords: 'overall conversion client vendor clicks' },
  { href: '/invoices', label: 'Invoices', icon: ReceiptText, group: 'Finance', keywords: 'billing reconciliation payment finance' },
  { href: '/payables', label: 'Vendor payables', icon: HandCoins, group: 'Finance', keywords: 'bills vendor payments owed finance' },
  { href: '/accounting', label: 'Accounting exports', icon: BookOpenCheck, group: 'Finance', keywords: 'zoho books tally quickbooks xero export finance ledger', editorsOnly: true },
  { href: '/clients', label: 'Clients', icon: Building2, group: 'Network' },
  { href: '/vendors', label: 'Vendors', icon: Truck, group: 'Network', keywords: 'panels suppliers' },
  { href: '/portal-access', label: 'Portal access', icon: KeyRound, group: 'Network', keywords: 'client vendor logins' },
  { href: '/settings/integrations', label: 'Integrations', icon: PlugZap, group: 'Admin', keywords: 'connect email smtp zoho mail google microsoft sso sign-in gemini ai api key zoho books xero quickbooks tally bidzo setup keys', adminOnly: true },
  { href: '/settings/team', label: 'Team', icon: Users, group: 'Admin', keywords: 'staff users invite people roles deactivate password', adminOnly: true },
  { href: '/settings/privacy', label: 'Privacy', icon: ShieldCheck, group: 'Admin', keywords: 'gdpr retention consent erase delete anonymise personal data', adminOnly: true },
  { href: '/settings/branding', label: 'Branding', icon: Stamp, group: 'Admin', keywords: 'white label logo colours domain custom brand name email sender', adminOnly: true },
  { href: '/settings', label: 'Settings', icon: Settings, group: 'Admin', keywords: 'organization redirects domains' },
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

/** Items this person may see. */
export const visibleNav = (role: string | undefined) => NAV.filter((n) => (!n.editorsOnly || role === 'ADMIN' || role === 'PROJECT_MANAGER') && (!n.adminOnly || role === 'ADMIN'));
