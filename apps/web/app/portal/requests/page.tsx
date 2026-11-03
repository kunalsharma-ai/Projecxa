'use client';
import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { RequestList } from '@/components/requests/list';
import { NewRequestForm } from '@/components/requests/new-request';
import type { RequestKind } from '@/components/requests/types';
import { PageHeader, Section } from '@/components/ui';

export default function PortalRequestsPage() {
  const me = useMe();
  const router = useRouter();
  const [creating, setCreating] = useState<RequestKind | null>(null);
  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get('new');
    if (n === 'dispute' && me?.user.role === 'VENDOR_USER') setCreating('DISPUTE');
    else if (n) setCreating('QUESTION');
  }, [me]);
  const mode = me?.user.role === 'VENDOR_USER' ? 'vendor' : 'client';
  return (
    <>
      <PageHeader
        title="Requests"
        subtitle={`Ask ${me?.organization.name ?? 'us'} a question, report a problem${mode === 'vendor' ? ' or dispute rejected completes' : ''}. You get an email when we answer.`}
        actions={<button className="btn-primary" onClick={() => setCreating(creating ? null : 'QUESTION')}>{creating ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {creating ? 'Cancel' : 'New request'}</button>}
      />
      {creating && (
        <Section title="New request" className="mb-6">
          <NewRequestForm key={creating} mode={mode} initialKind={creating} onCreated={(r) => router.push(`/portal/requests/${r.id}`)} />
        </Section>
      )}
      <RequestList portal />
    </>
  );
}
