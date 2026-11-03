'use client';
import { MfaPanel } from '@/components/account/mfa-panel';
import { useMe } from '@/components/me';
import { PageHeader } from '@/components/ui';

export default function AccountSecurityPage() {
  const me = useMe();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Account security" subtitle={me ? `${me.user.name} · ${me.user.email}` : undefined} />
      {me && <MfaPanel email={me.user.email} onFinished={() => { if (me.mfa?.setupRequired) window.location.href = '/'; }} />}
    </div>
  );
}
