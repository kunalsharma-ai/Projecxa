'use client';
import { ArrowLeft, Download, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHeader, Progress, Section, StatusChip, money } from '@/components/ui';
import { get, post } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import { downloadCsv } from '@/lib/csv';

interface Detail {
  id: string; projectCode: string; workOrderNo: string | null; name: string; status: string; category: string;
  projectManager: { name: string; email: string };
  countries: { id: string; countryCode: string; language: string; targetGroup: string | null; status: string; loiMinutes: number; irPercent: number; cpi: string; currency: string; targetCompletes: number; completes: number }[];
  stats: { completes: number; terminates: number; quotaFull: number; inProgress: number; partial: number; removedForQuality: number; incidence: number | null };
  spend: Record<string, { completes: number; amount: number }>;
}
interface Complete { id: string; token: string; approval: string; outcomeVerified: boolean; revenue: string | null; outcomeAt: string; projectCountry: { countryCode: string; currency: string } }

export default function ClientProject() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [rows, setRows] = useState<Complete[] | null>(null);
  const [filter, setFilter] = useState('PENDING');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const requestNo = useRef(0);
  const load = useCallback(() => {
    // Ignore responses from older requests so a slow earlier filter cannot overwrite the current one.
    const n = ++requestNo.current;
    get<Detail>(`/portal/client/projects/${id}`).then((r) => n === requestNo.current && setD(r)).catch(setError);
    get<Complete[]>(`/portal/client/projects/${id}/completes${filter ? `?approval=${filter}` : ''}`)
      .then((r) => n === requestNo.current && setRows(r))
      .catch(setError);
  }, [id, filter]);
  useEffect(() => {
    load();
    setSelected(new Set());
  }, [load]);

  async function decide(approval: 'APPROVED' | 'REJECTED') {
    setError(null);
    try {
      const r = await post<{ updated: number; skipped: number }>(`/portal/client/projects/${id}/approval`, { sessionIds: [...selected], approval });
      setNotice(`${r.updated} ${approval === 'APPROVED' ? 'approved' : 'rejected'}${r.skipped ? `, ${r.skipped} already decided` : ''}.`);
      setSelected(new Set());
      load();
    } catch (e) {
      setError(e);
    }
  }

  if (!d) return error ? <ErrorBox error={error} /> : <Loading />;
  const pendingIds = rows?.filter((r) => r.approval === 'PENDING').map((r) => r.id) ?? [];
  const target = d.countries.reduce((a, c) => a + c.targetCompletes, 0);
  const completes = d.countries.reduce((a, c) => a + c.completes, 0);

  return (
    <>
      <Link href="/portal/client" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> All projects</Link>
      <PageHeader
        title={d.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusChip status={d.status} /> {d.projectCode}{d.workOrderNo ? ` · ${d.workOrderNo}` : ''} · Project manager {d.projectManager.name} ({d.projectManager.email})</span>}
      />
      <ErrorBox error={error} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['Completes', `${completes} / ${target}`],
          ['In progress', d.stats.inProgress],
          ['Terminates', d.stats.terminates],
          ['Quota full', d.stats.quotaFull],
          ['Removed for quality', d.stats.removedForQuality],
          ['Incidence', d.stats.incidence != null ? `${d.stats.incidence}%` : '–'],
        ].map(([l, v]) => (
          <div key={l} className="card p-4"><div className="text-xs text-muted">{l}</div><div className="mt-1 text-xl font-semibold tabular-nums">{v}</div></div>
        ))}
      </div>

      <Section title="Progress by market" className="mb-6">
        <div className="-m-5 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="border-b border-line bg-sunken/60"><tr><th className="th">Market</th><th className="th">Status</th><th className="th">Completes</th><th className="th">LOI</th><th className="th">IR</th><th className="th">CPI</th></tr></thead>
            <tbody className="divide-y divide-line">
              {d.countries.map((c) => (
                <tr key={c.id}>
                  <td className="td">{flag(c.countryCode)} {countryName(c.countryCode)} <span className="text-muted">({c.language})</span>{c.targetGroup && <div className="text-xs text-muted">{c.targetGroup}</div>}</td>
                  <td className="td"><StatusChip status={c.status} /></td>
                  <td className="td"><Progress value={c.completes} max={c.targetCompletes} /></td>
                  <td className="td">{c.loiMinutes} min</td>
                  <td className="td">{c.irPercent}%</td>
                  <td className="td tabular-nums">{money(c.cpi, c.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-8 text-xs text-muted">
          Spend: approved {money(d.spend.APPROVED?.amount)} ({d.spend.APPROVED?.completes ?? 0}), pending {money(d.spend.PENDING?.amount)} ({d.spend.PENDING?.completes ?? 0}), rejected {d.spend.REJECTED?.completes ?? 0}. Amounts are in each market&apos;s currency.
        </p>
      </Section>

      <Section
        title="Completes"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-40 py-1.5" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by approval">
              <option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="">All</option>
            </select>
            <button
              className="btn-ghost px-2.5 py-1.5 text-xs"
              disabled={!rows?.length}
              onClick={() => rows && downloadCsv(`${d.projectCode}-completes.csv`, ['Respondent ID', 'Market', 'Approval', 'Confirmed by your platform', 'Amount', 'Currency', 'Completed at'], rows.map((r) => [r.token, r.projectCountry.countryCode, r.approval, r.outcomeVerified ? 'yes' : 'no', r.revenue ?? '', r.projectCountry.currency, r.outcomeAt]))}
            >
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            {selected.size > 0 && (
              <>
                <button className="btn-primary px-2.5 py-1.5 text-xs" onClick={() => decide('APPROVED')}>Approve {selected.size}</button>
                <button className="btn-danger px-2.5 py-1.5 text-xs" onClick={() => decide('REJECTED')}>Reject {selected.size}</button>
              </>
            )}
          </div>
        }
      >
        {notice && <p className="mb-3 text-sm text-ok" role="status">{notice}</p>}
        <p className="mb-4 text-xs text-muted">The respondent ID is the value your survey received from PROJEXA, so you can match it against your data. Download the CSV, check it, then approve or reject.</p>
        {!rows ? <Loading /> : rows.length === 0 ? <Empty>No completes in this view.</Empty> : (
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-y border-line bg-sunken/60">
                <tr>
                  <th className="th w-8">{pendingIds.length > 0 && <input type="checkbox" aria-label="Select all pending" checked={selected.size === pendingIds.length} onChange={(e) => setSelected(e.target.checked ? new Set(pendingIds) : new Set())} />}</th>
                  <th className="th">Respondent ID</th><th className="th">Market</th><th className="th">Approval</th><th className="th">Amount</th><th className="th">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="td">
                      {r.approval === 'PENDING' && (
                        <input type="checkbox" aria-label={`Select ${r.token}`} checked={selected.has(r.id)} onChange={(e) => {
                          const s = new Set(selected);
                          if (e.target.checked) s.add(r.id); else s.delete(r.id);
                          setSelected(s);
                        }} />
                      )}
                    </td>
                    <td className="td font-mono text-xs">{r.token}{r.outcomeVerified && <span title="Confirmed by your survey platform"><ShieldCheck className="ml-1.5 inline h-3.5 w-3.5 text-ok" /></span>}</td>
                    <td className="td">{flag(r.projectCountry.countryCode)} {r.projectCountry.countryCode}</td>
                    <td className="td text-xs">{r.approval.toLowerCase()}</td>
                    <td className="td tabular-nums">{r.revenue ? money(r.revenue, r.projectCountry.currency) : '–'}</td>
                    <td className="td text-xs text-muted">{new Date(r.outcomeAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
