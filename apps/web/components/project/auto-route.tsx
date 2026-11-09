'use client';
import clsx from 'clsx';
import { ArrowRight, Route, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { InfoTip } from '@/components/help';
import { ErrorBox, Loading, Section, Toggle } from '@/components/ui';
import { get, post } from '@/lib/api';
import { countryName } from '@/lib/countries';
import type { AutoRoute } from './types';

export const DEFAULT_AUTO_ROUTE: AutoRoute = { enabled: false, mode: 'approve', weights: { score: 50, cost: 30, room: 20 }, minScore: 55, keepMargin: true, maxMovePercent: 25, cooldownHours: 6 };

export function autoRouteProblem(a: AutoRoute): string | null {
  if (!a.enabled) return null;
  const w = a.weights;
  if (![w.score, w.cost, w.room].every((n) => Number.isInteger(n) && n >= 0 && n <= 100)) return 'Each weight must be a whole number from 0 to 100.';
  if (w.score + w.cost + w.room === 0) return 'At least one weight must be above 0.';
  if (!Number.isInteger(a.minScore) || a.minScore < 0 || a.minScore > 100) return 'The minimum score must be from 0 to 100.';
  if (!Number.isInteger(a.maxMovePercent) || a.maxMovePercent < 1 || a.maxMovePercent > 100) return 'The most to move in one run must be from 1 to 100%.';
  if (!Number.isInteger(a.cooldownHours) || a.cooldownHours < 1 || a.cooldownHours > 168) return 'The wait between runs must be from 1 to 168 hours.';
  return null;
}

interface Ranked { id: string; name: string; rank: number; routingScore: number; parts: { score: number; cost: number; room: number }; vendorScore: number | null; grade: string | null; scoreSource: string; cpi: number; marginPct: number; room: number; gets: number; because: string }
interface Move { from: string | null; to: string; completes: number; reason: string; reasonLabel: string; fromName: string; toName: string; cpiDelta: number; because: string }
interface MarketPlan {
  country: { id: string; countryCode: string; targetGroup: string | null; currency: string; cpi: number };
  target: number; completes: number; key: string; cooldownUntil: string | null;
  moves: Move[]; ranking: Ranked[]; skipped: { id: string; name: string; why: string }[];
  freed: number; cap: number; held: number; uncovered: number; costDelta: number; summary: string;
}
interface Run {
  id: string; createdAt: string; trigger: 'auto' | 'manual'; by: string; summary: string;
  country: { countryCode: string; targetGroup: string | null; currency: string };
  targets: { id: string; vendor: string; from: number; to: number }[];
  explanation: { ranking?: Ranked[]; skipped?: { name: string; why: string }[]; costDelta?: number };
  undoneAt: string | null; undoneBy: string | null;
}
interface RoutingView { settings: AutoRoute; scoreDays: number; markets: MarketPlan[]; runs: Run[] }

const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const market = (c: { countryCode: string; targetGroup: string | null }) => `${countryName(c.countryCode)}${c.targetGroup ? ` · ${c.targetGroup}` : ''}`;
const money = (n: number, cur: string) => `${n > 0 ? '+' : ''}${n.toFixed(2)} ${cur}`;

/** Settings for vendor auto-routing, inside the Autopilot card. Saved with the rest of the autopilot. */
export function AutoRouteControl({ value, onChange, editable }: { value: AutoRoute; onChange: (v: AutoRoute) => void; editable: boolean }) {
  const set = (patch: Partial<AutoRoute>) => onChange({ ...value, ...patch });
  const setW = (k: keyof AutoRoute['weights'], n: number) => set({ weights: { ...value.weights, [k]: n } });
  const problem = autoRouteProblem(value);
  const num = (v: number) => (Number.isFinite(v) ? v : '');
  const wSum = value.weights.score + value.weights.cost + value.weights.room || 1;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium"><Route className="h-4 w-4 text-brand" aria-hidden /> Route traffic to the best vendor <InfoTip id="project.autoRoute" /></div>
          <div className="text-xs text-muted">When a market will fall short, move what a vendor will not deliver to the best other vendor, by score, cost and room.</div>
        </div>
        <span className={editable ? '' : 'pointer-events-none opacity-60'}><Toggle checked={value.enabled} label="Route traffic to the best vendor" onChange={(v) => set({ enabled: v })} /></span>
      </div>
      {value.enabled && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="inline-flex overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label="Routing mode">
            {([['approve', 'Suggest, I approve'], ['auto', 'Route automatically']] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={value.mode === k} disabled={!editable} onClick={() => set({ mode: k })}
                className={clsx('px-3 py-1.5 text-sm', value.mode === k ? 'bg-brand text-white' : 'hover:bg-sunken')}>{l}</button>
            ))}
          </div>
          <p className="text-xs text-muted">{value.mode === 'auto' ? 'The monitor applies the plan on its own every five minutes, then leaves the market alone for the wait below. Every run can be undone.' : 'The plan shows below the alerts; nothing changes until someone presses Route.'}</p>
          <fieldset>
            <legend className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">Weights <InfoTip id="project.autoRoute.weights" /></legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {([['score', 'Vendor score'], ['cost', 'Margin (cost)'], ['room', 'Room left']] as const).map(([k, l]) => (
                <label key={k} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-1.5">
                  <span>{l}</span>
                  <span className="flex items-center gap-1">
                    <input className="input w-16 py-1 text-right tabular-nums" type="number" min={0} max={100} aria-label={`${l} weight`} value={num(value.weights[k])} disabled={!editable} onChange={(e) => setW(k, Math.round(Number(e.target.value)))} />
                    <span className="w-10 text-right text-xs tabular-nums text-muted">{Math.round((100 * (value.weights[k] || 0)) / wSum)}%</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block"><span className="label">Minimum vendor score</span><input className="input tabular-nums" type="number" min={0} max={100} value={num(value.minScore)} disabled={!editable} onChange={(e) => set({ minScore: Math.round(Number(e.target.value)) })} /></label>
            <label className="block"><span className="label">Most to move in one run (%)</span><input className="input tabular-nums" type="number" min={1} max={100} value={num(value.maxMovePercent)} disabled={!editable} onChange={(e) => set({ maxMovePercent: Math.round(Number(e.target.value)) })} /></label>
            <label className="block"><span className="label">Wait between runs (hours)</span><input className="input tabular-nums" type="number" min={1} max={168} value={num(value.cooldownHours)} disabled={!editable} onChange={(e) => set({ cooldownHours: Math.round(Number(e.target.value)) })} /></label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={value.keepMargin} disabled={!editable} onChange={(e) => set({ keepMargin: e.target.checked })} />
            <span>Never route to a vendor whose CPI is at or above the client CPI</span>
          </label>
          {problem && <p className="text-xs text-bad">{problem}</p>}
        </div>
      )}
    </div>
  );
}

/** The routing plan per live market, with the ranking behind it, and the history with Undo. */
export function RoutingPlan({ projectId, editable, onChanged }: { projectId: string; editable: boolean; onChanged?: () => void }) {
  const [data, setData] = useState<RoutingView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => get<RoutingView>(`/projects/${projectId}/routing`).then(setData).catch(setError), [projectId]);
  useEffect(() => { load(); }, [load]);
  const done = () => { load(); onChanged?.(); };

  const active = data?.markets.filter((m) => m.freed > 0) ?? [];
  return (
    <Section help="project.routingPlan" title={<span className="flex items-center gap-2"><Route className="h-4 w-4 text-brand" /> Vendor routing{data ? ` · ${data.settings.enabled ? (data.settings.mode === 'auto' ? 'automatic' : 'you approve') : 'off'}` : ''}</span>}>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <div className="space-y-4">
          {!data.settings.enabled && <p className="text-sm text-muted">Routing is off for this project. This is what it would do with the settings in the Autopilot card; you can still route a market by hand.</p>}
          {active.length === 0 ? (
            <p className="text-sm text-muted">Every live market is on course with its current vendor targets, so there is nothing to route.</p>
          ) : active.map((m) => <PlanCard key={`${m.country.id}:${m.key}`} m={m} projectId={projectId} editable={editable} scoreDays={data.scoreDays} onDone={done} />)}
          <RunHistory runs={data.runs} projectId={projectId} editable={editable} onDone={done} />
        </div>
      )}
    </Section>
  );
}

function PlanCard({ m, projectId, editable, scoreDays, onDone }: { m: MarketPlan; projectId: string; editable: boolean; scoreDays: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const moved = m.moves.reduce((t, x) => t + x.completes, 0);
  async function route() {
    if (!confirm(`${m.summary}? Vendor targets in ${market(m.country)} change straight away. You can undo it from the history.`)) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/projects/${projectId}/countries/${m.country.id}/route`, { key: m.key });
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-lg border border-line" data-route-market={m.country.id}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="font-medium">{market(m.country)}</div>
          <div className="text-xs text-muted">{m.completes} of {m.target} completes · {m.freed} at risk · up to {m.cap} per run · client CPI {m.country.cpi.toFixed(2)} {m.country.currency}{m.cooldownUntil ? ` · autopilot waits until ${when(m.cooldownUntil)}` : ''}</div>
        </div>
        {editable && moved > 0 && <button className="btn-primary" disabled={busy} onClick={route}>{busy ? 'Routing…' : `Route ${moved} completes`}</button>}
      </div>
      <div className="space-y-3 p-4">
        <ErrorBox error={error} />
        <p className="text-sm font-medium">{m.summary}</p>
        {m.moves.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {m.moves.map((x) => (
              <li key={`${x.from}-${x.to}`} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{x.fromName}</span><span className="chip bg-sunken text-muted">{x.reasonLabel}</span>
                <ArrowRight className="h-4 w-4 text-muted" aria-hidden />
                <span className="font-medium">{x.toName}</span>
                <span className="tabular-nums">{x.completes} complete{x.completes === 1 ? '' : 's'}</span>
                <span className={clsx('text-xs tabular-nums', x.cpiDelta > 0 ? 'text-bad' : x.cpiDelta < 0 ? 'text-ok' : 'text-muted')}>CPI {money(x.cpiDelta, m.country.currency)}</span>
              </li>
            ))}
          </ul>
        )}
        {m.costDelta !== 0 && <p className="text-xs text-muted">Vendor cost if every routed complete delivers: <span className={m.costDelta > 0 ? 'text-bad' : 'text-ok'}>{money(m.costDelta, m.country.currency)}</span></p>}
        {m.held > 0 && <p className="text-xs text-muted">{m.held} completes are held back by the per-run limit and go in a later run.</p>}
        {m.uncovered > 0 && <p className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{m.uncovered} completes have nowhere to go: no eligible vendor has room. Add another vendor, raise CPI, or move the field end date.</p>}
        {m.ranking.length + m.skipped.length > 0 && <p className="text-xs text-muted">Why this order: each vendor with room, ranked by routing score (vendor score from the last {scoreDays} days, margin against the client CPI, room before the field end date).</p>}
        {m.ranking.length + m.skipped.length > 0 && <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr><th className="th">#</th><th className="th">Vendor</th><th className="th text-right">Routing score</th><th className="th text-right">Vendor score</th><th className="th text-right">Margin</th><th className="th text-right">Room</th><th className="th text-right">Gets</th></tr></thead>
            <tbody>
              {m.ranking.map((r) => (
                <tr key={r.id} className="border-t border-line" title={r.because}>
                  <td className="td tabular-nums">{r.rank}</td>
                  <td className="td font-medium">{r.name}</td>
                  <td className="td text-right tabular-nums font-semibold">{r.routingScore}</td>
                  <td className="td text-right tabular-nums">{r.vendorScore == null ? <span className="text-muted">none yet</span> : `${r.vendorScore}${r.grade ? ` (${r.grade})` : ''}`}{r.scoreSource === 'market' && <span className="ml-1 text-xs text-muted">here</span>}</td>
                  <td className="td text-right tabular-nums">{r.marginPct}% <span className="text-xs text-muted">at {r.cpi.toFixed(2)}</span></td>
                  <td className="td text-right tabular-nums">{r.room}</td>
                  <td className="td text-right tabular-nums">{r.gets || '–'}</td>
                </tr>
              ))}
              {m.skipped.map((s) => (
                <tr key={s.id} className="border-t border-line text-muted">
                  <td className="td">–</td><td className="td">{s.name}</td><td className="td" colSpan={5}>Skipped: {s.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </div>
    </div>
  );
}

function RunHistory({ runs, projectId, editable, onDone }: { runs: Run[]; projectId: string; editable: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  async function undo(r: Run) {
    if (!confirm(`Undo "${r.summary}"? Each vendor target goes back to what it was before this run.`)) return;
    setBusy(r.id);
    setError(null);
    try {
      await post(`/projects/${projectId}/routing/runs/${r.id}/undo`, {});
      onDone();
    } catch (e) { setError(e); } finally { setBusy(null); }
  }
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold">Routing history <InfoTip id="project.routingHistory" /></h3>
      <ErrorBox error={error} />
      {runs.length === 0 ? <p className="text-sm text-muted">No routing yet.</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {runs.map((r) => (
            <li key={r.id} className={clsx('flex flex-wrap items-start justify-between gap-3 px-3 py-2', r.undoneAt && 'opacity-60')} data-run={r.id}>
              <div className="min-w-0">
                <div className={clsx('font-medium', r.undoneAt && 'line-through')}>{r.summary}</div>
                <div className="text-xs text-muted">{when(r.createdAt)} · {r.trigger === 'auto' ? 'automatic' : 'by hand'} · {r.by}{r.undoneAt ? ` · undone ${when(r.undoneAt)} by ${r.undoneBy}` : ''}</div>
                <div className="mt-1 text-xs text-muted tabular-nums">{r.targets.map((t) => `${t.vendor} ${t.from} → ${t.to}`).join(' · ')}</div>
              </div>
              {editable && !r.undoneAt && <button className="btn-ghost py-1 text-xs" disabled={busy === r.id} onClick={() => undo(r)}><Undo2 className="h-3.5 w-3.5" /> {busy === r.id ? 'Undoing…' : 'Undo'}</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
