'use client';
import clsx from 'clsx';
import { AlertTriangle, Bot, Building2, Clock, PauseCircle, Smartphone, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ActivityList } from '@/components/super-admin/activity-list';
import { ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { get } from '@/lib/api';
import { ago, day, daysUntil, SUB_STATUS, type ActivityItem, type SubStatus } from '@/lib/super-admin';

interface Overview {
  counts: { organizations: number; pending: number; suspended: number; users: number; mobileUsers: number; activeLast7Days: number };
  subscriptions: Partial<Record<SubStatus, number>>;
  expiring: { organization: { id: string; name: string }; plan: string; status: SubStatus; endsAt: string | null; live: boolean }[];
  plans: { id: string; name: string; code: string; organizations: number }[];
  automationRuns: { id: string; at: string; rule: string; organization: string | null; status: string }[];
  recentActivity: ActivityItem[];
}

export default function SuperAdminOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { get<Overview>('/super-admin/overview').then(setData).catch(setError); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const c = data.counts;
  const tiles = [
    { label: 'Active organisations', value: c.organizations, icon: Building2, href: '/super-admin/organizations' },
    { label: 'Waiting for approval', value: c.pending, icon: UserPlus, href: '/super-admin/registrations', tone: c.pending ? 'text-warn' : '' },
    { label: 'Paused', value: c.suspended, icon: PauseCircle, href: '/super-admin/organizations?status=SUSPENDED', tone: c.suspended ? 'text-bad' : '' },
    { label: 'Staff users', value: c.users, icon: Users, href: '/super-admin/activity' },
    { label: 'Mobile app users', value: c.mobileUsers, icon: Smartphone, href: '/super-admin/organizations' },
    { label: 'Active in the last 7 days', value: c.activeLast7Days, icon: Clock, href: '/super-admin/activity' },
  ];
  const totalSubs = Object.values(data.subscriptions).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <>
      <PageHeader title="Overview" subtitle="Every organisation on this SampTrek server: their subscriptions, what they use, and what needs you." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="card p-4 transition-colors hover:border-brand/40">
            <t.icon className={clsx('mb-2 h-4 w-4 text-muted', t.tone)} />
            <div className={clsx('text-2xl font-semibold tabular-nums', t.tone)}>{t.value}</div>
            <div className="text-xs text-muted">{t.label}</div>
          </Link>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Section title="Ending in the next 14 days, or already ended">
            {data.expiring.length === 0 ? <p className="text-sm text-muted">Nothing is ending soon.</p> : (
              <ul className="divide-y divide-line">
                {data.expiring.map((e) => {
                  const d = daysUntil(e.endsAt);
                  return (
                    <li key={e.organization.id} className="flex items-center gap-3 py-2.5 text-sm">
                      {!e.live && <AlertTriangle className="h-4 w-4 shrink-0 text-bad" />}
                      <Link href={`/super-admin/organizations/${e.organization.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{e.organization.name}</Link>
                      <span className="text-xs text-muted">{e.plan}</span>
                      <span className={clsx('chip', SUB_STATUS[e.status][1])}>{SUB_STATUS[e.status][0]}</span>
                      <span className={clsx('w-28 text-right text-xs', d != null && d < 0 ? 'text-bad' : 'text-muted')}>{d == null ? '' : d < 0 ? `Ended ${day(e.endsAt)}` : d === 0 ? 'Ends today' : `${d} days · ${day(e.endsAt)}`}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          <Section title="Plans" actions={<Link href="/super-admin/plans" className="text-xs text-brand hover:underline">Edit plans</Link>}>
            <div className="space-y-2">
              {data.plans.map((p) => (
                <div key={p.id} className="flex items-center gap-3 text-sm">
                  <span className="w-32 truncate font-medium">{p.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-brand" style={{ width: `${totalSubs ? (p.organizations / totalSubs) * 100 : 0}%` }} /></div>
                  <span className="w-24 text-right text-xs tabular-nums text-muted">{p.organizations} organisation{p.organizations === 1 ? '' : 's'}</span>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-2">
                {(Object.keys(SUB_STATUS) as SubStatus[]).filter((s) => data.subscriptions[s]).map((s) => <span key={s} className={clsx('chip', SUB_STATUS[s][1])}>{SUB_STATUS[s][0]}: {data.subscriptions[s]}</span>)}
              </div>
            </div>
          </Section>
          <Section title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-brand" />Latest automation runs</span>} actions={<Link href="/super-admin/automation" className="text-xs text-brand hover:underline">Automation</Link>}>
            {data.automationRuns.length === 0 ? <p className="text-sm text-muted">No rule has run yet. Add one from the ready-made recipes in Automation.</p> : (
              <ul className="divide-y divide-line text-sm">
                {data.automationRuns.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2">
                    <span className={clsx('h-2 w-2 shrink-0 rounded-full', r.status === 'ok' ? 'bg-ok' : 'bg-bad')} aria-label={r.status} />
                    <span className="min-w-0 flex-1 truncate">{r.rule}{r.organization && <span className="text-muted"> · {r.organization}</span>}</span>
                    <span className="text-xs text-muted">{ago(r.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <Section title="Latest activity" actions={<Link href="/super-admin/activity" className="text-xs text-brand hover:underline">All activity</Link>}>
          <ActivityList items={data.recentActivity} />
        </Section>
      </div>
    </>
  );
}
