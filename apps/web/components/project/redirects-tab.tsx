'use client';
import clsx from 'clsx';
import { Activity, CheckCircle2, Plus, Trash2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty, ErrorBox, Field, Loading, Section, StatusChip, Toggle } from '@/components/ui';
import { get, post } from '@/lib/api';
import { flag } from '@/lib/countries';
import { OUTCOME_STATUSES, OutcomeStatus, ParamMapping, RedirectConfig, RedirectMode, RedirectRule, RuleType, SECURITY_LABELS, STATUS_LABEL } from '@/lib/types';
import { RedirectDiagram } from './redirect-diagram';
import { RedirectSigning } from './redirect-signing';
import { RedirectVersions, Version } from './redirect-versions';
import type { ProjectDetail } from './types';

interface Issue { level: 'error' | 'warning'; message: string; status?: string; scope?: { countryCode?: string; vendorId?: string } }
interface Policy {
  mode: RedirectMode;
  active: (Version & { issues: Issue[] }) | null;
  versions: Version[];
  inherited: { clientTemplate: RedirectConfig | null; organizationDefault: RedirectConfig | null };
  allowedDomains: { organization: string[]; vendors: Record<string, { name: string; domains: string[] }> };
  countries: string[];
  vendors: { id: string; name: string; code: string }[];
}
interface EffectiveRow { countryCode: string; vendor: { id: string; name: string }; status: OutcomeStatus; source: string | null; type: string | null; destination: string; usedFallback: boolean; blockedReason: string | null; callbackRequired: boolean; apiEndpoint: string | null }

const CANONICAL = ['respondent_uid', 'vendor_id', 'country_code', 'project_code', 'status', 'session_token'];
const CANONICAL_LABEL: Record<string, string> = { respondent_uid: 'UID', vendor_id: 'Vendor ID', country_code: 'Country code', project_code: 'Project code', status: 'Status', session_token: 'Session token' };
const MACRO_HINT = '{respondent_uid} {vendor_id} {country_code} {project_code} {status} {session_token}';

const isScoped = (r: { scope?: { countryCode?: string; vendorId?: string } }) => !!(r.scope?.countryCode || r.scope?.vendorId);

export function RedirectsTab({ project, editable, reload }: { project: ProjectDetail; editable: boolean; reload: () => void }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [mode, setMode] = useState<RedirectMode>('HYBRID');
  const [config, setConfig] = useState<RedirectConfig>({ rules: [], params: [] });
  const [reason, setReason] = useState('');
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [effective, setEffective] = useState<EffectiveRow[] | null>(null);
  const [routeView, setRouteView] = useState<'diagram' | 'table'>('diagram');
  const [override, setOverride] = useState<Partial<RedirectRule> & { countryCode?: string; vendorId?: string }>({ status: 'COMPLETE', type: 'DYNAMIC' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await get<Policy>(`/projects/${project.id}/redirects`);
      setPolicy(p);
      const src = p.active;
      setMode(src?.mode ?? p.mode);
      setConfig(src?.config ?? { rules: [], params: [] });
      setIssues(src?.issues ?? null);
      setDirty(false);
    } catch (e) {
      setError(e);
    }
  }, [project.id]);
  useEffect(() => {
    load();
  }, [load]);
  // Show the routing for the active version straight away.
  useEffect(() => {
    get<{ rows: EffectiveRow[] }>(`/projects/${project.id}/redirects/effective`).then((r) => setEffective(r.rows)).catch(() => {});
  }, [project.id, project.activeRedirectVersion?.id]);

  const vendorName = useMemo(() => Object.fromEntries((policy?.vendors ?? []).map((v) => [v.id, v.name])), [policy]);
  const edit = (c: RedirectConfig) => {
    setConfig(c);
    setDirty(true);
    setDraftId(null);
  };

  const projectRule = (status: OutcomeStatus) => config.rules.find((r) => r.status === status && !isScoped(r));
  function setProjectRule(status: OutcomeStatus, patch: Partial<RedirectRule> | null) {
    const others = config.rules.filter((r) => !(r.status === status && !isScoped(r)));
    if (patch === null) return edit({ ...config, rules: others });
    const cur = projectRule(status) ?? { status, type: (mode === 'HYBRID' ? 'DYNAMIC' : mode) as RuleType, url: '', enabled: true, callbackRequired: status === 'COMPLETE' };
    edit({ ...config, rules: [...others, { ...cur, ...patch }] });
  }
  function inheritedFrom(status: OutcomeStatus) {
    if (policy?.inherited.clientTemplate?.rules.some((r) => r.status === status)) return 'client template';
    if (policy?.inherited.organizationDefault?.rules.some((r) => r.status === status)) return 'organization default';
    return null;
  }

  function changeMode(m: RedirectMode) {
    setMode(m);
    // Static and dynamic modes force every rule to that type; hybrid keeps per-status choices.
    if (m !== 'HYBRID') edit({ ...config, rules: config.rules.map((r) => ({ ...r, type: m })) });
    else setDirty(true);
  }

  async function saveDraft() {
    setBusy(true);
    setError(null);
    try {
      const clean: RedirectConfig = { rules: config.rules.filter((r) => r.url.trim()), params: config.params };
      const r = await post<{ version: Version; issues: Issue[] }>(`/projects/${project.id}/redirects/versions`, { mode, config: clean, changeReason: reason || undefined });
      setIssues(r.issues);
      setDraftId(r.version.id);
      setDirty(false);
      setReason('');
      const p = await get<Policy>(`/projects/${project.id}/redirects`);
      setPolicy(p);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function activate(versionId: string) {
    setBusy(true);
    setError(null);
    try {
      await post(`/projects/${project.id}/redirects/versions/${versionId}/activate`);
      setDraftId(null);
      await load();
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function showEffective() {
    try {
      const r = await get<{ rows: EffectiveRow[] }>(`/projects/${project.id}/redirects/effective`);
      setEffective(r.rows);
    } catch (e) {
      setError(e);
    }
  }

  function addOverride() {
    const scope = { ...(override.countryCode ? { countryCode: override.countryCode } : {}), ...(override.vendorId ? { vendorId: override.vendorId } : {}) };
    if (!override.url || !Object.keys(scope).length) return;
    edit({
      ...config,
      rules: [
        ...config.rules,
        {
          status: override.status as OutcomeStatus,
          type: (mode === 'HYBRID' ? override.type : mode) as RuleType,
          url: override.url,
          enabled: true,
          callbackRequired: !!override.callbackRequired,
          scope,
          ...((mode === 'HYBRID' ? override.type : mode) === 'API' ? { fallbackUrl: override.fallbackUrl ?? '' } : {}),
        },
      ],
    });
    setOverride({ status: 'COMPLETE', type: 'DYNAMIC' });
  }

  function setParam(i: number, patch: Partial<ParamMapping>) {
    edit({ ...config, params: config.params.map((p, n) => (n === i ? { ...p, ...patch } : p)) });
  }

  if (!policy) return error ? <ErrorBox error={error} /> : <Loading />;
  const overrides = config.rules.filter(isScoped);
  const errors = issues?.filter((i) => i.level === 'error') ?? [];
  const warnings = issues?.filter((i) => i.level === 'warning') ?? [];
  const ro = !editable;

  return (
    <div className="space-y-6">
      <ErrorBox error={error} />

      <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="text-sm">
          Active: <b>version {policy.active?.version ?? '–'}</b> · {policy.active?.mode.toLowerCase()}
          {dirty && <span className="ml-2 chip bg-warn/15 text-warn">Unsaved changes</span>}
          {draftId && !dirty && <span className="ml-2 chip bg-info/15 text-info">Draft saved, not active yet</span>}
          <Link href={`/redirect-health?project=${project.id}`} className="ml-3 inline-flex items-center gap-1 text-brand hover:underline"><Activity className="h-3.5 w-3.5" /> Redirect health</Link>
        </div>
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-64" placeholder="Reason for this change" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn-ghost" disabled={busy || !dirty} onClick={saveDraft}>Save as draft</button>
            <button className="btn-primary" disabled={busy || !draftId || errors.length > 0} onClick={() => draftId && activate(draftId)} title={errors.length ? 'Fix the errors first' : undefined}>
              <CheckCircle2 className="h-4 w-4" /> Approve and activate
            </button>
          </div>
        )}
      </div>

      {issues && issues.length > 0 && (
        <div className={clsx('rounded-lg border p-4 text-sm', errors.length ? 'border-bad/30 bg-bad/10' : 'border-warn/30 bg-warn/10')}>
          <div className="mb-1 flex items-center gap-2 font-medium"><TriangleAlert className="h-4 w-4" /> {errors.length} errors, {warnings.length} warnings</div>
          <ul className="ml-6 list-disc space-y-0.5">
            {issues.map((i, n) => (
              <li key={n} className={i.level === 'error' ? 'text-bad' : 'text-warn'}>
                {[i.status && STATUS_LABEL[i.status], i.scope?.countryCode, i.scope?.vendorId && vendorName[i.scope.vendorId]].filter(Boolean).join(' · ')}
                {i.status || i.scope ? ': ' : ''}{i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section title="Redirect mode">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup">
          {([
            ['STATIC', 'Static', 'Fixed destination URL per status.'],
            ['DYNAMIC', 'Dynamic', 'URLs get UID, vendor ID and country code added at runtime.'],
            ['HYBRID', 'Hybrid', 'Choose static, dynamic or API (asked live from an endpoint) for each status.'],
          ] as const).map(([m, label, desc]) => (
            <button key={m} role="radio" aria-checked={mode === m} disabled={ro} onClick={() => changeMode(m)} className={clsx('rounded-lg border p-4 text-left transition-colors', mode === m ? 'border-brand bg-brand/5 ring-2 ring-brand/20' : 'border-line hover:bg-sunken/50')}>
              <div className="text-sm font-semibold">{label}</div>
              <div className="mt-1 text-xs text-muted">{desc}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Status matrix (project level)">
        <p className="mb-4 text-xs text-muted">Dynamic URLs may use macros: <code>{MACRO_HINT}</code>. Leave a URL empty to inherit from the client template or organization default.</p>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="border-y border-line bg-sunken/60">
              <tr><th className="th">Status</th><th className="th">Type</th><th className="th">Destination URL</th><th className="th">Callback</th><th className="th">Enabled</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {OUTCOME_STATUSES.map((s) => {
                const r = projectRule(s);
                const inh = inheritedFrom(s);
                return (
                  <tr key={s}>
                    <td className="td font-medium">{STATUS_LABEL[s]}</td>
                    <td className="td">
                      <select className="input w-28 px-2 py-1" disabled={ro || mode !== 'HYBRID'} value={r ? (mode === 'HYBRID' ? r.type : mode) : mode === 'HYBRID' ? 'DYNAMIC' : mode} onChange={(e) => setProjectRule(s, { type: e.target.value as RuleType })}>
                        <option value="STATIC">Static</option><option value="DYNAMIC">Dynamic</option>{mode === 'HYBRID' && <option value="API">API</option>}
                      </select>
                    </td>
                    <td className="td w-full">
                      <input className="input px-2 py-1 font-mono text-xs" disabled={ro} value={r?.url ?? ''} aria-label={`${STATUS_LABEL[s]} ${r?.type === 'API' ? 'endpoint' : 'URL'}`} placeholder={r?.type === 'API' ? 'Endpoint, e.g. https://router.client.example.com/projexa' : inh ? `Inherited from ${inh}` : 'No rule: respondents see the PROJEXA end page'} onChange={(e) => (e.target.value || r ? setProjectRule(s, { url: e.target.value }) : null)} />
                      {r?.type === 'API' && mode === 'HYBRID' && (
                        <div className="mt-1.5 grid gap-1.5 sm:grid-cols-[1fr_120px]">
                          <input className="input px-2 py-1 font-mono text-xs" disabled={ro} value={r.fallbackUrl ?? ''} aria-label={`${STATUS_LABEL[s]} fallback URL`} placeholder="Fallback URL if the endpoint fails (macros allowed)" onChange={(e) => setProjectRule(s, { fallbackUrl: e.target.value })} />
                          <input className="input px-2 py-1 text-xs" type="number" min={200} max={5000} step={100} disabled={ro} value={r.timeoutMs ?? ''} aria-label={`${STATUS_LABEL[s]} timeout`} placeholder="1500 ms" onChange={(e) => setProjectRule(s, { timeoutMs: e.target.value ? Number(e.target.value) : undefined })} />
                        </div>
                      )}
                    </td>
                    <td className="td"><Toggle label={`${s} callback`} checked={!!r?.callbackRequired} onChange={(v) => !ro && setProjectRule(s, { callbackRequired: v })} /></td>
                    <td className="td"><Toggle label={`${s} enabled`} checked={r ? r.enabled : true} onChange={(v) => !ro && setProjectRule(s, { enabled: v })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={`Country and vendor overrides (${overrides.length})`}>
        <p className="mb-4 text-xs text-muted">Priority: vendor + country, then vendor, then country, then the project matrix. The domain allowlist always applies.</p>
        {overrides.length === 0 ? (
          <Empty>No overrides. Every country and vendor uses the project matrix.</Empty>
        ) : (
          <div className="-mx-5 mb-4 overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-y border-line bg-sunken/60"><tr><th className="th">Scope</th><th className="th">Status</th><th className="th">Type</th><th className="th">URL</th><th className="th">Callback</th><th className="th" /></tr></thead>
              <tbody className="divide-y divide-line">
                {overrides.map((r, i) => (
                  <tr key={i}>
                    <td className="td">{[r.scope?.vendorId && vendorName[r.scope.vendorId], r.scope?.countryCode && `${flag(r.scope.countryCode)} ${r.scope.countryCode}`].filter(Boolean).join(' + ')}</td>
                    <td className="td">{STATUS_LABEL[r.status]}</td>
                    <td className="td">{(mode === 'HYBRID' ? r.type : mode).toLowerCase()}</td>
                    <td className="td max-w-[360px] truncate font-mono text-xs" title={r.fallbackUrl ? `${r.url}\nFallback: ${r.fallbackUrl}` : r.url}>{r.url}{r.type === 'API' && r.fallbackUrl && <div className="truncate text-muted">fallback: {r.fallbackUrl}</div>}</td>
                    <td className="td">{r.callbackRequired ? 'yes' : 'no'}</td>
                    <td className="td">{editable && <button className="btn-ghost p-1.5" aria-label="Remove override" onClick={() => edit({ ...config, rules: config.rules.filter((x) => x !== r) })}><Trash2 className="h-3.5 w-3.5" /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editable && (
          <div className="grid grid-cols-1 gap-3 rounded-lg bg-sunken/60 p-4 md:grid-cols-[140px_180px_150px_110px_1fr_auto]">
            <Field label="Country">
              <select className="input" value={override.countryCode ?? ''} onChange={(e) => setOverride({ ...override, countryCode: e.target.value || undefined })}>
                <option value="">Any</option>{policy.countries.map((c) => <option key={c} value={c}>{flag(c)} {c}</option>)}
              </select>
            </Field>
            <Field label="Vendor">
              <select className="input" value={override.vendorId ?? ''} onChange={(e) => setOverride({ ...override, vendorId: e.target.value || undefined })}>
                <option value="">Any</option>{policy.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="input" value={override.status} onChange={(e) => setOverride({ ...override, status: e.target.value as OutcomeStatus })}>
                {OUTCOME_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select className="input" disabled={mode !== 'HYBRID'} value={mode === 'HYBRID' ? override.type : mode} onChange={(e) => setOverride({ ...override, type: e.target.value as RuleType })}>
                <option value="STATIC">Static</option><option value="DYNAMIC">Dynamic</option>{mode === 'HYBRID' && <option value="API">API</option>}
              </select>
            </Field>
            <Field label={mode === 'HYBRID' && override.type === 'API' ? 'Endpoint' : 'URL'}>
              <input className="input font-mono text-xs" value={override.url ?? ''} onChange={(e) => setOverride({ ...override, url: e.target.value })} />
              {mode === 'HYBRID' && override.type === 'API' && <input className="input mt-1.5 font-mono text-xs" aria-label="Fallback URL" placeholder="Fallback URL" value={override.fallbackUrl ?? ''} onChange={(e) => setOverride({ ...override, fallbackUrl: e.target.value })} />}
            </Field>
            <div className="flex items-end"><button className="btn-ghost" onClick={addOverride} disabled={!override.url || (!override.countryCode && !override.vendorId) || (mode === 'HYBRID' && override.type === 'API' && !override.fallbackUrl)}><Plus className="h-4 w-4" /> Add</button></div>
          </div>
        )}
      </Section>

      <Section title="Dynamic parameter mapping">
        <p className="mb-4 text-xs text-muted">Each mapping adds <code>alias=value</code> to dynamic URLs. A vendor-specific mapping replaces the general one for that vendor (e.g. one vendor expects <code>respondent_id</code> instead of <code>uid</code>).</p>
        <div className="space-y-2">
          {config.params.map((p, i) => (
            <div key={i} className="grid items-center gap-2 sm:grid-cols-[170px_1fr_200px_110px_40px]">
              <select className="input" disabled={ro} value={p.canonical} onChange={(e) => setParam(i, { canonical: e.target.value })}>
                {CANONICAL.map((c) => <option key={c} value={c}>{CANONICAL_LABEL[c]}</option>)}
              </select>
              <input className="input font-mono text-xs" disabled={ro} value={p.alias} onChange={(e) => setParam(i, { alias: e.target.value })} aria-label="Parameter name" />
              <select className="input" disabled={ro} value={p.scope?.vendorId ?? ''} onChange={(e) => setParam(i, { scope: e.target.value ? { vendorId: e.target.value } : undefined })}>
                <option value="">All vendors</option>{policy.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" disabled={ro} checked={p.required} onChange={(e) => setParam(i, { required: e.target.checked })} /> Required</label>
              {editable && <button className="btn-ghost p-1.5" aria-label="Remove mapping" onClick={() => edit({ ...config, params: config.params.filter((_, n) => n !== i) })}><Trash2 className="h-3.5 w-3.5" /></button>}
            </div>
          ))}
          {editable && <button className="btn-ghost text-xs" onClick={() => edit({ ...config, params: [...config.params, { canonical: 'respondent_uid', alias: 'uid', required: true }] })}><Plus className="h-3.5 w-3.5" /> Add mapping</button>}
        </div>
      </Section>

      <Section
        title="Effective routing"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="View">
              {(['diagram', 'table'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={routeView === v} onClick={() => setRouteView(v)} className={clsx('rounded-md px-2.5 py-1 text-xs', routeView === v ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>
                  {v === 'diagram' ? 'Diagram' : 'Table'}
                </button>
              ))}
            </div>
            <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={showEffective}>{effective ? 'Refresh' : 'Show'} for active version</button>
          </div>
        }
      >
        {!effective ? (
          <p className="text-sm text-muted">See which rule applies for every country, vendor and status, and where it comes from.</p>
        ) : effective.length === 0 ? (
          <Empty>Add vendors to see effective routing.</Empty>
        ) : routeView === 'diagram' ? (
          <RedirectDiagram rows={effective} checks={Object.entries(project.security ?? {}).filter(([, on]) => on).map(([k]) => SECURITY_LABELS[k] ?? k)} gate={!!project.gateQuestions?.length} />
        ) : (
          <div className="-m-5 max-h-[480px] overflow-auto">
            <table className="w-full min-w-[900px]">
              <thead className="sticky top-0 border-b border-line bg-sunken"><tr><th className="th">Market</th><th className="th">Vendor</th><th className="th">Status</th><th className="th">Source</th><th className="th">Destination (sample values)</th></tr></thead>
              <tbody className="divide-y divide-line">
                {effective.map((r, i) => (
                  <tr key={i} className={r.usedFallback ? 'bg-warn/5' : undefined}>
                    <td className="td">{flag(r.countryCode)} {r.countryCode}</td>
                    <td className="td">{r.vendor.name}</td>
                    <td className="td">{STATUS_LABEL[r.status]}</td>
                    <td className="td text-xs">{r.source ?? <span className="text-warn">fallback</span>}{r.type && <span className="text-muted"> · {r.type.toLowerCase()}</span>}</td>
                    <td className="td max-w-[420px] truncate font-mono text-xs" title={r.blockedReason ?? (r.apiEndpoint ? `Asked from ${r.apiEndpoint}; fallback ${r.destination}` : r.destination)}>
                      {r.usedFallback ? <span className="text-warn">{r.blockedReason}</span> : r.apiEndpoint ? <><span className="text-info">asks {r.apiEndpoint}</span><div className="truncate text-muted">fallback: {r.destination}</div></> : r.destination}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {mode === 'HYBRID' && <RedirectSigning />}

      <RedirectVersions projectId={project.id} versions={policy.versions} editable={editable} vendorName={vendorName} onChanged={async () => { setDraftId(null); await load(); reload(); }} />
    </div>
  );
}
