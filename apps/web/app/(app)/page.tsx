'use client';
import { Activity, Building2, CheckCircle2, FolderKanban, MousePointerClick, Truck, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, OutcomeChip, PageHeader, Progress, Section, money } from '@/components/ui';
import { useMe } from '@/components/me';
import { get } from '@/lib/api';

interface Dashboard {
  clients: { total: number; active: number; inactive: number };
  vendors: { total: number; active: number; inactive: number };
  projects: { total: number; byStatus: Record<string, number> };
  financials: { revenue: number; cost: number; profit: number; currencyNote: string };
  clicks: number;
  completes: number;
  sessionsByStatus: Record<string, number>;
  redirectHealth24h: { total: number; fallbacks: number };
  callbacks: Record<string, number>;
  liveProjects: { id: string; projectCode: string; workOrderNo: string | null; name: string; target: number; completes: number }[];
}

export default function DashboardPage() {
  const me = useMe();
  const [d, setD] = useState<Dashboard | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    get<Dashboard>('/dashboard').then(setD).catch(setError);
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;

  const failedCallbacks = (d.callbacks.FAILED ?? 0) + (d.callbacks.DEAD_LETTER ?? 0);
  const tiles = [
    { label: 'Clients', value: d.clients.total, sub: `${d.clients.active} active`, icon: Building2 },
    { label: 'Vendors', value: d.vendors.total, sub: `${d.vendors.active} active`, icon: Truck },
    { label: 'Projects', value: d.projects.total, sub: `${d.projects.byStatus.LIVE ?? 0} live · ${d.projects.byStatus.HOLD ?? 0} on hold`, icon: FolderKanban },
    { label: 'Clicks', value: d.clicks, sub: 'all respondent entries', icon: MousePointerClick },
    { label: 'Completes', value: d.completes, sub: 'excludes rejected', icon: CheckCircle2 },
    { label: 'Profit', value: money(d.financials.profit), sub: `revenue ${money(d.financials.revenue)} · cost ${money(d.financials.cost)}`, icon: Wallet },
  ];

  return (
    <>
      <PageHeader title={`Welcome, ${me?.user.name ?? ''}`} subtitle="Live numbers from your projects. Test traffic is excluded." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map(({ label, value, sub, icon: Icon }) => (
          <div key={label} className="card flex items-start gap-4 p-5">
            <div className="rounded-lg bg-brand/10 p-2.5 text-brand">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
              <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{d.financials.currencyNote}</p>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Section title="Live projects">
          {d.liveProjects.length === 0 ? (
            <Empty>No live projects yet.</Empty>
          ) : (
            <div className="divide-y divide-line">
              {d.liveProjects.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between gap-4 py-3 hover:bg-sunken/50">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="text-xs text-muted">
                      {p.projectCode}
                      {p.workOrderNo ? ` · ${p.workOrderNo}` : ''}
                    </div>
                  </div>
                  <Progress value={p.completes} max={p.target} />
                </Link>
              ))}
            </div>
          )}
        </Section>
        <Section title={<span className="flex items-center gap-2"><Activity className="h-4 w-4" /> Fieldwork health</span>}>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Redirects in the last 24h</dt><dd className="tabular-nums">{d.redirectHealth24h.total}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Redirects that used a fallback</dt><dd className={d.redirectHealth24h.fallbacks ? 'text-warn' : ''}>{d.redirectHealth24h.fallbacks}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Callbacks delivered</dt><dd className="tabular-nums">{d.callbacks.DELIVERED ?? 0}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Callbacks retrying</dt><dd className="tabular-nums">{d.callbacks.RETRY_SCHEDULED ?? 0}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Callbacks failed</dt><dd className={failedCallbacks ? 'text-bad' : ''}>{failedCallbacks}</dd></div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-1.5">
            {Object.entries(d.sessionsByStatus).map(([s, n]) => (
              <span key={s} className="flex items-center gap-1"><OutcomeChip status={s} /><span className="text-xs tabular-nums text-muted">{n}</span></span>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
