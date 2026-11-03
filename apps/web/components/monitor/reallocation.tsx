'use client';
import clsx from 'clsx';
import { ArrowRight, Shuffle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ErrorBox, Loading, Section } from '@/components/ui';
import { get, post } from '@/lib/api';

interface Move { from: string | null; to: string; completes: number; reason: string; reasonLabel: string; because: string; cpiDelta: number; fromName: string; toName: string }
interface LinkRow { id: string; vendor: { name: string; code: string }; status: string; target: number; completes: number; cpi: number; perDay: number; paceStatus: string; qualityShare24h: number | null }
interface Market {
  project: { id: string; projectCode: string; name: string; fieldEndAt: string | null };
  country: { id: string; countryCode: string; currency: string };
  pace: { status: string; daysLeft: number | null };
  target: number; completes: number; uncovered: number;
  moves: Move[];
  donors: { id: string | null; name: string; give: number; reasonLabel: string; detail: string }[];
  links: LinkRow[];
}

const REASON_TONE: Record<string, string> = { paused: 'bg-sunken text-muted', closed: 'bg-sunken text-muted', quality: 'bg-bad/10 text-bad', stalled: 'bg-warn/10 text-warn', behind: 'bg-warn/10 text-warn', unassigned: 'bg-brand/10 text-brand' };

/** Where a market will fall short and which vendor links can take the completes, with one-click apply. */
export function Reallocation({ projectId, editable, onApplied }: { projectId?: string; editable: boolean; onApplied?: () => void }) {
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => get<Market[]>(`/monitor/reallocation${projectId ? `?projectId=${projectId}` : ''}`).then(setMarkets).catch(setError), [projectId]);
  useEffect(() => { load(); }, [load]);

  return (
    <Section title={<span className="flex items-center gap-2"><Shuffle className="h-4 w-4 text-brand" /> Reallocation suggestions{markets?.length ? ` (${markets.length})` : ''}</span>}>
      <ErrorBox error={error} />
      {!markets ? <Loading /> : markets.length === 0 ? (
        <p className="text-sm text-muted">Every live market is on course with its current vendor targets. Suggestions show up here when a link falls behind, stalls, is paused or has quality problems, and another link has room.</p>
      ) : (
        <div className="space-y-4">
          {markets.map((m) => <MarketCard key={`${m.country.id}:${m.moves.map((x) => `${x.from}>${x.to}=${x.completes}`).join(",")}`} m={m} editable={editable} showProject={!projectId} onDone={() => { load(); onApplied?.(); }} />)}
        </div>
      )}
    </Section>
  );
}

function MarketCard({ m, editable, showProject, onDone }: { m: Market; editable: boolean; showProject: boolean; onDone: () => void }) {
  const [amounts, setAmounts] = useState<number[]>(m.moves.map((x) => x.completes));
  const [on, setOn] = useState<boolean[]>(m.moves.map(() => true));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const chosen = m.moves.map((x, i) => ({ from: x.from, to: x.to, completes: amounts[i] })).filter((x, i) => on[i] && x.completes > 0);
  const total = chosen.reduce((t, x) => t + x.completes, 0);

  async function apply() {
    if (!confirm(`Move ${total} completes between vendor links in ${m.project.projectCode} ${m.country.countryCode}? Vendor targets change straight away.`)) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/projects/${m.project.id}/countries/${m.country.id}/reallocate`, { moves: chosen });
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-line" data-market={m.country.id}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="font-medium">
            {showProject && <Link className="text-brand hover:underline" href={`/projects/${m.project.id}`}>{m.project.projectCode}</Link>}{showProject && ' · '}{m.country.countryCode}
            {showProject && <span className="ml-2 text-sm font-normal text-muted">{m.project.name}</span>}
          </div>
          <div className="text-xs text-muted">{m.completes} of {m.target} completes · {m.pace.daysLeft != null ? (m.pace.daysLeft > 0 ? `${m.pace.daysLeft} days left` : 'past the field end date') : 'no field end date (room = about 3 days of pace)'}</div>
        </div>
        {editable && m.moves.length > 0 && <button className="btn-primary" disabled={busy || !total} onClick={apply}>{busy ? 'Applying…' : `Apply ${total} completes`}</button>}
      </div>
      <div className="space-y-3 p-4">
        <ErrorBox error={error} />
        {m.moves.length > 0 && (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[620px] text-sm">
              <thead><tr><th className="th w-8" /><th className="th">From</th><th className="th" /><th className="th">To</th><th className="th text-right">Completes</th><th className="th text-right">CPI change</th></tr></thead>
              <tbody>
                {m.moves.map((x, i) => (
                  <tr key={`${x.from}-${x.to}`} className={clsx('border-t border-line align-top', !on[i] && 'opacity-50')}>
                    <td className="td">{editable && <input type="checkbox" aria-label="Include this move" checked={on[i]} onChange={() => setOn(on.map((v, j) => (j === i ? !v : v)))} />}</td>
                    <td className="td"><div className="font-medium">{x.fromName}</div><span className={clsx('chip mt-1', REASON_TONE[x.reason])}>{x.reasonLabel}</span></td>
                    <td className="td text-muted"><ArrowRight className="mt-0.5 h-4 w-4" /></td>
                    <td className="td"><div className="font-medium">{x.toName}</div><div className="text-xs text-muted">{x.because}</div></td>
                    <td className="td text-right">
                      {editable ? (
                        <input type="number" min={1} max={x.completes} aria-label="Completes to move" className="input ml-auto w-20 text-right tabular-nums" value={amounts[i]} onChange={(e) => setAmounts(amounts.map((v, j) => (j === i ? Math.max(0, Math.min(x.completes, Math.floor(Number(e.target.value) || 0))) : v)))} />
                      ) : <span className="tabular-nums">{x.completes}</span>}
                    </td>
                    <td className={clsx('td text-right tabular-nums', x.cpiDelta > 0 ? 'text-bad' : x.cpiDelta < 0 ? 'text-ok' : 'text-muted')}>{x.cpiDelta > 0 ? '+' : ''}{x.cpiDelta.toFixed(2)} {m.country.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {m.uncovered > 0 && (
          <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{m.moves.length ? `${m.uncovered} more completes are still at risk after these moves.` : `${m.uncovered} completes are at risk and no live link has room for them.`} Add another vendor, raise CPI, or move the field end date.</p>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Vendor links in this market</summary>
          <div className="-mx-4 mt-2 overflow-x-auto px-4">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr><th className="th">Vendor</th><th className="th">Status</th><th className="th text-right">Completes</th><th className="th text-right">Per day</th><th className="th text-right">Quality rejects 24h</th><th className="th text-right">CPI</th></tr></thead>
              <tbody>
                {m.links.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="td">{l.vendor.name}</td>
                    <td className="td text-xs">{l.status === 'ACTIVE' ? l.paceStatus.replace('_', ' ') : l.status.toLowerCase()}</td>
                    <td className="td text-right tabular-nums">{l.completes} / {l.target}</td>
                    <td className="td text-right tabular-nums">{l.perDay}</td>
                    <td className="td text-right tabular-nums">{l.qualityShare24h == null ? '–' : `${l.qualityShare24h}%`}</td>
                    <td className="td text-right tabular-nums">{l.cpi.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </div>
  );
}
