'use client';
import clsx from 'clsx';
import { Activity, Bot, Building2, CreditCard, Crown, DatabaseBackup, Gauge, Layers, PlugZap, RadioTower, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMe } from '@/components/me';
import { Empty } from '@/components/ui';

const TABS = [
  { href: '/super-admin', label: 'Overview', icon: Gauge },
  { href: '/super-admin/organizations', label: 'Organisations', icon: Building2 },
  { href: '/super-admin/registrations', label: 'Registrations', icon: UserPlus },
  { href: '/super-admin/plans', label: 'Plans and features', icon: Layers },
  { href: '/super-admin/billing', label: 'Billing', icon: CreditCard },
  { href: '/super-admin/activity', label: 'Activity', icon: Activity },
  { href: '/super-admin/integrations', label: 'Integrations', icon: PlugZap },
  { href: '/super-admin/automation', label: 'Automation', icon: Bot },
  { href: '/super-admin/backups', label: 'Backups', icon: DatabaseBackup },
  { href: '/super-admin/status', label: 'Status page', icon: RadioTower },
];

/** Super Admin console (docs/SUPER_ADMIN.md): only the person who runs this server sees it. */
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const pathname = usePathname();
  if (!me?.features?.superAdmin) return <Empty>Only the Super Admin can open this.</Empty>;
  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand"><Crown className="h-4 w-4" /> Super Admin</div>
      <nav aria-label="Super Admin" className="-mx-4 mb-6 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1">
          {TABS.map((t) => {
            const active = t.href === '/super-admin' ? pathname === t.href : pathname.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined}
                className={clsx('flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors', active ? 'border-brand font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}>
                <t.icon className="h-4 w-4" />{t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </div>
  );
}
