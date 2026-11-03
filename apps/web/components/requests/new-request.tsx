'use client';
import { Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Empty, ErrorBox, Field } from '@/components/ui';
import { get, post } from '@/lib/api';
import { flag } from '@/lib/countries';
import { RequestFull, RequestKind } from './types';

interface Disputable { id: string; uid: string; rejectedAt: string | null; countryCode: string; project: { id: string; projectCode: string; name: string } }

/**
 * Opens a request. Portals: a question or issue, optionally about one of their projects; vendors can also
 * dispute rejected completes. Staff: a message to one client or vendor.
 */
export function NewRequestForm({ mode, onCreated, initialKind }: { mode: 'client' | 'vendor' | 'staff'; onCreated: (r: RequestFull) => void; initialKind?: RequestKind }) {
  const [kind, setKind] = useState<RequestKind>(initialKind ?? 'QUESTION');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [projectId, setProjectId] = useState('');
  const [target, setTarget] = useState('');
  const [projects, setProjects] = useState<{ id: string; label: string }[]>([]);
  const [targets, setTargets] = useState<{ value: string; label: string }[]>([]);
  const [disputable, setDisputable] = useState<Disputable[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode === 'client') get<{ id: string; projectCode: string; name: string }[]>('/portal/client/projects').then((r) => setProjects(r.map((p) => ({ id: p.id, label: `${p.projectCode} · ${p.name}` })))).catch(() => {});
    if (mode === 'vendor') {
      get<{ project: { id: string; projectCode: string; name: string } }[]>('/portal/vendor/allocations')
        .then((r) => setProjects([...new Map(r.map((a) => [a.project.id, { id: a.project.id, label: `${a.project.projectCode} · ${a.project.name}` }])).values()]))
        .catch(() => {});
      get<Disputable[]>('/portal/vendor/disputable').then(setDisputable).catch(() => setDisputable([]));
    }
    if (mode === 'staff') {
      Promise.all([get<{ id: string; name: string }[]>('/clients'), get<{ id: string; name: string }[]>('/vendors')])
        .then(([c, v]) => setTargets([...c.map((x) => ({ value: `client:${x.id}`, label: `Client · ${x.name}` })), ...v.map((x) => ({ value: `vendor:${x.id}`, label: `Vendor · ${x.name}` }))]))
        .catch(setError);
    }
  }, [mode]);

  const dispute = kind === 'DISPUTE';
  const shown = useMemo(() => (disputable ?? []).filter((d) => !projectId || d.project.id === projectId), [disputable, projectId]);
  const pickedProjects = new Set((disputable ?? []).filter((d) => picked.has(d.id)).map((d) => d.project.id));

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const [tk, tid] = target.split(':');
      const r = await post<RequestFull>(mode === 'staff' ? '/requests' : '/portal/requests', {
        subject,
        body,
        kind,
        ...(projectId && !dispute ? { projectId } : {}),
        ...(dispute ? { sessionIds: [...picked] } : {}),
        ...(mode === 'staff' ? (tk === 'client' ? { clientId: tid } : { vendorId: tid }) : {}),
      });
      onCreated(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const valid = subject.trim().length >= 3 && body.trim() && (mode !== 'staff' || target) && (!dispute || (picked.size > 0 && pickedProjects.size === 1));

  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {mode === 'staff' ? (
          <Field label="To">
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a client or vendor</option>
              {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="What is it about?">
            <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as RequestKind); setPicked(new Set()); }}>
              <option value="QUESTION">A question or change request</option>
              <option value="ISSUE">Something is not working</option>
              {mode === 'vendor' && <option value="DISPUTE">Dispute rejected completes</option>}
            </select>
          </Field>
        )}
        {mode !== 'staff' && projects.length > 0 && (
          <Field label={dispute ? 'Show completes from' : 'Project (optional)'}>
            <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">{dispute ? 'All projects' : 'Not about one project'}</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
        )}
      </div>

      {dispute && (
        <div className="rounded-lg border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken/60 px-3 py-2 text-xs">
            <span><b>{picked.size}</b> selected · rejected completes that are not invoiced or already disputed</span>
            {shown.length > 0 && <button className="text-brand hover:underline" onClick={() => setPicked(new Set(shown.map((d) => d.id)))}>Select all shown</button>}
          </div>
          {disputable === null ? null : shown.length === 0 ? (
            <div className="p-3"><Empty>No rejected completes to dispute.</Empty></div>
          ) : (
            <ul className="max-h-64 divide-y divide-line overflow-auto text-sm">
              {shown.map((d) => (
                <li key={d.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-sunken/50">
                    <input type="checkbox" checked={picked.has(d.id)} onChange={() => toggle(d.id)} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{d.uid}</span>
                    <span className="text-xs text-muted">{flag(d.countryCode)} {d.project.projectCode}</span>
                    <span className="hidden text-xs text-muted sm:inline">{d.rejectedAt ? `rejected ${new Date(d.rejectedAt).toLocaleDateString()}` : ''}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {pickedProjects.size > 1 && <p className="border-t border-line px-3 py-2 text-xs text-bad">Dispute completes from one project at a time.</p>}
        </div>
      )}

      <Field label="Subject"><input className="input" maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={dispute ? 'e.g. 14 completes rejected in error' : 'e.g. Can we extend fieldwork to Friday?'} /></Field>
      <Field label="Message"><textarea className="input min-h-[140px]" maxLength={10_000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={dispute ? 'Why should these be approved? Add evidence such as QC checks.' : 'Tell us what you need.'} /></Field>
      <div className="flex justify-end">
        <button className="btn-primary" disabled={busy || !valid} onClick={submit}><Send className="h-4 w-4" /> {dispute ? 'Send dispute' : 'Send request'}</button>
      </div>
    </div>
  );
}
