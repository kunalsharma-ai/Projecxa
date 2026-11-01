'use client';
import { Copy, Pencil, Save } from 'lucide-react';
import { useState } from 'react';
import { ErrorBox, Field, Progress, Section, StatusChip, money } from '@/components/ui';
import { patch, post } from '@/lib/api';
import { COUNTRIES, countryName, flag } from '@/lib/countries';
import type { Country, ProjectDetail } from './types';

export function CountriesTab({ project, editable, reload, security }: { project: ProjectDetail; editable: boolean; reload: () => void; security: string[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Country>>({});
  const [clone, setClone] = useState<{ from: string; code: string } | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function save(c: Country) {
    setError(null);
    try {
      await patch(`/projects/${project.id}/countries/${c.id}`, {
        status: draft.status,
        loiMinutes: draft.loiMinutes !== undefined ? Number(draft.loiMinutes) : undefined,
        irPercent: draft.irPercent !== undefined ? Number(draft.irPercent) : undefined,
        cpi: draft.cpi !== undefined ? Number(draft.cpi) : undefined,
        targetCompletes: draft.targetCompletes !== undefined ? Number(draft.targetCompletes) : undefined,
        liveSurveyUrl: draft.liveSurveyUrl || undefined,
        testSurveyUrl: draft.testSurveyUrl || undefined,
      });
      setEditing(null);
      reload();
    } catch (e) {
      setError(e);
    }
  }

  async function doClone() {
    if (!clone?.code) return;
    setError(null);
    try {
      await post(`/projects/${project.id}/countries/clone`, { fromCountryId: clone.from, countryCode: clone.code, includeVendors: true });
      setClone(null);
      reload();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className="space-y-6">
      <ErrorBox error={error} />
      <Section title="Countries">
        <div className="-m-5 overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead className="border-b border-line bg-sunken/60">
              <tr><th className="th">Country</th><th className="th">Status</th><th className="th">Completes</th><th className="th">LOI</th><th className="th">IR</th><th className="th">CPI</th><th className="th">Vendors</th><th className="th">Survey links</th><th className="th" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {project.countries.map((c) =>
                editing === c.id ? (
                  <tr key={c.id} className="bg-sunken/30">
                    <td className="td">{flag(c.countryCode)} {countryName(c.countryCode)} <span className="text-muted">({c.language})</span></td>
                    <td className="td">
                      <select className="input px-2 py-1" value={draft.status ?? c.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                        {['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED'].map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td className="td"><input className="input w-20 px-2 py-1" type="number" defaultValue={c.targetCompletes} onChange={(e) => setDraft({ ...draft, targetCompletes: Number(e.target.value) })} /></td>
                    <td className="td"><input className="input w-16 px-2 py-1" type="number" defaultValue={c.loiMinutes} onChange={(e) => setDraft({ ...draft, loiMinutes: Number(e.target.value) })} /></td>
                    <td className="td"><input className="input w-16 px-2 py-1" type="number" defaultValue={c.irPercent} onChange={(e) => setDraft({ ...draft, irPercent: Number(e.target.value) })} /></td>
                    <td className="td"><input className="input w-20 px-2 py-1" type="number" step="0.01" defaultValue={c.cpi} onChange={(e) => setDraft({ ...draft, cpi: e.target.value })} /></td>
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
                  <tr key={c.id}>
                    <td className="td">{flag(c.countryCode)} {countryName(c.countryCode)} <span className="text-muted">({c.language})</span><div className="text-xs text-muted">{c.targetGroup}</div></td>
                    <td className="td"><StatusChip status={c.status} /></td>
                    <td className="td"><Progress value={c.completes} max={c.targetCompletes} /></td>
                    <td className="td tabular-nums">{c.loiMinutes} min</td>
                    <td className="td tabular-nums">{c.irPercent}%</td>
                    <td className="td tabular-nums">{money(c.cpi, c.currency)}</td>
                    <td className="td">{c.allocations.length}</td>
                    <td className="td max-w-[280px] truncate text-xs text-muted" title={c.liveSurveyUrl ?? ''}>{c.liveSurveyUrl ?? <span className="text-warn">No live link</span>}</td>
                    <td className="td">
                      {editable && (
                        <div className="flex gap-1">
                          <button className="btn-ghost p-1.5" aria-label={`Edit ${c.countryCode}`} onClick={() => { setEditing(c.id); setDraft({}); }}><Pencil className="h-3.5 w-3.5" /></button>
                          <button className="btn-ghost p-1.5" aria-label={`Clone ${c.countryCode}`} title="Clone to another country" onClick={() => setClone({ from: c.id, code: '' })}><Copy className="h-3.5 w-3.5" /></button>
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
            <Field label={`Clone ${project.countries.find((c) => c.id === clone.from)?.countryCode} with its vendors and quotas to`}>
              <select className="input w-64" value={clone.code} onChange={(e) => setClone({ ...clone, code: e.target.value })}>
                <option value="">Choose a country…</option>
                {COUNTRIES.filter((x) => !project.countries.some((c) => c.countryCode === x.code)).map((x) => <option key={x.code} value={x.code}>{flag(x.code)} {x.name}</option>)}
              </select>
            </Field>
            <button className="btn-primary" onClick={doClone} disabled={!clone.code}>Clone</button>
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
            <dt className="text-muted">Bid reference</dt><dd>{project.bidReference ?? '–'}</dd>
            <dt className="text-muted">Devices</dt><dd>{Object.entries(project.devices).filter(([, v]) => v).map(([k]) => k).join(', ')}</dd>
            <dt className="text-muted">Security</dt><dd>{security.length ? security.join(', ') : 'None'}</dd>
            <dt className="text-muted">Redirect mode</dt><dd>{project.redirectMode.toLowerCase()} (version {project.activeRedirectVersion?.version ?? '–'})</dd>
          </dl>
          {project.description && <p className="mt-4 whitespace-pre-wrap border-t border-line pt-4 text-sm text-muted">{project.description}</p>}
        </Section>
        <Section title="Client survey integration">
          <p className="text-sm text-muted">At the end of the survey, send respondents to this URL with the status and the token PROJEXA passed in:</p>
          <code className="mt-2 block break-all rounded-lg bg-sunken p-3 text-xs">{project.outcomeEndpoints.browser}</code>
          <p className="mt-2 text-xs text-muted">Statuses: {project.outcomeEndpoints.statuses.join(', ')}</p>
          <p className="mt-4 text-sm text-muted">To confirm outcomes server to server (recommended before billing), POST a signed request to:</p>
          <code className="mt-2 block break-all rounded-lg bg-sunken p-3 text-xs">{project.outcomeEndpoints.s2s}</code>
          <p className="mt-2 text-xs text-muted">Body: token, status, timestamp (unix seconds) and signature = HMAC-SHA256(client secret, &quot;token.status.timestamp&quot;). See docs/SURVEY_INTEGRATION.md.</p>
        </Section>
      </div>
    </div>
  );
}
