'use client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RequestThread } from '@/components/requests/thread';
import type { RequestRow } from '@/components/requests/types';
import { PageHeader } from '@/components/ui';
import { get } from '@/lib/api';

export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  const [head, setHead] = useState<Pick<RequestRow, 'ref' | 'subject'> | null>(null);
  useEffect(() => {
    get<RequestRow>(`/requests/${id}`).then(setHead).catch(() => {});
  }, [id]);
  return (
    <>
      <Link href="/requests" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Requests</Link>
      <PageHeader title={head ? head.subject : 'Request'} subtitle={head?.ref} />
      <RequestThread id={id} portal={false} />
    </>
  );
}
