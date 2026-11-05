'use client';
import clsx from 'clsx';
import { Bell, LogOut, Maximize2, Menu, Palette, PanelRight, Plus, Search, Settings, ShieldCheck, Sparkles, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CopilotChat } from '@/components/copilot/chat';
import { canEdit, MeContext } from '@/components/me';
import { CommandPalette } from '@/components/shell/command-palette';
import { InsightsPanel, type Insights } from '@/components/shell/insights-panel';
import { bidzoUrl } from '@/components/shell/nav';
import { Popover } from '@/components/shell/popover';
import { Sidebar } from '@/components/shell/sidebar';
import { ThemeMenu } from '@/components/shell/theme-menu';
import { useTheme } from '@/components/theme';
import { Loading } from '@/components/ui';
import { FEATURES_EVENT, get, post } from '@/lib/api';
import { PlanBlocked, FeatureOff } from '@/components/super-admin/plan-gate';
import { applyDocumentBrand, orgTheme } from '@/lib/branding';
import { isPortalRole, portalHome, type Features, type Me } from '@/lib/types';
import { NAV, isActive } from '@/components/shell/nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [palette, setPalette] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [copilot, setCopilot] = useState(false);
  const [copilotConv, setCopilotConv] = useState<string | null>(null);
  const { prefs, update, hydrate } = useTheme();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    get<Me>('/auth/me')
      .then((m) => {
        if (isPortalRole(m.user.role)) return router.replace(portalHome(m.user.role));
        hydrate(m.preferences, orgTheme(m.branding));
        if (m.branding) applyDocumentBrand(m.branding);
        setMe(m);
      })
      .catch(() => router.replace('/login'));
  }, [router, hydrate]);
  // Organization requires two-step sign-in: nothing else works until it is set up.
  useEffect(() => {
    if (me?.mfa?.setupRequired && pathname !== '/account/security') router.replace('/account/security');
  }, [me, pathname, router]);
  useEffect(() => setMobileNav(false), [pathname]);

  // Super Admin switches apply at once: reload them when the server says they changed, and every 30 s.
  useEffect(() => {
    if (!me) return;
    let last = me.features?.version;
    const refresh = () => get<Features>('/auth/me/features').then((f) => {
      if (f.version !== last) { last = f.version; setMe((m) => (m ? { ...m, features: f } : m)); }
    }).catch(() => undefined);
    window.addEventListener(FEATURES_EVENT, refresh);
    const t = setInterval(refresh, 30_000);
    const onFocus = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.removeEventListener(FEATURES_EVENT, refresh); clearInterval(t); document.removeEventListener('visibilitychange', onFocus); };
  }, [me?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // The page's feature, from the longest matching menu entry.
  const pageFeature = NAV.filter((n) => n.feature && isActive(pathname, n.href)).sort((a, b) => b.href.length - a.href.length)[0]?.feature
    ?? (pathname.startsWith('/projects/new') ? 'projects.create' : undefined);
  const blocked = me.features?.block && !pathname.startsWith('/account') && !(me.features.block === 'SUBSCRIPTION_INACTIVE' && me.user.role === 'ADMIN' && pathname.startsWith('/settings/subscription'));
  const featureOff = !blocked && pageFeature && me.features && me.features.web[pageFeature] === false;

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
              {pathname !== '/copilot' && (
                <button onClick={() => setCopilot(!copilot)} aria-pressed={copilot} aria-label="AI copilot" title="AI copilot"
                  className={clsx('grid h-9 w-9 place-items-center rounded-lg transition-colors duration-[var(--dur)] hover:bg-sunken', copilot ? 'bg-brand/10 text-brand' : 'text-muted hover:text-ink')}>
                  <Sparkles className="h-[18px] w-[18px]" />
                </button>
              )}
              {canEdit(me) && (
                <Popover label="Quick create" trigger={<Plus className="h-[18px] w-[18px]" />} width="w-60">
                  {(close) => (
                    <div className="p-1.5 text-sm">
                      <Link href="/projects/new" onClick={close} className="block rounded-md px-3 py-2 hover:bg-sunken">
                        <div className="font-medium">New project</div>
                        <div className="text-xs text-muted">Multi-country project wizard</div>
                      </Link>
                      {bidzoUrl(me) ? (
                        <a href={`${bidzoUrl(me)}/bids/new`} target="_blank" rel="noopener noreferrer" onClick={close} className="block rounded-md px-3 py-2 hover:bg-sunken">
                          <div className="font-medium">New bid</div>
                          <div className="text-xs text-muted">Opens Bidzo, where bids live</div>
                        </a>
                      ) : (
                        <div className="rounded-md px-3 py-2 text-muted">
                          <div className="font-medium">New bid</div>
                          <div className="text-xs">Bids are created in Bidzo. An admin can add its address in Settings → Integrations.</div>
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
                    <Link href="/account/security" onClick={close} className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-sunken"><ShieldCheck className="h-4 w-4 text-muted" /> Account security</Link>
                    <Link href="/settings/appearance" onClick={close} className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-sunken"><Palette className="h-4 w-4 text-muted" /> Theme Studio</Link>
                    <Link href="/settings" onClick={close} className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-sunken"><Settings className="h-4 w-4 text-muted" /> Organization settings</Link>
                    <button onClick={async () => { await post('/auth/logout'); router.replace('/login'); }} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-sunken"><LogOut className="h-4 w-4 text-muted" /> Sign out</button>
                  </div>
                )}
              </Popover>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <main id="main" key={pathname} className="anim-in mx-auto w-full min-w-0 max-w-[1440px] px-4 py-6 sm:px-6">
              {blocked ? <PlanBlocked block={me.features!.block!} admin={me.user.role === 'ADMIN'} /> : featureOff ? <FeatureOff feature={pageFeature!} /> : children}
            </main>
            {copilot && pathname !== '/copilot' && (
              <aside className="fixed bottom-0 right-0 top-14 z-30 flex w-full flex-col border-l border-line bg-panel shadow-2xl sm:w-[440px]" aria-label="AI copilot">
                <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-brand" />AI copilot</span>
                  <div className="flex gap-1">
                    {copilotConv && <button className="btn-ghost h-8 px-2 text-xs" onClick={() => setCopilotConv(null)}><Plus className="h-3.5 w-3.5" />New</button>}
                    <Link href={copilotConv ? `/copilot?c=${copilotConv}` : '/copilot'} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink" aria-label="Open full screen" onClick={() => setCopilot(false)}><Maximize2 className="h-4 w-4" /></Link>
                    <button className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-sunken hover:text-ink" aria-label="Close copilot" onClick={() => setCopilot(false)}><X className="h-4 w-4" /></button>
                  </div>
                </div>
                <div className="min-h-0 flex-1"><CopilotChat compact conversationId={copilotConv} onConversation={(c) => setCopilotConv(c)} /></div>
              </aside>
            )}
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
