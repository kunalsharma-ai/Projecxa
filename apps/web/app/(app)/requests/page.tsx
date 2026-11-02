'use client';
import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { RequestList } from '@/components/requests/list';
import { NewRequestForm } from '@/components/requests/new-request';
import type { RequestStatus } from '@/components/requests/types';
import { PageHeader, Section } from '@/components/ui';

export default function RequestsPage() {
  const me = useMe();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [initial, setInitial] = useState<RequestStatus | 'ALL' | null>(null);
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('status');
    setInitial(s === 'OPEN' || s === 'ANSWERED' || s === 'CLOSED' ? s : 'OPEN');
  }, []);

  return (
    <>
      <PageHeader
        title="Requests"
        subtitle="Questions, issues and disputes from clients and vendors, sent from their portals."
        actions={canEdit(me) && <button className="btn-primary" onClick={() => setCreating(!creating)}>{creating ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {creating ? 'Cancel' : 'New request'}</button>}
      />
      {creating && (
        <Section title="Write to a client or vendor" className="mb-6">
          <NewRequestForm mode="staff" onCreated={(r) => router.push(`/requests/${r.id}`)} />
        </Section>
      )}
      {initial && <RequestList portal={false} initialStatus={initial} />}
    </>
  );
}
