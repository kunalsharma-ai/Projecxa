'use client';
import { History, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading } from '@/components/ui';
import { get, post } from '@/lib/api';
import type { ProjectDetail } from './types';

interface Change { field: string; label: string; before: string | null; after: string | null }
interface Version { id: string; version: number; createdAt: string; actor: string | null; reason: string | null; changes: Change[] }

const when = (d: string) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Every saved state of the project's settings, newest first, with what changed and a restore. */
export function HistoryTab({ project, editable, reload }: { project: ProjectDetail; editable: boolean; reload: () => void }) {
  const [rows, setRows] = useState<Version[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => get<Version[]>(`/projects/${project.id}/history`).then(setRows).catch(setError), [project.id]);
  useEffect(() => {
    load();
  }, [load]);

  async function restore(v: Version) {
    const reason = prompt(`Restore the settings of version ${v.version}? Status, vendors, quotas and redirects stay as they are; the restore is saved as a new version.\n\nReason (optional):`);
    if (reason === null) return;
    setBusy(v.version);
    setError(null);
    setDone(null);
    try {
      const r = await post<{ restoredVersion: number | null }>(`/projects/${project.id}/history/${v.version}/restore`, reason.trim() ? { reason: reason.trim() } : {});
      setDone(r.restoredVersion ? `Settings from version ${v.version} restored as version ${r.restoredVersion}.` : `The settings already match version ${v.version}.`);
      await load();
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  if (!rows) return error ? <ErrorBox error={error} /> : <Loading />;
  if (!rows.length) return <Empty>No settings changes recorded yet. Every change from now on is kept here.</Empty>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Each change to the project&apos;s settings, markets, gate and prescreener questions, respondent pages and autopilot is kept as a version. Restoring puts those settings back; status, vendors, quotas and redirects (which have their own versions) are not changed.</p>
      <ErrorBox error={error} />
      {done && <div className="rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm" role="status">{done}</div>}
      <ol className="space-y-3">
        {rows.map((v, i) => (
          <li key={v.id} className="card p-4" data-version={v.version}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 font-semibold"><History className="h-4 w-4 text-muted" /> Version {v.version}</span>
              {i === 0 && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">Current</span>}
              <span className="text-sm text-muted">{when(v.createdAt)}{v.actor ? ` · ${v.actor}` : ''}</span>
              {editable && i > 0 && (
                <button className="btn-ghost ml-auto h-8 px-2.5 text-xs" disabled={busy !== null} onClick={() => restore(v)}>
                  <RotateCcw className="h-3.5 w-3.5" /> {busy === v.version ? 'Restoring…' : 'Restore'}
                </button>
              )}
            </div>
            {v.reason && <div className="mt-1 text-sm">{v.reason}</div>}
            {v.changes.length > 0 && (
              <div className="-mx-4 mt-3">
                <table className="w-full table-fixed text-sm">
                  <thead className="border-y border-line bg-sunken/60"><tr><th className="th w-[34%]">Setting</th><th className="th w-[33%]">Before</th><th className="th w-[33%]">After</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {v.changes.map((c) => (
                      <tr key={c.field}>
                        <td className="td whitespace-normal break-words font-medium">{c.label}</td>
                        <td className="td whitespace-normal break-words text-muted">{c.before ?? <span className="italic">empty</span>}</td>
                        <td className="td whitespace-normal break-words">{c.after ?? <span className="italic text-muted">empty</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
