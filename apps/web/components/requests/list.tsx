'use client';
import clsx from 'clsx';
import { MessagesSquare } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading } from '@/components/ui';
import { get } from '@/lib/api';
import { StatusPill } from './thread';
import { KIND_LABEL, PORTAL_STATUS_LABEL, RequestRow, RequestStatus, STATUS_LABEL } from './types';

const FILTERS: (RequestStatus | 'ALL')[] = ['OPEN', 'ANSWERED', 'CLOSED', 'ALL'];

/** Requests as a list with status filters. Staff see whose request it is; portals only their own. */
export function RequestList({ portal, initialStatus = 'ALL', projectId }: { portal: boolean; initialStatus?: RequestStatus | 'ALL'; projectId?: string }) {
  const [status, setStatus] = useState<RequestStatus | 'ALL'>(initialStatus);
  const [rows, setRows] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const base = portal ? '/portal/requests' : '/requests';
  const href = (id: string) => (portal ? `/portal/requests/${id}` : `/requests/${id}`);

  useEffect(() => {
    setRows(null);
    const q = new URLSearchParams();
    if (status !== 'ALL') q.set('status', status);
    if (projectId) q.set('projectId', projectId);
    get<RequestRow[]>(`${base}${q.size ? `?${q}` : ''}`).then(setRows).catch(setError);
  }, [base, status, projectId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={status === f} onClick={() => setStatus(f)} className={clsx('rounded-full px-3 py-1.5 text-sm', status === f ? 'bg-brand text-white' : 'text-muted hover:bg-sunken')}>
            {f === 'ALL' ? 'All' : (portal ? PORTAL_STATUS_LABEL : STATUS_LABEL)[f]}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>{status === 'OPEN' && !portal ? 'Nothing is waiting for an answer.' : 'No requests here.'}</Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={href(r.id)} className="flex flex-wrap items-start gap-3 p-4 hover:bg-sunken/50">
                <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted">{r.ref}</span>
                    <span className="break-words font-medium">{r.subject}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                    <span>{KIND_LABEL[r.kind]}{r.kind === 'DISPUTE' ? ` · ${r.disputedCompletes} complete${r.disputedCompletes === 1 ? '' : 's'}` : ''}</span>
                    {!portal && (r.client || r.vendor) && <span>{r.client ? `Client: ${r.client.name}` : `Vendor: ${r.vendor!.name}`}</span>}
                    {r.project && <span>{r.project.projectCode}</span>}
                    {!portal && <span>{r.assignee ? `Owner: ${r.assignee.name}` : 'No owner'}</span>}
                    <span>{r.messages} message{r.messages === 1 ? '' : 's'} · last {new Date(r.lastMessageAt).toLocaleString()}</span>
                  </div>
                </div>
                <StatusPill status={r.status} portal={portal} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
