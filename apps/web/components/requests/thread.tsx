'use client';
import clsx from 'clsx';
import { CheckCircle2, Lock, Paperclip, Send, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { ErrorBox, Loading, OutcomeChip, Section, Toggle } from '@/components/ui';
import { API_URL, ApiError, get, patch, post } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { flag } from '@/lib/countries';
import { FILE_ACCEPT, fileSize, KIND_LABEL, PORTAL_STATUS_LABEL, RequestFull, RequestStatus, STATUS_LABEL, STATUS_TONE } from './types';

export function StatusPill({ status, portal }: { status: RequestStatus; portal?: boolean }) {
  return <span className={clsx('chip', STATUS_TONE[status])}>{(portal ? PORTAL_STATUS_LABEL : STATUS_LABEL)[status]}</span>;
}

/** One request: the conversation, attachments, disputed completes and (for staff) status, owner and decisions. */
export function RequestThread({ id, portal }: { id: string; portal: boolean }) {
  const me = useMe();
  const editor = !portal && canEdit(me);
  const base = portal ? '/portal/requests' : '/requests';
  const fileBase = portal ? '/portal/files' : '/files';
  const [r, setR] = useState<RequestFull | null>(null);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [decisionNote, setDecisionNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => get<RequestFull>(`${base}/${id}`).then(setR).catch(setError), [base, id]);
  useEffect(() => {
    load();
    if (!portal) get<{ id: string; name: string }[]>('/users').then(setStaff).catch(() => {});
  }, [load, portal]);

  async function run(fn: () => Promise<RequestFull | unknown>) {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      if (out && typeof out === 'object' && 'messages' in (out as object)) setR(out as RequestFull);
      else await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const send = () =>
    run(async () => {
      const out = await post<RequestFull>(`${base}/${id}/messages`, portal ? { body } : { body, internal });
      setBody('');
      setInternal(false);
      return out;
    });

  async function attach(file: File) {
    await run(async () => {
      const form = new FormData();
      form.append('file', file);
      form.append('ticketId', id);
      const res = await fetch(`${API_URL}/api/v1${fileBase}`, { method: 'POST', credentials: 'include', body: form });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new ApiError(res.status, res.status === 413 ? 'Files can be up to 10 MB' : b?.message ?? 'Upload failed');
      }
    });
    if (fileInput.current) fileInput.current.value = '';
  }

  if (!r) return error ? <ErrorBox error={error} /> : <Loading />;
  const canWrite = portal || editor;
  const decidable = editor && r.kind === 'DISPUTE' && r.status !== 'CLOSED';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-4">
        <ErrorBox error={error} />
        <ol className="space-y-3" aria-label="Conversation">
          {r.messages.map((m) => {
            const mineSide = portal ? m.fromPortal : !m.fromPortal;
            return (
              <li key={m.id} className={clsx('rounded-lg border p-4', m.internal ? 'border-warn/40 bg-warn/5' : mineSide ? 'border-brand/20 bg-brand/5' : 'border-line bg-panel')}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <b className="text-ink">{m.author}</b>
                  {!portal && m.fromPortal && <span className="chip bg-sunken text-muted">{r.client ? 'client' : 'vendor'}</span>}
                  {m.internal && <span className="chip bg-warn/15 text-warn"><Lock className="h-3 w-3" /> Internal note</span>}
                  <span>{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <div className="whitespace-pre-wrap break-words text-sm">{m.body}</div>
              </li>
            );
          })}
        </ol>

        {canWrite && (
          <div className="card space-y-3 p-4">
            <textarea className="input min-h-[110px]" maxLength={10_000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={r.status === 'CLOSED' ? 'Writing again reopens this request' : 'Write a reply'} aria-label="Reply" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <input ref={fileInput} type="file" accept={FILE_ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} aria-label="Attach a file" />
                <button className="btn-ghost px-2.5 py-1.5 text-xs" disabled={busy} onClick={() => fileInput.current?.click()}><Paperclip className="h-3.5 w-3.5" /> Attach</button>
                {!portal && <label className="flex items-center gap-2 text-xs text-muted"><Toggle checked={internal} onChange={setInternal} label="Internal note" /> Internal note (not shown to the {r.client ? 'client' : 'vendor'})</label>}
              </div>
              <button className="btn-primary" disabled={busy || !body.trim()} onClick={send}><Send className="h-4 w-4" /> {internal ? 'Add note' : 'Send'}</button>
            </div>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <Section title="Details">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted">Status</dt><dd><StatusPill status={r.status} portal={portal} /></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Type</dt><dd>{KIND_LABEL[r.kind]}</dd></div>
            {!portal && (r.client || r.vendor) && (
              <div className="flex justify-between gap-3"><dt className="text-muted">{r.client ? 'Client' : 'Vendor'}</dt><dd className="text-right">{r.client ? r.client.name : <Link className="text-brand hover:underline" href={`/vendors/${r.vendor!.id}`}>{r.vendor!.name}</Link>}</dd></div>
            )}
            {r.project && (
              <div className="flex justify-between gap-3"><dt className="text-muted">Project</dt><dd className="text-right">{portal ? `${r.project.projectCode} · ${r.project.name}` : <Link className="text-brand hover:underline" href={`/projects/${r.project.id}`}>{r.project.projectCode}</Link>}</dd></div>
            )}
            <div className="flex justify-between gap-3"><dt className="text-muted">Opened by</dt><dd className="text-right">{r.createdBy}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Opened</dt><dd className="text-right">{new Date(r.createdAt).toLocaleDateString()}</dd></div>
          </dl>
          {editor && (
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <label className="block text-xs text-muted">
                Owner
                <select className="input mt-1" value={r.assignee?.id ?? ''} disabled={busy} onChange={(e) => run(() => patch(`${base}/${id}`, { assigneeId: e.target.value || null }))}>
                  <option value="">Nobody</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label className="block text-xs text-muted">
                Status
                <select className="input mt-1" value={r.status} disabled={busy} onChange={(e) => run(() => patch(`${base}/${id}`, { status: e.target.value }))}>
                  {(['OPEN', 'ANSWERED', 'CLOSED'] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </select>
              </label>
            </div>
          )}
          {portal && r.status !== 'CLOSED' && (
            <button className="btn-ghost mt-4 w-full justify-center text-xs" disabled={busy} onClick={() => run(() => post(`${base}/${id}/close`))}>Close this request</button>
          )}
        </Section>

        {r.sessions.length > 0 && (
          <Section title={`Disputed completes (${r.sessions.length})`}>
            <ul className="max-h-64 space-y-1.5 overflow-auto text-xs">
              {r.sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono">{flag(s.countryCode)} {s.uid}</span>
                  <span className="flex items-center gap-1">{s.invoiced && <span className="text-muted">invoiced</span>}<OutcomeChip status={s.approval === 'APPROVED' ? 'COMPLETE' : 'QUALITY_FAIL'} /></span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">{r.sessions.filter((s) => s.approval === 'APPROVED').length} approved · {r.sessions.filter((s) => s.approval === 'REJECTED').length} rejected</p>
            {decidable && (
              <div className="mt-3 space-y-2 border-t border-line pt-3">
                <textarea className="input min-h-[70px] text-xs" maxLength={5000} value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} placeholder="Message to the vendor (optional)" aria-label="Decision message" />
                <button className="btn-primary w-full justify-center" disabled={busy} onClick={() => run(() => post(`${base}/${id}/dispute`, { decision: 'APPROVE', message: decisionNote || undefined }))}><CheckCircle2 className="h-4 w-4" /> Approve these completes</button>
                <button className="btn-ghost w-full justify-center" disabled={busy} onClick={() => run(() => post(`${base}/${id}/dispute`, { decision: 'KEEP_REJECTED', message: decisionNote || undefined }))}><XCircle className="h-4 w-4" /> Keep them rejected</button>
                <p className="text-xs text-muted">Either way the request closes and the vendor sees your decision. Invoiced completes are not changed.</p>
              </div>
            )}
          </Section>
        )}

        <Section title={`Attachments (${r.files.length})`}>
          {r.files.length === 0 ? (
            <p className="text-xs text-muted">No attachments.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {r.files.map((f) => (
                <li key={f.id}>
                  <button className="text-left text-brand hover:underline" onClick={() => downloadFile(`${fileBase}/${f.id}/download`, f.name).catch(setError)}>{f.name}</button>
                  <span className="text-muted"> · {fileSize(f.size)} · {f.uploadedBy}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </aside>
    </div>
  );
}
