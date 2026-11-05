'use client';
import clsx from 'clsx';
import { Ban, Check, Minus, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';
import { get } from '@/lib/api';

interface Cell { allowed: boolean; saved: boolean; lastTestOk: boolean | null; lastTestAt: string | null; lastTestMessage: string | null }
interface Matrix { kinds: { kind: string; label: string; group: string }[]; organizations: { id: string; name: string; status: string; platformOwner: boolean; integrations: Record<string, Cell> }[] }

function Mark({ c }: { c: Cell }) {
  if (!c.allowed) return <span title="Blocked by you" className="text-muted"><Ban className="mx-auto h-4 w-4" /></span>;
  if (!c.saved) return <span title="Allowed, not set up" className="text-muted"><Minus className="mx-auto h-4 w-4" /></span>;
  if (c.lastTestOk === false) return <span title={`Last test failed: ${c.lastTestMessage ?? ''}`} className="text-bad"><X className="mx-auto h-4 w-4" /></span>;
  return <span title={c.lastTestOk ? 'Set up, last test worked' : 'Set up, not tested'} className={c.lastTestOk ? 'text-ok' : 'text-info'}><Check className="mx-auto h-4 w-4" /></span>;
}

export default function IntegrationsOverview() {
  const [m, setM] = useState<Matrix | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { get<Matrix>('/super-admin/integrations').then(setM).catch(setError); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!m) return <Loading />;
  const failing = m.organizations.flatMap((o) => Object.entries(o.integrations).filter(([, c]) => c.allowed && c.lastTestOk === false).map(([k]) => ({ o, k })));
  return (
    <>
      <PageHeader title="Integrations" subtitle="Which organisation may use, and has set up, each integration. Open an organisation to allow or block one." />
      {failing.length > 0 && <div className="mb-4 rounded-lg bg-bad/10 p-3 text-sm text-bad">{failing.length} integration test{failing.length === 1 ? '' : 's'} failing: {failing.map(({ o, k }) => `${o.name} (${m.kinds.find((x) => x.kind === k)?.label})`).join(', ')}</div>}
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1"><Check className="h-3.5 w-3.5 text-ok" />Set up and working</span><span className="flex items-center gap-1"><X className="h-3.5 w-3.5 text-bad" />Test failed</span>
        <span className="flex items-center gap-1"><Minus className="h-3.5 w-3.5" />Allowed, not set up</span><span className="flex items-center gap-1"><Ban className="h-3.5 w-3.5" />Blocked</span>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead><tr><th className="th sticky left-0 bg-panel">Organisation</th>{m.kinds.map((k) => <th key={k.kind} className="th text-center text-[11px]">{k.label}</th>)}</tr></thead>
          <tbody>
            {m.organizations.map((o) => (
              <tr key={o.id} className={clsx('border-t border-line', o.status === 'SUSPENDED' && 'opacity-50')}>
                <td className="td sticky left-0 bg-panel"><Link href={`/super-admin/organizations/${o.id}`} className="font-medium hover:underline">{o.name}</Link></td>
                {m.kinds.map((k) => <td key={k.kind} className="td text-center"><Mark c={o.integrations[k.kind]} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
