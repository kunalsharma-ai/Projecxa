'use client';
import { useCallback, useEffect, useState } from 'react';
import { ActivityList } from '@/components/super-admin/activity-list';
import { ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { get } from '@/lib/api';
import type { ActivityItem, OrgSummary } from '@/lib/super-admin';

const KINDS: [string, string][] = [['', 'Everything'], ['auth.', 'Sign-ins'], ['user.', 'Team changes'], ['project', 'Projects'], ['integration', 'Integrations'], ['superadmin.', 'Super Admin'], ['invoice', 'Invoices'], ['org.', 'Registrations']];

export default function ActivityPage() {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [org, setOrg] = useState('');
  const [kind, setKind] = useState('');
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { get<OrgSummary[]>('/super-admin/organizations').then(setOrgs).catch(setError); }, []);
  const load = useCallback((before?: string) => {
    const qs = new URLSearchParams({ limit: '50', ...(org ? { organizationId: org } : {}), ...(kind ? { action: kind } : {}), ...(before ? { before } : {}) });
    return get<{ items: ActivityItem[]; next: string | null }>(`/super-admin/activity?${qs}`).then((r) => { setItems((x) => (before ? [...(x ?? []), ...r.items] : r.items)); setNext(r.next); }).catch(setError);
  }, [org, kind]);
  useEffect(() => { setItems(null); load(); }, [load]);
  return (
    <>
      <PageHeader title="Activity" subtitle="Everything admins, their users and you did, in every organisation: sign-ins, team changes, projects, integrations and your own changes." />
      <ErrorBox error={error} />
      <div className="mb-4 flex flex-wrap gap-2">
        <select className="input h-9 w-auto py-0 text-sm" value={org} onChange={(e) => setOrg(e.target.value)} aria-label="Organisation"><option value="">All organisations</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <select className="input h-9 w-auto py-0 text-sm" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      <Section title="Latest first">
        {!items ? <Loading /> : <ActivityList items={items} />}
        {next && <button className="btn-ghost mt-3 w-full" onClick={() => load(next)}>Show older</button>}
      </Section>
    </>
  );
}
