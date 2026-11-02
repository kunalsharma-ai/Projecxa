'use client';
import { LogOut, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MeContext } from '@/components/me';
import { ThemeMenu } from '@/components/shell/theme-menu';
import { useTheme } from '@/components/theme';
import { Loading } from '@/components/ui';
import { get, post } from '@/lib/api';
import { applyDocumentBrand, DEFAULT_BRAND, orgTheme } from '@/lib/branding';
import { BrandIcon } from '@/components/brand-mark';
import { isPortalRole, type Me } from '@/lib/types';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { hydrate } = useTheme();

  useEffect(() => {
    get<Me>('/auth/me')
      .then((m) => {
        if (!isPortalRole(m.user.role)) return router.replace('/');
        hydrate(m.preferences, orgTheme(m.branding));
        if (m.branding) applyDocumentBrand(m.branding);
        setMe(m);
      })
      .catch(() => router.replace('/login'));
  }, [router, hydrate]);

  if (!me) return <Loading label="Checking your session" />;
  const company = me.client?.name ?? me.vendor?.name ?? '';
  const brand = me.branding ?? DEFAULT_BRAND;
  const home = me.user.role === 'CLIENT_USER' ? '/portal/client' : '/portal/vendor';
  const links = [
    { href: home, label: me.user.role === 'CLIENT_USER' ? 'Projects' : 'Links' },
    ...(me.user.role === 'VENDOR_USER' ? [{ href: '/portal/quotes', label: 'Quotes' }] : []),
    { href: '/portal/requests', label: 'Requests' },
    { href: '/portal/files', label: 'Files' },
    ...(me.user.role === 'CLIENT_USER' ? [{ href: '/portal/invoices', label: 'Invoices' }] : []),
  ];

  return (
    <MeContext.Provider value={me}>
      <header className="glass sticky top-0 z-20 border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
          <Link href={home} className="flex min-w-0 items-center gap-2 truncate font-semibold tracking-tight">
            {brand.iconUrl && <BrandIcon brand={brand} className="h-7 w-7" />}
            <span className="truncate">{brand.appName} <span className="ml-1 text-xs font-normal text-muted">{me.user.role === 'CLIENT_USER' ? 'Client portal' : 'Vendor portal'} · {company}</span></span>
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <span className="hidden text-muted sm:inline">{me.user.name}</span>
            <Link href="/portal/account" className="btn-ghost px-2.5 py-1.5" aria-label="Account security" title="Account security"><ShieldCheck className="h-4 w-4" /></Link>
            <ThemeMenu showStudio={false} />
            <button className="btn-ghost px-2.5 py-1.5" onClick={async () => { await post('/auth/logout'); router.replace('/login'); }}>
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-[1200px] gap-1 overflow-x-auto px-4 pb-2 sm:px-6" aria-label="Portal">
          {links.map((l) => {
            const on = l.href === home ? pathname === home || pathname.startsWith(`${home}/`) : pathname.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} aria-current={on ? 'page' : undefined} className={clsx('whitespace-nowrap rounded-full px-3 py-1 text-sm', on ? 'bg-brand text-white' : 'text-muted hover:bg-sunken')}>
                {l.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="anim-in mx-auto max-w-[1200px] px-4 py-6 sm:px-6">{children}</main>
      <footer className="pb-8 text-center text-xs text-muted">
        Operated by {me.organization.name}{!brand.hidePoweredBy && ' · Powered by Sampledge PROJEXA'}
        {brand.supportEmail && <> · <a className="underline" href={`mailto:${brand.supportEmail}`}>{brand.supportEmail}</a></>}
      </footer>
    </MeContext.Provider>
  );
}
