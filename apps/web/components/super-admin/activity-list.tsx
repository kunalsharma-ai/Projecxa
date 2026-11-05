'use client';
import { Crown } from 'lucide-react';
import Link from 'next/link';
import { actionLabel, ago, ROLE_LABEL, type ActivityItem } from '@/lib/super-admin';

const detailText = (d: Record<string, unknown> | null) => {
  if (!d) return '';
  const bits: string[] = [];
  for (const k of ['email', 'plan', 'status', 'kind', 'role', 'name', 'code']) if (typeof d[k] === 'string') bits.push(String(d[k]));
  if (Array.isArray(d.changes)) bits.push((d.changes as { feature: string; channel: string; state: string }[]).map((c) => `${c.feature} ${c.channel === 'mobile' ? 'in the app' : 'on the web'}: ${c.state}`).join(', '));
  if (Array.isArray(d.featuresOff)) bits.push(`off for them: ${(d.featuresOff as string[]).join(', ') || 'none'}`);
  if (typeof d.mobileAccess === 'boolean') bits.push(d.mobileAccess ? 'mobile app on' : 'mobile app off');
  return bits.join(' · ');
};

export function ActivityList({ items, showOrg = true }: { items: ActivityItem[]; showOrg?: boolean }) {
  if (!items.length) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <ol className="divide-y divide-line">
      {items.map((i) => {
        const bySa = i.actor?.superAdmin || (i.detail && 'bySuperAdmin' in i.detail);
        return (
          <li key={i.id} className="flex gap-3 py-2.5 text-sm">
            <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sunken text-[11px] font-semibold text-muted">
              {bySa ? <Crown className="h-3.5 w-3.5 text-brand" /> : (i.actor?.name ?? '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div>
                <span className="font-medium">{i.actor?.name ?? (i.detail?.bySuperAdmin === 'automation' ? 'Automation' : 'System')}</span>
                {i.actor?.role && <span className="text-xs text-muted"> · {ROLE_LABEL[i.actor.role] ?? i.actor.role}</span>}
                <span className="text-muted"> — </span>{actionLabel(i.action)}
                {showOrg && <> in <Link className="text-brand hover:underline" href={`/super-admin/organizations/${i.organization.id}`}>{i.organization.name}</Link></>}
              </div>
              {detailText(i.detail) && <div className="truncate text-xs text-muted">{detailText(i.detail)}</div>}
            </div>
            <time className="shrink-0 whitespace-nowrap text-xs text-muted" dateTime={i.at} title={new Date(i.at).toLocaleString()}>{ago(i.at)}</time>
          </li>
        );
      })}
    </ol>
  );
}
