'use client';
import clsx from 'clsx';
import { Bell, LogOut, Menu, Palette, PanelRight, Plus, Search, Settings, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { canEdit, MeContext } from '@/components/me';
import { CommandPalette } from '@/components/shell/command-palette';
import { InsightsPanel, type Insights } from '@/components/shell/insights-panel';
import { BIDZO_URL } from '@/components/shell/nav';
import { Popover } from '@/components/shell/popover';
import { Sidebar } from '@/components/shell/sidebar';
import { ThemeMenu } from '@/components/shell/theme-menu';
import { useTheme } from '@/components/theme';
import { Loading } from '@/components/ui';
import { get, post } from '@/lib/api';
import { isPortalRole, portalHome, type Me } from '@/lib/types';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [palette, setPalette] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);
  const { prefs, update, hydrate } = useTheme();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    get<Me>('/auth/me')
      .then((m) => {
        if (isPortalRole(m.user.role)) return router.replace(portalHome(m.user.role));
        hydrate(m.preferences);
        setMe(m);
      })
      .catch(() => router.replace('/login'));
  }, [router, hydrate]);
  useEffect(() => setMobileNav(false), [pathname]);

  // Insights feed the bell count, so they load once and refresh every two minutes.
  const loadInsights = useCallback(() => get<Insights>('/insights').then(setInsights).catch(() => undefined), []);
  useEffect(() => {
    if (!me) return;
    loadInsights();
    const t = setInterval(loadInsights, 120_000);
    return () => clearInterval(t);
  }, [me, loadInsights]);

  const toggleInsights = useCallback(() => update({ insightsOpen: !prefs.insightsOpen }), [update, prefs.insightsOpen]);

  // Keyboard: Ctrl/Cmd+K search, [ sidebar, ] insights (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === '[') update({ sidebarCollapsed: !prefs.sidebarCollapsed });
      if (e.key === ']') toggleInsights();
      if (e.key === '/') {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [update, prefs.sidebarCollapsed, toggleInsights]);

  if (!me) return <Loading label="Checking your session" />;

  return (
    <MeContext.Provider value={me}>
      <a href="#main" className="sr-only z-50 rounded bg-panel px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to content</a>
      <div className="flex min-h-screen">
        <Sidebar mobileOpen={mobileNav} onClose={() => setMobileNav(false)} badges={{ '/won-bids': insights?.wonBidsNew ?? 0 }} />
        {mobileNav && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setMobileNav(false)} aria-hidden />}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="glass sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line px-3 sm:px-5">
            <button className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-sunken lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <button
              onClick={() => setPalette(true)}
              className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-panel/70 px-3 text-sm text-muted transition-colors duration-[var(--dur)] hover:border-brand/40 sm:max-w-md"
              aria-label="Search and commands"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="truncate">Search projects, clients, vendors…</span>
              <kbd className="ml-auto hidden shrink-0 rounded border border-line px-1.5 text-[10px] sm:block">Ctrl K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-1">
              {canEdit(me) && (
                <Popover label="Quick create" trigger={<Plus className="h-[18px] w-[18px]" />} width="w-60">
                  {(close) => (
                    <div className="p-1.5 text-sm">
                      <Link href="/projects/new" onClick={close} className="block rounded-md px-3 py-2 hover:bg-sunken">
                        <div className="font-medium">New project</div>
                        <div className="text-xs text-muted">Multi-country project wizard</div>
                      </Link>
                      {BIDZO_URL ? (
                        <a href={`${BIDZO_URL.replace(/\/$/, '')}/bids/new`} target="_blank" rel="noopener noreferrer" onClick={close} className="block rounded-md px-3 py-2 hover:bg-sunken">
                          <div className="font-medium">New bid</div>
                          <div className="text-xs text-muted">Opens Bidzo, where bids live</div>
                        </a>
                      ) : (
                        <div className="rounded-md px-3 py-2 text-muted">
                          <div className="font-medium">New bid</div>
                          <div className="text-xs">Bids are created in Bidzo. Set NEXT_PUBLIC_BIDZO_URL to link it here.</div>
                        </div>
                      )}
                    </div>
                  )}
                </Popover>
              )}
              <Popover label="Notifications" trigger={<Bell className="h-[18px] w-[18px]" />} badge={insights?.alerts} width="w-80">
                {(close) => (
                  <div className="p-2">
                    <div className="px-2 pb-2 pt-1 text-xs font-semibold text-muted">Alerts</div>
                    {!insights || insights.items.filter((i) => i.severity !== 'info').length === 0 ? (
                      <p className="px-2 pb-2 text-sm text-muted">No alerts.</p>
                    ) : (
                      insights.items.filter((i) => i.severity !== 'info').slice(0, 6).map((i) => (
                        <Link key={i.id} href={i.href} onClick={close} className="block rounded-md px-2 py-2 text-sm hover:bg-sunken">
                          <div className={clsx('font-medium', i.severity === 'bad' ? 'text-bad' : 'text-ink')}>{i.title}</div>
                          <div className="truncate text-xs text-muted">{i.detail}</div>
                        </Link>
                      ))
                    )}
                    <button onClick={() => { close(); if (!prefs.insightsOpen) toggleInsights(); }} className="btn-ghost mt-1 w-full py-1.5 text-xs">Open insights panel</button>
                  </div>
                )}
              </Popover>
              <ThemeMenu />
              <button onClick={toggleInsights} aria-pressed={prefs.insightsOpen} aria-label={prefs.insightsOpen ? 'Hide insights panel' : 'Show insights panel'} title="Insights ( ] )"
                className={clsx('hidden h-9 w-9 place-items-center rounded-lg transition-colors duration-[var(--dur)] hover:bg-sunken sm:grid', prefs.insightsOpen ? 'bg-brand/10 text-brand' : 'text-muted hover:text-ink')}>
                <PanelRight className="h-[18px] w-[18px]" />
              </button>
              <Popover label="Account" trigger={<UserRound className="h-[18px] w-[18px]" />} width="w-64">
                {(close) => (
                  <div className="p-1.5 text-sm">
                    <div className="px-3 py-2">
                      <div className="truncate font-medium">{me.user.name}</div>
                      <div className="truncate text-xs text-muted">{me.user.email}</div>
                      <div className="mt-1 text-xs text-muted">{me.organization.name} · {me.user.role.replace('_', ' ').toLowerCase()}</div>
                    </div>
                    <div className="my-1 border-t border-line" />
                    <Link href="/settings/appearance" onClick={close} className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-sunken"><Palette className="h-4 w-4 text-muted" /> Theme Studio</Link>
                    <Link href="/settings" onClick={close} className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-sunken"><Settings className="h-4 w-4 text-muted" /> Organization settings</Link>
                    <button onClick={async () => { await post('/auth/logout'); router.replace('/login'); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-sunken"><LogOut className="h-4 w-4 text-muted" /> Sign out</button>
                  </div>
                )}
              </Popover>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <main id="main" key={pathname} className="anim-in mx-auto w-full min-w-0 max-w-[1440px] px-4 py-6 sm:px-6">{children}</main>
            {prefs.insightsOpen && (
              <>
                {/* Pushes content on very wide screens, overlays it otherwise, so it never squeezes tables. */}
                <div className="fixed inset-0 z-30 bg-black/30 2xl:hidden" onClick={toggleInsights} aria-hidden />
                <div className="anim-in fixed inset-y-0 right-0 z-40 w-[340px] max-w-[90vw] 2xl:sticky 2xl:top-14 2xl:z-10 2xl:h-[calc(100vh-3.5rem)]">
                  <InsightsPanel data={insights} onClose={toggleInsights} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} onToggleInsights={toggleInsights} />
    </MeContext.Provider>
  );
}
