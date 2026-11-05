import { hasFeature, type Features } from '@/lib/types';
import { CreditCard, Crown, Activity, Route, MessagesSquare, ListChecks, Sparkles, BarChart3, BookOpenCheck, Users, HandCoins, Building2, FolderKanban, FormInput, ReceiptText, KeyRound, LayoutDashboard, Palette, PlugZap, PlusCircle, Settings, ShieldCheck, Stamp, Trophy, Truck, type LucideIcon } from 'lucide-react';

export interface NavItem { href: string; label: string; icon: LucideIcon; keywords?: string; editorsOnly?: boolean; adminOnly?: boolean; feature?: string; superAdminOnly?: boolean }

export const NAV: NavItem[] = [
  { href: '/', label: 'Command center', icon: LayoutDashboard, keywords: 'dashboard home', feature: 'dashboard' },
  { href: '/copilot', label: 'AI copilot', icon: Sparkles, keywords: 'assistant ai gemini voice ask chat summarise report', feature: 'copilot' },
  { href: '/projects', label: 'Projects', icon: FolderKanban, keywords: 'manage projects list', feature: 'projects' },
  { href: '/tasks', label: 'Tasks', icon: ListChecks, keywords: 'to do todo reminders assigned overdue', feature: 'tasks' },
  { href: '/requests', label: 'Requests', icon: MessagesSquare, keywords: 'tickets support client vendor portal disputes questions issues', feature: 'requests' },
  { href: '/won-bids', label: 'Won bids', icon: Trophy, keywords: 'bidzo awarded setup project', feature: 'won_bids' },
  { href: '/projects/new', label: 'Create project', icon: PlusCircle, keywords: 'new project wizard', editorsOnly: true, feature: 'projects.create' },
  { href: '/monitor', label: 'Fieldwork monitor', icon: Activity, keywords: 'alerts pace autopilot stalled incidence quality', feature: 'monitor' },
  { href: '/redirect-health', label: 'Redirect health', icon: Route, keywords: 'redirects fallback callbacks survey links broken latency errors health', feature: 'redirect_health' },
  { href: '/reports', label: 'Reports', icon: BarChart3, keywords: 'overall conversion client vendor clicks', feature: 'reports' },
  { href: '/invoices', label: 'Invoices', icon: ReceiptText, keywords: 'billing reconciliation payment finance', feature: 'invoices' },
  { href: '/payables', label: 'Vendor payables', icon: HandCoins, keywords: 'bills vendor payments owed finance', feature: 'payables' },
  { href: '/accounting', label: 'Accounting exports', icon: BookOpenCheck, keywords: 'zoho books tally quickbooks xero export finance ledger', editorsOnly: true, feature: 'accounting' },
  { href: '/clients', label: 'Clients', icon: Building2, feature: 'clients' },
  { href: '/vendors', label: 'Vendors', icon: Truck, keywords: 'panels suppliers', feature: 'vendors' },
  { href: '/portal-access', label: 'Portal access', icon: KeyRound, keywords: 'client vendor logins', feature: 'portal_access' },
  { href: '/settings/integrations', label: 'Integrations', icon: PlugZap, keywords: 'connect email smtp zoho mail google microsoft sso sign-in gemini ai api key zoho books xero quickbooks tally bidzo setup keys', adminOnly: true, feature: 'integrations' },
  { href: '/settings/team', label: 'Team', icon: Users, keywords: 'staff users invite people roles deactivate password', adminOnly: true, feature: 'team' },
  { href: '/settings/privacy', label: 'Privacy', icon: ShieldCheck, keywords: 'gdpr retention consent erase delete anonymise personal data', adminOnly: true, feature: 'privacy' },
  { href: '/settings/subscription', label: 'Subscription', icon: CreditCard, keywords: 'plan billing pay payment renew upgrade invoice receipt razorpay stripe bank transfer upi', adminOnly: true },
  { href: '/settings/branding', label: 'Branding', icon: Stamp, keywords: 'white label logo colours domain custom brand name email sender', adminOnly: true, feature: 'branding' },
  { href: '/settings', label: 'Settings', icon: Settings, keywords: 'organization redirects domains', feature: 'settings' },
  { href: '/super-admin', label: 'Super Admin', icon: Crown, keywords: 'super admin organisations tenants subscriptions plans features mobile app activity automation registrations', superAdminOnly: true },
  { href: '/settings/appearance', label: 'Theme Studio', icon: Palette, keywords: 'appearance theme colours dark light density motion' },
  { href: '/settings/forms', label: 'Form gallery', icon: FormInput, keywords: 'smart forms controls components date picker select design system' },
];

export function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  if (href === '/projects') return pathname === '/projects' || (pathname.startsWith('/projects/') && !pathname.startsWith('/projects/new'));
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
