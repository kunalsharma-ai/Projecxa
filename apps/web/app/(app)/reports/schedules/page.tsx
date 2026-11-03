'use client';
import clsx from 'clsx';
import { ArrowLeft, Eye, Mail, Plus, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import type { Options } from '@/components/reports/types';
import { Empty, ErrorBox, Loading, PageHeader, Section, Toggle } from '@/components/ui';
import { api, get, patch, post } from '@/lib/api';

interface Run { id?: string; status: string; error: string | null; createdAt: string; from: string; to: string; trigger?: string; rows?: number; recipients?: string[] }
interface Schedule {
  id: string; name: string; report: string; period: string; filters: { clientId?: string; vendorId?: string; projectId?: string };
  frequency: 'daily' | 'weekly' | 'monthly'; dayOfWeek: number | null; dayOfMonth: number | null; hour: number; timezone: string;
  recipients: string[]; skipEmpty: boolean; active: boolean; nextRunAt: string | null; schedule: string; lastRun: Run | null;
}
interface List { schedules: Schedule[]; mail: { configured: boolean; host: string | null; from: string | null }; reports: { id: string; label: string }[]; periods: { id: string; label: string }[] }
type Draft = Omit<Schedule, 'id' | 'nextRunAt' | 'schedule' | 'lastRun' | 'recipients'> & { recipients: string };

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ZONES = ['Asia/Kolkata', 'UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney'];
const RUN: Record<string, string> = { SENT: 'bg-ok/15 text-ok', FAILED: 'bg-bad/15 text-bad', SKIPPED: 'bg-sunken text-muted' };
const when = (d: string, timeZone?: string) => new Date(d).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone });
const blank = (): Draft => ({
  name: '', report: 'overall', period: 'last_7_days', filters: {}, frequency: 'weekly', dayOfWeek: 1, dayOfMonth: 1, hour: 9,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata', recipients: '', skipEmpty: false, active: true,
});

export default function SchedulesPage() {
  const me = useMe();
  const editable = canEdit(me);
  const [list, setList] = useState<List | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; filename: string; rows: number } | null>(null);
  const [runs, setRuns] = useState<{ id: string; rows: Run[] } | null>(null);

  const load = useCallback(() => get<List>('/report-schedules').then(setList).catch(setError), []);
  useEffect(() => {
    load();
    get<Options>('/reports/options').then(setOptions).catch(setError);
  }, [load]);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try { await f(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    const d = editing!.draft;
    const body = {
      ...d,
      dayOfWeek: d.frequency === 'weekly' ? d.dayOfWeek : null,
      dayOfMonth: d.frequency === 'monthly' ? d.dayOfMonth : null,
      filters: Object.fromEntries(Object.entries(d.filters).filter(([, v]) => v)),
      recipients: d.recipients.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean),
    };
    if (editing!.id) await api(`/report-schedules/${editing!.id}`, { method: 'PUT', json: body });
    else await post('/report-schedules', body);
    setEditing(null);
    await load();
  });
  const sendNow = (s: Schedule) => run(async () => {
    const r = await post<Run>(`/report-schedules/${s.id}/send`);
    if (runs?.id === s.id) setRuns({ id: s.id, rows: await get<Run[]>(`/report-schedules/${s.id}/runs`) });
    setNote(r.status === 'SENT' ? `Sent "${s.name}" to ${s.recipients.length} recipient${s.recipients.length === 1 ? '' : 's'}.` : r.status === 'SKIPPED' ? `Skipped "${s.name}": no traffic in the period.` : `Could not send "${s.name}": ${r.error}`);
    await load();
  });
  const testEmail = () => run(async () => {
    const r = await post<{ to: string }>('/report-schedules/test-email');
    setNote(`Test email sent to ${r.to}. Check your inbox.`);
  });
  const remove = (s: Schedule) => run(async () => {
    if (!confirm(`Delete "${s.name}" and its history?`)) return;
    await api(`/report-schedules/${s.id}`, { method: 'DELETE' });
    await load();
  });

  const describeFilters = (f: Schedule['filters']) =>
    [
      f.clientId && options?.clients.find((c) => c.id === f.clientId)?.name,
      f.vendorId && options?.vendors.find((v) => v.id === f.vendorId)?.name,
      f.projectId && options?.projects.find((p) => p.id === f.projectId)?.projectCode,
    ].filter(Boolean).join(' · ');

  return (
    <>
      <div className="mb-3"><Link href="/reports" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Reports</Link></div>
      <PageHeader
        title="Scheduled reports"
        subtitle="Reports emailed on a schedule, with a summary in the email and the full table as a CSV attachment. Test traffic is never counted."
        actions={editable && !editing ? <button className="btn-primary" onClick={() => setEditing({ id: null, draft: blank() })}><Plus className="h-4 w-4" />New schedule</button> : undefined}
      />
      <ErrorBox error={error} />
      {note && <p className="mb-4 text-sm" role="status">{note}</p>}
      {!list ? <Loading /> : (
        <div className="space-y-5">
          <div className={clsx('card flex flex-wrap items-center justify-between gap-3 p-4 text-sm', !list.mail.configured && 'border-warn/50')}>
            <div className="flex items-start gap-3">
              <Mail className={clsx('mt-0.5 h-5 w-5 shrink-0', list.mail.configured ? 'text-ok' : 'text-warn')} />
              {list.mail.configured ? (
                <div><div className="font-medium">Email is set up</div><div className="text-muted">Sent from {list.mail.from ?? 'the configured address'}{list.mail.host ? ` through ${list.mail.host}` : ''}.</div></div>
              ) : (
                <div><div className="font-medium">Email is not set up yet</div><div className="text-muted">Schedules are saved, but nothing is sent until the server has the Zoho Mail settings (SMTP_USER, SMTP_PASS, MAIL_FROM). See docs/SCHEDULED_REPORTS.md.</div></div>
              )}
            </div>
            {me?.user.role === 'ADMIN' && <button className="btn-ghost" disabled={busy} onClick={testEmail}><Send className="h-4 w-4" />Send me a test email</button>}
          </div>

          {editing && options && <Editor list={list} options={options} value={editing.draft} onChange={(draft) => setEditing({ ...editing, draft })} onSave={save} onCancel={() => setEditing(null)} busy={busy} isNew={!editing.id} />}

          <Section title="Schedules">
            {list.schedules.length === 0 ? <Empty>No scheduled reports yet.{editable && ' Create one to get a report by email every day, week or month.'}</Empty> : (
              <ul className="divide-y divide-line">
                {list.schedules.map((s) => (
                  <li key={s.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{s.name}</span>
                          {!s.active && <span className="chip bg-sunken text-muted">Paused</span>}
                        </div>
                        <div className="mt-0.5 text-sm text-muted">
                          {list.reports.find((r) => r.id === s.report)?.label} · {list.periods.find((p) => p.id === s.period)?.label}{describeFilters(s.filters) && ` · ${describeFilters(s.filters)}`}
                        </div>
                        <div className="mt-1 text-sm">{s.schedule}{s.active && s.nextRunAt && <span className="text-muted"> · next {when(s.nextRunAt, s.timezone)}</span>}</div>
                        <div className="mt-1 break-all text-xs text-muted">To {s.recipients.join(', ')}</div>
                        {s.lastRun && (
                          <div className="mt-1.5 text-xs">
                            <span className={clsx('chip', RUN[s.lastRun.status])}>{s.lastRun.status === 'SENT' ? 'Sent' : s.lastRun.status === 'FAILED' ? 'Failed' : 'Skipped'}</span>
                            <span className="ml-1.5 text-muted">{when(s.lastRun.createdAt)}{s.lastRun.error ? `: ${s.lastRun.error}` : ''}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {editable && <Toggle checked={s.active} label={`Schedule ${s.name} on`} onChange={(v) => run(async () => { await patch(`/report-schedules/${s.id}`, { active: v }); await load(); })} />}
                        <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => run(async () => setPreview(await get(`/report-schedules/${s.id}/preview`)))}><Eye className="h-3.5 w-3.5" />Preview</button>
                        <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => run(async () => setRuns({ id: s.id, rows: await get<Run[]>(`/report-schedules/${s.id}/runs`) }))}>History</button>
                        {editable && <button className="btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={() => sendNow(s)}><Send className="h-3.5 w-3.5" />Send now</button>}
                        {editable && <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setEditing({ id: s.id, draft: { ...s, recipients: s.recipients.join(', '), dayOfWeek: s.dayOfWeek ?? 1, dayOfMonth: s.dayOfMonth ?? 1 } })}>Edit</button>}
                        {editable && <button className="btn-ghost px-2.5 py-1 text-xs text-bad" onClick={() => remove(s)}>Delete</button>}
                      </div>
                    </div>
                    {runs?.id === s.id && (
                      <div className="mt-3 rounded-lg border border-line p-3">
                        <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted">Last {runs.rows.length} sends<button aria-label="Close history" onClick={() => setRuns(null)}><X className="h-4 w-4" /></button></div>
                        {runs.rows.length === 0 ? <p className="text-sm text-muted">Not sent yet.</p> : (
                          <div className="-mx-3 overflow-x-auto px-3">
                            <table className="w-full min-w-[520px] text-sm">
                              <thead><tr><th className="th">When</th><th className="th">Result</th><th className="th">Period</th><th className="th text-right">Rows</th></tr></thead>
                              <tbody>
                                {runs.rows.map((r) => (
                                  <tr key={r.id} className="border-t border-line">
                                    <td className="td whitespace-nowrap text-xs">{when(r.createdAt)}{r.trigger === 'manual' && <span className="text-muted"> · by hand</span>}</td>
                                    <td className="td"><span className={clsx('chip', RUN[r.status])}>{r.status.toLowerCase()}</span>{r.error && <div className="mt-1 text-xs text-muted">{r.error}</div>}</td>
                                    <td className="td whitespace-nowrap text-xs">{r.from === r.to ? r.from : `${r.from} to ${r.to}`}</td>
                                    <td className="td text-right tabular-nums">{r.rows}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal aria-label="Email preview" onClick={() => setPreview(null)}>
          <div className="card my-6 w-full max-w-3xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-line p-4">
              <div className="min-w-0"><div className="truncate font-medium">{preview.subject}</div><div className="text-xs text-muted">Attachment: {preview.filename} ({preview.rows} rows)</div></div>
              <button className="btn-ghost h-8 px-2" aria-label="Close preview" onClick={() => setPreview(null)}><X className="h-4 w-4" /></button>
            </div>
            <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[70vh] w-full bg-white" />
          </div>
        </div>
      )}
    </>
  );
}

function Editor({ list, options, value: d, onChange, onSave, onCancel, busy, isNew }: { list: List; options: Options; value: Draft; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void; busy: boolean; isNew: boolean }) {
  const set = (p: Partial<Draft>) => onChange({ ...d, ...p });
  const zones = ZONES.includes(d.timezone) ? ZONES : [d.timezone, ...ZONES];
  return (
    <Section title={isNew ? 'New scheduled report' : 'Edit scheduled report'}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="md:col-span-2"><span className="label">Name</span><input className="input" autoFocus maxLength={120} placeholder="Weekly vendor performance" value={d.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label><span className="label">Report</span><select className="input" value={d.report} onChange={(e) => set({ report: e.target.value })}>{list.reports.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        <label><span className="label">Covers</span><select className="input" value={d.period} onChange={(e) => set({ period: e.target.value })}>{list.periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
        <label><span className="label">Client (optional)</span><select className="input" value={d.filters.clientId ?? ''} onChange={(e) => set({ filters: { ...d.filters, clientId: e.target.value || undefined } })}><option value="">All clients</option>{options.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label><span className="label">Vendor (optional)</span><select className="input" value={d.filters.vendorId ?? ''} onChange={(e) => set({ filters: { ...d.filters, vendorId: e.target.value || undefined } })}><option value="">All vendors</option>{options.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className="md:col-span-2"><span className="label">Project (optional)</span><select className="input" value={d.filters.projectId ?? ''} onChange={(e) => set({ filters: { ...d.filters, projectId: e.target.value || undefined } })}><option value="">All projects</option>{options.projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode} · {p.name}</option>)}</select></label>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label><span className="label">How often</span><select className="input" value={d.frequency} onChange={(e) => set({ frequency: e.target.value as Draft['frequency'] })}><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></label>
        {d.frequency === 'weekly' && <label><span className="label">On</span><select className="input" value={d.dayOfWeek ?? 1} onChange={(e) => set({ dayOfWeek: Number(e.target.value) })}>{DAYS.map((x, i) => <option key={x} value={i}>{x}</option>)}</select></label>}
        {d.frequency === 'monthly' && <label><span className="label">On day</span><select className="input" value={d.dayOfMonth ?? 1} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}>{Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label>}
        <label><span className="label">At</span><select className="input" value={d.hour} onChange={(e) => set({ hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select></label>
        <label><span className="label">Timezone</span><select className="input" value={d.timezone} onChange={(e) => set({ timezone: e.target.value })}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
      </div>
      <label className="mt-5 block"><span className="label">Send to</span><textarea className="input min-h-16" placeholder="ops@yourcompany.com, client@example.com" value={d.recipients} onChange={(e) => set({ recipients: e.target.value })} /><span className="mt-1 block text-xs text-muted">Up to 20 addresses, separated by commas or new lines. Anyone listed gets the figures, including revenue, so check before adding clients or vendors.</span></label>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={d.skipEmpty} onChange={(e) => set({ skipEmpty: e.target.checked })} />Do not send when there was no traffic in the period</label>
      <div className="mt-5 flex gap-2">
        <button className="btn-primary" disabled={busy || !d.name.trim() || !d.recipients.trim()} onClick={onSave}>{isNew ? 'Create schedule' : 'Save changes'}</button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </Section>
  );
}
