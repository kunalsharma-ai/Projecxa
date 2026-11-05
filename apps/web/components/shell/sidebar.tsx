'use client';
import clsx from 'clsx';
import { ChevronsLeft, ChevronsRight, Clock, Star, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { canEdit, useMe } from '@/components/me';
import { BrandIcon } from '@/components/brand-mark';
import { DEFAULT_BRAND } from '@/lib/branding';
import { useTheme } from '@/components/theme';
import { isActive, NAV, visibleNav, type NavItem } from './nav';

/** Collapsible navigation with favorites and recent projects. Compact mode shows icons with labels on hover/focus. */
export function Sidebar({ mobileOpen, onClose, badges = {} }: { mobileOpen: boolean; onClose: () => void; badges?: Record<string, number> }) {
  const { prefs, update } = useTheme();
  const me = useMe();
  const brand = me?.branding ?? DEFAULT_BRAND;
  const pathname = usePathname();
  const compact = prefs.sidebarCollapsed;
  const items = visibleNav(me?.user.role);
  const favorites = prefs.favorites.map((h) => items.find((n) => n.href === h)).filter((n): n is NavItem => !!n);
  const toggleFav = (href: string) =>
    update({ favorites: prefs.favorites.includes(href) ? prefs.favorites.filter((f) => f !== href) : [...prefs.favorites, href].slice(0, 20) });

  const Item = ({ n, fav }: { n: NavItem; fav?: boolean }) => {
    const active = isActive(pathname, n.href);
    const starred = prefs.favorites.includes(n.href);
    return (
      <div className="group/item relative">
        <Link
          href={n.href}
          data-tour={fav ? undefined : `nav:${n.href}`}
          aria-current={active ? 'page' : undefined}
          title={compact ? n.label : undefined}
          className={clsx(
            'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm outline-offset-0 transition-colors duration-[var(--dur)]',
            compact && 'lg:justify-center lg:px-0',
            active ? 'bg-sidebar-ink/10 font-medium text-sidebar-ink' : 'text-sidebar-muted hover:bg-sidebar-ink/5 hover:text-sidebar-ink',
          )}
        >
          {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-sidebar-active anim-pop" aria-hidden />}
          <n.icon className={clsx('h-[18px] w-[18px] shrink-0 transition-transform duration-[var(--dur)] group-hover/item:scale-110', active && 'text-sidebar-active')} aria-hidden />
          <span className={clsx('truncate', compact && 'lg:sr-only')}>{n.label}</span>
          {!!badges[n.href] && (
            <span
              className={clsx('ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-sidebar-active px-1.5 text-[11px] font-semibold text-sidebar', compact && 'lg:absolute lg:right-1 lg:top-0.5 lg:ml-0 lg:h-4 lg:min-w-4 lg:text-[10px]', !compact && 'mr-6')}
              aria-label={`${badges[n.href]} new`}
            >
              {badges[n.href] > 99 ? '99+' : badges[n.href]}
            </span>
          )}
        </Link>
        {!compact && (
          <button
            type="button"
            onClick={() => toggleFav(n.href)}
            aria-label={starred ? `Remove ${n.label} from favorites` : `Add ${n.label} to favorites`}
            aria-pressed={starred}
            className={clsx(
              'absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-sidebar-muted hover:text-sidebar-ink focus-visible:opacity-100',
              starred && !fav ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100',
            )}
          >
            <Star className={clsx('h-3.5 w-3.5', starred && 'fill-current text-sidebar-active')} />
          </button>
        )}
      </div>
    );
  };

  const Heading = ({ children }: { children: React.ReactNode }) => (
    <div className={clsx('px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted', compact && 'lg:sr-only')}>{children}</div>
  );

  return (
    <aside
      aria-label="Main navigation"
      className={clsx(
        'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-ink/10 bg-sidebar text-sidebar-ink transition-[transform,width] duration-[var(--dur-slow)] ease-[var(--ease)] lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
        compact ? 'lg:w-[72px]' : 'lg:w-64',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}
    >
      <div className={clsx('flex h-14 shrink-0 items-center justify-between px-4', compact && 'lg:justify-center lg:px-0')}>
        <Link href="/" className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight">
          <BrandIcon brand={brand} />
          <span className={clsx('truncate', compact && 'lg:sr-only')}>
            {brand.custom ? brand.appName : <>PROJEXA <span className="text-xs font-normal text-sidebar-muted">by Sampledge</span></>}
          </span>
        </Link>
        <button className="rounded p-1 lg:hidden" onClick={onClose} aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {favorites.length > 0 && (
          <>
            <Heading>Favorites</Heading>
            <div className="space-y-0.5">{favorites.map((n) => <Item key={`f-${n.href}`} n={n} fav />)}</div>
          </>
        )}
        <Heading>Workspace</Heading>
        <div className="space-y-0.5">{items.map((n) => <Item key={n.href} n={n} />)}</div>
        {prefs.recentProjects.length > 0 && (
          <>
            <Heading>Recent projects</Heading>
            <div className="space-y-0.5">
              {prefs.recentProjects.slice(0, 5).map((p) => {
                const href = `/projects/${p.id}`;
                const active = pathname === href;
                return (
                  <Link
                    key={p.id}
                    href={href}
                    title={compact ? `${p.code} · ${p.name}` : p.name}
                    className={clsx('flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors duration-[var(--dur)]', compact && 'lg:justify-center lg:px-0', active ? 'bg-sidebar-ink/10 text-sidebar-ink' : 'text-sidebar-muted hover:bg-sidebar-ink/5 hover:text-sidebar-ink')}
                  >
                    <Clock className="h-4 w-4 shrink-0" aria-hidden />
                    <span className={clsx('min-w-0 truncate', compact && 'lg:sr-only')}>
                      <span className="font-mono text-xs">{p.code}</span> <span className="opacity-80">{p.name}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </nav>

      <div className="hidden shrink-0 border-t border-sidebar-ink/10 p-3 lg:block">
        <button
          type="button"
          onClick={() => update({ sidebarCollapsed: !compact })}
          className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-muted hover:bg-sidebar-ink/5 hover:text-sidebar-ink', compact && 'justify-center px-0')}
          aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
          title="Toggle sidebar ( [ )"
        >
          {compact ? <ChevronsRight className="h-[18px] w-[18px]" /> : <><ChevronsLeft className="h-[18px] w-[18px]" /> Collapse</>}
        </button>
      </div>
    </aside>
  );
}
