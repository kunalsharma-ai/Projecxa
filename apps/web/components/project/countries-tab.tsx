'use client';
import { CopyIcon, Copyable } from '@/components/copy';
import clsx from 'clsx';
import { AlertTriangle, CopyPlus, Pause, Pencil, Play, Plus, Save, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CountrySelect } from '@/components/form/combobox';
import { saveCustomOption, useCustomOptions } from '@/components/form/option-select';
import { ErrorBox, Field, Progress, Section, StatusChip, money } from '@/components/ui';
import { patch, post } from '@/lib/api';
import { COUNTRIES, countryName, flag } from '@/lib/countries';
import { BulkFill } from './bulk-fill';
import type { Country, ProjectDetail } from './types';

const marketName = (c: Pick<Country, 'countryCode' | 'targetGroup'>) => `${countryName(c.countryCode)}${c.targetGroup ? ` · ${c.targetGroup}` : ''}`;
const EMPTY_ADD = { countryCode: '', language: '', targetGroup: '', loiMinutes: '', irPercent: '', cpi: '', targetCompletes: '', liveSurveyUrl: '', testSurveyUrl: '', copyFromCountryId: '', copyVendors: true };

export function CountriesTab({ project, editable, reload, security }: { project: ProjectDetail; editable: boolean; reload: () => void; security: string[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Country>>({});
  const [clone, setClone] = useState<{ from: string; code: string; targetGroup: string } | null>(null);
  const [adding, setAdding] = useState<typeof EMPTY_ADD | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [note, setNote] = useState<{ text: string; failed: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const targetGroups = useCustomOptions('targetGroup');
  const currency = project.countries[0]?.currency ?? 'USD';

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return project.countries.filter((c) => !q || `${c.countryCode} ${countryName(c.countryCode)} ${c.targetGroup ?? ''} ${c.language} ${c.status}`.toLowerCase().includes(q));
  }, [project.countries, filter]);
  const targets = selected.length ? selected : visible.map((c) => c.id);

  async function save(c: Country) {
    setError(null);
    try {
      await patch(`/projects/${project.id}/countries/${c.id}`, {
        status: draft.status,
        language: draft.language || undefined,
        targetGroup: draft.targetGroup !== undefined ? draft.targetGroup ?? '' : undefined,
        loiMinutes: draft.loiMinutes !== undefined ? Number(draft.loiMinutes) : undefined,
        irPercent: draft.irPercent !== undefined ? Number(draft.irPercent) : undefined,
        cpi: draft.cpi !== undefined ? Number(draft.cpi) : undefined,
        targetCompletes: draft.targetCompletes !== undefined ? Number(draft.targetCompletes) : undefined,
        liveSurveyUrl: draft.liveSurveyUrl || undefined,
        testSurveyUrl: draft.testSurveyUrl || undefined,
      });
      if (draft.targetGroup) saveCustomOption('targetGroup', draft.targetGroup);
      setEditing(null);
      reload();
    } catch (e) {
      setError(e);
    }
  }

  /** Apply values (or a status) to the ticked markets, or to every market shown when none are ticked. */
  async function bulk(set: Record<string, unknown>, what: string) {
    setError(null);
    setNote(null);
    try {
      const r = await patch<{ updated: number; failed: string[] }>(`/projects/${project.id}/countries/bulk`, { countryIds: targets, set });
      setNote({ text: `${what}: ${r.updated} of ${targets.length} ${targets.length === 1 ? 'market' : 'markets'} changed.`, failed: r.failed });
      setSelected([]);
      reload();
    } catch (e) {
      setError(e);
    }
  }

  async function doClone() {
    if (!clone?.code) return;
    setError(null);
    try {
      await post(`/projects/${project.id}/countries/clone`, { fromCountryId: clone.from, countryCode: clone.code, targetGroup: clone.targetGroup, includeVendors: true });
      setClone(null);
      reload();
    } catch (e) {
      setError(e);
    }
  }

  async function addMarket() {
    if (!adding?.countryCode) return;
    setError(null);
    const n = (v: string) => (v === '' ? undefined : Number(v));
    try {
      await post(`/projects/${project.id}/countries`, {
        countryCode: adding.countryCode,
        language: adding.language || COUNTRIES.find((x) => x.code === adding.countryCode)?.lang || 'en',
        targetGroup: adding.targetGroup.trim() || undefined,
        loiMinutes: n(adding.loiMinutes),
        irPercent: n(adding.irPercent),
        cpi: n(adding.cpi),
        targetCompletes: n(adding.targetCompletes),
        liveSurveyUrl: adding.liveSurveyUrl.trim() || undefined,
        testSurveyUrl: adding.testSurveyUrl.trim() || undefined,
        copyFromCountryId: adding.copyFromCountryId || undefined,
        copyVendors: !!adding.copyFromCountryId && adding.copyVendors,
      });
      if (adding.targetGroup.trim()) saveCustomOption('targetGroup', adding.targetGroup);
      setAdding(null);
      reload();
    } catch (e) {
      setError(e);
    }
  }

  const src = adding ? project.countries.find((c) => c.id === adding.copyFromCountryId) ?? project.countries[0] : undefined;
  const noLink = project.countries.filter((c) => !c.liveSurveyUrl && c.status !== 'CLOSED');

  return (
    <div className="space-y-6">
      <ErrorBox error={error} />
      {noLink.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <div>
            <span className="font-medium">{noLink.length === 1 ? '1 market has' : `${noLink.length} markets have`} no live survey link: </span>
            {noLink.map(marketName).join(', ')}. {noLink.length === 1 ? 'It' : 'They'} cannot go live until the client link is added. Other markets can go live without waiting.
          </div>
        </div>
      )}
      {note && (
        <div className="rounded-lg border border-line bg-panel p-3 text-sm" role="status">
          <div className="flex items-center justify-between gap-2"><span>{note.text}</span><button className="btn-ghost p-1" aria-label="Dismiss" onClick={() => setNote(null)}><X className="h-3.5 w-3.5" /></button></div>
          {note.failed.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-warn">{note.failed.map((f) => <li key={f}>{f}</li>)}</ul>}
        </div>
      )}
      <Section
        title={`Markets · ${project.countries.length}`}
        actions={editable && !adding && <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setAdding({ ...EMPTY_ADD })}><Plus className="h-3.5 w-3.5" /> Add market</button>}
      >
        {adding && (
          <div className="mb-5 rounded-lg border border-brand/30 bg-brand/5 p-4">
            <div className="mb-3 text-sm font-semibold">Add a market</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <Field label="Country *">
                  <CountrySelect value={adding.countryCode || null} onChange={(v) => setAdding({ ...adding, countryCode: v ?? '', language: COUNTRIES.find((x) => x.code === v)?.lang ?? '' })} placeholder="Type to search, e.g. Japan" />
                </Field>
              </div>
              <Field label="Language"><input className="input" value={adding.language} onChange={(e) => setAdding({ ...adding, language: e.target.value })} placeholder="en" /></Field>
              <Field label="Target group" hint="Needed when the country is already a market">
                <input className="input" list="tab-target-groups" value={adding.targetGroup} onChange={(e) => setAdding({ ...adding, targetGroup: e.target.value })} />
              </Field>
              <Field label="LOI (min)"><input className="input" type="number" min={1} placeholder={String(src?.loiMinutes ?? '')} value={adding.loiMinutes} onChange={(e) => setAdding({ ...adding, loiMinutes: e.target.value })} /></Field>
              <Field label="IR %"><input className="input" type="number" min={1} max={100} placeholder={String(src?.irPercent ?? '')} value={adding.irPercent} onChange={(e) => setAdding({ ...adding, irPercent: e.target.value })} /></Field>
              <Field label={`Client CPI (${currency})`}><input className="input" type="number" step="0.01" placeholder={src ? String(Number(src.cpi)) : ''} value={adding.cpi} onChange={(e) => setAdding({ ...adding, cpi: e.target.value })} /></Field>
              <Field label="Completes"><input className="input" type="number" min={1} placeholder={String(src?.targetCompletes ?? '')} value={adding.targetCompletes} onChange={(e) => setAdding({ ...adding, targetCompletes: e.target.value })} /></Field>
              <div className="sm:col-span-2"><Field label="Live survey link" hint="Can be added later; the market goes live only once it has one"><input className="input" placeholder="https://survey.client.com/s?rid={session_token}" value={adding.liveSurveyUrl} onChange={(e) => setAdding({ ...adding, liveSurveyUrl: e.target.value })} /></Field></div>
              <div className="sm:col-span-2"><Field label="Test survey link"><input className="input" value={adding.testSurveyUrl} onChange={(e) => setAdding({ ...adding, testSurveyUrl: e.target.value })} /></Field></div>
              <div className="sm:col-span-2">
                <Field label="Use settings from" hint="Empty fields above are taken from this market">
                  <select className="input" value={adding.copyFromCountryId} onChange={(e) => setAdding({ ...adding, copyFromCountryId: e.target.value })}>
                    <option value="">{project.countries[0] ? `${marketName(project.countries[0])} (first market)` : 'None'}</option>
                    {project.countries.slice(1).map((c) => <option key={c.id} value={c.id}>{marketName(c)}</option>)}
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={!!adding.copyFromCountryId && adding.copyVendors} disabled={!adding.copyFromCountryId} onChange={(e) => setAdding({ ...adding, copyVendors: e.target.checked })} />
                Also add that market&apos;s vendors (with new entry links)
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button className="btn-primary" disabled={!adding.countryCode} onClick={addMarket}>Add market</button>
              <button className="btn-ghost" onClick={() => setAdding(null)}>Cancel</button>
            </div>
          </div>
        )}
        <datalist id="tab-target-groups">{targetGroups.map((g) => <option key={g} value={g} />)}</datalist>
        {editable && project.countries.length > 0 && (
          <>
            <BulkFill
              selected={selected.length}
              total={visible.length}
              onApply={(v) => bulk(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ['liveSurveyUrl', 'testSurveyUrl'].includes(k) ? x.trim() : Number(x)])), 'Applied')}
              fields={[
                { key: 'loiMinutes', label: 'LOI', type: 'number', width: 'w-20' },
                { key: 'irPercent', label: 'IR %', type: 'number', width: 'w-20' },
                { key: 'cpi', label: `CPI (${currency})`, type: 'number', step: '0.01', width: 'w-24' },
                { key: 'targetCompletes', label: 'Completes', type: 'number', width: 'w-24' },
                { key: 'liveSurveyUrl', label: 'Live link', width: 'w-64', placeholder: 'https://…' },
                { key: 'testSurveyUrl', label: 'Test link', width: 'w-64', placeholder: 'https://…' },
              ]}
              extra={
                <div className="flex gap-1.5">
                  <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => bulk({ status: 'LIVE' }, 'Set live')}><Play className="h-3.5 w-3.5" /> Set live</button>
                  <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => bulk({ status: 'HOLD' }, 'Put on hold')}><Pause className="h-3.5 w-3.5" /> Hold</button>
                </div>
              }
            />
          </>
        )}
        {project.countries.length > 5 && (
          <label className="relative mb-3 block w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input className="input py-1.5 pl-8 text-sm" placeholder="Filter markets" aria-label="Filter markets" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        )}
        <div className="-mx-5 -mb-5 overflow-x-auto">
          <table className="w-full min-w-[1040px]">
            <thead className="border-y border-line bg-sunken/60">
              <tr>
                {editable && <th className="th w-8"><input type="checkbox" aria-label="Select all markets" checked={visible.length > 0 && visible.every((c) => selected.includes(c.id))} onChange={(e) => setSelected(e.target.checked ? visible.map((c) => c.id) : [])} /></th>}
                <th className="th">Market</th><th className="th">Status</th><th className="th">Completes</th><th className="th">LOI</th><th className="th">IR</th><th className="th">CPI</th><th className="th">Vendors</th><th className="th">Survey links</th><th className="th" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((c) =>
                editing === c.id ? (
                  <tr key={c.id} className="bg-sunken/30">
                    {editable && <td className="td" />}
                    <td className="td">
                      <div className="whitespace-nowrap">{flag(c.countryCode)} {countryName(c.countryCode)}</div>
                      <div className="mt-1 flex gap-1">
                        <input className="input w-14 px-2 py-1 text-xs" aria-label="Language" defaultValue={c.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} />
                        <input className="input w-36 px-2 py-1 text-xs" aria-label="Target group" placeholder="Target group" list="tab-target-groups" defaultValue={c.targetGroup ?? ''} onChange={(e) => setDraft({ ...draft, targetGroup: e.target.value })} />
                      </div>
                    </td>
                    <td className="td">
                      <select className="input px-2 py-1" value={draft.status ?? c.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                        {['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED'].map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="td"><input className="input w-20 px-2 py-1" type="number" aria-label="Completes" defaultValue={c.targetCompletes} onChange={(e) => setDraft({ ...draft, targetCompletes: Number(e.target.value) })} /></td>
                    <td className="td"><input className="input w-16 px-2 py-1" type="number" aria-label="LOI" defaultValue={c.loiMinutes} onChange={(e) => setDraft({ ...draft, loiMinutes: Number(e.target.value) })} /></td>
                    <td className="td"><input className="input w-16 px-2 py-1" type="number" aria-label="IR" defaultValue={c.irPercent} onChange={(e) => setDraft({ ...draft, irPercent: Number(e.target.value) })} /></td>
                    <td className="td"><input className="input w-20 px-2 py-1" type="number" step="0.01" aria-label="CPI" defaultValue={c.cpi} onChange={(e) => setDraft({ ...draft, cpi: e.target.value })} /></td>
                    <td className="td">{c.allocations.length}</td>
                    <td className="td space-y-1">
                      <input className="input w-72 px-2 py-1 text-xs" placeholder="Live link" defaultValue={c.liveSurveyUrl ?? ''} onChange={(e) => setDraft({ ...draft, liveSurveyUrl: e.target.value })} />
                      <input className="input w-72 px-2 py-1 text-xs" placeholder="Test link" defaultValue={c.testSurveyUrl ?? ''} onChange={(e) => setDraft({ ...draft, testSurveyUrl: e.target.value })} />
                    </td>
                    <td className="td">
                      <div className="flex gap-1"><button className="btn-primary px-2.5 py-1.5" onClick={() => save(c)}><Save className="h-3.5 w-3.5" /> Save</button><button className="btn-ghost px-2.5 py-1.5" onClick={() => setEditing(null)}>Cancel</button></div>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} className={clsx(selected.includes(c.id) && 'bg-brand/5')}>
                    {editable && <td className="td"><input type="checkbox" aria-label={`Select ${marketName(c)}`} checked={selected.includes(c.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} /></td>}
                    <td className="td">
                      <div className="whitespace-nowrap">{flag(c.countryCode)} {countryName(c.countryCode)} <span className="text-muted">({c.language})</span></div>
                      {c.targetGroup && <div className="text-xs font-medium text-brand">{c.targetGroup}</div>}
                    </td>
                    <td className="td"><StatusChip status={c.status} /></td>
                    <td className="td"><Progress value={c.completes} max={c.targetCompletes} /></td>
                    <td className="td tabular-nums">{c.loiMinutes} min</td>
                    <td className="td tabular-nums">{c.irPercent}%</td>
                    <td className="td tabular-nums">{money(c.cpi, c.currency)}</td>
                    <td className="td">{c.allocations.length || <span className="text-warn">0</span>}</td>
                    <td className="td max-w-[300px] text-xs text-muted" title={c.liveSurveyUrl ?? ''}>
                      {c.liveSurveyUrl ? <Copyable text={c.liveSurveyUrl} label={`live link for ${marketName(c)}`} /> : <span className="inline-flex items-center gap-1 font-medium text-warn"><AlertTriangle className="h-3 w-3" /> No live link</span>}
                      {c.testSurveyUrl && <div className="mt-0.5"><Copyable text={c.testSurveyUrl} label={`test link for ${marketName(c)}`}><span className="text-muted/80">Test: {c.testSurveyUrl}</span></Copyable></div>}
                    </td>
                    <td className="td">
                      {editable && (
                        <div className="flex gap-1">
                          <button className="btn-ghost p-1.5" aria-label={`Edit ${marketName(c)}`} title="Edit" onClick={() => { setEditing(c.id); setDraft({}); }}><Pencil className="h-3.5 w-3.5" /></button>
                          <button className="btn-ghost p-1.5" aria-label={`Copy ${marketName(c)}`} title="Copy to a new market (with vendors and quotas)" onClick={() => setClone({ from: c.id, code: c.countryCode, targetGroup: '' })}><CopyPlus className="h-3.5 w-3.5" /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        {clone && (
          <div className="mt-8 flex flex-wrap items-end gap-2 border-t border-line pt-4">
            <div className="w-64">
              <Field label={`Copy ${marketName(project.countries.find((c) => c.id === clone.from)!)} with its vendors and quotas to`}>
                <CountrySelect value={clone.code || null} onChange={(v) => setClone({ ...clone, code: v ?? '' })} />
              </Field>
            </div>
            <Field label="Target group"><input className="input w-48" list="tab-target-groups" value={clone.targetGroup} onChange={(e) => setClone({ ...clone, targetGroup: e.target.value })} /></Field>
            <button className="btn-primary" onClick={doClone} disabled={!clone.code}>Copy</button>
            <button className="btn-ghost" onClick={() => setClone(null)}>Cancel</button>
            <p className="w-full text-xs text-muted">Survey links are not copied, because they are usually market specific.</p>
          </div>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Project settings">
          <dl className="grid grid-cols-[140px_1fr] gap-y-2 text-sm">
            <dt className="text-muted">Client</dt><dd>{project.client.name}</dd>
            <dt className="text-muted">Sales</dt><dd>{project.salesPerson?.name ?? '–'}</dd>
            <dt className="text-muted">Bid reference</dt><dd>{project.bidReference ? <Copyable text={project.bidReference} label="bid reference" /> : '–'}</dd>
            <dt className="text-muted">CPI currency</dt><dd>{currency}</dd>
            <dt className="text-muted">Devices</dt><dd>{Object.entries(project.devices).filter(([, v]) => v).map(([k]) => k).join(', ')}</dd>
            <dt className="text-muted">Security</dt><dd>{security.length ? security.join(', ') : 'None'}</dd>
            <dt className="text-muted">Redirect mode</dt><dd>{project.redirectMode.toLowerCase()} (version {project.activeRedirectVersion?.version ?? '–'})</dd>
          </dl>
          {project.description && <p className="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-sm text-muted">{project.description}</p>}
        </Section>
        <Section title="Client survey integration">
          <p className="text-sm text-muted">At the end of the survey, send respondents to this URL with the status and the token SampTrek passed in:</p>
          <div className="mt-2 flex items-start gap-1 rounded-lg bg-sunken p-3"><code className="min-w-0 flex-1 break-all text-xs">{project.outcomeEndpoints.browser}</code><CopyIcon text={project.outcomeEndpoints.browser} label="end-of-survey URL" /></div>
          <p className="mt-2 text-xs text-muted">Statuses: {project.outcomeEndpoints.statuses.join(', ')}</p>
          <p className="mt-4 text-sm text-muted">To confirm outcomes server to server (recommended before billing), POST a signed request to:</p>
          <div className="mt-2 flex items-start gap-1 rounded-lg bg-sunken p-3"><code className="min-w-0 flex-1 break-all text-xs">{project.outcomeEndpoints.s2s}</code><CopyIcon text={project.outcomeEndpoints.s2s} label="server-to-server URL" /></div>
          <p className="mt-2 text-xs text-muted">Body: token, status, timestamp (unix seconds) and signature = HMAC-SHA256(client secret, &quot;token.status.timestamp&quot;). See docs/SURVEY_INTEGRATION.md.</p>
        </Section>
      </div>
    </div>
  );
}
