'use client';
import clsx from 'clsx';
import { Eraser, FileCheck2, History, Pencil, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { ErrorBox, Loading, OutcomeChip, PageHeader, Section, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { Label } from '@/components/help';

interface Retention { respondentDays: number | null; eventDays: number | null }
interface Preview { sessions: number; events: number; waitingForApproval: number }
interface Notice { countryCode: string; enabled: boolean; title: string; body: string; privacyUrl: string | null; version: number; updatedAt: string }
interface Privacy { retention: Retention; minDays: number; lastRunAt: string | null; preview: Preview; totals: { consented: number; anonymised: number }; consent: Notice[] }
interface Found { id: string; status: string; approval: string; isTest: boolean; startedAt: string; consentAt: string | null; consentVersion: number | null; deviceType: string | null; hasAnswers: boolean; project: { projectCode: string; name: string }; countryCode: string; vendor: string }

const when = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Never');
const num = (v: string) => (v.trim() === '' ? null : Number(v));
const BLANK = { countryCode: '*', enabled: true, title: 'Before you start', body: '', privacyUrl: '' };
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

export default function PrivacyPage() {
  const me = useMe();
  const admin = me?.user.role === 'ADMIN';
  const [data, setData] = useState<Privacy | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [keep, setKeep] = useState({ respondentDays: '', eventDays: '' });
  const [editing, setEditing] = useState<typeof BLANK | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [uid, setUid] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await get<Privacy>('/privacy');
    setData(d);
    setKeep({ respondentDays: d.retention.respondentDays?.toString() ?? '', eventDays: d.retention.eventDays?.toString() ?? '' });
  }, []);
  useEffect(() => { load().catch(setError); }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setNote(null);
    setBusy(true);
    try { await fn(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const saveRetention = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/privacy/retention', { method: 'PUT', json: { respondentDays: num(keep.respondentDays), eventDays: num(keep.eventDays) } });
      await load();
      setNote('Retention saved. It runs once a day; use Run now to apply it straight away.');
    });
  };
  const runNow = () => {
    if (!data) return;
    const p = data.preview;
    if (!confirm(`Anonymise ${plural(p.sessions, 'respondent session')} and delete ${plural(p.events, 'event')} now? This cannot be undone.`)) return;
    void run(async () => {
      const r = await post<{ sessions: number; events: number }>('/privacy/retention/run');
      await load();
      setNote(`Done: ${plural(r.sessions, 'session')} anonymised, ${plural(r.events, 'event')} deleted.`);
    });
  };
  const saveNotice = (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const code = editing.countryCode.trim().toUpperCase();
    void run(async () => {
      await api(`/privacy/consent/${encodeURIComponent(code)}`, { method: 'PUT', json: { enabled: editing.enabled, title: editing.title, body: editing.body, privacyUrl: editing.privacyUrl.trim() || null } });
      setEditing(null);
      await load();
    });
  };
  const toggle = (n: Notice, enabled: boolean) => void run(async () => {
    await api(`/privacy/consent/${encodeURIComponent(n.countryCode)}`, { method: 'PUT', json: { enabled, title: n.title, body: n.body, privacyUrl: n.privacyUrl } });
    await load();
  });
  const remove = (n: Notice) => {
    if (!confirm(`Delete the consent notice for ${n.countryCode === '*' ? 'every other market' : n.countryCode}? Respondents there stop seeing it.`)) return;
    void run(async () => { await api(`/privacy/consent/${encodeURIComponent(n.countryCode)}`, { method: 'DELETE' }); await load(); });
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const rows = await get<Found[]>(`/privacy/respondents?uid=${encodeURIComponent(uid.trim())}`);
      setFound(rows);
      setPicked(new Set(rows.map((r) => r.id)));
    });
  };
  const erase = () => {
    if (!confirm(`Erase the personal data in ${plural(picked.size, 'session')}? Status, money and counts stay; the respondent ID, answers, IP, device and browser details are removed. This cannot be undone.`)) return;
    void run(async () => {
      const r = await post<{ anonymised: number }>('/privacy/respondents/erase', { sessionIds: [...picked], reason: `Erasure request for ${uid.trim()}` });
      setFound(null);
      setPicked(new Set());
      await load();
      setNote(`${plural(r.anonymised, 'session')} erased.`);
    });
  };

  const notices = data?.consent ?? [];
  const startNew = () => { setIsNew(true); setEditing({ ...BLANK, countryCode: notices.some((n) => n.countryCode === '*') ? '' : '*' }); };
  return (
    <>
      <PageHeader title="Privacy" subtitle="How long respondent data is kept, the consent notice respondents see before a survey, and erasure requests." />
      <ErrorBox error={error} />
      {note && <div className="mb-4 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">{note}</div>}
      {!data ? <Loading /> : (
        <div className="space-y-6">
          <Section title={<span className="flex items-center gap-2"><History className="h-4 w-4 text-brand" /> Data retention</span>}>
            <form onSubmit={saveRetention} className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <label className="block"><Label>Anonymise respondents after (days)</Label>
                <input className="input" type="number" min={data.minDays} max={3650} placeholder="Keep" value={keep.respondentDays} disabled={!admin} onChange={(e) => setKeep({ ...keep, respondentDays: e.target.value })} />
              </label>
              <label className="block"><Label>Delete the event log after (days)</Label>
                <input className="input" type="number" min={data.minDays} max={3650} placeholder="Keep" value={keep.eventDays} disabled={!admin} onChange={(e) => setKeep({ ...keep, eventDays: e.target.value })} />
              </label>
              {admin && <button className="btn-primary" disabled={busy}>Save</button>}
            </form>
            <p className="mt-3 text-xs text-muted">
              Leave a box empty to keep that data. Anonymising removes the panel&apos;s respondent ID, answers, IP and browser details from finished sessions, and keeps the status, money and counts, so reports and invoices do not change.
              Completes still waiting for client approval are kept until they are decided. The minimum is {data.minDays} days.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
              <span><span className="text-muted">Due now: </span>{plural(data.preview.sessions, 'session')} · {plural(data.preview.events, 'event')}</span>
              {data.preview.waitingForApproval > 0 && <span className="text-muted">{plural(data.preview.waitingForApproval, 'complete')} waiting for approval</span>}
              <span><span className="text-muted">Last run: </span>{when(data.lastRunAt)}</span>
              <span><span className="text-muted">Anonymised so far: </span>{data.totals.anonymised.toLocaleString()}</span>
              {admin && <button className="btn-ghost ml-auto" disabled={busy || (!data.preview.sessions && !data.preview.events)} onClick={runNow}>Run now</button>}
            </div>
          </Section>

          <Section
            title={<span className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-brand" /> Consent notices</span>}
            actions={admin && !editing ? <button className="btn-ghost" onClick={startNew}><Plus className="h-4 w-4" /> Add notice</button> : undefined}
          >
            <p className="mb-4 text-sm text-muted">
              When a notice applies to a market, respondents read it and tick “I agree” on the entry page before the survey opens. Anyone who declines leaves as a partial and is not sent to the survey.
              A market&apos;s own notice wins over the one for every other market (*). {data.totals.consented.toLocaleString()} respondents have agreed so far.
            </p>
            {editing && (
              <form onSubmit={saveNotice} className="mb-5 grid gap-4 rounded-lg border border-line bg-sunken/40 p-4 md:grid-cols-[10rem_1fr]">
                <label className="block"><Label>Market</Label>
                  <input className="input font-mono uppercase" value={editing.countryCode} disabled={!isNew} maxLength={2} placeholder="DE or *" required onChange={(e) => setEditing({ ...editing, countryCode: e.target.value })} />
                </label>
                <label className="block"><Label>Title</Label><input className="input" value={editing.title} maxLength={120} required onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
                <label className="block md:col-span-2"><Label>What respondents read</Label>
                  <textarea className="input min-h-[9rem]" value={editing.body} maxLength={4000} required placeholder="Who you are, what you collect (answers, a hashed IP address, device type), why, how long you keep it, and how to ask for it to be deleted." onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                </label>
                <label className="block md:col-span-2"><Label>Full privacy notice (optional)</Label><input className="input" type="url" placeholder="https://" value={editing.privacyUrl} onChange={(e) => setEditing({ ...editing, privacyUrl: e.target.value })} /></label>
                <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                  <Toggle checked={editing.enabled} onChange={(v) => setEditing({ ...editing, enabled: v })} label="Show this notice" />
                  <span className="text-xs text-muted">Changing the wording starts a new version; each respondent&apos;s agreed version is kept.</span>
                  <div className="ml-auto flex gap-2">
                    <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                    <button className="btn-primary" disabled={busy}>Save notice</button>
                  </div>
                </div>
              </form>
            )}
            {notices.length === 0 ? <p className="text-sm text-muted">No consent notices. Respondents go straight to the survey (or to the entry checks the project turns on).</p> : (
              <ul className="divide-y divide-line">
                {notices.map((n) => (
                  <li key={n.countryCode} className="flex flex-wrap items-start gap-3 py-3" data-notice={n.countryCode}>
                    <span className="chip w-12 justify-center bg-sunken font-mono text-ink">{n.countryCode}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{n.title} <span className="text-xs font-normal text-muted">· version {n.version}{n.countryCode === '*' ? ' · every other market' : ''}</span></div>
                      <p className="line-clamp-2 text-sm text-muted">{n.body}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Toggle checked={n.enabled} onChange={(v) => admin && toggle(n, v)} label={n.enabled ? 'On' : 'Off'} />
                      {admin && <button className="btn-ghost px-2.5 py-1 text-xs" aria-label={`Edit notice ${n.countryCode}`} onClick={() => { setIsNew(false); setEditing({ countryCode: n.countryCode, enabled: n.enabled, title: n.title, body: n.body, privacyUrl: n.privacyUrl ?? '' }); }}><Pencil className="h-3.5 w-3.5" /></button>}
                      {admin && <button className="btn-ghost px-2.5 py-1 text-xs text-bad" aria-label={`Delete notice ${n.countryCode}`} onClick={() => remove(n)}><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {admin && (
            <Section title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand" /> Access and erasure requests</span>}>
              <form onSubmit={search} className="flex flex-wrap items-end gap-3">
                <label className="block min-w-[14rem] flex-1"><Label>Respondent ID the panel uses</Label><input className="input font-mono" value={uid} onChange={(e) => setUid(e.target.value)} placeholder="e.g. 8f3a2c91" required /></label>
                <button className="btn-ghost" disabled={busy || !uid.trim()}><Search className="h-4 w-4" /> Find</button>
              </form>
              {found && (found.length === 0 ? <p className="mt-4 text-sm text-muted">No sessions with that ID (it may already be erased).</p> : (
                <>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead><tr><th className="th w-8" /><th className="th">Project</th><th className="th">Market · vendor</th><th className="th">Status</th><th className="th">Consent</th><th className="th">Started</th></tr></thead>
                      <tbody>
                        {found.map((r) => (
                          <tr key={r.id} className={clsx('border-t border-line', !picked.has(r.id) && 'opacity-60')}>
                            <td className="td"><input type="checkbox" aria-label={`Erase session in ${r.project.projectCode}`} checked={picked.has(r.id)} onChange={(e) => { const s = new Set(picked); if (e.target.checked) s.add(r.id); else s.delete(r.id); setPicked(s); }} /></td>
                            <td className="td"><div className="font-medium">{r.project.name}</div><div className="font-mono text-xs text-muted">{r.project.projectCode}{r.isTest ? ' · test' : ''}</div></td>
                            <td className="td">{r.countryCode} · {r.vendor}</td>
                            <td className="td"><OutcomeChip status={r.status} />{r.approval === 'PENDING' && <div className="mt-1 text-xs text-muted">Awaiting approval</div>}</td>
                            <td className="td text-xs">{r.consentAt ? `v${r.consentVersion}, ${when(r.consentAt)}` : '—'}</td>
                            <td className="td whitespace-nowrap text-xs text-muted">{when(r.startedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <p className="flex-1 text-xs text-muted">Erasing keeps each session&apos;s status and money for invoices, and removes everything that identifies the person. The respondent ID becomes “erased”, so the panel can send them again.</p>
                    <button className="btn-danger" disabled={busy || picked.size === 0} onClick={erase}><Eraser className="h-4 w-4" /> Erase {plural(picked.size, 'session')}</button>
                  </div>
                </>
              ))}
            </Section>
          )}
        </div>
      )}
    </>
  );
}
