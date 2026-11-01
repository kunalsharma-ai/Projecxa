'use client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { MfaPanel } from '@/components/account/mfa-panel';
import { useMe } from '@/components/me';
import { PageHeader } from '@/components/ui';
import { portalHome } from '@/lib/types';

export default function PortalAccountPage() {
  const me = useMe();
  if (!me) return null;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3"><Link href={portalHome(me.user.role)} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Back</Link></div>
      <PageHeader title="Account security" subtitle={`${me.user.name} · ${me.user.email}`} />
      <MfaPanel email={me.user.email} />
    </div>
  );
}
