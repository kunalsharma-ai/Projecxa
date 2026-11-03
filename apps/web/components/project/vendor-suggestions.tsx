'use client';
import { Minus, Plus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorBox, Loading } from '@/components/ui';
import { ScoreBadge, type Grade } from '@/components/vendors/score';
import { get, post } from '@/lib/api';

interface Suggestion {
  vendorId: string;
  name: string;
  code: string;
  fit: number;
  knownInMarket: boolean;
  score: number | null;
  grade: Grade;
  marketCompletes: number;
  committed: number;
  headroom: number | null;
  typicalCpi: number | null;
  cpiSource: 'vendor' | 'market' | null;
  margin: number | null;
  suggested: { cpi: number | null; targetCompletes: number | null };
  reasons: { text: string; points: number }[];
  warnings: string[];
}
interface Result { countryCode: string; currency: string; clientCpi: number; needed: number; marketCpi: number | null; suggestions: Suggestion[] }

/** Ranked vendors for one market, with why, and an Add that uses the suggested CPI and target. */
export function VendorSuggestions({ projectId, countryId, editable, onAdded, onClose }: { projectId: string; countryId: string; editable: boolean; onAdded: () => void; onClose: () => void }) {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [edits, setEdits] = useState<Record<string, { cpi: string; target: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = () =>
    get<Result>(`/projects/${projectId}/countries/${countryId}/vendor-suggestions`)
      .then((r) => {
        setData(r);
        setEdits(Object.fromEntries(r.suggestions.map((s) => [s.vendorId, { cpi: s.suggested.cpi === null ? '' : String(s.suggested.cpi), target: String(s.suggested.targetCompletes ?? '') }])));
      })
      .catch(setError);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, countryId]);

  async function add(s: Suggestion) {
    const e = edits[s.vendorId];
    setBusy(s.vendorId);
    setError(null);
    try {
      await post(`/projects/${projectId}/countries/${countryId}/allocations`, { vendorId: s.vendorId, cpi: Number(e.cpi), targetCompletes: Number(e.target) });
      onAdded();
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return error ? <ErrorBox error={error} /> : <Loading label="Ranking vendors" />;
  const list = showAll ? data.suggestions : data.suggestions.slice(0, 5);
  return (
    <div className="mb-5 rounded-lg border border-brand/30 bg-brand/5 p-4" data-suggestions>
      <div className="mb-3 flex flex-wrap items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">Suggested vendors</div>
          <div className="text-muted">
            {data.needed > 0 ? `${data.needed} completes still to allocate.` : 'The target is fully allocated, so targets below are a 10% backup.'} Ranked by score, history and capacity in {data.countryCode}, and margin on the client CPI of {data.currency} {data.clientCpi.toFixed(2)}{data.marketCpi !== null ? ` (vendors usually get ${data.currency} ${data.marketCpi.toFixed(2)} here)` : ''}. <Link href="/vendors" className="underline">How scores work</Link>
          </div>
        </div>
        <button className="btn-ghost h-8 px-2.5 text-xs" onClick={onClose}>Close</button>
      </div>
      <ErrorBox error={error} />
      {data.suggestions.length === 0 ? (
        <p className="text-sm text-muted">Every active vendor is already on this market.</p>
      ) : (
        <ol className="space-y-2">
          {list.map((s, i) => {
            const e = edits[s.vendorId] ?? { cpi: '', target: '' };
            return (
              <li key={s.vendorId} className="rounded-lg border border-line bg-panel p-3" data-suggestion={s.code}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-5 text-sm font-semibold text-muted">{i + 1}</span>
                  <Link href={`/vendors/${s.vendorId}`} className="font-medium hover:text-brand hover:underline">{s.name}</Link>
                  <ScoreBadge score={s.score} grade={s.grade} />
                  <span className="text-xs text-muted">Fit {s.fit}</span>
                  {!s.knownInMarket && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-muted">Not known in {data.countryCode}</span>}
                </div>
                <ul className="mt-2 space-y-0.5 pl-8 text-xs">
                  {s.reasons.map((r) => (
                    <li key={r.text} className={r.points > 0 ? 'text-ok' : r.points < 0 ? 'text-bad' : 'text-muted'}>
                      {r.points > 0 ? <Plus className="mr-1 inline h-3 w-3" /> : r.points < 0 ? <Minus className="mr-1 inline h-3 w-3" /> : null}
                      {r.text}
                    </li>
                  ))}
                  {s.warnings.map((w) => <li key={w} className="text-warn">{w}</li>)}
                </ul>
                {editable && (
                  <div className="mt-3 flex flex-wrap items-end gap-2 pl-8">
                    <label className="flex flex-col text-xs text-muted">Vendor CPI ({data.currency})
                      <input className="input mt-1 w-28 py-1.5" type="number" step="0.01" min={0} value={e.cpi} placeholder="Set CPI" onChange={(ev) => setEdits({ ...edits, [s.vendorId]: { ...e, cpi: ev.target.value } })} />
                    </label>
                    <label className="flex flex-col text-xs text-muted">Target completes
                      <input className="input mt-1 w-28 py-1.5" type="number" min={1} value={e.target} onChange={(ev) => setEdits({ ...edits, [s.vendorId]: { ...e, target: ev.target.value } })} />
                    </label>
                    <button className="btn-primary h-9" disabled={busy !== null || e.cpi === '' || !Number(e.target)} onClick={() => add(s)}>{busy === s.vendorId ? 'Adding…' : 'Add vendor'}</button>
                    {s.margin !== null && <span className={`pb-2 text-xs ${s.margin <= 0 ? 'text-bad' : 'text-muted'}`}>{s.cpiSource === 'vendor' ? 'Its usual CPI' : 'Market CPI'} leaves {s.margin}% margin</span>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {data.suggestions.length > 5 && <button className="btn-ghost mt-2 h-8 px-2.5 text-xs" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show top 5' : `Show all ${data.suggestions.length}`}</button>}
    </div>
  );
}
