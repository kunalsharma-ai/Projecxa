'use client';
import clsx from 'clsx';
import { Download } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyButton } from '@/components/project/vendors-tab';
import { Empty, ErrorBox, Loading, OutcomeChip, PageHeader, Progress, Section, StatusChip, money } from '@/components/ui';
import { get } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import { downloadCsv } from '@/lib/csv';

interface Summary {
  vendor: { name: string; code: string };
  liveAllocations: number;
  clicks: number;
  conversion: number;
  stats: Record<string, number>;
  payout: Record<'approved' | 'pending' | 'rejected', { completes: number; payout: number }>;
  currencyNote: string;
}
interface Allocation {
  id: string; project: { projectCode: string; name: string; status: string; category: string; devices: Record<string, boolean> };
  countryCode: string; language: string; targetGroup: string | null; loiMinutes: number; irPercent: number; status: string; accepting: boolean;
  cpi: string; currency: string; targetCompletes: number; completes: number; entryLink: string; testEntryLink: string; stats: Record<string, number>;
}
interface SessionRow {
  id: string; vendorRespondentId: string; status: string; approval: string; isTest: boolean; payout: string | null; startedAt: string;
  project: { projectCode: string; name: string }; projectCountry: { countryCode: string; currency: string };
}
interface Callback { id: string; url: string; state: string; attempts: number; lastStatusCode: number | null; lastError: string | null; createdAt: string }

const TABS = ['Projects', 'Respondents', 'Callbacks'] as const;

export default function VendorPortal() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [allocs, setAllocs] = useState<Allocation[] | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [callbacks, setCallbacks] = useState<Callback[] | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Projects');
  const [allocFilter, setAllocFilter] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    get<Summary>('/portal/vendor/summary').then(setSummary).catch(setError);
    get<Allocation[]>('/portal/vendor/allocations').then(setAllocs).catch(setError);
  }, []);
  const requestNo = useRef(0);
  const loadSessions = useCallback(() => {
    const n = ++requestNo.current; // only the latest filter's response is shown
    setSessions(null);
    get<SessionRow[]>(`/portal/vendor/sessions${allocFilter ? `?allocationId=${allocFilter}` : ''}`)
      .then((r) => n === requestNo.current && setSessions(r))
      .catch(setError);
  }, [allocFilter]);
  useEffect(() => {
    if (tab === 'Respondents') loadSessions();
    if (tab === 'Callbacks' && !callbacks) get<Callback[]>('/portal/vendor/callbacks').then(setCallbacks).catch(setError);
  }, [tab, loadSessions, callbacks]);

  if (error) return <ErrorBox error={error} />;
  if (!summary) return <Loading />;

  const tiles = [
    ['Live projects', summary.liveAllocations],
    ['Clicks', summary.clicks],
    ['Completes', summary.stats.COMPLETE ?? 0],
    ['Conversion', `${summary.conversion}%`],
    ['Approved payout', money(summary.payout.approved.payout)],
    ['Pending payout', money(summary.payout.pending.payout)],
  ];

  return (
    <>
      <PageHeader title={summary.vendor.name} subtitle="Your projects, entry links, respondents and payouts." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([l, v]) => (
          <div key={l} className="card p-4">
            <div className="text-xs text-muted">{l}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      <p className="mb-6 mt-2 text-xs text-muted">
        {summary.currencyNote} Rejected completes: {summary.payout.rejected.completes}. Payout becomes final when the client approves a complete.
      </p>

      <div className="mb-5 flex gap-1 border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={clsx('-mb-px border-b-2 px-4 py-2.5 text-sm', tab === t ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink')}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Projects' &&
        (!allocs ? <Loading /> : allocs.length === 0 ? <Empty>No projects have been assigned to you yet.</Empty> : (
          <div className="space-y-4">
            {allocs.map((a) => (
              <div key={a.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={clsx('chip', a.accepting ? 'bg-ok/15 text-ok' : 'bg-sunken text-muted')}>{a.accepting ? 'Accepting traffic' : 'Not accepting traffic'}</span>
                      {a.status !== 'ACTIVE' && <StatusChip status={a.status} />}
                    </div>
                    <h2 className="mt-2 truncate font-semibold">{a.project.name}</h2>
                    <p className="text-sm text-muted">
                      {a.project.projectCode} · {flag(a.countryCode)} {countryName(a.countryCode)} ({a.language}) · {a.project.category}
                      {a.targetGroup ? ` · ${a.targetGroup}` : ''}
                    </p>
                  </div>
                  <Progress value={a.completes} max={a.targetCompletes} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                  <div><dt className="text-xs text-muted">Your CPI</dt><dd className="font-medium">{money(a.cpi, a.currency)}</dd></div>
                  <div><dt className="text-xs text-muted">LOI</dt><dd>{a.loiMinutes} min</dd></div>
                  <div><dt className="text-xs text-muted">IR</dt><dd>{a.irPercent}%</dd></div>
                  <div><dt className="text-xs text-muted">Terminates</dt><dd className="tabular-nums">{a.stats.TERMINATE}</dd></div>
                  <div><dt className="text-xs text-muted">Quota full</dt><dd className="tabular-nums">{a.stats.QUOTA_FULL}</dd></div>
                </dl>
                <div className="mt-4 rounded-lg bg-sunken/60 p-3">
                  <div className="text-xs text-muted">Entry link (replace [UID] with your respondent ID)</div>
                  <code className="mt-1 block break-all text-xs">{a.entryLink}</code>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <CopyButton text={a.entryLink} label="Copy live link" />
                    <CopyButton text={a.testEntryLink} label="Copy test link" />
                    <span className="self-center text-xs text-muted">Devices: {Object.entries(a.project.devices).filter(([, v]) => v).map(([k]) => k).join(', ')}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}

      {tab === 'Respondents' && (
        <Section
          title="Respondents (latest 500)"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-64 py-1.5" value={allocFilter} onChange={(e) => setAllocFilter(e.target.value)} aria-label="Filter by project">
                <option value="">All projects</option>
                {allocs?.map((a) => <option key={a.id} value={a.id}>{a.project.projectCode} · {a.countryCode}</option>)}
              </select>
              <button
                className="btn-ghost px-2.5 py-1.5 text-xs"
                disabled={!sessions?.length}
                onClick={() =>
                  sessions &&
                  downloadCsv(
                    'respondents.csv',
                    ['UID', 'Project', 'Country', 'Status', 'Approval', 'Payout', 'Currency', 'Test', 'Started'],
                    sessions.map((s) => [s.vendorRespondentId, s.project.projectCode, s.projectCountry.countryCode, s.status, s.approval, s.payout ?? '', s.projectCountry.currency, s.isTest ? 'yes' : 'no', s.startedAt]),
                  )
                }
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </button>
            </div>
          }
        >
          {!sessions ? <Loading /> : sessions.length === 0 ? <Empty>No respondents yet.</Empty> : (
            <div className="-m-5 overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="border-b border-line bg-sunken/60"><tr><th className="th">UID</th><th className="th">Project</th><th className="th">Market</th><th className="th">Status</th><th className="th">Approval</th><th className="th">Payout</th><th className="th">Started</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {sessions.map((s) => (
                    <tr key={s.id} className={s.isTest ? 'opacity-70' : undefined}>
                      <td className="td font-mono text-xs">{s.vendorRespondentId}{s.isTest && <span className="chip ml-2 bg-info/15 text-info">test</span>}</td>
                      <td className="td">{s.project.projectCode}</td>
                      <td className="td">{flag(s.projectCountry.countryCode)} {s.projectCountry.countryCode}</td>
                      <td className="td"><OutcomeChip status={s.status} /></td>
                      <td className="td text-xs">{s.approval === 'NOT_APPLICABLE' ? '–' : s.approval.toLowerCase()}</td>
                      <td className="td tabular-nums">{s.payout ? money(s.payout, s.projectCountry.currency) : '–'}</td>
                      <td className="td text-xs text-muted">{new Date(s.startedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {tab === 'Callbacks' && (
        <Section title="Server-to-server callbacks sent to you">
          {!callbacks ? <Loading /> : callbacks.length === 0 ? <Empty>No callbacks yet. Callbacks are sent only when a project&apos;s redirect rule asks for one and a callback URL is set up for you.</Empty> : (
            <div className="-m-5 overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="border-b border-line bg-sunken/60"><tr><th className="th">State</th><th className="th">URL</th><th className="th">Attempts</th><th className="th">Last response</th><th className="th">Created</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {callbacks.map((c) => (
                    <tr key={c.id}>
                      <td className="td"><span className={clsx('chip', c.state === 'DELIVERED' ? 'bg-ok/15 text-ok' : ['FAILED', 'DEAD_LETTER'].includes(c.state) ? 'bg-bad/15 text-bad' : 'bg-warn/15 text-warn')}>{c.state.toLowerCase().replace('_', ' ')}</span></td>
                      <td className="td max-w-[420px] truncate font-mono text-xs" title={c.url}>{c.url}</td>
                      <td className="td tabular-nums">{c.attempts}</td>
                      <td className="td text-xs">{c.lastStatusCode ?? c.lastError ?? '–'}</td>
                      <td className="td text-xs text-muted">{new Date(c.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </>
  );
}
