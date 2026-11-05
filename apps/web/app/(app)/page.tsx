'use client';
import clsx from 'clsx';
import { MousePointerClick, TrendingUp, Activity, ArrowDownRight, Banknote, Check, HandCoins, LayoutDashboard, Receipt, RotateCcw, ArrowUpRight, BadgeCheck, Building2, CircleDollarSign, Clock3, FileText, FolderKanban, Hourglass, Minus, Truck, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, OutcomeChip, PageHeader, Progress, Section } from '@/components/ui';
import { canEdit, useMe } from '@/components/me';
import { CommandHero } from '@/components/dashboard/hero';
import { api, get } from '@/lib/api';
import { TrafficHeatmap, type Heat } from '@/components/dashboard/heatmap';
import { WidgetGrid, type WidgetPlace } from '@/components/dashboard/layout';
import { MarketsMap, type Market } from '@/components/dashboard/markets-map';
import { WaterfallChart, type Waterfall } from '@/components/dashboard/waterfall';
import { MoneyChart, type MoneyPoint } from '@/components/reports/money-chart';

interface Kpis { revenue: number; cost: number; profit: number; clicks: number; completes: number; currencies: string[] }
interface Base { currency: string; amount: number; missing: string[] }
interface Tile { count: number; byCurrency: { currency: string; amount: number }[]; base?: Base }
interface PayTile { completes: number; byCurrency: { currency: string; amount: number }[]; base: Base }
interface TopRow { id: string; label: string; sublabel: string | null; revenue: number; profit: number; completes: number; clicks: number; currencies: string[] }
interface Dashboard {
  clients: { total: number; active: number; inactive: number };
  vendors: { total: number; active: number; inactive: number };
  projects: { total: number; byStatus: Record<string, number> };
  financials: { currencyNote: string };
  sessionsByStatus: Record<string, number>;
  redirectHealth24h: { total: number; fallbacks: number };
  callbacks: Record<string, number>;
  liveProjects: { id: string; projectCode: string; workOrderNo: string | null; name: string; target: number; completes: number }[];
  period: {
    from: string; to: string; previousFrom: string; previousTo: string; current: Kpis; previous: Kpis; trend: Record<'revenue' | 'cost' | 'profit' | 'clicks' | 'completes', number | null>;
    converted: { currency: string; current: { revenue: number; cost: number; profit: number; missing: string[] }; trend: Record<'revenue' | 'cost' | 'profit', number | null> };
  };
  finance: Record<'reconciled' | 'pendingReconciliation' | 'invoicePending' | 'invoiced' | 'paymentReceived', Tile>;
  payables?: Record<'unbilled' | 'due' | 'paid', PayTile>;
  top: { vendors: TopRow[]; projects: TopRow[]; clients: TopRow[] };
}
interface Layout { custom: boolean; widgets: WidgetPlace[] }
interface Series { interval: 'day' | 'week' | 'month'; points: MoneyPoint[]; currencies: string[] }

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const PRESETS = [
  { id: '7d', label: '7 days', range: () => ({ from: iso(Date.now() - 6 * DAY), to: iso(Date.now()) }) },
  { id: '30d', label: '30 days', range: () => ({ from: iso(Date.now() - 29 * DAY), to: iso(Date.now()) }) },
  { id: '90d', label: '90 days', range: () => ({ from: iso(Date.now() - 89 * DAY), to: iso(Date.now()) }) },
  { id: 'ytd', label: 'This year', range: () => ({ from: `${new Date().getUTCFullYear()}-01-01`, to: iso(Date.now()) }) },
] as const;
const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const amt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function Trend({ value, neutral }: { value: number | null; neutral?: boolean }) {
  if (value == null) return <span className="text-xs text-muted">no earlier data</span>;
  const Icon = value > 0 ? ArrowUpRight : value < 0 ? ArrowDownRight : Minus;
  const tone = neutral || value === 0 ? 'text-muted' : value > 0 ? 'text-ok' : 'text-bad';
  return (
    <span className={clsx('inline-flex items-center gap-0.5 text-xs font-medium', tone)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {value > 0 ? '+' : ''}{value}%<span className="ml-1 font-normal text-muted">vs previous</span>
    </span>
  );
}

function Money({ list, empty = '0' }: { list: { currency: string; amount: number }[]; empty?: string }) {
  if (!list.length) return <span>{empty}</span>;
  return (
    <span className="flex flex-wrap gap-x-2">
      {list.slice(0, 3).map((m) => <span key={m.currency} className="whitespace-nowrap">{m.currency} {amt.format(m.amount)}</span>)}
      {list.length > 3 && <span className="text-muted" title={list.slice(3).map((m) => `${m.currency} ${amt.format(m.amount)}`).join(', ')}>+{list.length - 3} more</span>}
    </span>
  );
}

/** "≈ USD 12,345.00 total" when amounts are in more than one currency (or not the reporting one). */
function BaseLine({ base, list }: { base?: Base; list: { currency: string; amount: number }[] }) {
  if (!base || !list.length || (list.length === 1 && list[0].currency === base.currency)) return null;
  return (
    <div className="mt-1 text-xs tabular-nums text-muted">
      ≈ {base.currency} {amt.format(base.amount)} total{base.missing.length > 0 && <span className="text-warn"> (no rate for {base.missing.join(', ')})</span>}
    </div>
  );
}

function TopList({ title, rows, href }: { title: string; rows: TopRow[]; href: (r: TopRow) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  return (
    <Section title={title}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No traffic in this period.</p>
      ) : (
        <ol className="space-y-3">
          {rows.map((r, i) => (
            <li key={r.id}>
              <Link href={href(r)} className="block rounded-md hover:bg-sunken/60">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate"><span className="mr-1.5 text-xs tabular-nums text-muted">{i + 1}</span><span className="font-medium">{r.label}</span>{r.sublabel && <span className="ml-1.5 text-xs text-muted">{r.sublabel}</span>}</span>
                  <span className="shrink-0 tabular-nums">{amt.format(r.revenue)}{r.currencies.length > 1 && <span className="ml-1 text-xs text-warn" title={`Mixed: ${r.currencies.join(', ')}`}>*</span>}</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full" style={{ width: `${(r.revenue / max) * 100}%`, background: 'var(--fin-1)' }} /></div>
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted">{num.format(r.completes)} completes</span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

export default function DashboardPage() {
  const me = useMe();
  const [preset, setPreset] = useState<string>('30d');
  const [range, setRange] = useState(PRESETS[1].range());
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [interval, setBucket] = useState<'day' | 'week' | 'month'>('day');
  const [mode, setMode] = useState<'bar' | 'line'>('bar');
  const [series, setSeries] = useState<Series | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [draft, setDraft] = useState<WidgetPlace[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [markets, setMarkets] = useState<{ currency: string; markets: Market[] } | null>(null);
  const [heat, setHeat] = useState<Heat | null>(null);
  const [fall, setFall] = useState<Waterfall | null>(null);
  const editing = draft !== null;
  const shown = new Set((draft ?? layout?.widgets ?? []).filter((w) => !w.hidden).map((w) => w.id));

  useEffect(() => {
    get<Layout>('/dashboard/layout').then(setLayout).catch(() => setLayout({ custom: false, widgets: [] }));
  }, []);
  // The newer widgets load only when they are on the page.
  const wantMap = shown.has('map');
  const wantHeat = shown.has('heatmap');
  const wantFall = shown.has('waterfall');
  useEffect(() => {
    if (!wantMap || !range.from || !range.to || range.from > range.to) return;
    setMarkets(null);
    get<{ currency: string; markets: Market[] }>(`/dashboard/markets?from=${range.from}&to=${range.to}`).then(setMarkets).catch(setError);
  }, [range, wantMap]);
  useEffect(() => {
    if (!wantHeat || !range.from || !range.to || range.from > range.to) return;
    setHeat(null);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    get<Heat>(`/dashboard/heatmap?from=${range.from}&to=${range.to}&tz=${encodeURIComponent(tz)}`).then(setHeat).catch(setError);
  }, [range, wantHeat]);
  useEffect(() => {
    if (!wantFall || !range.from || !range.to || range.from > range.to) return;
    setFall(null);
    get<Waterfall>(`/dashboard/waterfall?from=${range.from}&to=${range.to}`).then(setFall).catch(setError);
  }, [range, wantFall]);

  async function saveLayout() {
    if (!draft) return;
    setSaving(true);
    try {
      setLayout(await api<Layout>('/dashboard/layout', { method: 'PUT', json: { widgets: draft } }));
      setDraft(null);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }
  async function resetLayout() {
    if (!confirm('Go back to the standard dashboard layout?')) return;
    try {
      setLayout(await api<Layout>('/dashboard/layout', { method: 'DELETE' }));
      setDraft(null);
    } catch (e) {
      setError(e);
    }
  }

  useEffect(() => {
    if (!range.from || !range.to || range.from > range.to) return;
    get<Dashboard>(`/dashboard?from=${range.from}&to=${range.to}`).then((x) => { setD(x); setError(null); }).catch(setError);
  }, [range]);
  useEffect(() => {
    if (!range.from || !range.to || range.from > range.to) return;
    setSeries(null);
    get<Series>(`/dashboard/series?from=${range.from}&to=${range.to}&interval=${interval}`).then(setSeries).catch(setError);
  }, [range, interval]);

  if (error && !d) return <ErrorBox error={error} />;
  if (!d || !layout) return <Loading />;

  const c = d.period.current;
  const cv = d.period.converted;
  const missing = cv.current.missing.length ? `${cv.current.missing.join(', ')} left out: no exchange rate` : undefined;
  const kpis = [
    { key: 'revenue' as const, label: `Revenue · ${cv.currency}`, icon: CircleDollarSign, tone: 'tone-violet', value: amt.format(cv.current.revenue), trend: cv.trend.revenue, warn: missing },
    { key: 'cost' as const, label: `Cost · ${cv.currency}`, icon: HandCoins, tone: 'tone-amber', value: amt.format(cv.current.cost), neutral: true, trend: cv.trend.cost, warn: missing },
    { key: 'profit' as const, label: `Profit · ${cv.currency}`, icon: TrendingUp, tone: 'tone-green', value: amt.format(cv.current.profit), bad: cv.current.profit < 0, trend: cv.trend.profit, warn: missing },
    { key: 'clicks' as const, label: 'Clicks', icon: MousePointerClick, tone: 'tone-blue', value: num.format(c.clicks), trend: d.period.trend.clicks },
    { key: 'completes' as const, label: 'Completes', icon: BadgeCheck, tone: 'tone-pink', value: num.format(c.completes), trend: d.period.trend.completes },
  ];
  const fin = [
    { key: 'reconciled' as const, label: 'Reconciled', icon: BadgeCheck, sub: 'approved completes', href: '/reports' },
    { key: 'pendingReconciliation' as const, label: 'Awaiting reconciliation', icon: Hourglass, sub: 'completes to approve', href: '/projects' },
    { key: 'invoicePending' as const, label: 'Invoice pending', icon: Clock3, sub: 'approved, not yet sent', href: '/invoices?status=DRAFT' },
    { key: 'invoiced' as const, label: 'Invoiced', icon: FileText, sub: 'sent, awaiting payment', href: '/invoices?status=SENT' },
    { key: 'paymentReceived' as const, label: 'Payment received', icon: CircleDollarSign, sub: 'paid invoices', href: '/invoices?status=PAID' },
  ];
  const failedCallbacks = (d.callbacks.FAILED ?? 0) + (d.callbacks.DEAD_LETTER ?? 0);

  /** One widget's content. Inner grids follow the widget's own width (container queries), not the screen's. */
  const dash = d;
  function widget(id: string) {
    const d = dash;
    switch (id) {
      case 'kpis':
        return (
          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @4xl:grid-cols-5">
            {kpis.map((k) => (
              <div key={k.key} className="card anim-in flex min-w-0 items-center gap-3 p-4">
                <span className={clsx('icon-tile hidden @md:grid', k.tone)}><k.icon className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0">
                  <div className={clsx('truncate text-2xl font-bold tabular-nums', k.bad && 'text-bad')}>{k.value}{k.warn && <span className="ml-1 align-top text-xs text-warn" title={k.warn}>*</span>}</div>
                  <div className="truncate text-xs font-medium text-muted">{k.label}</div>
                  <div className="mt-0.5"><Trend value={k.trend} neutral={k.neutral} /></div>
                </div>
              </div>
            ))}
          </div>
        );
      case 'trend':
        return (
          <Section title="Revenue, payout and profit" actions={
            <div className="flex flex-wrap gap-2">
              <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Interval">
                {(['day', 'week', 'month'] as const).map((i) => (
                  <button key={i} type="button" aria-pressed={interval === i} onClick={() => setBucket(i)} className={clsx('rounded-md px-2.5 py-1 text-xs', interval === i ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>
                    {i === 'day' ? 'Daily' : i === 'week' ? 'Weekly' : 'Monthly'}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Chart style">
                {(['bar', 'line'] as const).map((m) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={clsx('rounded-md px-2.5 py-1 text-xs', mode === m ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>
                    {m === 'bar' ? 'Bars' : 'Lines'}
                  </button>
                ))}
              </div>
            </div>
          }>
            {series ? <MoneyChart points={series.points} interval={series.interval} mode={mode} currencies={series.currencies} /> : <div className="skeleton h-60" />}
          </Section>
        );
      case 'map':
        return <Section title="Markets">{markets ? <MarketsMap markets={markets.markets} currency={markets.currency} /> : <div className="skeleton h-64" />}</Section>;
      case 'waterfall':
        return <Section title="Revenue to profit">{fall ? <WaterfallChart data={fall} /> : <div className="skeleton h-40" />}</Section>;
      case 'heatmap':
        return <Section title="Traffic by weekday and hour">{heat ? <TrafficHeatmap data={heat} /> : <div className="skeleton h-48" />}</Section>;
      case 'finance':
        return (
          <div>
            <h2 className="mb-3 text-sm font-semibold">Reconciliation and invoicing <span className="font-normal text-muted">· all time</span></h2>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-3 @6xl:grid-cols-5">
              {fin.map(({ key, label, icon: Icon, sub, href }) => (
                <Link key={key} href={href} className="card group min-w-0 p-4 hover:border-brand/40">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted"><span className="icon-tile tone-brand h-7 w-7 rounded-lg"><Icon className="h-3.5 w-3.5" aria-hidden /></span>{label}</div>
                  <div className="mt-1.5 text-base font-semibold tabular-nums"><Money list={d.finance[key].byCurrency} /></div>
                  <div className="mt-0.5 text-xs text-muted">{num.format(d.finance[key].count)} {sub}</div>
                  <BaseLine base={d.finance[key].base} list={d.finance[key].byCurrency} />
                </Link>
              ))}
            </div>
          </div>
        );
      case 'payables':
        if (!d.payables) return <Section title="Vendor payables"><Empty>Not available for your role.</Empty></Section>;
        return (
          <div>
            <h2 className="mb-3 text-sm font-semibold">Vendor payables <span className="font-normal text-muted">· all time</span></h2>
            <div className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
              {([
                ['unbilled', 'Approved, not billed', HandCoins, 'completes to bill', '/payables'],
                ['due', 'Bills due', Receipt, 'completes on approved bills', '/payables?status=APPROVED'],
                ['paid', 'Paid to vendors', Banknote, 'completes paid', '/payables?status=PAID'],
              ] as const).map(([key, label, Icon, sub, href]) => (
                <Link key={key} href={href} className="card group min-w-0 p-4 hover:border-brand/40">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted"><span className="icon-tile tone-brand h-7 w-7 rounded-lg"><Icon className="h-3.5 w-3.5" aria-hidden /></span>{label}</div>
                  <div className="mt-1.5 text-base font-semibold tabular-nums"><Money list={d.payables![key].byCurrency} /></div>
                  <div className="mt-0.5 text-xs text-muted">{num.format(d.payables![key].completes)} {sub}</div>
                  <BaseLine base={d.payables![key].base} list={d.payables![key].byCurrency} />
                </Link>
              ))}
            </div>
          </div>
        );
      case 'top-vendors':
        return <TopList title="Top 5 vendors" rows={d.top.vendors} href={(r) => `/reports?vendorId=${r.id}`} />;
      case 'top-projects':
        return <TopList title="Top 5 projects" rows={d.top.projects} href={(r) => `/projects/${r.id}`} />;
      case 'top-clients':
        return <TopList title="Top 5 clients" rows={d.top.clients} href={(r) => `/reports?clientId=${r.id}`} />;
      case 'live-projects':
        return (
          <Section title="Live projects · quota achievement">
            {d.liveProjects.length === 0 ? (
              <Empty>No live projects yet.</Empty>
            ) : (
              <div className="divide-y divide-line">
                {d.liveProjects.map((p) => (
                  <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between gap-4 py-3 hover:bg-sunken/50">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-muted">{p.projectCode}{p.workOrderNo ? ` · ${p.workOrderNo}` : ''}</div>
                    </div>
                    <Progress value={p.completes} max={p.target} />
                  </Link>
                ))}
              </div>
            )}
          </Section>
        );
      case 'workspace':
        return (
          <Section title="Workspace">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="flex items-center gap-2 text-muted"><Building2 className="h-4 w-4" />Clients</dt><dd className="tabular-nums">{d.clients.total} <span className="text-xs text-muted">({d.clients.active} active)</span></dd></div>
              <div className="flex justify-between"><dt className="flex items-center gap-2 text-muted"><Truck className="h-4 w-4" />Vendors</dt><dd className="tabular-nums">{d.vendors.total} <span className="text-xs text-muted">({d.vendors.active} active)</span></dd></div>
              <div className="flex justify-between"><dt className="flex items-center gap-2 text-muted"><FolderKanban className="h-4 w-4" />Projects</dt><dd className="tabular-nums">{d.projects.total} <span className="text-xs text-muted">({d.projects.byStatus.LIVE ?? 0} live, {d.projects.byStatus.HOLD ?? 0} on hold)</span></dd></div>
            </dl>
          </Section>
        );
      case 'health':
        return (
          <Section title={<span className="flex items-center gap-2"><Activity className="h-4 w-4" /> Fieldwork health</span>} actions={<Link href="/redirect-health" className="text-xs text-brand hover:underline">Redirect health</Link>}>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Redirects in the last 24h</dt><dd className="tabular-nums">{d.redirectHealth24h.total}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Redirects that used a fallback</dt><dd className={d.redirectHealth24h.fallbacks ? 'text-warn' : ''}>{d.redirectHealth24h.fallbacks}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Callbacks delivered</dt><dd className="tabular-nums">{d.callbacks.DELIVERED ?? 0}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Callbacks retrying</dt><dd className="tabular-nums">{d.callbacks.RETRY_SCHEDULED ?? 0}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Callbacks failed</dt><dd className={failedCallbacks ? 'text-bad' : ''}>{failedCallbacks}</dd></div>
            </dl>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {Object.entries(d.sessionsByStatus).map(([st, n]) => (
                <span key={st} className="flex items-center gap-1"><OutcomeChip status={st} /><span className="text-xs tabular-nums text-muted">{n}</span></span>
              ))}
            </div>
          </Section>
        );
      default:
        return null;
    }
  }

  return (
    <>
      <PageHeader
        title="Command center"
        subtitle="Live numbers from your projects; test traffic is excluded."
        actions={
          editing ? (
            <div className="flex flex-wrap gap-2">
              {layout.custom && <button type="button" className="btn-ghost" onClick={resetLayout}><RotateCcw className="h-4 w-4" /> Reset</button>}
              <button type="button" className="btn-ghost" onClick={() => setDraft(null)}><X className="h-4 w-4" /> Cancel</button>
              <button type="button" className="btn-primary" disabled={saving} onClick={saveLayout}><Check className="h-4 w-4" /> Done</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-ghost" onClick={() => setDraft(layout.widgets)}><LayoutDashboard className="h-4 w-4" /> Customize</button>
              <Link href="/reports" className="btn-ghost">Open reports</Link>
            </div>
          )
        }
      />

      <CommandHero
        firstName={me?.user.name.split(' ')[0] ?? ''}
        canCreate={canEdit(me)}
        counts={{ live: d.projects.byStatus.LIVE ?? 0, draft: d.projects.byStatus.DRAFT ?? 0, test: d.projects.byStatus.TEST ?? 0, closed: d.projects.byStatus.CLOSED ?? 0, invoiced: d.projects.byStatus.INVOICED ?? 0, total: d.projects.total }}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap rounded-full border border-line bg-panel p-0.5" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => { setPreset(p.id); setRange(p.range()); }} className={clsx('rounded-full px-3 py-1.5 text-sm', preset === p.id ? 'bg-neon shadow-sm' : 'text-muted hover:bg-sunken')}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          From <input type="date" className="input w-auto py-1.5" value={range.from} max={range.to} onChange={(e) => { setPreset('custom'); setRange({ ...range, from: e.target.value }); }} />
        </label>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          to <input type="date" className="input w-auto py-1.5" value={range.to} min={range.from} onChange={(e) => { setPreset('custom'); setRange({ ...range, to: e.target.value }); }} />
        </label>
        <span className="text-xs text-muted">Compared with {short(d.period.previousFrom)} to {short(d.period.previousTo)} (UTC)</span>
      </div>
      <ErrorBox error={error} />

      <WidgetGrid layout={draft ?? layout.widgets} editing={editing} onChange={setDraft} render={(id) => widget(id)} />
    </>
  );
}
