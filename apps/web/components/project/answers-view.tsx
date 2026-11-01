'use client';
import { Download, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Empty, ErrorBox, Loading, OutcomeChip, Section } from '@/components/ui';
import { get } from '@/lib/api';
import { flag } from '@/lib/countries';
import { downloadCsv } from '@/lib/csv';
import { STATUS_LABEL } from '@/lib/types';

interface Q { section: 'gate' | 'prescreen'; id: string; type: string; text: string; options?: { id: string; label: string }[] }
interface Ans { value: unknown; label: string }
interface Row {
  id: string; vendorRespondentId: string; status: string; statusDetail: string | null; reason: string | null; isTest: boolean; startedAt: string;
  deviceType: string | null; country: string; vendor: { id: string; name: string }; answers: Partial<Record<'gate' | 'prescreen', Record<string, Ans>>> | null;
}
interface SummaryItem { section: string; id: string; answered: number; counts?: { id: string; label: string; count: number }[]; number?: { min: number; median: number; max: number } }
interface Data { questions: Q[]; countries: string[]; total: number; page: number; pageSize: number; truncated: boolean; summary?: SummaryItem[]; rows: Row[] }

const STATUSES = ['STARTED', 'COMPLETE', 'TERMINATE', 'QUOTA_FULL', 'QUALITY_FAIL', 'DUPLICATE', 'SECURITY_REJECT', 'PARTIAL'];
const key = (q: { section: string; id: string }) => `${q.section}.${q.id}`;

/** Gate survey and prescreener answers for one project: per-question counts, filters, table and CSV export. */
export function AnswersView({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const [status, setStatus] = useState('');
  const [country, setCountry] = useState('');
  const [includeTest, setIncludeTest] = useState(false);
  const [filter, setFilter] = useState<{ section: string; question: string; option: string } | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);
  const seq = useRef(0);

  const query = new URLSearchParams({
    includeTest: String(includeTest),
    ...(status ? { status } : {}),
    ...(country ? { country } : {}),
    ...(filter ? filter : {}),
  }).toString();

  useEffect(() => setPage(1), [query]);
  useEffect(() => {
    const mine = ++seq.current;
    setError(null);
    get<Data>(`/projects/${projectId}/answers?${query}&page=${page}&pageSize=50`)
      .then((d) => mine === seq.current && setData(d))
      .catch((e) => mine === seq.current && setError(e));
  }, [projectId, query, page]);

  async function exportCsv() {
    setExporting(true);
    try {
      const d = await get<Data>(`/projects/${projectId}/answers?${query}&export=true`);
      const header = ['Vendor UID', 'Market', 'Vendor', 'Status', 'Reason', 'Device', 'Test', 'Started', ...d.questions.map((q) => `${q.section === 'gate' ? 'Gate' : 'Prescreen'}: ${q.id}`)];
      downloadCsv(`${projectCode}-answers.csv`, header, d.rows.map((r) => [
        r.vendorRespondentId, r.country, r.vendor.name, STATUS_LABEL[r.status] ?? r.status, r.reason ?? '', r.deviceType ?? '', r.isTest ? 'yes' : '', r.startedAt,
        ...d.questions.map((q) => r.answers?.[q.section]?.[q.id]?.label ?? ''),
      ]));
    } catch (e) {
      setError(e);
    } finally {
      setExporting(false);
    }
  }

  const choiceQs = data?.questions.filter((q) => q.options?.length) ?? [];
  const filterQ = filter ? data?.questions.find((q) => key(q) === `${filter.section}.${filter.question}`) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block"><span className="label">Status</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Market</span>
          <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">All markets</option>
            {data?.countries.map((c) => <option key={c} value={c}>{flag(c)} {c}</option>)}
          </select>
        </label>
        <label className="block min-w-0 max-w-full"><span className="label">Answered</span>
          <select className="input max-w-full" value={filter ? `${filter.section}.${filter.question}.${filter.option}` : ''} onChange={(e) => {
            const [section, question, option] = e.target.value.split('.');
            setFilter(e.target.value ? { section, question, option } : null);
          }}>
            <option value="">Any answer</option>
            {choiceQs.map((q) => (
              <optgroup key={key(q)} label={`${q.section === 'gate' ? 'Gate' : 'Prescreen'}: ${q.text.slice(0, 60)}`}>
                {q.options!.map((o) => <option key={o.id} value={`${key(q)}.${o.id}`}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-muted"><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> Include test</label>
        <button className="btn-ghost ml-auto" onClick={exportCsv} disabled={exporting || !data?.total}><Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Export CSV'}</button>
      </div>
      {filter && filterQ && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Showing respondents who answered</span>
          <span className="chip bg-brand/15 text-brand">{filterQ.options?.find((o) => o.id === filter.option)?.label}</span>
          <span className="text-muted">to “{filterQ.text}”</span>
          <button className="rounded p-1 text-muted hover:text-ink" aria-label="Clear answer filter" onClick={() => setFilter(null)}><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <ErrorBox error={error} />
      {!data ? <Loading /> : data.questions.length === 0 ? (
        <Empty>This project has no gate survey or prescreener questions yet. Add them on the Gate &amp; security tab.</Empty>
      ) : (
        <>
          {data.summary && data.total > 0 && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {data.questions.map((q) => {
                const s = data.summary!.find((x) => x.section === q.section && x.id === q.id);
                if (!s || (!s.counts && !s.number)) return null;
                const max = Math.max(1, ...(s.counts ?? []).map((c) => c.count));
                return (
                  <div key={key(q)} className="card p-4">
                    <div className="text-xs uppercase tracking-wide text-muted">{q.section === 'gate' ? 'Gate survey' : 'Prescreener'} · {s.answered.toLocaleString()} answered</div>
                    <div className="mb-3 mt-0.5 text-sm font-medium">{q.text}</div>
                    {s.number && (
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {(['min', 'median', 'max'] as const).map((k) => <div key={k}><div className="text-lg font-semibold tabular-nums">{s.number![k]}</div><div className="text-xs text-muted">{k}</div></div>)}
                      </div>
                    )}
                    {s.counts && (
                      <ul className="space-y-1.5">
                        {s.counts.map((c) => {
                          const active = filter?.section === q.section && filter.question === q.id && filter.option === c.id;
                          return (
                            <li key={c.id}>
                              <button className="group block w-full text-left" title="Show only these respondents" onClick={() => setFilter(active ? null : { section: q.section, question: q.id, option: c.id })}>
                                <div className="flex justify-between gap-2 text-xs"><span className={active ? 'font-semibold text-brand' : 'group-hover:text-brand'}>{c.label}</span><span className="tabular-nums text-muted">{c.count.toLocaleString()}</span></div>
                                <div className="mt-0.5 h-1.5 rounded-full bg-sunken"><div className="h-1.5 rounded-full bg-brand transition-all duration-[var(--dur)]" style={{ width: `${(c.count / max) * 100}%` }} /></div>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <Section title={`Respondent answers · ${data.total.toLocaleString()}`}>
            {data.rows.length === 0 ? <Empty>No respondents match these filters.</Empty> : (
              <div className="-m-5 overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="border-b border-line bg-sunken/60">
                    <tr>
                      <th className="th sticky left-0 bg-sunken">Vendor UID</th><th className="th">Market</th><th className="th">Vendor</th><th className="th">Outcome</th><th className="th">Started</th>
                      {data.questions.map((q) => <th key={key(q)} className="th max-w-[200px]" title={q.text}><span className="block truncate">{q.text}</span><span className="block text-[10px] font-normal normal-case text-muted">{q.section === 'gate' ? 'gate' : 'prescreen'} · {q.id}</span></th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.rows.map((r) => (
                      <tr key={r.id} className={r.isTest ? 'opacity-70' : undefined}>
                        <td className="td sticky left-0 bg-panel font-mono text-xs">{r.vendorRespondentId}{r.isTest && <span className="ml-2 chip bg-info/15 text-info">test</span>}</td>
                        <td className="td whitespace-nowrap">{flag(r.country)} {r.country}</td>
                        <td className="td whitespace-nowrap">{r.vendor.name}</td>
                        <td className="td"><OutcomeChip status={r.status} />{r.reason && <div className="mt-0.5 max-w-[180px] text-xs text-muted">{r.reason}</div>}</td>
                        <td className="td whitespace-nowrap text-xs text-muted">{new Date(r.startedAt).toLocaleString()}</td>
                        {data.questions.map((q) => <td key={key(q)} className="td max-w-[220px] text-xs"><span className="line-clamp-2">{r.answers?.[q.section]?.[q.id]?.label ?? <span className="text-muted">–</span>}</span></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.total > data.pageSize && (
              <div className="mt-8 flex items-center justify-between gap-3 text-sm">
                <span className="text-muted">Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span>
                <div className="flex gap-2">
                  <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                  <button className="btn-ghost" disabled={page >= Math.ceil(data.total / data.pageSize)} onClick={() => setPage(page + 1)}>Next</button>
                </div>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
