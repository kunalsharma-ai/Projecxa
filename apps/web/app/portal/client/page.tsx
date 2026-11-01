'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHeader, Progress, StatusChip } from '@/components/ui';
import { get } from '@/lib/api';
import { flag } from '@/lib/countries';

interface Row {
  id: string; projectCode: string; workOrderNo: string | null; name: string; status: string; category: string; createdAt: string;
  countries: string[]; targetCompletes: number; completes: number; pendingApprovals: number;
}

export default function ClientPortal() {
  const [summary, setSummary] = useState<{ client: { name: string }; pendingApprovals: number } | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    get<typeof summary>('/portal/client/summary').then(setSummary).catch(setError);
    get<Row[]>('/portal/client/projects').then(setRows).catch(setError);
  }, []);

  if (error) return <ErrorBox error={error} />;
  if (!summary || !rows) return <Loading />;

  return (
    <>
      <PageHeader
        title={summary.client.name}
        subtitle={summary.pendingApprovals ? `${summary.pendingApprovals} completes are waiting for your approval.` : 'Live progress on your projects.'}
      />
      {rows.length === 0 ? (
        <Empty>No projects to show yet.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {rows.map((p) => (
            <Link key={p.id} href={`/portal/client/projects/${p.id}`} className="card block p-5 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <StatusChip status={p.status} />
                  <h2 className="mt-2 truncate font-semibold">{p.name}</h2>
                  <p className="text-sm text-muted">{p.projectCode}{p.workOrderNo ? ` · ${p.workOrderNo}` : ''} · {p.category}</p>
                </div>
                <Progress value={p.completes} max={p.targetCompletes} />
              </div>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="text-base leading-none" title={p.countries.join(', ')}>{p.countries.map(flag).join(' ')}</span>
                {p.pendingApprovals > 0 && <span className="chip bg-warn/15 text-warn">{p.pendingApprovals} to review</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
