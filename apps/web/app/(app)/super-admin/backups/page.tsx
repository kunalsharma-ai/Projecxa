'use client';
import clsx from 'clsx';
import { AlertTriangle, CalendarClock, Check, CheckCircle2, DatabaseBackup, Download, HardDrive, History, KeyRound, Loader2, Lock, RefreshCw, Save, SearchCheck, ShieldCheck, Trash2, Undo2, X } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { Label } from '@/components/help';
import { ErrorBox, Field, Loading, PageHeader, Section, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { downloadFile } from '@/lib/download';

interface Backup {
  id: string; name: string; trigger: 'manual' | 'scheduled' | 'before_restore' | 'cli'; status: 'running' | 'ok' | 'failed'; target: string;
  sizeBytes: number | null; sha256: string | null; encrypted: boolean; migration: string | null; tables: number | null; durationMs: number | null; error: string | null;
  createdBy: string | null; lastVerifiedAt: string | null; lastVerifyOk: boolean | null; restoredAt: string | null; startedAt: string; finishedAt: string | null;
}
interface Settings { schedule: 'off' | 'daily' | 'weekly'; hour: number; weekday: number; keep: number; notifyOnFailure: boolean }
interface Restore { backupId: string; backupName: string; by: string; startedAt: string; finishedAt: string | null; state: 'running' | 'ok' | 'failed'; step: string; message: string | null; safetyBackup: string | null }
interface Data {
  settings: Settings; nextRunAt: string | null;
  storage: { configured: boolean; error: string | null; target: 'local' | 's3' | null; where: string | null; encrypted: boolean; source: 'app' | 'env' | null; lastTestOk: boolean | null; lastTestAt: string | null; lastTestMessage: string | null };
  tool: { ok: boolean; message: string }; database: { name: string | null; host: string | null };
  running: 'backup' | 'restore' | null; restore: Restore | null; lastOkAt: string | null; backups: Backup[]; restoreWord: string;
}

const TRIGGER: Record<Backup['trigger'], string> = { manual: 'One click', scheduled: 'Scheduled', before_restore: 'Safety copy before a restore', cli: 'Command line' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STEPS: { key: string; label: string }[] = [
  { key: 'safety_backup', label: 'Safety backup of the database as it is now' },
  { key: 'download', label: 'Fetch the backup and check its fingerprint' },
  { key: 'check', label: 'Decrypt and read it through' },
  { key: 'restore', label: 'Replace the database in one step' },
  { key: 'migrate', label: 'Apply newer database changes, if the backup is older' },
];

const size = (b: number | null) => (b === null ? '—' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : b < 1024 ** 3 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`);
const when = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
function ago(d: string | null) {
  if (!d) return 'Never';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (m < 2) return 'Just now';
  if (m < 90) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}
/** The UTC hour in the viewer's own time, e.g. "07:30 your time". */
const localHour = (h: number) => new Date(Date.UTC(2026, 0, 5, h)).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export default function BackupsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<ReactNode>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const load = useCallback(() => get<Data>('/super-admin/backups').then(setData).catch(setError), []);
  useEffect(() => { load(); }, [load]);
  // Follow a running backup or restore.
  const live = !!data && (!!data.running || data.backups.some((b) => b.status === 'running'));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [live, load]);

  if (!data) return error ? <ErrorBox error={error} /> : <Loading />;

  const act = async (key: string, fn: () => Promise<unknown>, done?: (r: unknown) => ReactNode) => {
    setBusy(key); setError(null); setNote(null);
    try { const r = await fn(); if (done) setNote(done(r)); await load(); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const ok = data.backups.filter((b) => b.status === 'ok');
  const total = ok.reduce((a, b) => a + (b.sizeBytes ?? 0), 0);
  const stale = !data.lastOkAt || Date.now() - new Date(data.lastOkAt).getTime() > 8 * 86_400_000;
  const r = data.restore;

  const Actions = ({ b }: { b: Backup }) => (
    <>
                      {b.status === 'ok' && (
                        <div className="flex flex-wrap gap-1.5 sm:justify-end">
                          <button className="btn-ghost h-8 px-2 text-xs" disabled={!!busy} title="Fetch it, check its fingerprint and read it through, without touching the database"
                            onClick={() => act(`v${b.id}`, () => post<{ ok: boolean; message: string }>(`/super-admin/backups/${b.id}/verify`), (x) => { const v = x as { ok: boolean; message: string }; if (!v.ok) throw new Error(v.message); return v.message; })}>
                            {busy === `v${b.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}Test
                          </button>
                          <button className="btn-ghost h-8 px-2 text-xs" disabled={!!busy} title={b.encrypted ? 'The encrypted file, as stored' : 'The backup file'}
                            onClick={() => act(`d${b.id}`, () => downloadFile(`/super-admin/backups/${b.id}/download`, b.name))}>
                            {busy === `d${b.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}Download
                          </button>
                          {b.encrypted && (
                            <button className="btn-ghost h-8 px-2 text-xs" disabled={!!busy} title="Decrypted, ready for pg_restore. Keep it safe: it is not encrypted."
                              onClick={() => act(`p${b.id}`, () => downloadFile(`/super-admin/backups/${b.id}/download?plain=1`, b.name.replace(/\.enc$/, '')))}>
                              <KeyRound className="h-3.5 w-3.5" />Plain
                            </button>
                          )}
                          <button className="btn-danger h-8 px-2 text-xs" disabled={!!busy || !!data.running} onClick={() => setRestoring(b)}><Undo2 className="h-3.5 w-3.5" />Restore</button>
                          <button className="btn-ghost h-8 px-2 text-xs text-bad" disabled={!!busy} aria-label={`Delete ${b.name}`}
                            onClick={() => { if (confirm(`Delete the backup from ${when(b.startedAt)}? The file is removed from the storage too.`)) act(`x${b.id}`, () => api(`/super-admin/backups/${b.id}`, { method: 'DELETE' }), () => 'Backup deleted.'); }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                      {b.status === 'failed' && (
                        <div className="flex justify-end">
                          <button className="btn-ghost h-8 px-2 text-xs" disabled={!!busy} onClick={() => act(`x${b.id}`, () => api(`/super-admin/backups/${b.id}`, { method: 'DELETE' }))}><Trash2 className="h-3.5 w-3.5" />Remove</button>
                        </div>
                      )}
    </>
  );

  return (
    <>
      <PageHeader title="Backups" subtitle="Copies of the whole SampTrek database: take one in one click, or let the schedule do it, and restore any of them if something goes wrong."
        actions={<>
          <button className="btn-ghost" disabled={!data.storage.configured || !!busy} onClick={() => act('rescan', () => post<{ message: string }>('/super-admin/backups/rescan'), (x) => (x as { message: string }).message)}>
            {busy === 'rescan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}Find backups in storage
          </button>
          <button className="btn-primary" disabled={!data.storage.configured || !data.tool.ok || !!data.running || !!busy} onClick={() => act('run', () => post('/super-admin/backups'), () => 'Backup started. It appears below when it is done.')}>
            {data.running === 'backup' || busy === 'run' ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}Back up now
          </button>
        </>} />
      <ErrorBox error={error} />
      {note && <div className="mb-4 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">{note}</div>}

      {!data.storage.configured && (
        <Callout tone="warn" icon={HardDrive} title="Choose where to keep backups first">
          {data.storage.error ?? 'Pick a folder on this server, or a free S3-compatible bucket (Cloudflare R2 and Backblaze B2 have 10 GB free).'}{' '}
          <Link className="font-medium underline" href="/settings/integrations#backup_storage">Set up backup storage</Link>
        </Callout>
      )}
      {!data.tool.ok && <Callout tone="bad" icon={AlertTriangle} title="pg_dump is missing on the server">{data.tool.message}</Callout>}
      {data.storage.configured && !data.storage.encrypted && (
        <Callout tone="warn" icon={Lock} title="Backups are not encrypted">
          Anyone who gets a backup file can read every client, vendor and respondent in it. <Link className="font-medium underline" href="/settings/integrations#backup_storage">Add an encryption passphrase</Link>.
        </Callout>
      )}
      {data.storage.target === 'local' && (
        <Callout tone="info" icon={HardDrive} title="Backups are on this same server">
          If the server is lost, they go with it. Download one now and then, or <Link className="font-medium underline" href="/settings/integrations#backup_storage">use a bucket</Link> to keep them somewhere else.
        </Callout>
      )}
      {r && <RestoreProgress r={r} onClose={r.state !== 'running' ? load : undefined} />}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={History} label="Last good backup" value={ago(data.lastOkAt)} sub={data.lastOkAt ? when(data.lastOkAt) : 'Take the first one now'} tone={stale ? 'warn' : undefined} />
        <Tile icon={CalendarClock} label="Schedule" value={data.settings.schedule === 'off' ? 'Off' : data.settings.schedule === 'daily' ? 'Every day' : `Every ${DAYS[data.settings.weekday]}`}
          sub={data.nextRunAt ? `Next: ${when(data.nextRunAt)}` : 'Only when you click Back up now'} tone={data.settings.schedule === 'off' ? 'warn' : undefined} />
        <Tile icon={HardDrive} label="Kept in" value={data.storage.target === 's3' ? 'Bucket' : data.storage.target === 'local' ? 'Server folder' : 'Not set up'}
          sub={<span className="flex min-w-0 items-center gap-1"><span className="min-w-0 truncate" title={data.storage.where ?? undefined}>{data.storage.where ?? '—'}</span>{data.storage.encrypted && <span className="chip shrink-0 bg-ok/15 text-ok"><Lock className="h-3 w-3" />Encrypted</span>}</span>} />
        <Tile icon={DatabaseBackup} label="Backups kept" value={`${ok.length} of ${data.settings.keep}`} sub={`${size(total)} in total`} />
      </div>

      <ScheduleForm key={JSON.stringify(data.settings)} value={data.settings} disabled={!data.storage.configured} onSaved={(d) => { setData(d); setNote('Schedule saved.'); }} onError={setError} />

      <Section title="All backups" className="mt-6">
        {data.backups.length === 0 ? <p className="text-sm text-muted">No backups yet. Press Back up now to take the first one.</p> : (
          <>
          <ul className="-mx-5 divide-y divide-line sm:hidden">
            {data.backups.map((b) => (
              <li key={b.id} className="space-y-2 px-5 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{when(b.startedAt)}</div>
                    <div className="text-xs text-muted">{TRIGGER[b.trigger] ?? b.trigger} · {size(b.sizeBytes)}{b.encrypted ? ' · encrypted' : ''}</div>
                    {b.restoredAt && <div className="text-xs text-info">Restored {when(b.restoredAt)}</div>}
                  </div>
                  {b.status === 'ok' && <span className="chip shrink-0 bg-ok/15 text-ok"><Check className="h-3 w-3" />Done</span>}
                  {b.status === 'running' && <span className="chip shrink-0 bg-info/15 text-info"><Loader2 className="h-3 w-3 animate-spin" />Running</span>}
                  {b.status === 'failed' && <span className="chip shrink-0 bg-bad/15 text-bad"><X className="h-3 w-3" />Failed</span>}
                </div>
                {b.error && <p className="text-xs text-bad">{b.error}</p>}
                <Actions b={b} />
              </li>
            ))}
          </ul>
          <div className="-mx-5 hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr><th className="th">Taken</th><th className="th">How</th><th className="th">Size</th><th className="th">Status</th><th className="th">Last test</th><th className="th text-right">Actions</th></tr></thead>
              <tbody>
                {data.backups.map((b) => (
                  <tr key={b.id} className="border-t border-line align-top">
                    <td className="td">
                      <div className="font-medium">{when(b.startedAt)}</div>
                      <div className="font-mono text-[11px] text-muted" title={b.sha256 ? `SHA-256 ${b.sha256}` : undefined}>{b.name}</div>
                      {b.restoredAt && <div className="mt-0.5 text-xs text-info"><Undo2 className="mr-1 inline h-3 w-3" />Restored {when(b.restoredAt)}</div>}
                    </td>
                    <td className="td">{TRIGGER[b.trigger] ?? b.trigger}<div className="text-xs text-muted">{b.createdBy ?? ''}</div></td>
                    <td className="td tabular-nums">{size(b.sizeBytes)}<div className="text-xs text-muted">{b.tables ? `${b.tables} tables` : ''}{b.encrypted ? ' · encrypted' : ''}</div></td>
                    <td className="td whitespace-normal">
                      {b.status === 'ok' && <span className="chip whitespace-nowrap bg-ok/15 text-ok"><Check className="h-3 w-3" />Done{b.durationMs ? ` in ${Math.max(1, Math.round(b.durationMs / 1000))}s` : ''}</span>}
                      {b.status === 'running' && <span className="chip bg-info/15 text-info"><Loader2 className="h-3 w-3 animate-spin" />Running</span>}
                      {b.status === 'failed' && <><span className="chip bg-bad/15 text-bad"><X className="h-3 w-3" />Failed</span><p className="mt-1 max-w-xs text-xs text-bad">{b.error}</p></>}
                    </td>
                    <td className="td">{b.lastVerifiedAt ? <span className={clsx('text-xs', b.lastVerifyOk ? 'text-ok' : 'text-bad')}>{b.lastVerifyOk ? 'Readable' : 'Problem'} · {ago(b.lastVerifiedAt)}</span> : <span className="text-xs text-muted">Not tested</span>}</td>
                    <td className="td">
                      <Actions b={b} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        <p className="mt-4 text-xs text-muted">
          Every backup is a full copy of the database ({data.database.name ?? 'unknown'}), made with PostgreSQL&apos;s own pg_dump. Each one has a fingerprint (SHA-256) and a small .json description next to it in the storage, so &quot;Find backups in storage&quot; can list them on a new server.
          If the app cannot start at all, restore a downloaded file on the server with <code className="rounded bg-sunken px-1">pnpm restore-backup --file &lt;file&gt;</code>.
        </p>
      </Section>

      {restoring && <RestoreDialog b={restoring} word={data.restoreWord} db={data.database.name} onClose={() => setRestoring(null)} onStarted={() => { setRestoring(null); load(); }} />}
    </>
  );
}

function Callout({ tone, icon: Icon, title, children }: { tone: 'warn' | 'bad' | 'info'; icon: typeof Lock; title: string; children: ReactNode }) {
  return (
    <div className={clsx('mb-4 flex gap-3 rounded-lg p-3 text-sm', tone === 'warn' && 'bg-warn/10 text-ink', tone === 'bad' && 'bg-bad/10 text-ink', tone === 'info' && 'bg-info/10 text-ink')}>
      <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad', tone === 'info' && 'text-info')} />
      <div><div className="font-medium">{title}</div><div className="text-muted">{children}</div></div>
    </div>
  );
}

function Tile({ icon: Icon, label, value, sub, tone }: { icon: typeof Lock; label: string; value: string; sub?: ReactNode; tone?: 'warn' }) {
  return (
    <div className="card min-w-0 p-4">
      <div className="flex items-center gap-2 text-xs text-muted"><Icon className="h-4 w-4" />{label}</div>
      <div className={clsx('mt-1 text-xl font-semibold', tone === 'warn' && 'text-warn')}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

function ScheduleForm({ value, disabled, onSaved, onError }: { value: Settings; disabled: boolean; onSaved: (d: Data) => void; onError: (e: unknown) => void }) {
  const [s, setS] = useState(value);
  const [saving, setSaving] = useState(false);
  const changed = JSON.stringify(s) !== JSON.stringify(value);
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try { onSaved(await api<Data>('/super-admin/backups/settings', { method: 'PUT', json: { schedule: s.schedule, hour: s.hour, weekday: s.weekday, keep: s.keep, notifyOnFailure: s.notifyOnFailure } })); } catch (err) { onError(err); } finally { setSaving(false); }
  }
  return (
    <Section title="Backup schedule">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Take a backup">
          <select className="input" value={s.schedule} disabled={disabled} onChange={(e) => setS({ ...s, schedule: e.target.value as Settings['schedule'] })}>
            <option value="off">Only when I click</option><option value="daily">Every day</option><option value="weekly">Every week</option>
          </select>
        </Field>
        {s.schedule === 'weekly' && (
          <Field label="On">
            <select className="input" value={s.weekday} onChange={(e) => setS({ ...s, weekday: Number(e.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
          </Field>
        )}
        {s.schedule !== 'off' && (
          <Field label="At (UTC)" hint={`${localHour(s.hour)} your time. Pick a quiet hour.`}>
            <select className="input" value={s.hour} onChange={(e) => setS({ ...s, hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00 UTC</option>)}</select>
          </Field>
        )}
        <Field label="Keep the newest" hint="Older ones are deleted after each new backup.">
          <input className="input" type="number" min={1} max={365} value={s.keep} onChange={(e) => setS({ ...s, keep: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })} />
        </Field>
        <div>
          <Label>Email me if a backup fails</Label>
          <div className="flex h-10 items-center"><Toggle checked={s.notifyOnFailure} onChange={(v) => setS({ ...s, notifyOnFailure: v })} label="Email me if a backup fails" /></div>
        </div>
        <div className="flex items-end sm:col-span-2 lg:col-span-5">
          <button className="btn-primary" disabled={!changed || saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save schedule</button>
        </div>
      </form>
    </Section>
  );
}

function RestoreDialog({ b, word, db, onClose, onStarted }: { b: Backup; word: string; db: string | null; onClose: () => void; onStarted: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await post(`/super-admin/backups/${b.id}/restore`, { confirm, password }); onStarted(); } catch (err) { setError(err); setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal aria-label="Restore this backup" onMouseDown={onClose}>
      <form className="card my-10 w-full max-w-lg p-5" onMouseDown={(e) => e.stopPropagation()} onSubmit={go}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-bad"><AlertTriangle className="h-5 w-5" />Restore this backup</h2>
          <button type="button" className="btn-ghost h-8 px-2" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <p className="text-sm">The whole database{db ? ` (${db})` : ''} goes back to <strong>{when(b.startedAt)}</strong>. Everything done in SampTrek since then, in every organisation, is replaced: projects, respondents, invoices, users and settings.</p>
        <ol className="my-4 space-y-1.5 text-sm text-muted">
          {STEPS.map((s, i) => <li key={s.key} className="flex gap-2"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunken text-[11px] font-semibold text-ink">{i + 1}</span>{s.label}</li>)}
        </ol>
        <p className="mb-4 rounded-lg bg-info/10 p-3 text-xs text-ink">It runs in one transaction, so it either works completely or changes nothing. The safety backup from step 1 lets you undo it. People stay signed in if their account exists in the backup.</p>
        <ErrorBox error={error} />
        <div className="space-y-3">
          <Field label={`Type ${word} to confirm`}>
            <input className="input font-mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" autoFocus placeholder={word} />
          </Field>
          <Field label="Your password">
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-danger" disabled={busy || confirm.trim() !== word || !password}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}Restore the database</button>
        </div>
      </form>
    </div>
  );
}

function RestoreProgress({ r, onClose }: { r: Restore; onClose?: () => void }) {
  const at = STEPS.findIndex((s) => s.key === r.step);
  return (
    <div className={clsx('card mb-6 p-4', r.state === 'failed' && 'border-bad/50', r.state === 'ok' && 'border-ok/50')} role="status" aria-live="polite">
      <div className="flex items-center gap-2 font-medium">
        {r.state === 'running' && <><Loader2 className="h-4 w-4 animate-spin text-info" />Restoring {r.backupName}…</>}
        {r.state === 'ok' && <><CheckCircle2 className="h-4 w-4 text-ok" />Database restored</>}
        {r.state === 'failed' && <><AlertTriangle className="h-4 w-4 text-bad" />The restore did not run</>}
        {onClose && <button className="btn-ghost ml-auto h-7 px-2 text-xs" onClick={onClose}><RefreshCw className="h-3.5 w-3.5" />Refresh</button>}
      </div>
      {r.state === 'running' && (
        <ol className="mt-3 space-y-1 text-sm">
          {STEPS.map((s, i) => (
            <li key={s.key} className={clsx('flex items-center gap-2', i < at ? 'text-ok' : i === at ? 'text-ink' : 'text-muted')}>
              {i < at ? <Check className="h-4 w-4" /> : i === at ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="h-4 w-4" />}{s.label}
            </li>
          ))}
        </ol>
      )}
      {r.message && <p className={clsx('mt-2 text-sm', r.state === 'failed' ? 'text-bad' : 'text-muted')}>{r.message}</p>}
      <p className="mt-1 text-xs text-muted">Started by {r.by}, {when(r.startedAt)}.</p>
    </div>
  );
}
