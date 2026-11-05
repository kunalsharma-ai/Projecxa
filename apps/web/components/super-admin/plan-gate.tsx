'use client';
import { Lock, PauseCircle } from 'lucide-react';
import Link from 'next/link';
import { post } from '@/lib/api';

const LABEL: Record<string, string> = {
  dashboard: 'The command center', copilot: 'The AI copilot', projects: 'Projects', 'projects.create': 'Creating projects', tasks: 'Tasks', requests: 'Requests',
  won_bids: 'Won bids', monitor: 'The fieldwork monitor', redirect_health: 'Redirect health', reports: 'Reports', invoices: 'Invoices', payables: 'Vendor payables',
  accounting: 'Accounting', clients: 'Clients', vendors: 'Vendors', portal_access: 'Portal access', integrations: 'Integrations', team: 'Team', privacy: 'Privacy',
  branding: 'Branding', settings: 'Settings', developers: 'API and webhooks', portal: 'The portal',
};

/** Shown instead of a page whose feature the Super Admin did not give this person. */
export function FeatureOff({ feature }: { feature: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-sunken text-muted"><Lock className="h-5 w-5" /></div>
      <h1 className="text-lg font-semibold">{LABEL[feature] ?? 'This feature'} is not part of your access</h1>
      <p className="mt-2 text-sm text-muted">Your organisation’s plan does not include it, or it was turned off for you. Ask your admin, or your PROJEXA provider, to turn it on.</p>
      <Link href="/" className="btn-ghost mt-5 inline-flex">Back to the start</Link>
    </div>
  );
}

const BLOCK: Record<string, [string, string]> = {
  ORG_PENDING: ['Your organisation is waiting for approval', 'You will get an email as soon as it is ready.'],
  ORG_SUSPENDED: ['Your organisation’s access is paused', 'Contact your PROJEXA provider to get access back. Your data is kept.'],
  SUBSCRIPTION_INACTIVE: ['Your subscription has ended', 'Contact your PROJEXA provider to renew. Your projects and data are kept and come back as soon as it is renewed.'],
};

/** Shown instead of every page while the organisation is paused or its subscription has ended. */
export function PlanBlocked({ block }: { block: string }) {
  const [title, text] = BLOCK[block] ?? BLOCK.ORG_SUSPENDED;
  return (
    <div className="mx-auto mt-16 max-w-md text-center" role="alert">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-warn/15 text-warn"><PauseCircle className="h-6 w-6" /></div>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">{text}</p>
      <div className="mt-5 flex justify-center gap-2">
        <Link href={typeof window !== 'undefined' && window.location.pathname.startsWith('/portal') ? '/portal/account' : '/account/security'} className="btn-ghost">Account security</Link>
        <button className="btn-ghost" onClick={async () => { await post('/auth/logout'); window.location.href = '/login'; }}>Sign out</button>
      </div>
    </div>
  );
}
