'use client';
import clsx from 'clsx';
import { CheckCircle2, FlaskConical, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Empty, ErrorBox, Field, Section } from '@/components/ui';
import { post } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import { OUTCOME_STATUSES, OutcomeStatus, STATUS_LABEL } from '@/lib/types';
import type { ProjectDetail } from './types';

interface SimResult {
  input: { status: OutcomeStatus; uid: string; version: string; mode: string };
  result: { destination: string; usedFallback: boolean; ruleSource?: string; ruleType?: string; callbackRequired: boolean; params: Record<string, string>; blockedReason?: string; steps: { step: string; ok: boolean; detail: string }[] };
  callbackPreview: { url: string } | null;
  billable: boolean;
  durationMs: number;
}

export function QaStudio({ project }: { project: ProjectDetail }) {
  const [countryCode, setCountry] = useState(project.countries[0]?.countryCode ?? '');
  const vendors = useMemo(() => project.countries.find((c) => c.countryCode === countryCode)?.allocations ?? [], [project, countryCode]);
  const [vendorId, setVendor] = useState('');
  const [uid, setUid] = useState('QA-TEST-001');
  const [results, setResults] = useState<SimResult[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const vid = vendorId || vendors[0]?.vendorId || '';

  async function run(statuses: readonly OutcomeStatus[]) {
    setBusy(true);
    setError(null);
    try {
      const out: SimResult[] = [];
      for (const status of statuses) out.push(await post<SimResult>(`/projects/${project.id}/redirects/simulate`, { status, countryCode, vendorId: vid, uid }));
      setResults(out);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const testLink = vendors.find((a) => a.vendorId === vid)?.testEntryLink.replace('[UID]', encodeURIComponent(uid));

  return (
    <div className="space-y-6">
      <Section title={<span className="flex items-center gap-2"><FlaskConical className="h-4 w-4" /> Redirect QA studio</span>}>
        <p className="mb-4 text-sm text-muted">Simulations use the active configuration and synthetic IDs. They create no sessions, completes or callbacks.</p>
        {vendors.length === 0 && project.countries.length > 0 ? (
          <Empty>Add a vendor to {countryName(countryCode)} first.</Empty>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
          <Field label="Country">
            <select className="input" value={countryCode} onChange={(e) => { setCountry(e.target.value); setVendor(''); }}>
              {project.countries.map((c) => <option key={c.id} value={c.countryCode}>{flag(c.countryCode)} {countryName(c.countryCode)}</option>)}
            </select>
          </Field>
          <Field label="Vendor">
            <select className="input" value={vid} onChange={(e) => setVendor(e.target.value)}>
              {vendors.map((a) => <option key={a.vendorId} value={a.vendorId}>{a.vendor.name}</option>)}
            </select>
          </Field>
          <Field label="Test UID"><input className="input font-mono text-xs" value={uid} onChange={(e) => setUid(e.target.value)} /></Field>
          <div className="flex items-end"><button className="btn-primary" disabled={busy || !vid} onClick={() => run(OUTCOME_STATUSES)}>Run all 8 statuses</button></div>
          <div className="flex items-end">
            <select className="input" value="" disabled={busy || !vid} onChange={(e) => e.target.value && run([e.target.value as OutcomeStatus])} aria-label="Run one status">
              <option value="">Run one…</option>
              {OUTCOME_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
        </div>
        {testLink && (
          <p className="mt-4 text-xs text-muted">
            For a full journey through the real survey, open the test link: <a className="break-all text-brand underline" href={testLink} target="_blank" rel="noreferrer">{testLink}</a>
          </p>
        )}
      </Section>
      <ErrorBox error={error} />
      {results.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {results.map((r) => (
            <div key={r.input.status} className={clsx('card p-4', r.result.usedFallback && 'border-warn/50')}>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 font-medium">
                  {r.result.usedFallback ? <XCircle className="h-4 w-4 text-warn" /> : <CheckCircle2 className="h-4 w-4 text-ok" />}
                  {STATUS_LABEL[r.input.status]}
                </div>
                <div className="text-xs text-muted">{r.result.ruleSource ?? 'fallback'}{r.result.ruleType ? ` · ${r.result.ruleType.toLowerCase()}` : ''} · {r.durationMs} ms</div>
              </div>
              <code className="block break-all rounded bg-sunken p-2 text-xs">{r.result.destination}</code>
              {Object.keys(r.result.params).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">{Object.entries(r.result.params).map(([k, v]) => <span key={k} className="chip bg-brand/10 font-mono text-brand">{k}={v}</span>)}</div>
              )}
              <ol className="mt-3 space-y-1 text-xs">
                {r.result.steps.map((s, i) => (
                  <li key={i} className={s.ok ? 'text-muted' : 'text-warn'}>{s.ok ? '✓' : '✗'} <b>{s.step}</b>: {s.detail}</li>
                ))}
              </ol>
              {r.callbackPreview && <p className="mt-2 break-all text-xs text-muted">Callback that would be sent: <code>{r.callbackPreview.url}</code></p>}
              {r.result.callbackRequired && !r.callbackPreview && <p className="mt-2 text-xs text-warn">Callback required, but this vendor has no callback URL.</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
