'use client';
import clsx from 'clsx';
import { ArrowLeft, Check, Eye, Globe, LogOut, Minus, PauseCircle, PlayCircle, Smartphone, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityList } from '@/components/super-admin/activity-list';
import { ErrorBox, Loading, PageHeader, Section, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { LimitFields, limitBody, limitForm, UsageBars } from '@/components/super-admin/limits';
import { ACCESS_LABEL, ago, day, ORG_STATUS, ROLE_LABEL, SUB_STATUS, type ActivityItem, type Catalog, type FeatureRow, type LimitDef, type OrgDetail, type OrgUser, type Plan, type SubStatus } from '@/lib/super-admin';
import { Label } from '@/components/help';

type Tab = 'subscription' | 'traffic' | 'features' | 'people' | 'activity' | 'integrations';
const TABS: [Tab, string][] = [['subscription', 'Subscription'], ['traffic', 'Traffic'], ['features', 'Features'], ['people', 'People'], ['activity', 'Activity'], ['integrations', 'Integrations']];
const toInput = (d: string | null | undefined) => (d ? d.slice(0, 10) : '');
const fromInput = (s: string) => (s ? new Date(`${s}T23:59:59Z`).toISOString() : null);

export default function OrganizationPage() {
  const { id } = useParams<{ id: string }>();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [tab, setTab] = useState<Tab>('subscription');
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => get<OrgDetail>(`/super-admin/organizations/${id}`).then(setOrg).catch(setError), [id]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null); setNote(null);
    try { const r = await fn(); if (r && typeof r === 'object' && 'features' in r && 'id' in r) setOrg(r as OrgDetail); else await load(); if (done) setNote(done); } catch (e) { setError(e); }
  };
  if (!org) return error ? <ErrorBox error={error} /> : <Loading />;

  const setStatus = (status: 'ACTIVE' | 'SUSPENDED') => {
    if (status === 'SUSPENDED' && !confirm(`Pause ${org.name}? Everyone there is signed out at once and cannot sign in, on the web or in the app, until you reactivate it. Their data is kept.`)) return;
    void run(() => api(`/super-admin/organizations/${id}`, { method: 'PATCH', json: { status } }), status === 'SUSPENDED' ? 'Paused. Everyone there was signed out.' : 'Reactivated.');
  };

  const observe = async () => {
    setError(null);
    try { await post(`/super-admin/organizations/${org.id}/observe`); window.location.href = '/'; } catch (e) { setError(e); }
  };

  return (
    <>
      <Link href="/super-admin/organizations" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Organisations</Link>
      <PageHeader
        title={org.name}
        subtitle={<span className="flex flex-wrap items-center gap-2">{org.slug}<span className={clsx('chip', ORG_STATUS[org.status][1])}>{ORG_STATUS[org.status][0]}</span>{org.platformOwner && <span className="chip bg-brand/10 text-brand">Runs this server: always every feature</span>}{org.block && org.status === 'ACTIVE' && <span className="chip bg-bad/15 text-bad">Subscription ended: no access</span>}</span>}
        actions={!org.platformOwner && org.status !== 'PENDING' && (
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" title="See everything in this organisation as its admin sees it, without changing anything" onClick={observe}><Eye className="h-4 w-4" />Observe (read-only)</button>
            {org.status === 'ACTIVE'
              ? <button className="btn-danger" onClick={() => setStatus('SUSPENDED')}><PauseCircle className="h-4 w-4" />Pause access</button>
              : <button className="btn-primary" onClick={() => setStatus('ACTIVE')}><PlayCircle className="h-4 w-4" />Reactivate</button>}
          </div>
        )}
      />
      <ErrorBox error={error} />
      {note && <div className="mb-4 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">{note}</div>}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Users', `${org.users}${org.limits.maxUsers != null ? ` / ${org.limits.maxUsers}` : ''}`], ['Projects', `${org.projects}${org.limits.maxProjects != null ? ` / ${org.limits.maxProjects}` : ''}`], ['Features on the web', `${org.features.filter((f) => f.web.effective).length} / ${org.features.length}`], ['Last active', ago(org.lastActiveAt)]].map(([k, v]) => (
          <div key={k} className="card p-3"><div className="text-xs text-muted">{k}</div><div className="mt-0.5 font-semibold tabular-nums">{v}</div></div>
        ))}
      </div>
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx('whitespace-nowrap border-b-2 px-3 py-2 text-sm', tab === k ? 'border-brand font-medium' : 'border-transparent text-muted hover:text-ink')}>{l}</button>)}
      </div>
      {tab === 'subscription' && <SubscriptionTab org={org} run={run} />}
      {tab === 'traffic' && <TrafficTab orgId={org.id} />}
      {tab === 'features' && <FeaturesTab org={org} run={run} />}
      {tab === 'people' && <PeopleTab org={org} setError={setError} setNote={setNote} />}
      {tab === 'activity' && <ActivityTab orgId={org.id} />}
      {tab === 'integrations' && <IntegrationsTab org={org} run={run} />}
    </>
  );
}

type Run = (fn: () => Promise<unknown>, done?: string) => Promise<void>;

function SubscriptionTab({ org, run }: { org: OrgDetail; run: Run }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const s = org.subscriptionDetail;
  const [form, setForm] = useState({
    planCode: org.subscription?.plan.code ?? 'starter', status: (s?.status ?? 'ACTIVE') as SubStatus, endsAt: toInput(s?.endsAt), trialEndsAt: toInput(s?.trialEndsAt),
    lim: limitForm(s?.maxUsers, s?.maxProjects, s?.limits, true), mobileEnabled: s?.mobileEnabled ?? true, notes: s?.notes ?? '',
  });
  const [limitDefs, setLimitDefs] = useState<LimitDef[]>([]);
  useEffect(() => {
    get<Plan[]>('/super-admin/plans').then(setPlans).catch(() => undefined);
    get<Catalog>('/super-admin/catalog').then((c) => setLimitDefs(c.limits)).catch(() => undefined);
  }, []);
  if (org.platformOwner) return <Section title="Subscription"><p className="text-sm text-muted">This organisation runs the server, so it always has every feature and no limits.</p></Section>;
  const plan = plans.find((p) => p.code === form.planCode);
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(() => api(`/super-admin/organizations/${org.id}/subscription`, { method: 'PUT', json: {
      planCode: form.planCode, status: form.status, endsAt: fromInput(form.endsAt), trialEndsAt: fromInput(form.trialEndsAt),
      ...limitBody(form.lim), mobileEnabled: form.mobileEnabled, notes: form.notes || null,
    } }), 'Saved. The change applies at once on the web and in the mobile app.');
  };
  const extend = (days: number) => {
    const field = form.status === 'TRIAL' ? 'trialEndsAt' : 'endsAt';
    const from = Math.max(Date.now(), form[field] ? new Date(form[field]).getTime() : Date.now());
    setForm({ ...form, [field]: new Date(from + days * 86_400_000).toISOString().slice(0, 10) });
  };
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Section title={org.subscription ? 'Subscription' : 'No subscription yet: this organisation has every feature'}>
        <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
          <label className="block"><Label>Plan</Label>
            <select className="input" value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}{p.active ? '' : ' (off)'}</option>)}</select>
          </label>
          <label className="block"><Label>Status</Label>
            <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SubStatus })}>{(Object.keys(SUB_STATUS) as SubStatus[]).map((k) => <option key={k} value={k}>{SUB_STATUS[k][0]}</option>)}</select>
            <span className="mt-1 block text-xs text-muted">{{ TRIAL: 'Works until the trial end date.', ACTIVE: 'Works until the end date (none = no end).', PAST_DUE: 'Still works: a late renewal.', EXPIRED: 'No access until renewed.', CANCELLED: 'No access.' }[form.status]}</span>
          </label>
          {form.status === 'TRIAL'
            ? <label className="block"><Label>Trial ends</Label><input className="input" type="date" value={form.trialEndsAt} onChange={(e) => setForm({ ...form, trialEndsAt: e.target.value })} /></label>
            : <label className="block"><Label>Ends or renews on</Label><input className="input" type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label>}
          <div className="flex items-end gap-2">{[30, 90, 365].map((d) => <button key={d} type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => extend(d)}>+{d === 365 ? '1 year' : `${d} days`}</button>)}</div>
          <div className="sm:col-span-2">
            <h3 className="text-sm font-semibold">Limits for this organisation</h3>
            <p className="mb-3 text-xs text-muted">Empty follows the plan. Type a number to give this organisation more or less{plan ? ', or “none” for no limit' : ''}.</p>
            {plan && limitDefs.length > 0 ? <LimitFields defs={limitDefs} form={form.lim} onChange={(lim) => setForm({ ...form, lim })} plan={plan} /> : <Loading />}
          </div>
          <div className="flex items-center gap-3 sm:col-span-2"><Toggle checked={form.mobileEnabled} onChange={(v) => setForm({ ...form, mobileEnabled: v })} label="Mobile app" /><span className="text-sm"><Smartphone className="mr-1 inline h-4 w-4 text-muted" />Android and iOS app {form.mobileEnabled ? 'on' : 'off'} for this organisation{plan && !plan.mobileEnabled ? ' (the plan has no app)' : ''}</span></div>
          <label className="block sm:col-span-2"><Label>Notes (only you see them)</Label><textarea className="input min-h-[70px]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Paid by bank transfer until March" /></label>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary">Save subscription</button>
            {org.subscription && <button type="button" className="btn-ghost" onClick={() => confirm('Remove the subscription? The organisation then has every feature with no limits.') && run(() => api(`/super-admin/organizations/${org.id}/subscription`, { method: 'DELETE' }), 'Subscription removed.')}>Remove</button>}
          </div>
        </form>
      </Section>
      <div className="space-y-6">
      <Section title="Usage">
        <UsageBars usage={org.usage} />
      </Section>
      <Section title="Limit emails">
        {org.limitAlerts.length === 0 ? <p className="text-sm text-muted">None yet. Its admins get an email at 80% of a limit and when it is reached; you get one when it is reached.</p> : (
          <ul className="-mx-5 divide-y divide-line text-sm" data-testid="limit-alerts">
            {org.limitAlerts.map((a) => (
              <li key={`${a.limit}-${a.level}-${a.period}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-5 py-2">
                <span><span className={clsx('mr-2 rounded-full px-2 py-0.5 text-xs', a.level === 'reached' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn')}>{a.level === 'reached' ? 'Reached' : 'Close'}</span>{org.usage.limits.find((l) => l.key === a.limit)?.label ?? a.limit} <span className="tabular-nums text-muted">{a.used.toLocaleString('en')} / {a.max.toLocaleString('en')}</span></span>
                <span className="text-xs text-muted" title={a.sentTo ?? ''}>{day(a.createdAt)} · {a.sentTo}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={plan ? `In ${plan.name}` : 'Plan'}>
        {plan ? (
          <div className="space-y-3 text-sm">
            {plan.description && <p className="text-muted">{plan.description}</p>}
            {plan.priceLabel && <p className="font-medium">{plan.priceLabel}</p>}
            <p><b className="tabular-nums">{plan.features.length}</b> web features · <b className="tabular-nums">{plan.mobileEnabled ? plan.mobileFeatures.length : 0}</b> in the app</p>
            <p className="text-xs text-muted">Plan limits are shown as hints in the limit fields. Turn single features on or off for this organisation in the Features tab.</p>
            <p className="text-xs text-muted">Payments online or offline renew this by themselves (Billing). You can also change it here, or let Automation remind and expire it.</p>
          </div>
        ) : <Loading />}
      </Section>
      </div>
    </div>
  );
}

function State({ cell, onChange, label }: { cell: { plan: boolean; override: boolean | null; effective: boolean }; onChange: (s: 'plan' | 'on' | 'off') => void; label: string }) {
  const value = cell.override === null ? 'plan' : cell.override ? 'on' : 'off';
  return (
    <div className="flex items-center gap-2">
      <span className={clsx('grid h-5 w-5 shrink-0 place-items-center rounded-full', cell.effective ? 'bg-ok/15 text-ok' : 'bg-sunken text-muted')} aria-label={cell.effective ? 'On' : 'Off'}>{cell.effective ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}</span>
      <div className="flex rounded-lg border border-line bg-panel p-0.5" role="radiogroup" aria-label={label}>
        {([['plan', `Plan (${cell.plan ? 'on' : 'off'})`], ['on', 'On'], ['off', 'Off']] as const).map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => value !== k && onChange(k)}
            className={clsx('rounded-md px-2 py-0.5 text-xs', value === k ? (k === 'off' ? 'bg-bad text-white' : k === 'on' ? 'bg-ok text-white' : 'bg-brand text-brand-ink') : 'text-muted hover:bg-sunken')}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function FeaturesTab({ org, run }: { org: OrgDetail; run: Run }) {
  const groups = useMemo(() => [...new Set(org.features.map((f) => f.group))], [org.features]);
  if (org.platformOwner) return <Section title="Features"><p className="text-sm text-muted">This organisation runs the server, so it always has every feature.</p></Section>;
  const change = (f: FeatureRow, channel: 'web' | 'mobile', state: 'plan' | 'on' | 'off') =>
    run(() => api(`/super-admin/organizations/${org.id}/features`, { method: 'PUT', json: { changes: [{ feature: f.key, channel, state }] } }), `${f.label} ${channel === 'mobile' ? 'in the app' : 'on the web'}: ${state === 'plan' ? 'follows the plan' : state}. It applies at once.`);
  const all = (channel: 'web' | 'mobile', state: 'plan' | 'on' | 'off') =>
    confirm(`Set every feature ${channel === 'mobile' ? 'in the app' : 'on the web'} to “${state === 'plan' ? 'follow the plan' : state}”?`) &&
    run(() => api(`/super-admin/organizations/${org.id}/features`, { method: 'PUT', json: { changes: org.features.filter((f) => channel === 'web' || f.mobile).map((f) => ({ feature: f.key, channel, state })) } }));
  return (
    <>
      <p className="mb-4 text-sm text-muted">Each feature follows the plan unless you switch it on or off here. Switching on a feature the plan does not include gives this organisation an extra. Changes reach the web app and the Android/iOS app within seconds, and the server refuses switched-off features. The organisation’s Admin then chooses who in their team gets each feature (the “Admin gives it to” column). People can also have features taken away one by one in the People tab.</p>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <span className="self-center text-muted">All on the web:</span>
        {(['plan', 'on', 'off'] as const).map((s) => <button key={s} className="btn-ghost px-2 py-1 text-xs" onClick={() => all('web', s)}>{s === 'plan' ? 'Follow plan' : s === 'on' ? 'On' : 'Off'}</button>)}
        <span className="ml-3 self-center text-muted">All in the app:</span>
        {(['plan', 'on', 'off'] as const).map((s) => <button key={s} className="btn-ghost px-2 py-1 text-xs" onClick={() => all('mobile', s)}>{s === 'plan' ? 'Follow plan' : s === 'on' ? 'On' : 'Off'}</button>)}
      </div>
      <div className="space-y-6">
        {groups.map((g) => (
          <Section key={g} title={g}>
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[820px] table-fixed text-sm">
                <thead><tr><th className="th w-[34%]">Feature</th><th className="th"><Globe className="mr-1 inline h-3.5 w-3.5" />Web</th><th className="th"><Smartphone className="mr-1 inline h-3.5 w-3.5" />Mobile app</th><th className="th w-[16%]">Admin gives it to</th></tr></thead>
                <tbody>
                  {org.features.filter((f) => f.group === g).map((f) => (
                    <tr key={f.key} className="border-t border-line" data-feature={f.key}>
                      <td className="td"><div className="font-medium">{f.label}</div><div className="text-xs text-muted">{f.summary}</div></td>
                      <td className="td"><State cell={f.web} label={`${f.label} on the web`} onChange={(s) => change(f, 'web', s)} /></td>
                      <td className="td">{f.app ? <State cell={f.app} label={`${f.label} in the app`} onChange={(s) => change(f, 'mobile', s)} /> : <span className="flex items-center gap-1 text-xs text-muted"><Minus className="h-3 w-3" />Web only</span>}</td>
                      <td className="td text-xs text-muted">{f.adminAccess ? `${ACCESS_LABEL[f.adminAccess.mode]}${f.adminAccess.mode === 'people' ? ` (${f.adminAccess.people})` : ''}` : 'Admins'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        ))}
      </div>
    </>
  );
}

function PeopleTab({ org, setError, setNote }: { org: OrgDetail; setError: (e: unknown) => void; setNote: (s: string | null) => void }) {
  const [users, setUsers] = useState<OrgUser[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const load = useCallback(() => get<OrgUser[]>(`/super-admin/organizations/${org.id}/users`).then(setUsers).catch(setError), [org.id, setError]);
  useEffect(() => { load(); get<Catalog>('/super-admin/catalog').then(setCatalog).catch(setError); }, [load, setError]);
  const patch = async (u: OrgUser, body: object, done: string) => {
    setError(null); setNote(null);
    try { await api(`/super-admin/users/${u.id}`, { method: 'PATCH', json: body }); setNote(done); await load(); } catch (e) { setError(e); }
  };
  if (!users || !catalog) return <Loading />;
  // Only what the organisation has: a person cannot get more than their organisation.
  const orgWeb = new Set(org.features.filter((f) => f.web.effective).map((f) => f.key));
  const orgApp = new Set(org.features.filter((f) => f.app?.effective).map((f) => f.key));
  const forRole = (u: OrgUser) => catalog.features.filter((f) => f.roles.includes(u.role) && orgWeb.has(f.key));
  return (
    <Section title={`People (${users.filter((u) => u.active).length} active)`}>
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[860px] text-sm">
          <thead><tr><th className="th">Person</th><th className="th">Role</th><th className="th">Last seen</th><th className="th">Features</th><th className="th">Mobile app</th><th className="th" /></tr></thead>
          <tbody>
            {users.map((u) => (
              <Fragment key={u.id}>
                <tr className={clsx('border-t border-line', !u.active && 'opacity-60')} data-user={u.email}>
                  <td className="td"><div className="font-medium">{u.name}{u.superAdmin && <span className="ml-1.5 chip bg-brand/10 text-brand">Super Admin</span>}</div><div className="text-xs text-muted">{u.email}{u.partner && ` · ${u.partner}`}</div></td>
                  <td className="td text-xs">{ROLE_LABEL[u.role] ?? u.role}{!u.active && <div className="text-muted">{u.invited ? 'Not approved yet' : 'Deactivated'}</div>}{u.active && u.invited && <div className="text-muted">Invited</div>}</td>
                  <td className="td whitespace-nowrap text-xs text-muted" title={u.lastLoginAt ? `Last sign-in ${new Date(u.lastLoginAt).toLocaleString()}` : undefined}>{ago(u.lastSeenAt ?? u.lastLoginAt)}</td>
                  <td className="td text-xs"><button className="text-brand hover:underline" onClick={() => setEditing(editing === u.id ? null : u.id)}>{u.webFeatures} on the web{u.featuresOff.length + u.mobileFeaturesOff.length > 0 && `, ${u.featuresOff.length + u.mobileFeaturesOff.length} taken away`}</button></td>
                  <td className="td"><div className="flex items-center gap-2"><Toggle checked={u.mobileAccess} onChange={(v) => patch(u, { mobileAccess: v }, `${u.name}: mobile app ${v ? 'on' : 'off'}.`)} label={`Mobile app for ${u.name}`} /><span className="text-xs text-muted">{u.mobileEnabled ? `${u.mobileFeatures} features` : u.mobileAccess ? 'Off for the organisation' : 'Off'}</span></div></td>
                  <td className="td">
                    <div className="flex justify-end gap-1.5">
                      {org.platformOwner && u.role === 'ADMIN' && u.active && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => confirm(u.superAdmin ? `Remove Super Admin from ${u.name}?` : `Make ${u.name} a Super Admin? They can then control every organisation.`) && patch(u, { superAdmin: !u.superAdmin }, 'Saved.')}>{u.superAdmin ? 'Remove Super Admin' : 'Make Super Admin'}</button>}
                      {u.active && <button className="btn-ghost px-2 py-1 text-xs" aria-label={`Sign ${u.name} out everywhere`} title="Sign out everywhere" onClick={async () => { if (!confirm(`Sign ${u.name} out of every browser and phone?`)) return; try { await post(`/super-admin/users/${u.id}/sign-out`); setNote(`${u.name} was signed out everywhere.`); } catch (e) { setError(e); } }}><LogOut className="h-3.5 w-3.5" /></button>}
                      {u.active ? <button className="btn-danger px-2 py-1 text-xs" onClick={() => confirm(`Deactivate ${u.name}? They are signed out at once.`) && patch(u, { active: false }, `${u.name} was deactivated.`)}>Deactivate</button>
                        : !u.invited && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => patch(u, { active: true }, `${u.name} was reactivated.`)}>Reactivate</button>}
                    </div>
                  </td>
                </tr>
                {editing === u.id && (
                  <tr className="bg-sunken/40">
                    <td className="td" colSpan={6}>
                      <p className="mb-2 text-xs text-muted">Untick a feature to take it away from {u.name} only (web, or just the app). It stays on for everyone else in {org.name}. Features the organisation does not have are not listed.</p>
                      <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                        {forRole(u).map((f) => {
                          const webOn = !u.featuresOff.includes(f.key);
                          const appOn = webOn && !u.mobileFeaturesOff.includes(f.key);
                          return (
                            <div key={f.key} className="flex items-center gap-3 text-sm">
                              <label className="flex min-w-0 flex-1 items-center gap-2"><input type="checkbox" checked={webOn} onChange={() => patch(u, { featuresOff: webOn ? [...u.featuresOff, f.key] : u.featuresOff.filter((k) => k !== f.key) }, `${f.label} ${webOn ? 'taken away from' : 'given back to'} ${u.name}.`)} /><span className="truncate">{f.label}</span></label>
                              {orgApp.has(f.key) && <label className="flex items-center gap-1 text-xs text-muted" title="In the mobile app"><Smartphone className="h-3.5 w-3.5" />App<input type="checkbox" disabled={!webOn} checked={appOn} onChange={() => patch(u, { mobileFeaturesOff: appOn ? [...u.mobileFeaturesOff, f.key] : u.mobileFeaturesOff.filter((k) => k !== f.key) }, `${f.label} in the app ${appOn ? 'taken away from' : 'given back to'} ${u.name}.`)} aria-label={`${f.label} in the app`} /></label>}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function ActivityTab({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback((before?: string) => get<{ items: ActivityItem[]; next: string | null }>(`/super-admin/activity?organizationId=${orgId}&limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`)
    .then((r) => { setItems((x) => (before ? [...(x ?? []), ...r.items] : r.items)); setNext(r.next); }).catch(setError), [orgId]);
  useEffect(() => { load(); }, [load]);
  if (error) return <ErrorBox error={error} />;
  if (!items) return <Loading />;
  return (
    <Section title="What admins and their users did">
      <ActivityList items={items} showOrg={false} />
      {next && <button className="btn-ghost mt-3 w-full" onClick={() => load(next)}>Show older</button>}
    </Section>
  );
}

interface IntegrationsMatrix { kinds: { kind: string; label: string; group: string; scope: string }[]; organizations: { id: string; integrations: Record<string, { allowed: boolean; saved: boolean; lastTestOk: boolean | null; lastTestAt: string | null; lastTestMessage: string | null; updatedAt: string | null }> }[] }

function IntegrationsTab({ org, run }: { org: OrgDetail; run: Run }) {
  const [m, setM] = useState<IntegrationsMatrix | null>(null);
  const load = useCallback(() => get<IntegrationsMatrix>('/super-admin/integrations').then(setM).catch(() => undefined), []);
  useEffect(() => { load(); }, [load, org]);
  if (!m) return <Loading />;
  const row = m.organizations.find((o) => o.id === org.id);
  return (
    <Section title="Integrations">
      <p className="mb-4 text-sm text-muted">Allow or block each integration for {org.name}. Blocked integrations stop working at once and cannot be set up in their Settings → Integrations. You never see their secrets.</p>
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[680px] text-sm">
          <thead><tr><th className="th">Integration</th><th className="th">Allowed</th><th className="th">Set up</th><th className="th">Last test</th><th className="th" /></tr></thead>
          <tbody>
            {m.kinds.map((k) => {
              const c = row?.integrations[k.kind];
              return (
                <tr key={k.kind} className="border-t border-line">
                  <td className="td"><div className="font-medium">{k.label}</div><div className="text-xs text-muted">{k.group}{k.scope === 'platform' ? ' · app set up once by the server owner' : ''}</div></td>
                  <td className="td">{org.platformOwner ? <span className="text-xs text-muted">Always</span> : <Toggle checked={!!c?.allowed} onChange={(v) => run(() => api(`/super-admin/organizations/${org.id}/features`, { method: 'PUT', json: { changes: [{ feature: `integration.${k.kind}`, channel: 'web', state: v ? 'on' : 'off' }] } }), `${k.label} ${v ? 'allowed' : 'blocked'}.`).then(load)} label={`Allow ${k.label}`} />}</td>
                  <td className="td text-xs">{c?.saved ? <span className="chip bg-ok/15 text-ok">Saved {day(c.updatedAt)}</span> : <span className="text-muted">Not set up</span>}</td>
                  <td className="td text-xs">{c?.lastTestAt ? <span className={c.lastTestOk ? 'text-ok' : 'text-bad'} title={c.lastTestMessage ?? undefined}>{c.lastTestOk ? 'Worked' : 'Failed'} · {ago(c.lastTestAt)}</span> : <span className="text-muted">—</span>}</td>
                  <td className="td text-right">{c?.saved && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => confirm(`Delete ${org.name}'s ${k.label} settings, including its keys? They will have to set it up again.`) && run(() => api(`/super-admin/organizations/${org.id}/integrations/${k.kind}`, { method: 'DELETE' }), 'Settings removed.').then(load)}>Remove settings</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

interface Traffic {
  days: number; liveProjects: number;
  totals: { clicks: number; completes: number; inSurvey: number; incidence: number | null };
  byDay: { day: string; clicks: number; completes: number; terminates: number; quotaFull: number; rejected: number }[];
  topProjects: { id: string; name?: string; workOrderNo?: string | null; status?: string; clicks: number; completes: number }[];
  runsAs: { appName: string | null; domain: string | null; domainVerified: boolean; uidPrefix: string | null };
}

/** Respondent traffic for the Super Admin, also when the organisation runs links on its own domain and name. */
function TrafficTab({ orgId }: { orgId: string }) {
  const [days, setDays] = useState(30);
  const [t, setT] = useState<Traffic | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { setT(null); get<Traffic>(`/super-admin/organizations/${orgId}/traffic?days=${days}`).then(setT).catch(setError); }, [orgId, days]);
  if (error) return <ErrorBox error={error} />;
  if (!t) return <Loading />;
  const max = Math.max(1, ...t.byDay.map((d) => d.clicks));
  const n = (v: number) => v.toLocaleString('en');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Last</span>
        {[7, 30, 90].map((d) => <button key={d} className={clsx('rounded-md px-2.5 py-1', d === days ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')} onClick={() => setDays(d)}>{d} days</button>)}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[['Clicks', n(t.totals.clicks)], ['Completes', n(t.totals.completes)], ['Incidence', t.totals.incidence == null ? '–' : `${t.totals.incidence}%`], ['In a survey now', n(t.totals.inSurvey)], ['Live projects', n(t.liveProjects)]].map(([k, v]) => (
          <div key={k} className="card p-3"><div className="text-xs text-muted">{k}</div><div className="mt-0.5 text-lg font-semibold tabular-nums">{v}</div></div>
        ))}
      </div>
      <Section title="Runs as">
        <p className="text-sm">
          {t.runsAs.appName ? <>Brand name <b>{t.runsAs.appName}</b></> : 'SampTrek name'}
          {' · '}{t.runsAs.domain ? <>links on <b>{t.runsAs.domain}</b> {t.runsAs.domainVerified ? '(verified)' : '(not verified yet, links use the SampTrek address)'}</> : 'links on the SampTrek address'}
          {t.runsAs.uidPrefix ? <> · respondent IDs start with <b>{t.runsAs.uidPrefix}</b></> : null}
        </p>
        <p className="mt-1 text-xs text-muted">Whatever name and domain they use, all traffic is counted here, and Observe opens their workspace read-only.</p>
      </Section>
      <Section title="Clicks and completes per day">
        <div className="flex h-40 items-end gap-0.5" role="img" aria-label={`Clicks per day for the last ${t.days} days`}>
          {t.byDay.map((d) => (
            <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.day}: ${n(d.clicks)} clicks, ${n(d.completes)} completes`}>
              <div className="w-full rounded-t-sm bg-brand/30" style={{ height: `${(d.clicks - d.completes) / max * 100}%` }} />
              <div className="w-full bg-brand" style={{ height: `${d.completes / max * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted"><span>{t.byDay[0]?.day}</span><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-brand" />completes <span className="ml-2 mr-1 inline-block h-2 w-2 rounded-sm bg-brand/30" />other clicks</span><span>{t.byDay.at(-1)?.day}</span></div>
      </Section>
      <Section title="Busiest projects">
        {t.topProjects.length === 0 ? <p className="text-sm text-muted">No live traffic in this period.</p> : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr><th className="th">Project</th><th className="th">Status</th><th className="th text-right">Clicks</th><th className="th text-right">Completes</th></tr></thead>
              <tbody>{t.topProjects.map((p) => <tr key={p.id} className="border-t border-line"><td className="td">{p.name}{p.workOrderNo ? <span className="ml-2 text-xs text-muted">{p.workOrderNo}</span> : null}</td><td className="td text-xs">{p.status}</td><td className="td text-right tabular-nums">{n(p.clicks)}</td><td className="td text-right tabular-nums">{n(p.completes)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
