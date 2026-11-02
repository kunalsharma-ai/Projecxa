'use client';
import clsx from 'clsx';
import { CalendarClock, GitCompare, History, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorBox, Section, StatusChip } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { flag } from '@/lib/countries';
import { RedirectConfig, RedirectMode, RedirectRule, STATUS_LABEL } from '@/lib/types';

export interface Version {
  id: string; version: number; state: string; mode: RedirectMode; changeReason: string | null;
  createdAt: string; activatedAt: string | null; approvedById: string | null; config: RedirectConfig;
  scheduledAt?: string | null; scheduleError?: string | null;
}

interface RuleChange {
  kind: 'added' | 'removed' | 'changed';
  status: string;
  scope: { countryCode?: string; vendorId?: string };
  fields: { field: string; before: string | null; after: string | null }[];
  before: RedirectRule | null;
  after: RedirectRule | null;
}
interface ParamChange { kind: 'added' | 'removed' | 'changed'; canonical: string; scope: { vendorId?: string }; before: { alias: string; required: boolean } | null; after: { alias: string; required: boolean } | null }
interface Compare {
  from: { version: number; mode: RedirectMode };
  to: { version: number; mode: RedirectMode };
  diff: { mode: { before: RedirectMode; after: RedirectMode } | null; rules: RuleChange[]; params: ParamChange[]; unchangedRules: number };
}

const FIELD_LABEL: Record<string, string> = { type: 'Type', url: 'URL', fallbackUrl: 'Fallback URL', timeoutMs: 'Timeout (ms)', enabled: 'Enabled', callbackRequired: 'Callback' };
const KIND_TONE = { added: 'bg-ok/15 text-ok', removed: 'bg-bad/15 text-bad', changed: 'bg-warn/15 text-warn' } as const;

/** A local date-time string for <input type="datetime-local">, one hour from now on the hour. */
function nextHour() {
  const d = new Date(Date.now() + 3600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}

export function RedirectVersions({ projectId, versions, editable, vendorName, onChanged }: { projectId: string; versions: Version[]; editable: boolean; vendorName: Record<string, string>; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const [at, setAt] = useState(nextHour());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cmp, setCmp] = useState<Compare | null>(null);

  // Default comparison: the newest version against the active one (or the one before it).
  useEffect(() => {
    if (!versions.length) return;
    const active = versions.find((v) => v.state === 'ACTIVE');
    const newest = versions[0];
    setTo((t) => t || newest.id);
    setFrom((f) => f || (active && active.id !== newest.id ? active.id : versions[1]?.id ?? newest.id));
  }, [versions]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const activate = (id: string) => run(() => post(`/projects/${projectId}/redirects/versions/${id}/activate`));
  const rollback = (id: string) => run(() => post(`/projects/${projectId}/redirects/rollback`, { versionId: id }));
  const schedule = (id: string) => run(async () => {
    await post(`/projects/${projectId}/redirects/versions/${id}/schedule`, { at: new Date(at).toISOString() });
    setScheduling(null);
  });
  const cancel = (id: string) => run(() => api(`/projects/${projectId}/redirects/versions/${id}/schedule`, { method: 'DELETE' }));

  async function compare() {
    setError(null);
    try {
      setCmp(await get<Compare>(`/projects/${projectId}/redirects/compare?from=${from}&to=${to}`));
    } catch (e) {
      setError(e);
    }
  }

  const scopeLabel = (s: { countryCode?: string; vendorId?: string }) =>
    [s.vendorId && (vendorName[s.vendorId] ?? 'Vendor'), s.countryCode && `${flag(s.countryCode)} ${s.countryCode}`].filter(Boolean).join(' + ') || 'Project';

  return (
    <Section title={<span className="flex items-center gap-2"><History className="h-4 w-4" /> Version history</span>}>
      <ErrorBox error={error} />
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead className="border-y border-line bg-sunken/60"><tr><th className="th">Version</th><th className="th">State</th><th className="th">Mode</th><th className="th">Reason</th><th className="th">Created</th><th className="th">Goes live / went live</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">
            {versions.map((v) => (
              <tr key={v.id} className="align-top">
                <td className="td font-medium">v{v.version}</td>
                <td className="td"><StatusChip status={v.state} /></td>
                <td className="td">{v.mode.toLowerCase()}</td>
                <td className="td max-w-[260px] whitespace-normal break-words">
                  {v.changeReason ?? '–'}
                  {v.scheduleError && v.state === 'DRAFT' && <div className="mt-1 text-xs text-bad">Did not go live as scheduled: {v.scheduleError}</div>}
                </td>
                <td className="td text-xs text-muted">{new Date(v.createdAt).toLocaleString()}</td>
                <td className="td text-xs text-muted">
                  {v.activatedAt ? new Date(v.activatedAt).toLocaleString() : v.state === 'SCHEDULED' && v.scheduledAt ? <span className="text-info">{new Date(v.scheduledAt).toLocaleString()}</span> : '–'}
                </td>
                <td className="td">
                  {editable && (
                    <div className="flex flex-wrap justify-end gap-1">
                      {v.state === 'DRAFT' && <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => activate(v.id)}>Activate</button>}
                      {v.state === 'DRAFT' && <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => setScheduling(scheduling === v.id ? null : v.id)}><CalendarClock className="h-3.5 w-3.5" /> Schedule</button>}
                      {v.state === 'SCHEDULED' && <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => activate(v.id)}>Activate now</button>}
                      {v.state === 'SCHEDULED' && <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => cancel(v.id)}><X className="h-3.5 w-3.5" /> Cancel schedule</button>}
                      {v.state === 'ARCHIVED' && v.approvedById && <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => rollback(v.id)}><RotateCcw className="h-3.5 w-3.5" /> Restore</button>}
                    </div>
                  )}
                  {scheduling === v.id && (
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                      <input type="datetime-local" className="input w-auto px-2 py-1 text-xs" value={at} onChange={(e) => setAt(e.target.value)} aria-label={`When version ${v.version} goes live`} />
                      <button className="btn-primary px-2.5 py-1 text-xs" disabled={busy || !at} onClick={() => schedule(v.id)}>Go live then</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted">
        Restoring creates a new version from the old one. A scheduled version is checked again when its time comes; if it no longer passes, it stays a draft and the bell says why. Respondents already in the survey keep the version they started with.
      </p>

      {versions.length > 1 && (
        <div className="mt-5 rounded-lg bg-sunken/60 p-4">
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <span className="flex items-center gap-2 font-medium"><GitCompare className="h-4 w-4" /> Compare</span>
            <select className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Compare from version">
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.version} ({v.state.toLowerCase()})</option>)}
            </select>
            <span className="text-muted">with</span>
            <select className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Compare to version">
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.version} ({v.state.toLowerCase()})</option>)}
            </select>
            <button className="btn-ghost" disabled={!from || !to || from === to} onClick={compare}>Show changes</button>
          </div>
          {cmp && (
            <div className="mt-4 space-y-3 text-sm">
              <div className="text-muted">
                v{cmp.from.version} → v{cmp.to.version}: {cmp.diff.rules.length} rule change{cmp.diff.rules.length === 1 ? '' : 's'}, {cmp.diff.params.length} parameter change{cmp.diff.params.length === 1 ? '' : 's'}, {cmp.diff.unchangedRules} rule{cmp.diff.unchangedRules === 1 ? '' : 's'} unchanged.
                {cmp.diff.mode && <> Mode: <b>{cmp.diff.mode.before.toLowerCase()}</b> → <b>{cmp.diff.mode.after.toLowerCase()}</b>.</>}
              </div>
              {cmp.diff.rules.length === 0 && cmp.diff.params.length === 0 && !cmp.diff.mode && <div>These versions route respondents the same way.</div>}
              {cmp.diff.rules.map((c, i) => (
                <div key={i} className="rounded-lg border border-line bg-panel p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={clsx('chip', KIND_TONE[c.kind])}>{c.kind}</span>
                    <b>{STATUS_LABEL[c.status] ?? c.status}</b>
                    <span className="text-muted">· {scopeLabel(c.scope)}</span>
                  </div>
                  {c.kind === 'changed' ? (
                    <ul className="mt-2 space-y-1">
                      {c.fields.map((f) => (
                        <li key={f.field} className="grid gap-1 sm:grid-cols-[110px_1fr]">
                          <span className="text-xs text-muted">{FIELD_LABEL[f.field] ?? f.field}</span>
                          <span className="min-w-0 break-all font-mono text-xs"><span className="text-bad line-through">{f.before ?? '–'}</span> <span className="text-ok">{f.after ?? '–'}</span></span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-2 break-all font-mono text-xs">{(c.after ?? c.before)?.type.toLowerCase()} · {(c.after ?? c.before)?.url}</div>
                  )}
                </div>
              ))}
              {cmp.diff.params.map((c, i) => (
                <div key={`p${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-panel p-3">
                  <span className={clsx('chip', KIND_TONE[c.kind])}>{c.kind}</span>
                  <span>Parameter <b>{c.canonical}</b>{c.scope.vendorId ? ` for ${vendorName[c.scope.vendorId] ?? 'a vendor'}` : ''}:</span>
                  <span className="font-mono text-xs">{c.before ? `${c.before.alias}${c.before.required ? ' (required)' : ''}` : '–'} → {c.after ? `${c.after.alias}${c.after.required ? ' (required)' : ''}` : '–'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
