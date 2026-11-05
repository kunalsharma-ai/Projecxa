'use client';
import clsx from 'clsx';
import { Globe, Plus, Smartphone, Trash2 } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorBox, Loading, PageHeader, Section, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { fmtMoney, type Catalog, type Plan } from '@/lib/super-admin';

type Draft = Omit<Plan, 'id' | 'organizations'> & { id?: string };
const blank = (): Draft => ({ code: '', name: '', description: '', priceLabel: '', features: [], mobileFeatures: [], mobileEnabled: true, maxUsers: null, maxProjects: null, active: true, sortOrder: 10, currency: 'INR', priceMonthly: null, priceYearly: null });

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => get<Plan[]>('/super-admin/plans').then(setPlans).catch(setError), []);
  useEffect(() => { load(); get<Catalog>('/super-admin/catalog').then(setCatalog).catch(setError); }, [load]);
  const groups = useMemo(() => catalog?.groups ?? [], [catalog]);
  if (!plans || !catalog) return error ? <ErrorBox error={error} /> : <Loading />;

  const toggle = (list: 'features' | 'mobileFeatures', key: string) => draft && setDraft({ ...draft, [list]: draft[list].includes(key) ? draft[list].filter((k) => k !== key) : [...draft[list], key] });
  const setGroup = (list: 'features' | 'mobileFeatures', g: string, on: boolean) => {
    if (!draft) return;
    const keys = catalog.features.filter((f) => f.group === g && (list === 'features' || f.mobile)).map((f) => f.key);
    setDraft({ ...draft, [list]: on ? [...new Set([...draft[list], ...keys])] : draft[list].filter((k) => !keys.includes(k)) });
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setError(null); setNote(null);
    const { id, code, ...rest } = draft;
    const price = (v: number | string | null) => (v === '' || v == null ? null : Number(v));
    const body = { ...rest, description: rest.description || null, priceLabel: rest.priceLabel || null, priceMonthly: price(rest.priceMonthly), priceYearly: price(rest.priceYearly) };
    try {
      if (id) await api(`/super-admin/plans/${id}`, { method: 'PATCH', json: body });
      else await post('/super-admin/plans', { code, ...body, active: undefined });
      setNote(id ? `${draft.name} saved. Every organisation on it got the change at once.` : `${draft.name} created.`);
      setDraft(null);
      load();
    } catch (err) { setError(err); }
  }
  const remove = async (p: Plan) => {
    if (!confirm(`Delete the ${p.name} plan?`)) return;
    try { await api(`/super-admin/plans/${p.id}`, { method: 'DELETE' }); load(); } catch (e) { setError(e); }
  };

  return (
    <>
      <PageHeader title="Plans and features" subtitle="A plan is a package of features for the web and the mobile app, with user and project limits and a price organisations pay online or offline (Billing)."
        actions={<button className="btn-primary" onClick={() => setDraft(blank())}><Plus className="h-4 w-4" />New plan</button>} />
      <ErrorBox error={error} />
      {note && <div className="mb-4 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">{note}</div>}
      {!draft && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => (
            <div key={p.id} className={clsx('card flex flex-col p-5', !p.active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div><div className="text-lg font-semibold">{p.name}</div><div className="text-xs text-muted">{p.code}{!p.active && ' · turned off'}</div></div>
                {(p.priceMonthly != null || p.priceYearly != null) ? (
                  <div className="text-right text-sm font-medium tabular-nums">
                    {p.priceMonthly != null && <div>{fmtMoney(p.currency, p.priceMonthly)}<span className="text-xs font-normal text-muted"> /month</span></div>}
                    {p.priceYearly != null && <div>{fmtMoney(p.currency, p.priceYearly)}<span className="text-xs font-normal text-muted"> /year</span></div>}
                  </div>
                ) : p.priceLabel ? <div className="text-right text-sm font-medium">{p.priceLabel}</div> : <div className="text-right text-xs text-muted">No price: not sold online</div>}
              </div>
              {p.description && <p className="mt-2 text-sm text-muted">{p.description}</p>}
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-sunken p-2"><Globe className="mb-1 h-4 w-4 text-muted" /><b className="tabular-nums">{p.features.length}</b> <span className="text-muted">/ {catalog.features.length} web</span></div>
                <div className="rounded-lg bg-sunken p-2"><Smartphone className="mb-1 h-4 w-4 text-muted" />{p.mobileEnabled ? <><b className="tabular-nums">{p.mobileFeatures.length}</b> <span className="text-muted">in the app</span></> : <span className="text-muted">No app</span>}</div>
              </div>
              <p className="mt-3 text-xs text-muted">Users: {p.maxUsers ?? 'no limit'} · Projects: {p.maxProjects ?? 'no limit'} · {p.organizations} organisation{p.organizations === 1 ? '' : 's'}</p>
              <div className="mt-auto flex gap-2 pt-4">
                <button className="btn-ghost flex-1" onClick={() => setDraft({ ...p })}>Edit</button>
                {p.organizations === 0 && <button className="btn-ghost px-2.5" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}><Trash2 className="h-4 w-4" /></button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {draft && (
        <form onSubmit={save} className="space-y-6">
          <Section title={draft.id ? `Edit ${draft.name}` : 'New plan'}>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="block"><span className="label">Name</span><input className="input" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <label className="block"><span className="label">Code</span><input className="input" required disabled={!!draft.id} pattern="[a-z0-9_-]{2,40}" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toLowerCase() })} placeholder="e.g. growth" /></label>
              <label className="block"><span className="label">Price label (optional)</span><input className="input" value={draft.priceLabel ?? ''} onChange={(e) => setDraft({ ...draft, priceLabel: e.target.value })} placeholder="e.g. Talk to us" /></label>
              <label className="block"><span className="label">Currency</span><input className="input uppercase" required maxLength={3} pattern="[A-Za-z]{3}" value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} placeholder="INR" /></label>
              <label className="block"><span className="label">Monthly price (empty = not monthly)</span><input className="input" type="number" min={0} step="0.01" value={draft.priceMonthly ?? ''} onChange={(e) => setDraft({ ...draft, priceMonthly: e.target.value })} placeholder="e.g. 4999" /></label>
              <label className="block"><span className="label">Yearly price (empty = not yearly)</span><input className="input" type="number" min={0} step="0.01" value={draft.priceYearly ?? ''} onChange={(e) => setDraft({ ...draft, priceYearly: e.target.value })} placeholder="e.g. 49990" /></label>
              <label className="block md:col-span-3"><span className="label">Description</span><input className="input" value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
              <label className="block"><span className="label">User limit (empty = none)</span><input className="input" type="number" min={0} value={draft.maxUsers ?? ''} onChange={(e) => setDraft({ ...draft, maxUsers: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              <label className="block"><span className="label">Project limit (empty = none)</span><input className="input" type="number" min={0} value={draft.maxProjects ?? ''} onChange={(e) => setDraft({ ...draft, maxProjects: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              <div className="flex flex-col justify-end gap-2">
                <label className="flex items-center gap-2 text-sm"><Toggle checked={draft.mobileEnabled} onChange={(v) => setDraft({ ...draft, mobileEnabled: v })} label="Mobile app" />Android and iOS app included</label>
                {draft.id && <label className="flex items-center gap-2 text-sm"><Toggle checked={draft.active} onChange={(v) => setDraft({ ...draft, active: v })} label="Offered" />Offered for new organisations</label>}
              </div>
            </div>
          </Section>
          <Section title="Features in this plan">
            <div className="space-y-5">
              {groups.map((g) => {
                const fs = catalog.features.filter((f) => f.group === g);
                return (
                  <div key={g}>
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      <h3 className="text-sm font-semibold">{g}</h3>
                      <button type="button" className="text-xs text-brand hover:underline" onClick={() => setGroup('features', g, true)}>All on the web</button>
                      <button type="button" className="text-xs text-muted hover:underline" onClick={() => setGroup('features', g, false)}>None</button>
                      {fs.some((f) => f.mobile) && <><button type="button" className="text-xs text-brand hover:underline" onClick={() => setGroup('mobileFeatures', g, true)}>All in the app</button><button type="button" className="text-xs text-muted hover:underline" onClick={() => setGroup('mobileFeatures', g, false)}>None in the app</button></>}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {fs.map((f) => (
                        <div key={f.key} className="flex items-start gap-3 rounded-lg border border-line p-2.5">
                          <div className="min-w-0 flex-1"><div className="text-sm font-medium">{f.label}</div><div className="text-xs text-muted">{f.summary}</div></div>
                          <label className="flex items-center gap-1 text-xs text-muted" title="On the web"><Globe className="h-3.5 w-3.5" /><input type="checkbox" checked={draft.features.includes(f.key)} onChange={() => toggle('features', f.key)} aria-label={`${f.label} on the web`} /></label>
                          {f.mobile ? <label className="flex items-center gap-1 text-xs text-muted" title="In the mobile app"><Smartphone className="h-3.5 w-3.5" /><input type="checkbox" disabled={!draft.mobileEnabled} checked={draft.mobileFeatures.includes(f.key)} onChange={() => toggle('mobileFeatures', f.key)} aria-label={`${f.label} in the app`} /></label> : <span className="w-8" />}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
          <div className="flex gap-2"><button className="btn-primary">{draft.id ? 'Save plan' : 'Create plan'}</button><button type="button" className="btn-ghost" onClick={() => setDraft(null)}>Cancel</button></div>
        </form>
      )}
    </>
  );
}
