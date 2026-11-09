'use client';
import clsx from 'clsx';
import { ExternalLink, Loader2, Megaphone, RefreshCw, Save, Trash2 } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CopyIcon } from '@/components/copy';
import { Label } from '@/components/help';
import { IMPACT_LABEL, STATE_LABEL, StatusBoard, type Incident, type StatusPage } from '@/components/status/status-board';
import { ErrorBox, Field, Loading, PageHeader, Section, Toggle } from '@/components/ui';
import { API_URL, api, get, post } from '@/lib/api';

interface Settings { enabled: boolean; title: string; intro: string; components: string[] }
interface Data {
  settings: Settings; catalog: { key: string; label: string; description: string }[]; page: StatusPage; incidents: Incident[];
  lastCheck: { at: string; components: Record<string, string>; dbLatencyMs: number | null } | null;
}
const STATES: Record<Incident['impact'], string[]> = {
  minor: ['investigating', 'identified', 'monitoring', 'resolved'],
  major: ['investigating', 'identified', 'monitoring', 'resolved'],
  maintenance: ['scheduled', 'in_progress', 'completed'],
};
const CLOSED = ['resolved', 'completed'];
const fmt = (d: string) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** A Date → the value of a datetime-local input, in the viewer's time. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export default function StatusAdminPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const load = useCallback(() => get<Data>('/super-admin/status').then(setData).catch(setError), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return error ? <ErrorBox error={error} /> : <Loading />;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const pageUrl = `${origin}/status`;
  const pingUrl = `${API_URL}/api/v1/public/status/ping`;
  const open = data.incidents.filter((i) => !CLOSED.includes(i.state));
  const closed = data.incidents.filter((i) => CLOSED.includes(i.state));

  return (
    <>
      <PageHeader title="Status page" subtitle="A public page that shows whether SampTrek is working, the last 90 days of uptime, and any incident or planned maintenance you post."
        actions={<>
          <button className="btn-ghost" disabled={checking} onClick={async () => { setChecking(true); try { setData(await post<Data>('/super-admin/status/check')); } catch (e) { setError(e); } finally { setChecking(false); } }}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Check now
          </button>
          <a className="btn-primary" href="/status" target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Open the page</a>
        </>} />
      <ErrorBox error={error} />
      {note && <div className="mb-4 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">{note}</div>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-6">
          <PageSettings data={data} onSaved={(d) => { setData(d); setNote('Status page saved.'); }} onError={setError} />

          <Section title="Links to share">
            <div className="space-y-3 text-sm">
              <div>
                <Label>Status page</Label>
                <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-sunken px-2 py-1.5 text-xs">{pageUrl}</code><CopyIcon text={pageUrl} label="status page address" /></div>
                <p className="mt-1 text-xs text-muted">Put it in your email footer, vendor onboarding and the client portal. Anyone can open it without signing in.</p>
              </div>
              <div>
                <Label>Uptime monitor address</Label>
                <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-sunken px-2 py-1.5 text-xs">{pingUrl}</code><CopyIcon text={pingUrl} label="monitor address" /></div>
                <p className="mt-1 text-xs text-muted">Answers 200 when the API and database work, 503 when the database does not. Add it to a free outside monitor (UptimeRobot, Better Stack) to be told by email or SMS even when this server is completely off.</p>
              </div>
              {data.lastCheck && (
                <p className="text-xs text-muted">Last self-check {fmt(data.lastCheck.at)}: {Object.entries(data.lastCheck.components).map(([k, v]) => `${data.catalog.find((c) => c.key === k)?.label ?? k} ${v}`).join(', ')}{data.lastCheck.dbLatencyMs !== null ? ` (database ${data.lastCheck.dbLatencyMs} ms)` : ''}.</p>
              )}
            </div>
          </Section>

          <NewIncident catalog={data.catalog} onCreated={() => { setNote('Posted on the status page.'); load(); }} onError={setError} />

          <Section title={`Open incidents and maintenance (${open.length})`}>
            {open.length === 0 ? <p className="text-sm text-muted">Nothing open. Post an incident when something is wrong, or announce maintenance ahead of time.</p>
              : <div className="space-y-4">{open.map((i) => <IncidentEditor key={i.id} i={i} onChanged={load} onError={setError} />)}</div>}
          </Section>

          {closed.length > 0 && (
            <Section title="Closed">
              <ul className="divide-y divide-line text-sm">
                {closed.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1"><div className="truncate font-medium">{i.title}</div><div className="text-xs text-muted">{IMPACT_LABEL[i.impact]} · {STATE_LABEL[i.state]} {i.resolvedAt ? fmt(i.resolvedAt) : ''}</div></div>
                    <button className="btn-ghost h-8 px-2 text-xs text-bad" aria-label={`Delete ${i.title}`} onClick={async () => { if (!confirm('Delete this incident from the status page?')) return; try { await api(`/super-admin/status/incidents/${i.id}`, { method: 'DELETE' }); load(); } catch (e) { setError(e); } }}><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <Section title="Preview" actions={!data.settings.enabled ? <span className="chip bg-warn/15 text-warn">Not published</span> : <span className="chip bg-ok/15 text-ok">Live at /status</span>}>
          <StatusBoard page={data.page} showDays={60} />
        </Section>
      </div>
    </>
  );
}

function PageSettings({ data, onSaved, onError }: { data: Data; onSaved: (d: Data) => void; onError: (e: unknown) => void }) {
  const [s, setS] = useState(data.settings);
  const [saving, setSaving] = useState(false);
  const changed = JSON.stringify(s) !== JSON.stringify(data.settings);
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try { onSaved(await api<Data>('/super-admin/status/settings', { method: 'PUT', json: s })); } catch (err) { onError(err); } finally { setSaving(false); }
  }
  return (
    <Section title="Page settings">
      <form onSubmit={save} className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div><div className="text-sm font-medium">Publish the status page</div><div className="text-xs text-muted">Off: /status says it is not published. Checks keep running either way.</div></div>
          <Toggle checked={s.enabled} onChange={(v) => setS({ ...s, enabled: v })} label="Publish the status page" />
        </div>
        <Field label="Page title"><input className="input" value={s.title} maxLength={80} onChange={(e) => setS({ ...s, title: e.target.value })} /></Field>
        <Field label="Introduction"><textarea className="input min-h-[60px]" value={s.intro} maxLength={400} onChange={(e) => setS({ ...s, intro: e.target.value })} /></Field>
        <div>
          <Label>Parts to show</Label>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.catalog.map((c) => (
              <label key={c.key} className="flex items-start gap-2 rounded-lg border border-line p-2 text-sm">
                <input type="checkbox" className="mt-0.5" checked={s.components.includes(c.key)} onChange={(e) => setS({ ...s, components: e.target.checked ? data.catalog.map((x) => x.key).filter((k) => k === c.key || s.components.includes(k)) : s.components.filter((k) => k !== c.key) })} />
                <span><span className="font-medium">{c.label}</span><span className="block text-xs text-muted">{c.description}</span></span>
              </label>
            ))}
          </div>
        </div>
        <button className="btn-primary" disabled={!changed || saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</button>
      </form>
    </Section>
  );
}

function NewIncident({ catalog, onCreated, onError }: { catalog: Data['catalog']; onCreated: () => void; onError: (e: unknown) => void }) {
  const blank = { title: '', impact: 'minor' as Incident['impact'], components: [] as string[], message: '', startsAt: '', endsAt: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const maintenance = f.impact === 'maintenance';
  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/super-admin/status/incidents', {
        title: f.title, impact: f.impact, components: f.components, message: f.message,
        ...(f.startsAt ? { startsAt: new Date(f.startsAt).toISOString() } : {}), ...(f.endsAt ? { endsAt: new Date(f.endsAt).toISOString() } : {}),
      });
      setF(blank);
      onCreated();
    } catch (err) { onError(err); } finally { setBusy(false); }
  }
  return (
    <Section title="Post an incident or maintenance">
      <form onSubmit={go} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What happened">
            <input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={maintenance ? 'Database upgrade' : 'Respondent links are slow'} required minLength={3} maxLength={160} />
          </Field>
          <Field label="Impact">
            <select className="input" value={f.impact} onChange={(e) => setF({ ...f, impact: e.target.value as Incident['impact'], startsAt: e.target.value === 'maintenance' && !f.startsAt ? localInput(new Date(Date.now() + 86_400_000)) : f.startsAt })}>
              {(Object.keys(IMPACT_LABEL) as Incident['impact'][]).map((k) => <option key={k} value={k}>{IMPACT_LABEL[k]}</option>)}
            </select>
          </Field>
        </div>
        {maintenance && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts"><input className="input" type="datetime-local" value={f.startsAt} onChange={(e) => setF({ ...f, startsAt: e.target.value })} required /></Field>
            <Field label="Ends (optional)"><input className="input" type="datetime-local" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
          </div>
        )}
        <div>
          <Label>Affects</Label>
          <div className="flex flex-wrap gap-2">
            {catalog.map((c) => {
              const on = f.components.includes(c.key);
              return <button type="button" key={c.key} aria-pressed={on} onClick={() => setF({ ...f, components: on ? f.components.filter((k) => k !== c.key) : [...f.components, c.key] })}
                className={clsx('chip border', on ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted')}>{c.label}</button>;
            })}
          </div>
        </div>
        <Field label="Message for people" hint="Plain words: what is affected, what you are doing, when you expect it fixed.">
          <textarea className="input min-h-[70px]" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} required maxLength={4000} />
        </Field>
        <button className="btn-primary" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}Post on the status page</button>
      </form>
    </Section>
  );
}

function IncidentEditor({ i, onChanged, onError }: { i: Incident; onChanged: () => void; onError: (e: unknown) => void }) {
  const states = STATES[i.impact];
  const [state, setState] = useState(i.state);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await api(`/super-admin/status/incidents/${i.id}`, { method: 'PATCH', json: { state, ...(message.trim() ? { message } : {}) } }); setMessage(''); onChanged(); } catch (err) { onError(err); } finally { setBusy(false); }
  }
  const last = i.updates[i.updates.length - 1];
  return (
    <form onSubmit={go} className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1 font-medium">{i.title}</div>
        <span className="chip bg-sunken text-muted">{IMPACT_LABEL[i.impact]}</span>
      </div>
      {last && <p className="mt-1 text-xs text-muted">Last update {fmt(last.at)}: {last.message}</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
        <select className="input" value={state} onChange={(e) => setState(e.target.value)} aria-label="State">{states.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}</select>
        <input className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add an update (optional)" maxLength={4000} aria-label="Update" />
      </div>
      <div className="mt-2 flex justify-end"><button className="btn-ghost h-8 px-3 text-xs" disabled={busy || (state === i.state && !message.trim())}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Post update</button></div>
    </form>
  );
}
