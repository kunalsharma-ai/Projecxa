'use client';
import { LogOut, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { MeContext } from '@/components/me';
import { ThemeMenu } from '@/components/shell/theme-menu';
import { useTheme } from '@/components/theme';
import { Loading } from '@/components/ui';
import { get, post } from '@/lib/api';
import { isPortalRole, type Me } from '@/lib/types';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();
  const { hydrate } = useTheme();

  useEffect(() => {
    get<Me>('/auth/me')
      .then((m) => {
        if (!isPortalRole(m.user.role)) return router.replace('/');
        hydrate(m.preferences);
        setMe(m);
      })
      .catch(() => router.replace('/login'));
  }, [router, hydrate]);

  if (!me) return <Loading label="Checking your session" />;
  const company = me.client?.name ?? me.vendor?.name ?? '';
  const home = me.user.role === 'CLIENT_USER' ? '/portal/client' : '/portal/vendor';

  return (
    <MeContext.Provider value={me}>
      <header className="glass sticky top-0 z-20 border-b border-line">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
          <Link href={home} className="min-w-0 truncate font-semibold tracking-tight">
            PROJEXA <span className="ml-1 text-xs font-normal text-muted">{me.user.role === 'CLIENT_USER' ? 'Client portal' : 'Vendor portal'} · {company}</span>
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
      </header>
      <main className="anim-in mx-auto max-w-[1200px] px-4 py-6 sm:px-6">{children}</main>
      <footer className="pb-8 text-center text-xs text-muted">Operated by {me.organization.name} · Powered by Sampledge PROJEXA</footer>
    </MeContext.Provider>
  );
}
