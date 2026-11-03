'use client';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Plus, Send } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { SecretOnce } from '@/components/settings/secret-once';
import { Empty, ErrorBox, Loading, Section, Toggle } from '@/components/ui';
import { api, get, patch, post } from '@/lib/api';

interface Endpoint { id: string; url: string; description: string | null; events: string[]; active: boolean; last7d: { delivered: number; pending: number; failed: number } }
interface List { events: { name: string; description: string }[]; endpoints: Endpoint[] }
interface Delivery { id: string; event: string; eventId: string; state: string; attempts: number; lastStatusCode: number | null; lastError: string | null; nextAttemptAt: string; deliveredAt: string | null; createdAt: string }

const STATE: Record<string, [string, string]> = {
  DELIVERED: ['Delivered', 'bg-ok/15 text-ok'],
  PENDING: ['Queued', 'bg-sunken text-muted'],
  SENDING: ['Sending', 'bg-sunken text-muted'],
  RETRY_SCHEDULED: ['Will retry', 'bg-warn/15 text-warn'],
  FAILED: ['Failed', 'bg-bad/15 text-bad'],
  DEAD_LETTER: ['Gave up', 'bg-bad/15 text-bad'],
  CANCELLED: ['Not sent', 'bg-sunken text-muted'],
};
const time = (d: string) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function Webhooks() {
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<string[]>(['session.completed']);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  const load = useCallback(() => get<List>('/webhooks').then(setList).catch(setError), []);
  useEffect(() => { load(); }, [load]);

  const run = async (f: () => Promise<unknown>) => {
    setError(null);
    try { await f(); } catch (e) { setError(e); }
  };
  async function create() {
    setBusy(true);
    await run(async () => {
      const e = await post<Endpoint & { secret: string }>('/webhooks', { url: url.trim(), events, ...(description.trim() ? { description: description.trim() } : {}) });
      setSecret(e.secret);
      setAdding(false);
      setUrl('');
      setDescription('');
      setEvents(['session.completed']);
      await load();
    });
    setBusy(false);
  }
  const test = (e: Endpoint) => run(async () => {
    setNote({ ...note, [e.id]: 'Sending…' });
    const r = await post<{ status: number; error?: string }>(`/webhooks/${e.id}/test`);
    setNote((n) => ({ ...n, [e.id]: r.status >= 200 && r.status < 300 ? `Test delivered (HTTP ${r.status})` : `Test failed: ${r.error ?? `HTTP ${r.status}`}` }));
  });
  const rotate = (e: Endpoint) => run(async () => {
    if (!confirm('Create a new signing secret? Deliveries are signed with the new one straight away, so update your receiver.')) return;
    setSecret((await post<{ secret: string }>(`/webhooks/${e.id}/rotate-secret`)).secret);
  });
  const remove = (e: Endpoint) => run(async () => {
    if (!confirm(`Delete the webhook to ${e.url} and its delivery log?`)) return;
    await api(`/webhooks/${e.id}`, { method: 'DELETE' });
    await load();
  });

  return (
    <Section title="Webhooks" actions={!adding ? <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add endpoint</button> : undefined}>
      <p className="mb-4 text-sm text-muted">PROJEXA sends a signed POST to your URL when something happens. Failed deliveries are retried up to 12 times with growing gaps, over about six hours. Check the <code className="font-mono text-xs">X-Projexa-Signature</code> header with your signing secret.</p>
      <ErrorBox error={error} />
      {secret && <SecretOnce title="Copy this signing secret into your receiver now. It will not be shown again." value={secret} onDone={() => setSecret(null)} />}
      {adding && list && (
        <div className="mb-5 rounded-lg border border-line p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label><span className="label">Endpoint URL</span><input className="input font-mono text-sm" autoFocus placeholder="https://example.com/hooks/projexa" maxLength={500} value={url} onChange={(e) => setUrl(e.target.value)} /></label>
            <label><span className="label">Description (optional)</span><input className="input" maxLength={120} placeholder="Ops dashboard" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          </div>
          <fieldset className="mt-4">
            <legend className="label">Events</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {list.events.map((ev) => (
                <label key={ev.name} className="flex items-start gap-2 rounded-md border border-line p-2.5 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={events.includes(ev.name)} onChange={(e) => setEvents(e.target.checked ? [...events, ev.name] : events.filter((x) => x !== ev.name))} />
                  <span><code className="font-mono text-xs">{ev.name}</code><span className="block text-xs text-muted">{ev.description}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 flex gap-2">
            <button className="btn-primary" disabled={busy || !url.trim() || !events.length} onClick={create}>Add endpoint</button>
            <button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
      {!list ? <Loading /> : list.endpoints.length === 0 ? <Empty>No webhook endpoints yet.</Empty> : (
        <ul className="space-y-3">
          {list.endpoints.map((e) => (
            <li key={e.id} className="rounded-lg border border-line">
              <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <code className="truncate font-mono text-sm">{e.url}</code>
                    {!e.active && <span className="chip shrink-0 bg-sunken text-muted">Off</span>}
                  </div>
                  {e.description && <div className="text-sm text-muted">{e.description}</div>}
                  <div className="mt-2 flex flex-wrap gap-1">{e.events.map((x) => <span key={x} className="chip bg-sunken font-mono text-[11px] text-muted">{x}</span>)}</div>
                  <div className="mt-2 text-xs text-muted">
                    Last 7 days: <span className="text-ok">{e.last7d.delivered} delivered</span>
                    {e.last7d.pending > 0 && <>, {e.last7d.pending} waiting</>}
                    {e.last7d.failed > 0 && <>, <span className="text-bad">{e.last7d.failed} failed</span></>}
                  </div>
                  {note[e.id] && <div className="mt-1 text-xs" role="status">{note[e.id]}</div>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Toggle checked={e.active} label="Endpoint on" onChange={(v) => run(async () => { await patch(`/webhooks/${e.id}`, { active: v }); await load(); })} />
                  <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => test(e)}><Send className="h-3.5 w-3.5" />Send test</button>
                  <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => rotate(e)}>New secret</button>
                  <button className="btn-ghost px-2.5 py-1 text-xs text-bad" onClick={() => remove(e)}>Delete</button>
                </div>
              </div>
              <button className="flex w-full items-center gap-1 border-t border-line px-4 py-2 text-left text-xs text-muted hover:bg-sunken/50" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                {open === e.id ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}Delivery log
              </button>
              {open === e.id && <Deliveries endpointId={e.id} onChange={load} />}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Deliveries({ endpointId, onChange }: { endpointId: string; onChange: () => void }) {
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => get<Delivery[]>(`/webhooks/${endpointId}/deliveries`).then(setRows).catch(setError), [endpointId]);
  useEffect(() => { load(); }, [load]);
  const replay = async (d: Delivery) => {
    setError(null);
    try { await post(`/webhooks/deliveries/${d.id}/replay`); await load(); onChange(); } catch (e) { setError(e); }
  };
  return (
    <div className="border-t border-line px-4 py-3">
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <p className="text-sm text-muted">Nothing sent yet.</p> : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[600px] text-sm">
            <thead><tr><th className="th">Event</th><th className="th">Result</th><th className="th text-right">Tries</th><th className="th">When</th><th className="th" /></tr></thead>
            <tbody>
              {rows.map((d) => {
                const [label, cls] = STATE[d.state] ?? [d.state, 'bg-sunken text-muted'];
                return (
                  <Fragment key={d.id}>
                    <tr className="border-t border-line">
                      <td className="td"><code className="font-mono text-xs">{d.event}</code></td>
                      <td className="td"><span className={clsx('chip', cls)}>{label}</span>{d.lastStatusCode ? <span className="ml-1.5 text-xs text-muted">HTTP {d.lastStatusCode}</span> : d.lastError ? <span className="ml-1.5 text-xs text-muted">{d.lastError}</span> : null}</td>
                      <td className="td text-right tabular-nums">{d.attempts}</td>
                      <td className="td whitespace-nowrap text-xs">{time(d.createdAt)}{d.state === 'RETRY_SCHEDULED' && <div className="text-muted">Next try {time(d.nextAttemptAt)}</div>}</td>
                      <td className="td text-right">{['FAILED', 'DEAD_LETTER', 'CANCELLED'].includes(d.state) && <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => replay(d)}>Send again</button>}</td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
