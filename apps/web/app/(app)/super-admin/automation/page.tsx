'use client';
import clsx from 'clsx';
import { ArrowDown, Bot, Play, Plus, Sparkles, Trash2, X, Zap } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ErrorBox, Loading, PageHeader, Section, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { ago, SUB_STATUS, type Action, type AutomationCatalog, type Catalog, type Plan, type Rule, type SubStatus } from '@/lib/super-admin';
import { Label } from '@/components/help';

interface Run { id: string; createdAt: string; status: string; dedupeKey: string; detail: { results?: { action: string; ok: boolean; message?: string }[] } | null; rule: { id: string; name: string }; organization: { id: string; name: string } | null }
type Draft = { id?: string; name: string; enabled: boolean; trigger: string; days: number | null; plans: string[]; statuses: SubStatus[]; actions: Action[] };

const defaults: Record<string, Action> = {
  email_org_admins: { type: 'email_org_admins', subject: 'About your SampTrek account', message: 'Hello {{org}}, ' },
  email_super_admins: { type: 'email_super_admins', subject: '{{org}}: ', message: '' },
  create_task: { type: 'create_task', title: 'Follow up with {{org}}' },
  approve_registration: { type: 'approve_registration', planCode: 'starter', trialDays: 14 },
  set_subscription_status: { type: 'set_subscription_status', status: 'PAST_DUE' },
  change_plan: { type: 'change_plan', planCode: 'starter' },
  extend_subscription: { type: 'extend_subscription', days: 30 },
  suspend_org: { type: 'suspend_org' },
  activate_org: { type: 'activate_org' },
  set_feature: { type: 'set_feature', feature: 'copilot', channel: 'web', state: 'off' },
};

function sentence(r: { trigger: string; triggerConfig: { days?: number }; conditions: { plans?: string[]; statuses?: string[] }; actions: Action[] }, cat: AutomationCatalog, plans: Plan[]) {
  const t = cat.triggers.find((x) => x.type === r.trigger);
  const days = t?.days ? ` (${r.triggerConfig.days ?? t.days.default} ${t.days.label.toLowerCase()})` : '';
  const ifs = [r.conditions.plans?.length && `plan is ${r.conditions.plans.map((c) => plans.find((p) => p.code === c)?.name ?? c).join(' or ')}`, r.conditions.statuses?.length && `status is ${r.conditions.statuses.map((s) => SUB_STATUS[s as SubStatus]?.[0] ?? s).join(' or ')}`].filter(Boolean);
  return { when: `${t?.label ?? r.trigger}${days}`, ifs: ifs.join(' and '), then: r.actions.map((a) => cat.actions.find((x) => x.type === a.type)?.label ?? a.type) };
}

export default function AutomationPage() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<{ event: boolean; organizations: { id: string; name: string; alreadyHandled: boolean; date?: string }[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => Promise.all([get<Rule[]>('/super-admin/automations').then(setRules), get<Run[]>('/super-admin/automations/runs').then(setRuns)]).catch(setError), []);
  useEffect(() => { load(); get<Catalog>('/super-admin/catalog').then(setCatalog).catch(setError); get<Plan[]>('/super-admin/plans').then(setPlans).catch(setError); }, [load]);
  if (!rules || !catalog) return error ? <ErrorBox error={error} /> : <Loading />;
  const cat = catalog.automation;
  const go = async (fn: () => Promise<unknown>, done?: string) => { setError(null); setNote(null); try { await fn(); if (done) setNote(done); await load(); } catch (e) { setError(e); } };

  const body = (d: Draft) => ({
    name: d.name, enabled: d.enabled, trigger: d.trigger, triggerConfig: d.days == null ? {} : { days: d.days },
    conditions: { ...(d.plans.length ? { plans: d.plans } : {}), ...(d.statuses.length ? { statuses: d.statuses } : {}) }, actions: d.actions,
  });
  const edit = (r?: Rule) => {
    setPreview(null);
    setDraft(r ? { id: r.id, name: r.name, enabled: r.enabled, trigger: r.trigger, days: r.triggerConfig.days ?? null, plans: r.conditions.plans ?? [], statuses: r.conditions.statuses ?? [], actions: r.actions }
      : { name: '', enabled: true, trigger: 'subscription.expiring', days: 7, plans: [], statuses: [], actions: [defaults.email_org_admins] });
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    await go(() => (draft.id ? api(`/super-admin/automations/${draft.id}`, { method: 'PATCH', json: body(draft) }) : post('/super-admin/automations', body(draft))), `“${draft.name}” saved.`);
    setDraft(null);
  }
  const trig = draft ? cat.triggers.find((t) => t.type === draft.trigger) : null;
  const setAction = (i: number, a: Action) => draft && setDraft({ ...draft, actions: draft.actions.map((x, j) => (j === i ? a : x)) });

  return (
    <>
      <PageHeader title="Automation" subtitle="Rules that run by themselves: when something happens to an organisation, SampTrek emails, reminds, changes the plan or pauses access for you. Time rules are checked every hour."
        actions={<>
          <button className="btn-ghost" onClick={() => go(() => post('/super-admin/automations/run'), 'Checked every time rule now.')}><Play className="h-4 w-4" />Run time rules now</button>
          <button className="btn-primary" onClick={() => edit()}><Plus className="h-4 w-4" />New rule</button>
        </>} />
      <ErrorBox error={error} />
      {note && <div className="mb-4 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">{note}</div>}

      {draft && (
        <form onSubmit={save} className="mb-6">
          <Section title={draft.id ? 'Edit rule' : 'New rule'} actions={<button type="button" className="text-muted hover:text-ink" aria-label="Close" onClick={() => setDraft(null)}><X className="h-4 w-4" /></button>}>
            <label className="mb-5 block max-w-md"><Label>Name</Label><input className="input" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Renewal reminder" /></label>
            <div className="space-y-3">
              <div className="rounded-xl border border-brand/30 bg-brand/5 p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand"><Zap className="h-3.5 w-3.5" />When</div>
                <div className="flex flex-wrap items-end gap-3">
                  <select className="input w-auto" aria-label="When" value={draft.trigger} onChange={(e) => { const t = cat.triggers.find((x) => x.type === e.target.value); setDraft({ ...draft, trigger: e.target.value, days: t?.days ? t.days.default : null }); }}>
                    {cat.triggers.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                  </select>
                  {trig?.days && <label className="flex items-center gap-2 text-sm"><input className="input w-20" type="number" min={0} max={3650} value={draft.days ?? trig.days.default} onChange={(e) => setDraft({ ...draft, days: Number(e.target.value) })} aria-label={trig.days.label} />{trig.days.label.toLowerCase()}</label>}
                </div>
                <p className="mt-2 text-xs text-muted">{trig?.detail} {trig?.kind === 'event' ? 'Runs at once.' : 'Checked every hour; acts once per organisation and date.'}</p>
              </div>
              <ArrowDown className="mx-auto h-4 w-4 text-muted" />
              <div className="rounded-xl border border-line p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Only if (optional)</div>
                <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
                  <div><div className="mb-1 text-xs text-muted">Plan is</div><div className="flex flex-wrap gap-2">{plans.map((p) => <label key={p.code} className="flex items-center gap-1.5"><input type="checkbox" checked={draft.plans.includes(p.code)} onChange={() => setDraft({ ...draft, plans: draft.plans.includes(p.code) ? draft.plans.filter((c) => c !== p.code) : [...draft.plans, p.code] })} />{p.name}</label>)}</div></div>
                  <div><div className="mb-1 text-xs text-muted">Subscription status is</div><div className="flex flex-wrap gap-2">{(Object.keys(SUB_STATUS) as SubStatus[]).map((s) => <label key={s} className="flex items-center gap-1.5"><input type="checkbox" checked={draft.statuses.includes(s)} onChange={() => setDraft({ ...draft, statuses: draft.statuses.includes(s) ? draft.statuses.filter((c) => c !== s) : [...draft.statuses, s] })} />{SUB_STATUS[s][0]}</label>)}</div></div>
                </div>
              </div>
              <ArrowDown className="mx-auto h-4 w-4 text-muted" />
              <div className="rounded-xl border border-ok/30 bg-ok/5 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-ok">Then</div>
                <div className="space-y-3">
                  {draft.actions.map((a, i) => (
                    <div key={i} className="rounded-lg border border-line bg-panel p-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sunken text-xs font-semibold">{i + 1}</span>
                        <select className="input h-9 flex-1 py-0 text-sm" aria-label={`Action ${i + 1}`} value={a.type} onChange={(e) => setAction(i, defaults[e.target.value])}>{cat.actions.map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}</select>
                        {draft.actions.length > 1 && <button type="button" className="text-muted hover:text-bad" aria-label="Remove action" onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>}
                      </div>
                      <ActionFields a={a} onChange={(x) => setAction(i, x)} plans={plans} catalog={catalog} />
                    </div>
                  ))}
                  {draft.actions.length < 10 && <button type="button" className="btn-ghost text-sm" onClick={() => setDraft({ ...draft, actions: [...draft.actions, defaults.email_super_admins] })}><Plus className="h-4 w-4" />Add another action</button>}
                  <p className="text-xs text-muted">In emails and tasks, {'{{org}}'} is the organisation, {'{{plan}}'} its plan, {'{{date}}'} the date and {'{{days}}'} the number of days.</p>
                </div>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button className="btn-primary">Save rule</button>
              <button type="button" className="btn-ghost" onClick={async () => { setError(null); try { setPreview(await post('/super-admin/automations/preview', body(draft))); } catch (e) { setError(e); } }}>Who would it act on now?</button>
              <label className="ml-auto flex items-center gap-2 text-sm"><Toggle checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} label="Rule on" />{draft.enabled ? 'On' : 'Off'}</label>
            </div>
            {preview && (
              <div className="mt-3 rounded-lg bg-sunken p-3 text-sm">
                {preview.event ? 'This rule runs by itself when the event happens.' : preview.organizations.length === 0 ? 'No organisation matches right now.' : (
                  <>Matches now: {preview.organizations.map((o) => `${o.name}${o.date ? ` (${o.date})` : ''}${o.alreadyHandled ? ', already handled' : ''}`).join(' · ')}</>
                )}
              </div>
            )}
          </Section>
        </form>
      )}

      <Section title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" />Ready-made recipes: add with one click, change later</span>} className="mb-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cat.recipes.map((r) => {
            const added = rules.some((x) => x.recipe === r.id);
            return (
              <div key={r.id} className="flex items-start gap-3 rounded-lg border border-line p-3">
                <div className="min-w-0 flex-1"><div className="text-sm font-medium">{r.name}</div><div className="text-xs text-muted">{r.summary}</div></div>
                <button className={clsx('shrink-0 px-2.5 py-1 text-xs', added ? 'btn-ghost' : 'btn-primary')} disabled={added} onClick={() => go(() => post(`/super-admin/automations/recipes/${r.id}`), `“${r.name}” added and on.`)}>{added ? 'Added' : 'Add'}</button>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-brand" />Your rules ({rules.length})</span>} className="mb-6">
        {rules.length === 0 ? <p className="text-sm text-muted">No rules yet. Add a recipe above, or make your own with New rule.</p> : (
          <ul className="divide-y divide-line">
            {rules.map((r) => {
              const s = sentence(r, cat, plans);
              const event = cat.triggers.find((t) => t.type === r.trigger)?.kind === 'event';
              return (
                <li key={r.id} className={clsx('flex flex-wrap items-start gap-3 py-3', !r.enabled && 'opacity-60')}>
                  <Toggle checked={r.enabled} onChange={(v) => go(() => api(`/super-admin/automations/${r.id}`, { method: 'PATCH', json: { enabled: v } }))} label={`${r.name} on`} />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted"><b className="text-brand">When</b> {s.when}{s.ifs && <> · <b>only if</b> {s.ifs}</>} · <b className="text-ok">then</b> {s.then.join(', then ')}</div>
                    <div className="text-xs text-muted">Acted {r.runCount} time{r.runCount === 1 ? '' : 's'}{r.lastRunAt && ` · last checked ${ago(r.lastRunAt)}`}</div>
                  </div>
                  <div className="flex gap-1.5">
                    {!event && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => go(async () => { const x = await post<{ acted: number }>(`/super-admin/automations/${r.id}/run`); setNote(`“${r.name}” acted on ${x.acted} organisation${x.acted === 1 ? '' : 's'}.`); })}><Play className="h-3.5 w-3.5" />Run</button>}
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => edit(r)}>Edit</button>
                    <button className="btn-ghost px-2 py-1 text-xs" aria-label={`Delete ${r.name}`} onClick={() => confirm(`Delete “${r.name}”?`) && go(() => api(`/super-admin/automations/${r.id}`, { method: 'DELETE' }))}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Run log">
        {runs.length === 0 ? <p className="text-sm text-muted">Nothing has run yet.</p> : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr><th className="th">When</th><th className="th">Rule</th><th className="th">Organisation</th><th className="th">Result</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="td whitespace-nowrap text-xs text-muted">{ago(r.createdAt)}</td>
                    <td className="td">{r.rule.name}</td>
                    <td className="td">{r.organization?.name ?? '—'}</td>
                    <td className="td text-xs"><span className={clsx('chip mr-1.5', r.status === 'ok' ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad')}>{r.status === 'ok' ? 'Done' : r.status === 'running' ? 'Running' : 'Failed'}</span>{r.detail?.results?.map((x) => x.message).filter(Boolean).join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function ActionFields({ a, onChange, plans, catalog }: { a: Action; onChange: (a: Action) => void; plans: Plan[]; catalog: Catalog }) {
  const set = (k: string, v: unknown) => onChange({ ...a, [k]: v });
  const str = (k: string) => String(a[k] ?? '');
  switch (a.type) {
    case 'email_org_admins':
    case 'email_super_admins':
      return (
        <div className="mt-3 grid gap-2">
          <input className="input" aria-label="Subject" placeholder="Subject" required value={str('subject')} onChange={(e) => set('subject', e.target.value)} />
          <textarea className="input min-h-[80px]" aria-label="Message" placeholder="Message" required value={str('message')} onChange={(e) => set('message', e.target.value)} />
        </div>
      );
    case 'create_task':
      return <input className="input mt-3" aria-label="Task title" required value={str('title')} onChange={(e) => set('title', e.target.value)} />;
    case 'approve_registration':
      return (
        <div className="mt-3 flex flex-wrap gap-2">
          <select className="input w-auto" aria-label="Plan" value={str('planCode')} onChange={(e) => set('planCode', e.target.value || null)}><option value="">Their requested plan, else the default</option>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
          <label className="flex items-center gap-2 text-sm"><input className="input w-20" type="number" min={0} max={365} value={Number(a.trialDays ?? 0)} onChange={(e) => set('trialDays', Number(e.target.value))} aria-label="Trial days" />trial days</label>
        </div>
      );
    case 'set_subscription_status':
      return <select className="input mt-3 w-auto" aria-label="Status" value={str('status')} onChange={(e) => set('status', e.target.value)}>{(Object.keys(SUB_STATUS) as SubStatus[]).map((s) => <option key={s} value={s}>{SUB_STATUS[s][0]}</option>)}</select>;
    case 'change_plan':
      return <select className="input mt-3 w-auto" aria-label="Plan" value={str('planCode')} onChange={(e) => set('planCode', e.target.value)}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>;
    case 'extend_subscription':
      return <label className="mt-3 flex items-center gap-2 text-sm"><input className="input w-24" type="number" min={1} max={3650} value={Number(a.days ?? 30)} onChange={(e) => set('days', Number(e.target.value))} aria-label="Days" />days</label>;
    case 'set_feature':
      return (
        <div className="mt-3 flex flex-wrap gap-2">
          <select className="input w-auto" aria-label="Feature" value={str('feature')} onChange={(e) => set('feature', e.target.value)}>{catalog.features.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
          <select className="input w-auto" aria-label="Where" value={str('channel')} onChange={(e) => set('channel', e.target.value)}><option value="web">On the web</option><option value="mobile">In the app</option></select>
          <select className="input w-auto" aria-label="State" value={str('state')} onChange={(e) => set('state', e.target.value)}><option value="on">On</option><option value="off">Off</option><option value="plan">Follow the plan</option></select>
        </div>
      );
    default:
      return null;
  }
}
