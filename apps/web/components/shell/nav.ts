import { BarChart3, Building2, FolderKanban, KeyRound, LayoutDashboard, Palette, PlusCircle, Settings, Trophy, Truck, type LucideIcon } from 'lucide-react';

export interface NavItem { href: string; label: string; icon: LucideIcon; keywords?: string; editorsOnly?: boolean }

export const NAV: NavItem[] = [
  { href: '/', label: 'Command center', icon: LayoutDashboard, keywords: 'dashboard home' },
  { href: '/projects', label: 'Projects', icon: FolderKanban, keywords: 'manage projects list' },
  { href: '/won-bids', label: 'Won bids', icon: Trophy, keywords: 'bidzo awarded setup project' },
  { href: '/projects/new', label: 'Create project', icon: PlusCircle, keywords: 'new project wizard', editorsOnly: true },
  { href: '/reports', label: 'Reports', icon: BarChart3, keywords: 'overall conversion client vendor clicks' },
  { href: '/clients', label: 'Clients', icon: Building2 },
  { href: '/vendors', label: 'Vendors', icon: Truck, keywords: 'panels suppliers' },
  { href: '/portal-access', label: 'Portal access', icon: KeyRound, keywords: 'client vendor logins' },
  { href: '/settings', label: 'Settings', icon: Settings, keywords: 'organization redirects domains' },
  { href: '/settings/appearance', label: 'Theme Studio', icon: Palette, keywords: 'appearance theme colours dark light density motion' },
];

export function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  if (href === '/projects') return pathname === '/projects' || (pathname.startsWith('/projects/') && !pathname.startsWith('/projects/new'));
  if (href === '/settings') return pathname === '/settings';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Bids live in Bidzo; PROJEXA links there when the URL is configured. */
export const BIDZO_URL = process.env.NEXT_PUBLIC_BIDZO_URL || '';
