'use client';
import { ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, OutcomeChip, Section, money } from '@/components/ui';
import { get, post } from '@/lib/api';
import { flag } from '@/lib/countries';
import { REASON_LABELS } from '@/lib/types';
import type { ProjectDetail } from './types';

interface SessionRow {
  id: string; vendorRespondentId: string; status: string; statusDetail: string | null; outcomeVerified: boolean; approval: string;
  isTest: boolean; revenue: string | null; payout: string | null; startedAt: string; outcomeAt: string | null;
  projectCountry: { countryCode: string }; vendorAllocation: { vendor: { name: string; code: string } }; redirectVersion: { version: number } | null;
}

export function SessionsTab({ project, editable }: { project: ProjectDetail; editable: boolean }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [includeTest, setIncludeTest] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => get<SessionRow[]>(`/projects/${project.id}/sessions?includeTest=${includeTest}`).then(setRows).catch(setError), [project.id, includeTest]);
  useEffect(() => {
    load();
  }, [load]);

  async function decide(approval: 'APPROVED' | 'REJECTED') {
    try {
      await post(`/projects/${project.id}/sessions/approval`, { sessionIds: [...selected], approval });
      setSelected(new Set());
      load();
    } catch (e) {
      setError(e);
    }
  }

  const pending = rows?.filter((r) => r.status === 'COMPLETE' && r.approval === 'PENDING') ?? [];

  return (
    <Section
      title="Respondent sessions (latest 200)"
      actions={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> Include test sessions</label>
          {editable && selected.size > 0 && (
            <>
              <button className="btn-primary px-2.5 py-1.5 text-xs" onClick={() => decide('APPROVED')}>Approve {selected.size}</button>
              <button className="btn-danger px-2.5 py-1.5 text-xs" onClick={() => decide('REJECTED')}>Reject {selected.size}</button>
            </>
          )}
        </div>
      }
    >
      <ErrorBox error={error} />
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No respondents yet. Share a vendor test link to try the flow.</Empty>
      ) : (
        <div className="-m-5 overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead className="border-b border-line bg-sunken/60">
              <tr>
                <th className="th w-8">
                  {editable && pending.length > 0 && (
                    <input type="checkbox" aria-label="Select all pending completes" checked={selected.size === pending.length} onChange={(e) => setSelected(e.target.checked ? new Set(pending.map((r) => r.id)) : new Set())} />
                  )}
                </th>
                <th className="th">Vendor UID</th><th className="th">Market</th><th className="th">Vendor</th><th className="th">Status</th><th className="th">Approval</th>
                <th className="th">Revenue</th><th className="th">Payout</th><th className="th">Started</th><th className="th">Config</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const selectable = r.status === 'COMPLETE' && r.approval === 'PENDING';
                return (
                  <tr key={r.id} className={r.isTest ? 'opacity-70' : undefined}>
                    <td className="td">
                      {editable && selectable && (
                        <input type="checkbox" aria-label={`Select ${r.vendorRespondentId}`} checked={selected.has(r.id)} onChange={(e) => {
                          const s = new Set(selected);
                          if (e.target.checked) s.add(r.id); else s.delete(r.id);
                          setSelected(s);
                        }} />
                      )}
                    </td>
                    <td className="td font-mono text-xs">{r.vendorRespondentId}{r.isTest && <span className="ml-2 chip bg-info/15 text-info">test</span>}</td>
                    <td className="td">{flag(r.projectCountry.countryCode)} {r.projectCountry.countryCode}</td>
                    <td className="td">{r.vendorAllocation.vendor.name}</td>
                    <td className="td">
                      <OutcomeChip status={r.status} />
                      {r.statusDetail && <span className="ml-1.5 text-xs text-muted">{REASON_LABELS[r.statusDetail] ?? r.statusDetail.toLowerCase().replaceAll('_', ' ')}</span>}
                      {r.outcomeVerified && <span title="Confirmed server to server"><ShieldCheck className="ml-1 inline h-3.5 w-3.5 text-ok" /></span>}
                    </td>
                    <td className="td text-xs">{r.approval === 'NOT_APPLICABLE' ? '–' : r.approval.toLowerCase()}</td>
                    <td className="td tabular-nums">{r.revenue ? money(r.revenue) : '–'}</td>
                    <td className="td tabular-nums">{r.payout ? money(r.payout) : '–'}</td>
                    <td className="td text-xs text-muted">{new Date(r.startedAt).toLocaleString()}</td>
                    <td className="td text-xs text-muted">v{r.redirectVersion?.version ?? '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
