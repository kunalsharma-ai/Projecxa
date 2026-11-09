'use client';
import clsx from 'clsx';
import type { LimitDef, LimitKey, LimitsJson, Usage } from '@/lib/super-admin';

/** Usage limits (docs/PLAN_LIMITS.md): editing them on a plan or an organisation, and showing usage. */

export const fmtNum = (n: number) => n.toLocaleString('en');

/** Text inputs for every limit. users/projects go to maxUsers/maxProjects, the rest to the limits JSON. */
export type LimitForm = Record<LimitKey, string> & { trafficAction: '' | 'stop' | 'warn' };

export function limitForm(maxUsers: number | null | undefined, maxProjects: number | null | undefined, json: LimitsJson | null | undefined, overrides = false): LimitForm {
  const j = json ?? {};
  const val = (k: LimitKey) => (k in j ? (j[k] == null ? (overrides ? 'none' : '') : String(j[k])) : '');
  return {
    users: maxUsers?.toString() ?? '', projects: maxProjects?.toString() ?? '',
    projectsPerMonth: val('projectsPerMonth'), clients: val('clients'), vendors: val('vendors'), portalUsers: val('portalUsers'),
    clicksPerMonth: val('clicksPerMonth'), completesPerMonth: val('completesPerMonth'), scheduledReports: val('scheduledReports'), apiKeys: val('apiKeys'),
    trafficAction: j.trafficAction ?? '',
  };
}

/** Back to the API shape. On an organisation, "none" means "no limit for this organisation" and empty means "the plan's". */
export function limitBody(f: LimitForm) {
  const n = (v: string) => (v === '' ? null : Number(v));
  const limits: LimitsJson = {};
  for (const k of Object.keys(f) as (keyof LimitForm)[]) {
    if (k === 'users' || k === 'projects' || k === 'trafficAction') continue;
    const v = f[k].trim().toLowerCase();
    if (v === 'none') limits[k] = null;
    else if (v !== '') limits[k] = Number(v);
  }
  if (f.trafficAction) limits.trafficAction = f.trafficAction;
  return { maxUsers: n(f.users), maxProjects: n(f.projects), limits };
}

export function LimitFields({ defs, form, onChange, plan }: { defs: LimitDef[]; form: LimitForm; onChange: (f: LimitForm) => void; plan?: { maxUsers: number | null; maxProjects: number | null; limits: LimitsJson | null } }) {
  const planValue = (k: LimitKey) => {
    if (!plan) return null;
    const v = k === 'users' ? plan.maxUsers : k === 'projects' ? plan.maxProjects : plan.limits?.[k];
    return v == null ? 'Plan: no limit' : `Plan: ${fmtNum(v)}`;
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {defs.map((d) => (
        <label key={d.key} className="block" data-limit={d.key}>
          <span className="mb-1 block text-sm font-medium">{d.label}</span>
          <input
            className="input" inputMode="numeric" value={form[d.key]}
            placeholder={planValue(d.key) ?? 'No limit'}
            pattern={plan && d.key !== 'users' && d.key !== 'projects' ? '\\d*|none' : '\\d*'}
            onChange={(e) => onChange({ ...form, [d.key]: e.target.value })}
            aria-describedby={`limit-${d.key}`}
          />
          <span id={`limit-${d.key}`} className="mt-1 block text-xs text-muted">{d.counts}{d.period === 'month' ? ' (resets on the 1st)' : ''}</span>
        </label>
      ))}
      <label className="block">
        <span className="mb-1 block text-sm font-medium">When clicks or completes run out</span>
        <select className="input" value={form.trafficAction} onChange={(e) => onChange({ ...form, trafficAction: e.target.value as LimitForm['trafficAction'] })}>
          {plan && <option value="">Follow the plan</option>}
          <option value="stop">Stop new entries (sent back to the vendor as quota full)</option>
          <option value="warn">Keep going and show the overrun</option>
        </select>
        <span className="mt-1 block text-xs text-muted">Test links and respondents already in a survey are never stopped.</span>
      </label>
    </div>
  );
}

export function UsageBars({ usage, compact }: { usage: Usage; compact?: boolean }) {
  const rows = usage.limits.filter((l) => !compact || l.limit != null);
  if (!rows.length) return <p className="text-sm text-muted">No usage limits on this plan.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {rows.map((l) => {
        const pct = l.limit == null ? 0 : l.limit === 0 ? 100 : Math.min(100, Math.round((l.used / l.limit) * 100));
        const over = l.limit != null && l.used >= l.limit;
        const near = l.limit != null && !over && pct >= 80;
        return (
          <li key={l.key} className="rounded-lg border border-line p-3" data-usage={l.key}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{l.label}{l.period === 'month' && <span className="ml-1 text-xs font-normal text-muted">this month</span>}</span>
              <span className={clsx('tabular-nums', over ? 'text-bad' : near ? 'text-warn' : 'text-muted')}>{fmtNum(l.used)} / {l.limit == null ? 'no limit' : fmtNum(l.limit)}</span>
            </div>
            {l.limit != null && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={l.label}>
                <div className={clsx('h-full rounded-full', over ? 'bg-bad' : near ? 'bg-warn' : 'bg-brand')} style={{ width: `${pct}%` }} />
              </div>
            )}
            {over && <p className="mt-1 text-xs text-bad">{l.traffic ? (usage.trafficAction === 'stop' ? 'Reached: new live entries go back to the vendor as quota full.' : 'Over the limit: entries keep going.') : 'Reached: nothing more can be added.'}</p>}
          </li>
        );
      })}
    </ul>
  );
}
