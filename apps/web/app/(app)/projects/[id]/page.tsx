'use client';
import clsx from 'clsx';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { useTheme } from '@/components/theme';
import { CountriesTab } from '@/components/project/countries-tab';
import { FilesTab } from '@/components/project/files-tab';
import { FinanceTab } from '@/components/project/finance-tab';
import { HistoryTab } from '@/components/project/history-tab';
import { SaveTemplate } from '@/components/project/save-template';
import { AlertTriangle, BadgeCheck, CircleSlash, CopyPlus, Gauge, Hourglass, LayoutTemplate, ShieldAlert, X } from 'lucide-react';
import { CloneProject } from '@/components/project/clone-project';
import { MonitorTab } from '@/components/project/monitor-tab';
import { QuotasTab } from '@/components/project/quotas-tab';
import { QaStudio } from '@/components/project/qa-studio';
import { RedirectsTab } from '@/components/project/redirects-tab';
import { RespondentPagesTab } from '@/components/project/respondent-pages-tab';
import { AnswersView } from '@/components/project/answers-view';
import { SampleonTab } from '@/components/project/sampleon-tab';
import { SecurityTab } from '@/components/project/security-tab';
import { SessionsTab } from '@/components/project/sessions-tab';
import { VendorsTab } from '@/components/project/vendors-tab';
import { UniqueLinksTab } from '@/components/project/unique-links-tab';
import type { ProjectDetail } from '@/components/project/types';
import { ErrorBox, Loading, PageHeader, StatusChip, money } from '@/components/ui';
import { InfoTip } from '@/components/help';
import { helpForTab } from '@/lib/help';
import { get, patch } from '@/lib/api';
import { flag } from '@/lib/countries';
import { SECURITY_LABELS } from '@/lib/types';

const TABS = ['Overview', 'Vendors & links', 'Unique links', 'Quotas', 'SAMPLEON', 'Monitor', 'Gate & security', 'Respondent pages', 'Redirects', 'QA studio', 'Respondents', 'Answers', 'Reconcile & invoice', 'Files & requests', 'History'] as const;
const NEXT_STATUS: Record<string, string[]> = {
  DRAFT: ['TEST', 'LIVE'],
  TEST: ['LIVE', 'HOLD'],
  LIVE: ['HOLD', 'CLOSED'],
  HOLD: ['LIVE', 'CLOSED'],
  CLOSED: ['INVOICED', 'LIVE'],
  INVOICED: [],
};

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const editable = canEdit(me);
  const [p, setP] = useState<ProjectDetail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [error, setError] = useState<unknown>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [launch, setLaunch] = useState<ProjectDetail['launch'] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  useEffect(() => {
    try {
      const k = `projexa:template-skipped:${id}`;
      const v = sessionStorage.getItem(k);
      if (v) {
        setSkipped(JSON.parse(v));
        sessionStorage.removeItem(k);
      }
    } catch {}
  }, [id]);

  // Links such as ?tab=redirects open a tab directly.
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get('tab');
    const t = want && TABS.find((x) => x.toLowerCase().startsWith(want.toLowerCase()));
    if (t) setTab(t);
  }, []);

  const reload = useCallback(() => get<ProjectDetail>(`/projects/${id}`).then(setP).catch(setError), [id]);
  useEffect(() => {
    reload();
  }, [reload]);

  // Remember this project in the sidebar's "Recent projects" (most recent first, at most 8).
  const { prefs, update } = useTheme();
  const recentKey = p ? `${p.id}|${p.projectCode}|${p.name}` : '';
  useEffect(() => {
    if (!p) return;
    const rest = prefs.recentProjects.filter((r) => r.id !== p.id);
    if (prefs.recentProjects[0]?.id === p.id && prefs.recentProjects[0]?.name === p.name) return;
    update({ recentProjects: [{ id: p.id, code: p.projectCode, name: p.name.slice(0, 200) }, ...rest].slice(0, 8) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentKey]);

  async function setStatus(status: string) {
    setError(null);
    setLaunch(null);
    try {
      const next = await patch<ProjectDetail>(`/projects/${id}`, { status });
      setP(next);
      if (next.launch?.notReady.length) setLaunch(next.launch);
    } catch (e) {
      setError(e);
    }
  }

  if (!p) return error ? <ErrorBox error={error} /> : <Loading />;
  const target = p.countries.reduce((a, c) => a + c.targetCompletes, 0);
  const completes = p.countries.reduce((a, c) => a + c.completes, 0);
  const security = Object.entries(p.security).filter(([, v]) => v).map(([k]) => SECURITY_LABELS[k] ?? k);
  const range = (xs: number[], unit: string) => {
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    return xs.length ? (lo === hi ? `${lo}${unit}` : `${lo}–${hi}${unit}`) : '–';
  };
  const loi = range(p.countries.map((c) => c.loiMinutes), ' min');
  const ir = range(p.countries.map((c) => c.irPercent), '%');

  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip status={p.status} />
            <span>{p.projectCode}</span>
            {p.workOrderNo && <span>· {p.workOrderNo}</span>}
            <span>· {p.client.name}</span>
            <span>· {p.category}</span>
            <span>· PM {p.projectManager.name}</span>
            <span>· LOI {loi}</span>
            <span>· IR {ir}</span>
            <span>· {[...new Set(p.countries.map((c) => flag(c.countryCode)))].join(' ')}</span>
          </span>
        }
        actions={
          editable && (
            <>
              <button className="btn-ghost" onClick={() => { setCloning(!cloning); setSavingTemplate(false); }}><CopyPlus className="h-4 w-4" /> Clone project</button>
              <button className="btn-ghost" onClick={() => { setSavingTemplate(!savingTemplate); setCloning(false); }}><LayoutTemplate className="h-4 w-4" /> Save as template</button>
              {NEXT_STATUS[p.status]?.map((s) => (
                <button key={s} className={s === 'LIVE' ? 'btn-primary' : 'btn-ghost'} onClick={() => setStatus(s)}>
                  {s === 'LIVE' ? 'Go live' : `Set ${s.toLowerCase()}`}
                </button>
              ))}
            </>
          )
        }
      />
      <div className="mb-4"><ErrorBox error={error} /></div>
      {skipped.length > 0 && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm" role="status">
          <div className="font-medium">Created from the template, with these left out:</div>
          <ul className="mt-1 list-disc pl-5">{skipped.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {launch && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">The project is live, but {launch.notReady.length === 1 ? 'one market is' : `${launch.notReady.length} markets are`} not.</div>
            <ul className="mt-1 list-disc pl-5">{launch.notReady.map((n) => <li key={n.id}>{n.market}: {n.problems.join(' and ')}</li>)}</ul>
            <div className="mt-1 text-muted">Add the live survey link (Overview tab) or a vendor (Vendors &amp; links tab), then set that market live.</div>
          </div>
          <button className="btn-ghost p-1" aria-label="Dismiss" onClick={() => setLaunch(null)}><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {savingTemplate && <SaveTemplate project={p} onClose={() => setSavingTemplate(false)} />}
      {cloning && <CloneProject project={p} onClose={() => setCloning(false)} />}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {([
          ['Completes', `${completes} / ${target}`, BadgeCheck, 'tone-violet'],
          ['In progress', p.stats.STARTED, Hourglass, 'tone-blue'],
          ['Terminates', p.stats.TERMINATE, CircleSlash, 'tone-amber'],
          ['Overquota / quota full', p.stats.QUOTA_FULL, Gauge, 'tone-cyan'],
          ['Quality, duplicate, security', p.stats.QUALITY_FAIL + p.stats.DUPLICATE + p.stats.SECURITY_REJECT, ShieldAlert, 'tone-pink'],
        ] as const).map(([l, v, Icon, tone], i) => (
          <div key={l} className={clsx('card flex min-w-0 items-center gap-3 p-4', i === 0 && 'col-span-2 lg:col-span-1')}>
            <span className={clsx('icon-tile hidden sm:grid', tone)}><Icon className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0">
              <div className="text-xl font-bold tabular-nums">{v}</div>
              <div className="text-xs text-muted">{l}</div>
            </div>
          </div>
        ))}
      </div>

      {!!p.finance?.length && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Money">
          {p.finance.map((f) => (
            [
              ['Client CPI', f.minCpi === f.maxCpi ? money(f.minCpi, f.currency) : `${money(f.minCpi, f.currency)}–${money(f.maxCpi)}`, f.minCpi === f.maxCpi ? 'per complete' : `per complete · average ${money(f.avgCpi)}`],
              ['Expected revenue', money(f.plannedRevenue, f.currency), 'CPI × target completes'],
              ['Revenue so far', money(f.revenue, f.currency), 'from completes'],
              ['Vendor cost so far', money(f.cost, f.currency), f.plannedCost ? `about ${money(f.plannedCost, f.currency)} at target` : 'no vendors yet'],
              ['Margin so far', money(f.margin, f.currency), f.revenue ? `${Math.round((f.margin / f.revenue) * 100)}% of revenue` : 'no completes yet'],
            ] as const
          ).map(([label, value, hint]) => (
            <div key={`${f.currency}-${label}`} className="card min-w-0 p-4">
              <div className="text-xs text-muted">{label}{p.finance!.length > 1 ? ` · ${f.currency}` : ''}</div>
              <div className={clsx('truncate text-lg font-bold tabular-nums', label === 'Margin so far' && f.margin < 0 && 'text-bad')}>{value}</div>
              <div className="truncate text-xs text-muted">{hint}</div>
            </div>
          )))}
        </div>
      )}

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => (
          <div key={t} className={clsx('-mb-px flex shrink-0 items-center border-b-2', tab === t ? 'border-brand' : 'border-transparent')}>
            <button role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('whitespace-nowrap py-2.5 text-sm', tab === t ? 'pl-4 pr-1 font-medium text-brand' : 'px-4 text-muted hover:text-ink')}>
              {t}
            </button>
            {/* The active tab shows its "i"; the words are in lib/help.ts under tab:<name>. */}
            {tab === t && <span className="pr-2"><InfoTip entry={helpForTab(t)} /></span>}
          </div>
        ))}
      </div>

      {tab === 'Overview' && <CountriesTab project={p} editable={editable} reload={reload} security={security} />}
      {tab === 'Vendors & links' && <VendorsTab project={p} editable={editable} reload={reload} />}
      {tab === 'Unique links' && <UniqueLinksTab key={p.id} project={p} editable={editable} />}
      {tab === 'Quotas' && <QuotasTab key={p.id} project={p} editable={editable} />}
      {tab === 'SAMPLEON' && <SampleonTab key={p.id} project={p} editable={editable} />}
      {tab === 'Monitor' && <MonitorTab key={p.id} project={p} editable={editable} reload={reload} />}
      {tab === 'Redirects' && <RedirectsTab project={p} editable={editable} reload={reload} />}
      {tab === 'QA studio' && <QaStudio project={p} />}
      {tab === 'Respondents' && <SessionsTab project={p} editable={editable} />}
      {tab === 'Gate & security' && <SecurityTab key={p.id} project={p} editable={editable} reload={reload} />}
      {tab === 'Reconcile & invoice' && <FinanceTab key={p.id} project={p} editable={editable} reload={reload} />}
      {tab === 'Respondent pages' && <RespondentPagesTab key={p.id} project={p} editable={editable} />}
      {tab === 'Files & requests' && <FilesTab project={p} editable={editable} />}
      {tab === 'History' && <HistoryTab key={p.id} project={p} editable={editable} reload={reload} />}
      {tab === 'Answers' && <AnswersView projectId={p.id} projectCode={p.projectCode} />}
    </>
  );
}
