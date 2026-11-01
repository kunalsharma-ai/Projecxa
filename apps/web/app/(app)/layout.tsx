'use client';
import clsx from 'clsx';
import { BarChart3, Building2, FolderKanban, KeyRound, LayoutDashboard, LogOut, Menu, PlusCircle, Settings, Truck, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MeContext } from '@/components/me';
import { Loading } from '@/components/ui';
import { get, post } from '@/lib/api';
import { isPortalRole, portalHome, type Me } from '@/lib/types';


const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Manage projects', icon: FolderKanban },
  { href: '/projects/new', label: 'Create project', icon: PlusCircle },
  { href: '/clients', label: 'Clients', icon: Building2 },
  { href: '/vendors', label: 'Vendors', icon: Truck },
  { href: '/reports', label: 'Reports', icon: BarChart3 },
  { href: '/portal-access', label: 'Portal access', icon: KeyRound },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    get<Me>('/auth/me')
      .then((m) => (isPortalRole(m.user.role) ? router.replace(portalHome(m.user.role)) : setMe(m)))
      .catch(() => router.replace('/login'));
  }, [router]);
  useEffect(() => setOpen(false), [pathname]);

  if (!me) return <Loading label="Checking your session" />;

  const active = (href: string) => (href === '/' ? pathname === '/' : pathname === href || (href !== '/projects' && pathname.startsWith(href)) || (href === '/projects' && pathname.startsWith('/projects/') && !pathname.startsWith('/projects/new')));

  return (
    <MeContext.Provider value={me}>
      <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
        <aside className={clsx('fixed inset-y-0 left-0 z-40 w-60 border-r border-line bg-panel transition-transform lg:static lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
          <div className="flex h-14 items-center justify-between border-b border-line px-5">
            <Link href="/" className="font-semibold tracking-tight">
              PROJEXA <span className="ml-1 text-xs font-normal text-muted">by Sampledge</span>
            </Link>
            <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="space-y-0.5 p-3">
            {NAV.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm', active(href) ? 'bg-brand/10 font-medium text-brand' : 'text-muted hover:bg-sunken hover:text-ink')}
              >
                <Icon className="h-4 w-4" /> {label}
              </Link>
            ))}
          </nav>
        </aside>
        {open && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-panel/80 px-4 backdrop-blur sm:px-6">
            <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <div className="truncate text-sm text-muted">{me.organization.name}</div>
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden sm:inline">
                {me.user.name} <span className="text-muted">· {me.user.role.replace('_', ' ').toLowerCase()}</span>
              </span>
              <button
                className="btn-ghost px-2.5 py-1.5"
                onClick={async () => {
                  await post('/auth/logout');
                  router.replace('/login');
                }}
              >
                <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          </header>
          <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
        </div>
      </div>
    </MeContext.Provider>
  );
}
