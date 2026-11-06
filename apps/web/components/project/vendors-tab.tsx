'use client';
import clsx from 'clsx';
import { AlertTriangle, Check, Copy, MessageSquareQuote, Pause, Pencil, Play, Plus, Save, Sparkles } from 'lucide-react';
import { QuotesPanel } from './quotes-panel';
import { VendorSuggestions } from './vendor-suggestions';
import { VendorTitle } from './vendor-title';
import { useEffect, useMemo, useState } from 'react';
import { Combobox } from '@/components/form/combobox';
import { Empty, ErrorBox, Field, Progress, Section, StatusChip, money } from '@/components/ui';
import { get, patch, post } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import type { Option } from '@/lib/types';
import { withPayoutCheck } from './payout';
import { BulkFill } from './bulk-fill';
import { CopyIcon, copyText } from '@/components/copy';
import type { Allocation, Country, ProjectDetail } from './types';

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn-ghost px-2 py-1 text-xs"
      onClick={async () => {
        if (!(await copyText(text))) return;
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />} {label}
    </button>
  );
}

const marketName = (c: Pick<Country, 'countryCode' | 'targetGroup'>) => `${countryName(c.countryCode)}${c.targetGroup ? ` · ${c.targetGroup}` : ''}`;
const EMPTY_FORM = { vendorId: '', cpi: '', targetCompletes: '', uidParam: 'vid', applyToAll: false };

export function VendorsTab({ project, editable, reload }: { project: ProjectDetail; editable: boolean; reload: () => void }) {
  const [vendors, setVendors] = useState<Option[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<{ id: string; cpi: string; targetCompletes: string; uidParam: string } | null>(null);
  const [view, setView] = useState<'market' | 'vendor'>('market');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    get<Option[]>('/vendors').then(setVendors).catch(setError);
  }, []);

  async function add(countryId: string) {
    setError(null);
    const targets = form.applyToAll ? project.countries.filter((c) => !c.allocations.some((a) => a.vendorId === form.vendorId)) : project.countries.filter((c) => c.id === countryId);
    try {
      let allowAbove = false;
      for (const c of targets) {
        const done = await withPayoutCheck((allowAboveCpi) =>
          post(`/projects/${project.id}/countries/${c.id}/allocations`, {
            vendorId: form.vendorId,
            cpi: Number(form.cpi),
            targetCompletes: Number(form.targetCompletes || c.targetCompletes),
            uidParam: form.uidParam || 'vid',
            allowAboveCpi: allowAboveCpi || allowAbove,
          }).then((r) => {
            if (allowAboveCpi) allowAbove = true; // asked once for the whole batch
            return r;
          }),
        );
        if (!done) break;
      }
      setAdding(null);
      setForm(EMPTY_FORM);
      reload();
    } catch (e) {
      setError(e);
      reload();
    }
  }

  async function toggle(countryId: string, allocationId: string, status: string) {
    try {
      await patch(`/projects/${project.id}/countries/${countryId}/allocations/${allocationId}`, { status: status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' });
      reload();
    } catch (e) {
      setError(e);
    }
  }

  async function saveEdit(countryId: string) {
    if (!editing) return;
    setError(null);
    try {
      const done = await withPayoutCheck((allowAboveCpi) =>
        patch(`/projects/${project.id}/countries/${countryId}/allocations/${editing.id}`, {
          cpi: Number(editing.cpi),
          targetCompletes: Number(editing.targetCompletes),
          uidParam: editing.uidParam.trim() || 'vid',
          allowAboveCpi,
        }),
      );
      if (!done) return;
      setEditing(null);
      reload();
    } catch (e) {
      setError(e);
    }
  }

  /** One payout for a vendor in every market it works in ("apply to all"). */
  async function payoutEverywhere(vendorId: string, cpi: number) {
    setError(null);
    let allowAbove = false;
    try {
      for (const c of project.countries) {
        const a = c.allocations.find((x) => x.vendorId === vendorId);
        if (!a) continue;
        const done = await withPayoutCheck((allowAboveCpi) =>
          patch(`/projects/${project.id}/countries/${c.id}/allocations/${a.id}`, { cpi, allowAboveCpi: allowAboveCpi || allowAbove }).then((r) => {
            if (allowAboveCpi) allowAbove = true;
            return r;
          }),
        );
        if (!done) break;
      }
    } catch (e) {
      setError(e);
    }
    reload();
  }

  /** "Apply to all" for vendor links: payout, target and link variable on every vendor link (or one vendor / one market). */
  const [scope, setScope] = useState({ vendorId: '', countryId: '' });
  const scoped = useMemo(
    () => project.countries.flatMap((c) => (scope.countryId && c.id !== scope.countryId ? [] : c.allocations.filter((a) => !scope.vendorId || a.vendorId === scope.vendorId).map((a) => ({ c, a })))),
    [project.countries, scope],
  );
  async function applyToLinks(v: Record<string, string>) {
    setError(null);
    let allowAbove = false;
    try {
      for (const { c, a } of scoped) {
        const body: Record<string, unknown> = {};
        if (v.cpi !== undefined) body.cpi = Number(v.cpi);
        if (v.targetCompletes !== undefined) body.targetCompletes = Number(v.targetCompletes);
        if (v.uidParam !== undefined) body.uidParam = v.uidParam.trim() || 'vid';
        const done = await withPayoutCheck((allowAboveCpi) =>
          patch(`/projects/${project.id}/countries/${c.id}/allocations/${a.id}`, { ...body, ...(body.cpi !== undefined ? { allowAboveCpi: allowAboveCpi || allowAbove } : {}) }).then((r) => {
            if (allowAboveCpi) allowAbove = true; // asked once for the whole batch
            return r;
          }),
        );
        if (!done) break;
      }
    } catch (e) {
      setError(e);
    }
    reload();
  }
  async function setLinksStatus(status: 'ACTIVE' | 'PAUSED') {
    setError(null);
    try {
      for (const { c, a } of scoped) if (a.status !== status) await patch(`/projects/${project.id}/countries/${c.id}/allocations/${a.id}`, { status });
    } catch (e) {
      setError(e);
    }
    reload();
  }
  /** Every entry link as rows (market, vendor, live, test) that paste straight into Excel or an email. */
  const allLinks = useMemo(
    () =>
      ['Market\tVendor\tLive link\tTest link', ...project.countries.flatMap((c) => c.allocations.map((a) => [marketName(c), a.vendor.name, a.uniqueLinksOnly ? 'Unique links only' : a.entryLink, a.testEntryLink].join('\t')))].join('\n'),
    [project.countries],
  );

  const byVendor = useMemo(() => {
    const m = new Map<string, { vendor: Allocation['vendor']; rows: { c: Country; a: Allocation }[] }>();
    for (const c of project.countries)
      for (const a of c.allocations) {
        const v = m.get(a.vendorId) ?? { vendor: a.vendor, rows: [] };
        v.rows.push({ c, a });
        m.set(a.vendorId, v);
      }
    return [...m.values()].sort((x, y) => x.vendor.name.localeCompare(y.vendor.name));
  }, [project.countries]);

  return (
    <div className="space-y-6">
      <VendorTitle project={project} editable={editable} reload={reload} />
      <ErrorBox error={error} />
      <Section
        title="Vendors per market"
        actions={
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-sunken p-1 text-xs" role="radiogroup" aria-label="Group vendors">
            {(['market', 'vendor'] as const).map((v) => (
              <button key={v} role="radio" aria-checked={view === v} onClick={() => setView(v)} className={clsx('rounded-md px-3 py-1 font-semibold', view === v ? 'bg-panel text-brand shadow-sm' : 'text-muted')}>
                By {v}
              </button>
            ))}
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          {project.countries.map((c) => (
            <a key={c.id} href={`#market-${c.id}`} onClick={() => setView('market')} className={clsx('chip border px-2.5 py-1 hover:border-brand', c.allocations.length ? 'border-line bg-panel' : 'border-warn/50 bg-warn/10')}>
              <span className="mr-1">{flag(c.countryCode)}</span>
              {marketName(c)}
              <span className={clsx('ml-1.5 rounded-full px-1.5 text-[11px] font-semibold tabular-nums', c.allocations.length ? 'bg-brand/10 text-brand' : 'bg-warn/20 text-warn')}>{c.allocations.length}</span>
            </a>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span>
            {project.countries.length} {project.countries.length === 1 ? 'market' : 'markets'}, {byVendor.length} {byVendor.length === 1 ? 'vendor' : 'vendors'}. Each vendor gets its own entry link per market. Replace <code className="rounded bg-sunken px-1">[UID]</code> with the vendor&apos;s respondent ID macro. Test links are never billed.
          </span>
          {byVendor.length > 0 && <CopyButton text={allLinks} label="Copy all links" />}
        </p>
        {editable && byVendor.length > 0 && (
          <div className="mt-4">
            <BulkFill
              selected={0}
              total={scoped.length}
              onApply={applyToLinks}
              noun={['vendor link', 'vendor links']}
              hint="Fill in only what should change, then apply. Pick a vendor or market to change just those links."
              fields={[
                { key: 'cpi', label: `Payout (${project.countries[0]?.currency ?? ''})`, type: 'number', step: '0.01', width: 'w-24' },
                { key: 'targetCompletes', label: 'Target completes', type: 'number', width: 'w-28' },
                { key: 'uidParam', label: 'Link variable', width: 'w-24', placeholder: 'vid' },
              ]}
              extra={
                <div className="flex flex-wrap items-end gap-1.5">
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] font-medium text-muted">Vendor</span>
                    <select className="input px-2 py-1 text-sm" aria-label="Apply to vendor" value={scope.vendorId} onChange={(e) => setScope({ ...scope, vendorId: e.target.value })}>
                      <option value="">All vendors</option>
                      {byVendor.map(({ vendor }) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] font-medium text-muted">Market</span>
                    <select className="input px-2 py-1 text-sm" aria-label="Apply to market" value={scope.countryId} onChange={(e) => setScope({ ...scope, countryId: e.target.value })}>
                      <option value="">All markets</option>
                      {project.countries.map((c) => <option key={c.id} value={c.id}>{marketName(c)}</option>)}
                    </select>
                  </label>
                  <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" disabled={!scoped.length} onClick={() => setLinksStatus('ACTIVE')}><Play className="h-3.5 w-3.5" /> Resume</button>
                  <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" disabled={!scoped.length} onClick={() => setLinksStatus('PAUSED')}><Pause className="h-3.5 w-3.5" /> Pause</button>
                </div>
              }
            />
          </div>
        )}
      </Section>

      {view === 'vendor' &&
        (byVendor.length === 0 ? (
          <Empty>No vendors yet. Switch to “By market” to add them.</Empty>
        ) : (
          byVendor.map(({ vendor, rows }) => (
            <Section key={vendor.id} help="project.vendorCard" title={<span>{vendor.name} <span className="font-normal text-muted">· {vendor.code} · {rows.length} {rows.length === 1 ? 'market' : 'markets'}</span></span>} actions={editable && rows.length > 1 && <PayoutEverywhere currency={rows[0].c.currency} onApply={(cpi) => payoutEverywhere(vendor.id, cpi)} />}>
              <div className="-m-5 overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead className="border-b border-line bg-sunken/60"><tr><th className="th">Market</th><th className="th">Status</th><th className="th">Completes</th><th className="th">Client CPI</th><th className="th">Payout</th><th className="th">Links</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {rows.map(({ c, a }) => (
                      <tr key={a.id}>
                        <td className="td whitespace-nowrap">{flag(c.countryCode)} {marketName(c)}</td>
                        <td className="td"><StatusChip status={a.status} /></td>
                        <td className="td"><Progress value={a.completes} max={a.targetCompletes} /></td>
                        <td className="td tabular-nums">{money(c.cpi, c.currency)}</td>
                        <td className={clsx('td tabular-nums', Number(a.cpi) > Number(c.cpi) && 'text-bad')}>{money(a.cpi, c.currency)}</td>
                        <td className="td"><div className="flex gap-1.5">{a.uniqueLinksOnly ? <span className="chip bg-sunken text-muted">Unique links only</span> : <CopyButton text={a.entryLink} label="Live link" />}<CopyButton text={a.testEntryLink} label="Test link" /></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ))
        ))}

      {view === 'market' &&
        project.countries.map((c) => {
          const high = form.cpi !== '' && Number(form.cpi) > Number(c.cpi);
          return (
            <Section
              key={c.id}
              help="project.vendorMarket"
              id={`market-${c.id}`}
              title={
                <span>
                  {flag(c.countryCode)} {countryName(c.countryCode)}
                  {c.targetGroup && <span className="ml-1.5 chip bg-brand/10 text-brand">{c.targetGroup}</span>}
                  <span className="font-normal text-muted"> · {c.allocations.length} {c.allocations.length === 1 ? 'vendor' : 'vendors'} · {c.completes}/{c.targetCompletes} completes · client CPI {money(c.cpi, c.currency)}</span>
                </span>
              }
              actions={
                <div className="flex gap-1.5">
                  {suggesting !== c.id && <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setSuggesting(c.id)}><Sparkles className="h-3.5 w-3.5" /> Suggest vendors</button>}
                  {editable && asking !== c.id && <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setAsking(c.id)}><MessageSquareQuote className="h-3.5 w-3.5" /> Ask for quotes</button>}
                  {editable && adding !== c.id && <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => { setAdding(c.id); setForm(EMPTY_FORM); }}><Plus className="h-3.5 w-3.5" /> Add vendor</button>}
                </div>
              }
            >
              <QuotesPanel projectId={project.id} countryId={c.id} editable={editable} asking={asking === c.id} onAskDone={() => setAsking(null)} allocated={c.allocations.map((a) => a.vendorId)} vendors={vendors} onAccepted={reload} />
              {suggesting === c.id && <VendorSuggestions projectId={project.id} countryId={c.id} editable={editable} onAdded={reload} onClose={() => setSuggesting(null)} />}
              {adding === c.id && (
                <div className="mb-5 rounded-lg bg-sunken/60 p-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                    <div className="sm:col-span-2">
                      <Field label="Vendor">
                        <Combobox options={vendors.filter((v) => !c.allocations.some((a) => a.vendorId === v.id)).map((v) => ({ value: v.id, label: v.name, hint: v.code }))} value={form.vendorId || null} onChange={(v) => setForm({ ...form, vendorId: v ?? '' })} placeholder="Search vendors" />
                      </Field>
                    </div>
                    <Field label={`Payout CPI (${c.currency})`}><input className={clsx('input', high && 'border-bad')} type="number" step="0.01" min={0} value={form.cpi} onChange={(e) => setForm({ ...form, cpi: e.target.value })} /></Field>
                    <Field label="Target completes"><input className="input" type="number" placeholder={String(c.targetCompletes)} value={form.targetCompletes} onChange={(e) => setForm({ ...form, targetCompletes: e.target.value })} /></Field>
                    <Field label="Link variable"><input className="input" value={form.uidParam} onChange={(e) => setForm({ ...form, uidParam: e.target.value })} /></Field>
                  </div>
                  {high && <p className="mt-2 flex items-center gap-1.5 text-xs text-bad"><AlertTriangle className="h-3.5 w-3.5" /> The payout is higher than the client CPI ({money(c.cpi, c.currency)}). You will be asked to confirm.</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button className="btn-primary" disabled={!form.vendorId || form.cpi === ''} onClick={() => add(c.id)}>Add</button>
                    <button className="btn-ghost" onClick={() => setAdding(null)}>Cancel</button>
                    {project.countries.length > 1 && (
                      <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={form.applyToAll} onChange={(e) => setForm({ ...form, applyToAll: e.target.checked })} /> Add to every market</label>
                    )}
                  </div>
                </div>
              )}
              {c.allocations.length === 0 ? (
                <Empty>No vendors yet. Add one to get entry links.</Empty>
              ) : (
                <div className="-mx-5 -mb-5 overflow-x-auto">
                  <table className="w-full min-w-[960px]">
                    <thead className="border-y border-line bg-sunken/60">
                      <tr><th className="th">Vendor</th><th className="th">Status</th><th className="th">Completes</th><th className="th">Terms</th><th className="th">Quota full</th><th className="th">Payout</th><th className="th">Variable</th><th className="th">Links</th><th className="th" /></tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {c.allocations.map((a) =>
                        editing?.id === a.id ? (
                          <tr key={a.id} className="bg-sunken/30">
                            <td className="td font-medium">{a.vendor.name}</td>
                            <td className="td"><StatusChip status={a.status} /></td>
                            <td className="td"><input className="input w-20 px-2 py-1" type="number" aria-label="Target completes" value={editing.targetCompletes} onChange={(e) => setEditing({ ...editing, targetCompletes: e.target.value })} /></td>
                            <td className="td" />
                            <td className="td" />
                            <td className="td">
                              <input className={clsx('input w-24 px-2 py-1', Number(editing.cpi) > Number(c.cpi) && 'border-bad')} type="number" step="0.01" aria-label="Payout CPI" value={editing.cpi} onChange={(e) => setEditing({ ...editing, cpi: e.target.value })} />
                              {Number(editing.cpi) > Number(c.cpi) && <div className="mt-0.5 text-[11px] text-bad">Above client CPI</div>}
                            </td>
                            <td className="td"><input className="input w-20 px-2 py-1" aria-label="Link variable" value={editing.uidParam} onChange={(e) => setEditing({ ...editing, uidParam: e.target.value })} /></td>
                            <td className="td" />
                            <td className="td"><div className="flex gap-1"><button className="btn-primary px-2.5 py-1.5 text-xs" onClick={() => saveEdit(c.id)}><Save className="h-3.5 w-3.5" /> Save</button><button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setEditing(null)}>Cancel</button></div></td>
                          </tr>
                        ) : (
                          <tr key={a.id}>
                            <td className="td font-medium">{a.vendor.name} <span className="inline-flex items-center text-xs text-muted">{a.vendor.code}<CopyIcon text={a.vendor.code} label={`${a.vendor.name} vendor ID`} /></span></td>
                            <td className="td"><StatusChip status={a.status} /></td>
                            <td className="td"><Progress value={a.completes} max={a.targetCompletes} /></td>
                            <td className="td tabular-nums">{a.stats.TERMINATE}</td>
                            <td className="td tabular-nums">{a.stats.QUOTA_FULL}</td>
                            <td className={clsx('td tabular-nums', Number(a.cpi) > Number(c.cpi) && 'font-medium text-bad')} title={Number(a.cpi) > Number(c.cpi) ? 'Above the client CPI' : undefined}>{money(a.cpi, c.currency)}</td>
                            <td className="td"><code className="rounded bg-sunken px-1 text-xs">{a.uidParam}</code></td>
                            <td className="td">
                              <div className="flex gap-1.5">
                                {a.uniqueLinksOnly ? <span className="chip bg-sunken text-muted" title="This market only accepts one-time unique links. Generate them on the Unique links tab.">Unique links only</span> : <CopyButton text={a.entryLink} label="Live link" />}
                                <CopyButton text={a.testEntryLink} label="Test link" />
                              </div>
                            </td>
                            <td className="td">
                              {editable && (
                                <div className="flex gap-1">
                                  <button className="btn-ghost p-1.5" aria-label={`Edit ${a.vendor.name}`} title="Edit payout, target and link variable" onClick={() => setEditing({ id: a.id, cpi: String(Number(a.cpi)), targetCompletes: String(a.targetCompletes), uidParam: a.uidParam })}><Pencil className="h-3.5 w-3.5" /></button>
                                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => toggle(c.id, a.id, a.status)}>
                                    {a.status === 'ACTIVE' ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Resume</>}
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          );
        })}
    </div>
  );
}

function PayoutEverywhere({ currency, onApply }: { currency: string; onApply: (cpi: number) => void }) {
  const [v, setV] = useState('');
  return (
    <div className="flex items-center gap-1.5">
      <input className="input w-28 px-2 py-1 text-xs" type="number" step="0.01" min={0} placeholder={`Payout ${currency}`} aria-label="Payout for every market" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn-ghost px-2.5 py-1 text-xs" disabled={v === ''} onClick={() => { onApply(Number(v)); setV(''); }}>Apply to all markets</button>
    </div>
  );
}
