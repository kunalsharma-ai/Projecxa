'use client';
import clsx from 'clsx';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { useTheme } from '@/components/theme';
import { CountriesTab } from '@/components/project/countries-tab';
import { FinanceTab } from '@/components/project/finance-tab';
import { QaStudio } from '@/components/project/qa-studio';
import { RedirectsTab } from '@/components/project/redirects-tab';
import { RespondentPagesTab } from '@/components/project/respondent-pages-tab';
import { AnswersView } from '@/components/project/answers-view';
import { SecurityTab } from '@/components/project/security-tab';
import { SessionsTab } from '@/components/project/sessions-tab';
import { VendorsTab } from '@/components/project/vendors-tab';
import type { ProjectDetail } from '@/components/project/types';
import { ErrorBox, Loading, PageHeader, StatusChip } from '@/components/ui';
import { get, patch } from '@/lib/api';
import { flag } from '@/lib/countries';
import { SECURITY_LABELS } from '@/lib/types';

const TABS = ['Overview', 'Vendors & links', 'Gate & security', 'Respondent pages', 'Redirects', 'QA studio', 'Respondents', 'Answers', 'Reconcile & invoice'] as const;
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
          editable &&
          NEXT_STATUS[p.status]?.map((s) => (
            <button key={s} className={s === 'LIVE' ? 'btn-primary' : 'btn-ghost'} onClick={() => setStatus(s)}>
              {s === 'LIVE' ? 'Go live' : `Set ${s.toLowerCase()}`}
            </button>
          ))
        }
      />
      <div className="mb-4"><ErrorBox error={error} /></div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ['Completes', `${completes} / ${target}`],
          ['In progress', p.stats.STARTED],
          ['Terminates', p.stats.TERMINATE],
          ['Overquota / quota full', p.stats.QUOTA_FULL],
          ['Quality, duplicate, security', p.stats.QUALITY_FAIL + p.stats.DUPLICATE + p.stats.SECURITY_REJECT],
        ].map(([l, v]) => (
          <div key={l} className="card p-4">
            <div className="text-xs text-muted">{l}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{v}</div>
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
      {tab === 'Redirects' && <RedirectsTab project={p} editable={editable} reload={reload} />}
      {tab === 'QA studio' && <QaStudio project={p} />}
      {tab === 'Respondents' && <SessionsTab project={p} editable={editable} />}
      {tab === 'Gate & security' && <SecurityTab key={p.id} project={p} editable={editable} reload={reload} />}
      {tab === 'Reconcile & invoice' && <FinanceTab key={p.id} project={p} editable={editable} reload={reload} />}
      {tab === 'Respondent pages' && <RespondentPagesTab key={p.id} project={p} editable={editable} />}
      {tab === 'Answers' && <AnswersView projectId={p.id} projectCode={p.projectCode} />}
    </>
  );
}
