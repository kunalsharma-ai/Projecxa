'use client';
import clsx from 'clsx';
import { Rabbit, Save } from 'lucide-react';
import { useState } from 'react';
import { ErrorBox, Section, Toggle } from '@/components/ui';
import { patch } from '@/lib/api';
import { countryName } from '@/lib/countries';
import type { ProjectDetail } from './types';

export const SPEEDER_PRESETS = ['1/4', '1/3', '2/4', '2/3', '3/4'] as const;

export function fractionValue(f: string): number {
  const [n, d] = f.split('/').map(Number);
  return d ? n / d : 0;
}

/** Problem with a typed fraction, or null when it is fine (same rule as the server). */
export function fractionProblem(f: string): string | null {
  if (!/^\d{1,2}\/\d{1,2}$/.test(f)) return 'Use a fraction such as 1/3.';
  const [n, d] = f.split('/').map(Number);
  if (n < 1 || n >= d || d > 10) return 'Pick a fraction below 1, with 10 or less under the line (e.g. 3/4).';
  return null;
}

/** Minutes, rounded for reading: 5 min, 3.8 min, 45 s. */
export function minutesText(m: number): string {
  if (m < 1) return `${Math.round(m * 60)} s`;
  return `${Math.round(m * 10) / 10} min`;
}

/**
 * Speeder check, set before launch: completes faster than a share of the planned LOI become
 * quality fails with the reason "Speeder", and show as Speeders in the fieldwork status.
 */
export function SpeederCheck({ project, editable, reload }: { project: ProjectDetail; editable: boolean; reload: () => void }) {
  const initial = project.speederCheck ?? { enabled: false, fraction: '1/3' };
  const [enabled, setEnabled] = useState(initial.enabled);
  const [fraction, setFraction] = useState(initial.fraction);
  const [custom, setCustom] = useState(!SPEEDER_PRESETS.includes(initial.fraction as (typeof SPEEDER_PRESETS)[number]));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const problem = fractionProblem(fraction);
  const dirty = enabled !== initial.enabled || fraction !== initial.fraction;
  const share = problem ? 0 : fractionValue(fraction);
  const markets = project.countries.filter((c) => c.status !== 'CLOSED');

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await patch(`/projects/${project.id}`, { speederCheck: { enabled, fraction } });
      setSaved(true);
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section help="project.speederCheck" title={<span className="flex items-center gap-2"><Rabbit className="h-4 w-4 text-brand" /> Speeder check</span>}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted">
          A respondent who finishes the survey faster than this share of the planned LOI is a speeder: the complete is not counted, the respondent goes to the quality-fail page, and the vendor is not paid. Set it before you launch.
        </p>
        {editable ? <Toggle checked={enabled} onChange={setEnabled} label="Speeder check" /> : <span className="text-xs text-muted">{enabled ? 'On' : 'Off'}</span>}
      </div>
      {!enabled && project.status !== 'LIVE' && <p className="mt-2 text-xs text-warn">Off. Turn it on before going live to catch speeders from the first complete.</p>}

      <div className={clsx('mt-4', !enabled && 'opacity-60')}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Speeder if faster than</div>
        <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Share of the planned LOI">
          {SPEEDER_PRESETS.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={!custom && fraction === f} disabled={!editable}
              onClick={() => { setCustom(false); setFraction(f); }}
              className={clsx('rounded-full border px-3 py-1.5 text-sm tabular-nums transition-colors disabled:cursor-not-allowed', !custom && fraction === f ? 'border-brand bg-brand/10 font-medium text-brand' : 'border-line hover:border-brand/50')}>
              {f} of LOI <span className="text-xs text-muted">({Math.round(fractionValue(f) * 100)}%)</span>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={custom} disabled={!editable} onClick={() => setCustom(true)}
            className={clsx('rounded-full border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed', custom ? 'border-brand bg-brand/10 font-medium text-brand' : 'border-line hover:border-brand/50')}>
            Other
          </button>
          {custom && (
            <input className="input w-24 py-1.5" aria-label="Fraction of LOI, for example 3/5" placeholder="3/5" value={fraction} disabled={!editable} onChange={(e) => setFraction(e.target.value.replace(/\s/g, ''))} />
          )}
        </div>
        {problem && <p className="mt-2 text-xs text-bad">{problem}</p>}

        {!problem && markets.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line text-sm">
            {markets.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span>{countryName(c.countryCode)}{c.targetGroup ? <span className="text-muted"> · {c.targetGroup}</span> : null} <span className="text-xs text-muted">planned LOI {c.loiMinutes} min</span></span>
                <span className="tabular-nums">speeder under <strong>{minutesText(c.loiMinutes * share)}</strong></span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">The clock starts when the respondent is sent to the client survey (after the gate page), so time spent on our own checks never counts. Test links are checked too, so you can try it.</p>
      </div>

      {editable && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={!dirty || saving || !!problem} onClick={save}><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save speeder check'}</button>
          {saved && !dirty && <span className="text-sm text-ok" role="status">Saved</span>}
          {project.status === 'LIVE' && dirty && <span className="text-sm text-warn">The survey is live: the change applies to the next completes.</span>}
          <ErrorBox error={error} />
        </div>
      )}
    </Section>
  );
}
