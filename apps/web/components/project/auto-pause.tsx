'use client';
import clsx from 'clsx';
import { PauseCircle } from 'lucide-react';
import { InfoTip } from '@/components/help';
import { Toggle } from '@/components/ui';
import { countryName } from '@/lib/countries';
import type { AutoPause, ProjectDetail } from './types';

export const DEFAULT_AUTO_PAUSE: AutoPause = { enabled: false, by: 'percent', value: 10, scope: 'market' };

export function autoPauseProblem(a: AutoPause): string | null {
  if (!a.enabled) return null;
  if (!Number.isInteger(a.value) || a.value < 1) return 'Enter a whole number of 1 or more.';
  if (a.by === 'percent' && a.value > 99) return 'A percentage must be between 1 and 99.';
  return null;
}

/** Completes at which the checkpoint fires (same rule as the server), or null when it cannot. */
export function autoPauseAt(a: AutoPause, target: number): number | null {
  if (target <= 0) return null;
  const at = a.by === 'percent' ? Math.max(1, Math.ceil((target * a.value) / 100)) : a.value;
  return at < target ? at : null;
}

const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Auto-pause checkpoint inside the autopilot: pause each market (or vendor link) at a % of its
 * target or a number of completes. Each market or link pauses once; after someone resumes it, or
 * once its target is reached, the checkpoint is off for it, and when all are done the autopilot
 * switches the checkpoint off.
 */
export function AutoPauseControl({ project, value, onChange, editable }: { project: ProjectDetail; value: AutoPause; onChange: (v: AutoPause) => void; editable: boolean }) {
  const set = (patch: Partial<AutoPause>) => onChange({ ...value, ...patch });
  const problem = autoPauseProblem(value);
  const state = project.autopilotState?.autoPause;
  const saved = project.autopilot?.autoPause;
  const current = state && saved && state.config === `${saved.by}:${saved.value}:${saved.scope}` ? state : null;

  const items = project.countries
    .filter((c) => c.status !== 'CLOSED' && c.status !== 'DRAFT')
    .flatMap((c) => {
      const market = `${countryName(c.countryCode)}${c.targetGroup ? ` · ${c.targetGroup}` : ''}`;
      return value.scope === 'market'
        ? [{ key: `m:${c.id}`, name: market, completes: c.completes, target: c.targetCompletes, paused: c.status === 'HOLD', resumeHint: 'set the market live' }]
        : c.allocations.filter((a) => a.status !== 'CLOSED').map((a) => ({ key: `a:${a.id}`, name: `${a.vendor.name} in ${market}`, completes: a.completes, target: a.targetCompletes, paused: a.status === 'PAUSED', resumeHint: 'reactivate the link' }));
    });

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium"><PauseCircle className="h-4 w-4 text-brand" aria-hidden /> Auto-pause at a checkpoint <InfoTip id="project.autoPause" /></div>
          <div className="text-xs text-muted">Soft launch: pause at a share of the target or a number of completes, check the data, then resume.</div>
        </div>
        <span className={editable ? '' : 'pointer-events-none opacity-60'}><Toggle checked={value.enabled} label="Auto-pause at a checkpoint" onChange={(v) => set({ enabled: v })} /></span>
      </div>
      {current?.switchedOffAt && !value.enabled && (
        <p className="mt-2 rounded-md bg-ok/10 px-2.5 py-1.5 text-xs text-ok" role="status">The autopilot switched this off on {when(current.switchedOffAt)}: every {saved?.scope === 'vendor' ? 'vendor link' : 'market'} was paused once or reached its target. Turn it on again to set a new checkpoint.</p>
      )}

      {value.enabled && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Pause</span>
            <select className="input w-auto py-1.5" aria-label="What to pause" value={value.scope} disabled={!editable} onChange={(e) => set({ scope: e.target.value as AutoPause['scope'] })}>
              <option value="market">each market</option>
              <option value="vendor">each vendor link</option>
            </select>
            <span>at</span>
            <input className="input w-24 py-1.5 tabular-nums" type="number" min={1} max={value.by === 'percent' ? 99 : undefined} aria-label="Checkpoint" value={Number.isFinite(value.value) ? value.value : ''} disabled={!editable} onChange={(e) => set({ value: Math.round(Number(e.target.value)) })} />
            <div className="inline-flex overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label="Checkpoint unit">
              {([['percent', '% of target'], ['completes', 'completes']] as const).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={value.by === k} disabled={!editable} onClick={() => set({ by: k })}
                  className={clsx('px-3 py-1.5 text-sm', value.by === k ? 'bg-brand text-white' : 'hover:bg-sunken')}>{l}</button>
              ))}
            </div>
          </div>
          {problem && <p className="text-xs text-bad">{problem}</p>}
          {!problem && items.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line text-xs">
              {items.map((it) => {
                const at = autoPauseAt(value, it.target);
                const done = current?.done[it.key];
                let status: { text: string; tone: string };
                if (done?.reason === 'target' || it.completes >= it.target) status = { text: 'Target reached · checkpoint off', tone: 'text-muted' };
                else if (done && it.paused) status = { text: `Paused at ${done.completes} of ${done.target} on ${when(done.at)} · ${it.resumeHint} to continue`, tone: 'text-warn' };
                else if (done) status = { text: `Resumed after the checkpoint · it will not pause again`, tone: 'text-ok' };
                else if (at == null) status = { text: 'Checkpoint is at or past the target, so it never pauses', tone: 'text-muted' };
                else status = { text: `Pauses at ${at} of ${it.target} completes (now ${it.completes})`, tone: 'text-ink' };
                return (
                  <li key={it.key} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                    <span className="font-medium">{it.name}</span>
                    <span className={clsx('tabular-nums', status.tone)}>{status.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-muted">Each {value.scope === 'market' ? 'market' : 'link'} pauses once. When you resume it, or it reaches its target, the checkpoint is off for it; when all are done the autopilot switches the checkpoint off. Changing the checkpoint starts it again for everyone.</p>
        </div>
      )}
    </div>
  );
}
