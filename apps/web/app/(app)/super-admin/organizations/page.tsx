'use client';
import clsx from 'clsx';
import { Copy, Plus, Search, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { get, post } from '@/lib/api';
import { ago, day, daysUntil, endOf, ORG_STATUS, SUB_STATUS, type OrgStatus, type OrgSummary, type Plan } from '@/lib/super-admin';

function Organizations() {
  const params = useSearchParams();
  const [status, setStatus] = useState<'' | OrgStatus>((params.get('status') as OrgStatus) ?? '');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<OrgSummary[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', adminName: '', adminEmail: '', planCode: 'starter', trialDays: 14 });
  const [made, setMade] = useState<{ name: string; emailed: boolean; url: string } | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) }).toString();
    get<OrgSummary[]>(`/super-admin/organizations${qs ? `?${qs}` : ''}`).then(setRows).catch(setError);
  }, [q, status]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);
  useEffect(() => { get<Plan[]>('/super-admin/plans').then(setPlans).catch(setError); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await post<{ id: string; invite: { emailed: boolean; inviteUrl: string } }>('/super-admin/organizations', { ...form, planCode: form.planCode || null, trialDays: form.trialDays || null });
      setMade({ name: form.name, emailed: r.invite.emailed, url: r.invite.inviteUrl });
      setForm({ ...form, name: '', adminName: '', adminEmail: '' });
      setAdding(false);
      load();
    } catch (err) { setError(err); }
  }

  return (
    <>
      <PageHeader title="Organisations" subtitle="Each customer company on this server, its plan and how much it uses PROJEXA."
        actions={<button className="btn-primary" onClick={() => setAdding(!adding)}><Plus className="h-4 w-4" />Add organisation</button>} />
      <ErrorBox error={error} />
      {made && (
        <div className="mb-4 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">
          {made.name} is ready. {made.emailed ? 'Its admin got an email to choose a password.' : 'Email is not set up on your organisation (Settings → Integrations), so send this link to its admin yourself. It works for 72 hours.'}
          {!made.emailed && <button type="button" className="mt-2 flex w-full items-center gap-2 rounded border border-line bg-panel px-2 py-1.5 text-left font-mono text-xs text-ink" onClick={() => navigator.clipboard?.writeText(made.url)}><span className="min-w-0 flex-1 truncate">{made.url}</span><Copy className="h-3.5 w-3.5 shrink-0 text-muted" /></button>}
        </div>
      )}
      {adding && (
        <Section title="Add an organisation" className="mb-6">
          <form onSubmit={create} className="grid gap-4 md:grid-cols-3">
            <label className="block"><span className="label">Company name</span><input className="input" required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="block"><span className="label">Admin’s name</span><input className="input" required value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} /></label>
            <label className="block"><span className="label">Admin’s email</span><input className="input" type="email" required value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} /></label>
            <label className="block"><span className="label">Plan</span>
              <select className="input" value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })}>
                <option value="">No plan (every feature)</option>
                {plans.filter((p) => p.active).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Free trial (days, 0 = none)</span><input className="input" type="number" min={0} max={365} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: Number(e.target.value) })} /></label>
            <div className="flex items-end gap-2"><button className="btn-primary">Create and invite admin</button><button type="button" className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button></div>
          </form>
        </Section>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search organisations" />
        </label>
        <div className="flex rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="Status">
          {(['', 'ACTIVE', 'PENDING', 'SUSPENDED'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={clsx('rounded-md px-3 py-1 text-xs', status === s ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>{s ? ORG_STATUS[s][0] : 'All'}</button>
          ))}
        </div>
      </div>
      {!rows ? <Loading /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead><tr><th className="th">Organisation</th><th className="th">Plan</th><th className="th">Ends</th><th className="th">Users</th><th className="th">Projects</th><th className="th">Features</th><th className="th">Last active</th></tr></thead>
            <tbody>
              {rows.map((o) => {
                const end = endOf(o.subscription);
                const d = daysUntil(end);
                return (
                  <tr key={o.id} className="border-t border-line hover:bg-sunken/50">
                    <td className="td">
                      <Link href={`/super-admin/organizations/${o.id}`} className="font-medium hover:underline">{o.name}</Link>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">{o.slug}{o.platformOwner && <span className="chip bg-brand/10 text-brand">Runs this server</span>}{o.status !== 'ACTIVE' && <span className={clsx('chip', ORG_STATUS[o.status][1])}>{ORG_STATUS[o.status][0]}</span>}</div>
                    </td>
                    <td className="td">{o.platformOwner ? <span className="text-muted">Everything</span> : o.subscription ? <div className="flex items-center gap-1.5"><span>{o.subscription.plan.name}</span><span className={clsx('chip', SUB_STATUS[o.subscription.status][1])}>{SUB_STATUS[o.subscription.status][0]}</span></div> : <span className="text-muted">No plan</span>}</td>
                    <td className={clsx('td whitespace-nowrap text-xs', d != null && d < 0 ? 'text-bad' : d != null && d <= 7 ? 'text-warn' : 'text-muted')}>{end ? day(end) : '—'}</td>
                    <td className="td tabular-nums">{o.users}{o.limits.maxUsers != null && <span className="text-muted"> / {o.limits.maxUsers}</span>}</td>
                    <td className="td tabular-nums">{o.projects}{o.limits.maxProjects != null && <span className="text-muted"> / {o.limits.maxProjects}</span>}</td>
                    <td className="td text-xs"><span className="tabular-nums">{o.features.web}/{o.features.total}</span> <span className="text-muted">web</span> · <Smartphone className="inline h-3 w-3 text-muted" /> <span className="tabular-nums">{o.features.mobile}</span>{o.overrides > 0 && <span className="ml-1 chip bg-info/15 text-info">{o.overrides} switched</span>}</td>
                    <td className="td whitespace-nowrap text-xs text-muted">{ago(o.lastActiveAt)}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td className="td text-muted" colSpan={7}>No organisations match.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default function OrganizationsPage() {
  return <Suspense fallback={<Loading />}><Organizations /></Suspense>;
}
