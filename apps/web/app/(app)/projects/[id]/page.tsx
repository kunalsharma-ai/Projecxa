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
import { BadgeCheck, CircleSlash, Gauge, Hourglass, LayoutTemplate, ShieldAlert } from 'lucide-react';
import { MonitorTab } from '@/components/project/monitor-tab';
import { QuotasTab } from '@/components/project/quotas-tab';
import { QaStudio } from '@/components/project/qa-studio';
import { RedirectsTab } from '@/components/project/redirects-tab';
import { RespondentPagesTab } from '@/components/project/respondent-pages-tab';
import { AnswersView } from '@/components/project/answers-view';
import { SecurityTab } from '@/components/project/security-tab';
import { SessionsTab } from '@/components/project/sessions-tab';
import { VendorsTab } from '@/components/project/vendors-tab';
import { UniqueLinksTab } from '@/components/project/unique-links-tab';
import type { ProjectDetail } from '@/components/project/types';
import { ErrorBox, Loading, PageHeader, StatusChip } from '@/components/ui';
import { get, patch } from '@/lib/api';
import { flag } from '@/lib/countries';
import { SECURITY_LABELS } from '@/lib/types';

const TABS = ['Overview', 'Vendors & links', 'Unique links', 'Quotas', 'Monitor', 'Gate & security', 'Respondent pages', 'Redirects', 'QA studio', 'Respondents', 'Answers', 'Reconcile & invoice', 'Files & requests', 'History'] as const;
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
    try {
      setP(await patch<ProjectDetail>(`/projects/${id}`, { status }));
    } catch (e) {
      setError(e);
    }
  }

  if (!p) return error ? <ErrorBox error={error} /> : <Loading />;
  const target = p.countries.reduce((a, c) => a + c.targetCompletes, 0);
  const completes = p.countries.reduce((a, c) => a + c.completes, 0);
  const security = Object.entries(p.security).filter(([, v]) => v).map(([k]) => SECURITY_LABELS[k] ?? k);

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
            <span>· {p.countries.map((c) => flag(c.countryCode)).join(' ')}</span>
          </span>
        }
        actions={
          editable && (
            <>
              <button className="btn-ghost" onClick={() => setSavingTemplate(!savingTemplate)}><LayoutTemplate className="h-4 w-4" /> Save as template</button>
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
      {savingTemplate && <SaveTemplate project={p} onClose={() => setSavingTemplate(false)} />}

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

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm', tab === t ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink')}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <CountriesTab project={p} editable={editable} reload={reload} security={security} />}
      {tab === 'Vendors & links' && <VendorsTab project={p} editable={editable} reload={reload} />}
      {tab === 'Unique links' && <UniqueLinksTab key={p.id} project={p} editable={editable} />}
      {tab === 'Quotas' && <QuotasTab key={p.id} project={p} editable={editable} />}
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
