'use client';
import clsx from 'clsx';
import { BadgeCheck, CircleSlash, Clock, Gauge, Hourglass, Percent, ShieldAlert, TrendingUp } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BrandLogo, useBrandedPage } from '@/components/brand-mark';
import { Loading, StatusChip, money } from '@/components/ui';
import { ApiError, get } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';

interface Quota { group: string; name: string; target: number; completes: number; open: boolean }
interface Market {
  countryCode: string; language: string; targetGroup: string | null; status: string;
  plannedLoiMinutes: number; plannedIrPercent: number; target: number; completes: number; quotas: Quota[];
  money?: { currency: string; cpi: number; spend: number };
}
interface Dashboard {
  organization: string;
  project: { code: string; name: string; status: string; fieldStartAt: string | null; fieldEndAt: string | null };
  generatedAt: string;
  showMoney: boolean;
  showVendors: boolean;
  totals: { target: number; completes: number; inProgress: number; terminates: number; quotaFull: number; removedForQuality: number; avgLoiMinutes: number | null; incidence: number | null; last24h: number };
  pace: number[];
  markets: Market[];
  vendors?: { name: string; target: number; completes: number; active: boolean }[];
}

const REFRESH_MS = 30_000;
const pct = (done: number, target: number) => (target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0);
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null);

function Bar({ done, target, className }: { done: number; target: number; className?: string }) {
  const p = pct(done, target);
  return (
    <div className={clsx('h-2 overflow-hidden rounded-full bg-sunken', className)} role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={done} aria-label={`${done} of ${target}`}>
      <div className={clsx('h-full rounded-full transition-[width] duration-700', p >= 100 ? 'bg-ok' : 'bg-brand')} style={{ width: `${p}%` }} />
    </div>
  );
}

/** Completes per hour over the last day, as small bars. */
function Pace({ pace }: { pace: number[] }) {
  const max = Math.max(1, ...pace);
  return (
    <div className="flex h-16 items-end gap-[3px]" aria-label="Completes per hour, last 24 hours">
      {pace.map((n, i) => (
        <div key={i} className="flex-1 rounded-t bg-brand/70" style={{ height: `${Math.max(4, (n / max) * 100)}%`, opacity: n ? 1 : 0.25 }} title={`${n} complete${n === 1 ? '' : 's'} · ${23 - i === 0 ? 'this hour' : `${23 - i} h ago`}`} />
      ))}
    </div>
  );
}

/**
 * Live client dashboard (docs/CLIENT_DASHBOARD_LINKS.md): read-only, no sign-in. The link itself is
 * the key; the project team can revoke it at any time. Refreshes every 30 seconds while visible.
 */
export default function LiveDashboardPage() {
  const brand = useBrandedPage();
  const { token } = useParams<{ token: string }>();
  const [d, setD] = useState<Dashboard | null>(null);
  const [gone, setGone] = useState(false);
  const [stale, setStale] = useState(false);

  const load = useCallback(
    () =>
      get<Dashboard>(`/public/dashboard/${encodeURIComponent(token)}`)
        .then((x) => { setD(x); setStale(false); })
        .catch((e) => (e instanceof ApiError && e.status === 404 ? setGone(true) : setStale(true))),
    [token],
  );
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS);
    const onShow = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onShow); };
  }, [load]);

  if (gone) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="card max-w-md p-7 text-center">
          <h1 className="text-xl font-semibold">This dashboard link does not work</h1>
          <p className="mt-2 text-sm text-muted">It was turned off or has ended. Ask your project manager for a new link.</p>
        </div>
      </main>
    );
  }
  if (!d) return <Loading />;

  const t = d.totals;
  const field = [day(d.project.fieldStartAt), day(d.project.fieldEndAt)].filter(Boolean).join(' – ');
  const groups = (qs: Quota[]) => [...new Set(qs.map((q) => q.group || 'Quotas'))].map((g) => ({ group: g, cells: qs.filter((q) => (q.group || 'Quotas') === g) }));
  const currencies = [...new Set(d.markets.map((m) => m.money?.currency).filter(Boolean))] as string[];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {brand && <BrandLogo brand={brand} className="mb-3" />}
          <div className="text-xs font-medium uppercase tracking-wide text-muted">{d.organization} · live fieldwork</div>
          <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight">{d.project.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="font-mono">{d.project.code}</span>
            <StatusChip status={d.project.status} />
            {field && <span>· Field {field}</span>}
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
          <span className={clsx('h-2 w-2 rounded-full', stale ? 'bg-warn' : 'animate-pulse bg-ok')} aria-hidden />
          {stale ? 'Could not refresh, trying again' : `Updated ${new Date(d.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
        </div>
      </header>

      <section className="card mt-6 p-5" aria-label="Overall progress">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-sm text-muted">Completes</div>
            <div className="text-3xl font-bold tabular-nums">{t.completes.toLocaleString()} <span className="text-lg font-medium text-muted">/ {t.target.toLocaleString()}</span></div>
          </div>
          <div className="text-2xl font-semibold tabular-nums text-brand">{pct(t.completes, t.target)}%</div>
        </div>
        <Bar done={t.completes} target={t.target} className="mt-3 h-3" />
        <div className="mt-5 flex items-center justify-between text-xs text-muted">
          <span className="inline-flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" /> {t.last24h.toLocaleString()} completes in the last 24 hours</span>
          <span>now</span>
        </div>
        <div className="mt-2"><Pace pace={d.pace} /></div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Fieldwork figures">
        {([
          ['In progress', t.inProgress.toLocaleString(), Hourglass, 'tone-blue'],
          ['Terminates', t.terminates.toLocaleString(), CircleSlash, 'tone-amber'],
          ['Quota full', t.quotaFull.toLocaleString(), Gauge, 'tone-cyan'],
          ['Removed for quality', t.removedForQuality.toLocaleString(), ShieldAlert, 'tone-pink'],
          ['Avg LOI', t.avgLoiMinutes != null ? `${t.avgLoiMinutes} min` : '–', Clock, 'tone-violet'],
          ['Incidence', t.incidence != null ? `${t.incidence}%` : '–', Percent, 'tone-green'],
        ] as const).map(([label, value, Icon, tone]) => (
          <div key={label} className="card flex min-w-0 items-center gap-3 p-4">
            <span className={clsx('icon-tile hidden sm:grid', tone)}><Icon className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0">
              <div className="text-lg font-bold tabular-nums">{value}</div>
              <div className="truncate text-xs text-muted">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {d.showMoney && currencies.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Spend">
          {currencies.map((c) => (
            <div key={c} className="card p-4">
              <div className="text-xs text-muted">Spend so far{currencies.length > 1 ? ` · ${c}` : ''}</div>
              <div className="text-lg font-bold tabular-nums">{money(d.markets.filter((m) => m.money?.currency === c).reduce((a, m) => a + (m.money?.spend ?? 0), 0), c)}</div>
              <div className="text-xs text-muted">CPI × accepted completes</div>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold">Markets and quotas</h2>
      <div className="mt-3 space-y-4">
        {d.markets.map((m, i) => (
          <section key={i} className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-medium">{flag(m.countryCode)} {countryName(m.countryCode)} <span className="text-muted">({m.language}){m.targetGroup ? ` · ${m.targetGroup}` : ''}</span></h3>
                <div className="mt-0.5 text-xs text-muted">
                  Planned LOI {m.plannedLoiMinutes} min · IR {m.plannedIrPercent}%
                  {m.money && <> · CPI {money(m.money.cpi, m.money.currency)} · spend {money(m.money.spend, m.money.currency)}</>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusChip status={m.status} />
                <span className="text-sm font-semibold tabular-nums">{m.completes.toLocaleString()} / {m.target.toLocaleString()}</span>
              </div>
            </div>
            <Bar done={m.completes} target={m.target} className="mt-3" />
            {groups(m.quotas).map((g) => (
              <div key={g.group} className="mt-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">{g.group}</div>
                <ul className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {g.cells.map((q) => (
                    <li key={q.name} className="min-w-0">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{q.name}</span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {q.completes} / {q.target}
                          {!q.open && <span className="ml-1.5 chip bg-sunken text-muted">{q.completes >= q.target ? 'Full' : 'Closed'}</span>}
                        </span>
                      </div>
                      <Bar done={q.completes} target={q.target} className="mt-1" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>

      {d.vendors && d.vendors.length > 0 && (
        <section className="card mt-6 p-5" aria-label="Sample sources">
          <h2 className="text-sm font-semibold">Sample sources</h2>
          <ul className="mt-3 space-y-3">
            {d.vendors.map((v) => (
              <li key={v.name}>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{v.name}{!v.active && <span className="ml-1.5 text-xs text-muted">(paused)</span>}</span>
                  <span className="shrink-0 tabular-nums text-muted">{v.completes} / {v.target}</span>
                </div>
                <Bar done={v.completes} target={v.target} className="mt-1" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 text-center text-xs text-muted">Read-only view shared from SampTrek. It refreshes every 30 seconds. Test traffic is not counted.</footer>
    </main>
  );
}
