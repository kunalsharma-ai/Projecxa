'use client';
import clsx from 'clsx';
import { Download, FileText, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, ErrorBox, Field, Loading } from '@/components/ui';
import { API_URL, ApiError, api, get } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { FILE_ACCEPT, FILE_KIND_LABEL, FileKind, fileSize, SharedFile } from './types';

export interface Audience { value: string; label: string; clientId?: string; vendorId?: string }

/**
 * Lists shared files and uploads new ones. Staff use `/files`, portals `/portal/files`; the API decides
 * what each person may see, so this component only passes filters through.
 */
export function FilesPanel({
  portal,
  query,
  kinds,
  audiences,
  projects,
  fixed,
  canUpload = true,
  canDelete,
  showProject = false,
  showSharedWith = false,
  empty = 'No files yet.',
}: {
  portal: boolean;
  /** Filters for the list, e.g. { projectId } or { vendorId, kind: 'COMPLIANCE' }. */
  query: Record<string, string | undefined>;
  /** Kinds this person may upload; the first is the default. */
  kinds: FileKind[];
  /** Staff only: who the file is shared with. */
  audiences?: Audience[];
  /** Optional project picker for the upload. */
  projects?: { id: string; label: string }[];
  /** Fields always sent with an upload (e.g. projectId or vendorId). */
  fixed?: Record<string, string>;
  canUpload?: boolean;
  canDelete?: (f: SharedFile) => boolean;
  showProject?: boolean;
  showSharedWith?: boolean;
  empty?: string;
}) {
  const base = portal ? '/portal/files' : '/files';
  const [files, setFiles] = useState<SharedFile[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<FileKind>(kinds[0]);
  const [audience, setAudience] = useState(audiences?.[0]?.value ?? '');
  const [projectId, setProjectId] = useState('');
  const [note, setNote] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const qs = new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => !!e[1])).toString();

  const load = useCallback(() => get<SharedFile[]>(`${base}${qs ? `?${qs}` : ''}`).then(setFiles).catch(setError), [base, qs]);
  useEffect(() => {
    load();
  }, [load]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      for (const [k, v] of Object.entries(fixed ?? {})) form.append(k, v);
      const a = audiences?.find((x) => x.value === audience);
      if (a?.clientId) form.append('clientId', a.clientId);
      if (a?.vendorId) form.append('vendorId', a.vendorId);
      if (projectId) form.append('projectId', projectId);
      if (note.trim()) form.append('note', note.trim());
      if (kind === 'COMPLIANCE' && expiresAt) form.append('expiresAt', new Date(`${expiresAt}T23:59:59`).toISOString());
      const res = await fetch(`${API_URL}/api/v1${base}`, { method: 'POST', credentials: 'include', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, res.status === 413 ? 'Files can be up to 10 MB' : body?.message ?? `Upload failed (${res.status})`);
      }
      setNote('');
      setExpiresAt('');
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove(f: SharedFile) {
    if (!confirm(`Remove ${f.name}?`)) return;
    try {
      await api(`${base}/${f.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      {canUpload && (
        <div className="grid grid-cols-1 gap-3 rounded-lg bg-sunken/60 p-4 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {kinds.length > 1 && (
            <Field label="Type">
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>
                {kinds.map((k) => <option key={k} value={k}>{FILE_KIND_LABEL[k]}</option>)}
              </select>
            </Field>
          )}
          {audiences && audiences.length > 0 && (
            <Field label="Shared with">
              <select className="input" value={audience} onChange={(e) => setAudience(e.target.value)}>
                {audiences.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </Field>
          )}
          {projects && projects.length > 0 && (
            <Field label="Project">
              <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">None</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
          )}
          {kind === 'COMPLIANCE' && (
            <Field label="Valid until">
              <input type="date" className="input" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </Field>
          )}
          <Field label="Note (optional)">
            <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Final version" />
          </Field>
          <div className="flex items-end">
            <input ref={input} type="file" accept={FILE_ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} aria-label="Choose a file" />
            <button className="btn-primary w-full justify-center" disabled={busy} onClick={() => input.current?.click()}>
              <Upload className="h-4 w-4" /> {busy ? 'Uploading…' : 'Upload a file'}
            </button>
          </div>
          <p className="text-xs text-muted sm:col-span-full">PDF, Word, Excel, PowerPoint, CSV, text, PNG, JPEG, ZIP or SPSS, up to 10 MB.</p>
        </div>
      )}
      {!files ? (
        <Loading />
      ) : files.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 p-3">
              <FileText className="h-5 w-5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-medium">{f.name}</div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted">
                  <span className="chip bg-sunken text-muted">{FILE_KIND_LABEL[f.kind]}</span>
                  <span>{fileSize(f.size)}</span>
                  <span>{f.uploadedBy}{f.fromPortal && !portal ? ' (portal)' : ''} · {new Date(f.createdAt).toLocaleDateString()}</span>
                  {showProject && f.project && <span>{f.project.projectCode}</span>}
                  {showSharedWith && <span>{f.sharedWith ? `Shared with ${f.sharedWith.name}` : 'Staff only'}</span>}
                  {f.expiresAt && <span className={clsx(f.expired ? 'text-bad' : new Date(f.expiresAt).getTime() - Date.now() < 30 * 86_400_000 ? 'text-warn' : '')}>{f.expired ? 'Expired' : 'Valid until'} {new Date(f.expiresAt).toLocaleDateString()}</span>}
                </div>
                {f.note && <div className="mt-0.5 text-xs">{f.note}</div>}
              </div>
              <div className="flex gap-1">
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => downloadFile(`${base}/${f.id}/download`, f.name).catch(setError)} aria-label={`Download ${f.name}`}><Download className="h-3.5 w-3.5" /> Download</button>
                {canDelete?.(f) && <button className="btn-ghost p-1.5" onClick={() => remove(f)} aria-label={`Remove ${f.name}`}><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
