'use client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useMe } from '@/components/me';
import { ApiKeys } from '@/components/settings/api-keys';
import { Webhooks } from '@/components/settings/webhooks';
import { Loading, PageHeader, Section } from '@/components/ui';
import { API_URL } from '@/lib/api';

export default function DevelopersPage() {
  const me = useMe();
  if (!me) return <Loading />;
  const isAdmin = me.user.role === 'ADMIN';
  const base = `${API_URL}/api/v1/public`;
  return (
    <>
      <div className="mb-3"><Link href="/settings" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Settings</Link></div>
      <PageHeader title="API and webhooks" subtitle="Connect other systems to SampTrek: read projects, fieldwork, sessions and finance with an API key, and get events pushed to your own URL." />
      {!isAdmin ? (
        <Section title="Admins only"><p className="text-sm text-muted">Only admins can create API keys and webhooks. Ask an admin in your team.</p></Section>
      ) : (
        <div className="space-y-6">
          <Section title="Quick start">
            <p className="mb-3 text-sm text-muted">Send the key in the Authorization header. Every call is limited to your organization and to the permissions the key has. The full description is in OpenAPI format, so tools like Postman can import it.</p>
            <pre className="overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-xs leading-relaxed">{`curl ${base}/projects?status=LIVE \\
  -H "Authorization: Bearer pjx_..."`}</pre>
            <p className="mt-3 text-sm"><a className="text-brand hover:underline" href={`${base}/openapi.json`} target="_blank" rel="noreferrer">OpenAPI description (openapi.json)</a></p>
          </Section>
          <ApiKeys />
          <Webhooks />
        </div>
      )}
    </>
  );
}
