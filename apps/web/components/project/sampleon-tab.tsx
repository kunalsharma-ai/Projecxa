'use client';
/**
 * SAMPLEON audience requests for a project (docs/SAMPLEON_INTEGRATION.md).
 * SampTrek sends the project's requirements; SAMPLEON finds respondents in SUPPLY360, a person
 * approves the audience in SAMPLEON, and progress comes back here. Quota cells are sent as
 * SUPPLY360 attribute quotas once their questions are mapped below.
 */
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, RefreshCw, Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ProjectDetail } from '@/components/project/types';
import { Empty, ErrorBox, Field, Loading, Progress, Section, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { flag } from '@/lib/countries';

interface RequestRow {
  id: string;
  audienceRequestId: string;
  surveyId: string;
  status: string;
  requiredCompletes: number;
  completes: number;
  remaining: number | null;
  usesProjectQuotas: boolean;
  lastEventType: string | null;
  lastEventAt: string | null;
  createdAt: string;
}
type Scalar = string | number | boolean;
interface Attribute { key: string; label: string; type: 'enum' | 'number' | 'boolean' | 'string'; values?: string[] }
interface Criterion { attribute: string; op: 'in' | 'gte' | 'lte' | 'between'; values?: Scalar[]; value?: number; min?: number; max?: number }
interface QuotaPreview {
  cells: number;
  attributes: Attribute[];
  map: Record<string, { attribute: string; values: Record<string, Scalar> }>;
  quotas: { id: string; label: string; country: string; target: number; conditions: Criterion[] }[];
  skipped: { cellId: string; name: string; country: string; reason: string }[];
  questions: { key: string; text: string; type: string; attribute: string | null; suggested: boolean; answers: { id: string; label: string; value: Scalar | null; suggested: boolean }[] }[];
}

const STATUS_TONE: Record<string, string> = {
  submitted: 'bg-info/15 text-info',
  feasibility_ready: 'bg-info/15 text-info',
  approved: 'bg-brand/15 text-brand',
  soft_launch: 'bg-ok/15 text-ok',
  live: 'bg-ok/15 text-ok',
  paused: 'bg-warn/15 text-warn',
  closed: 'bg-sunken text-muted',
  rejected: 'bg-bad/15 text-bad',
};
const statusLabel = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ');

function describe(c: Criterion, attrs: Attribute[]) {
  const a = attrs.find((x) => x.key === c.attribute);
  const name = a?.label ?? c.attribute;
  if (c.op === 'in') return `${name}: ${(c.values ?? []).map((v) => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v).replace(/_/g, ' '))).join(' or ')}`;
  if (c.op === 'between') return `${name}: ${c.min}–${c.max}`;
  if (c.op === 'gte') return `${name}: ${c.value}+`;
  return `${name}: up to ${c.value}`;
}

export function SampleonTab({ project, editable }: { project: ProjectDetail; editable: boolean }) {
  const [view, setView] = useState<{ configured: boolean; requests: RequestRow[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => get<{ configured: boolean; requests: RequestRow[] }>(`/projects/${project.id}/sampleon`).then(setView).catch(setError), [project.id]);
  useEffect(() => {
    load();
  }, [load]);

  if (!view) return error ? <ErrorBox error={error} /> : <Loading />;
  if (!view.configured) {
    return (
      <Empty>
        SAMPLEON is not connected. An administrator sets <code>SAMPLEON_URL</code> and <code>SAMPLEON_CLIENT_SECRET</code> for the API, and registers SampTrek as a client in SAMPLEON.
      </Empty>
    );
  }
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Ask SAMPLEON for respondents from the SUPPLY360 panels. SAMPLEON checks feasibility, a supply approver approves the audience before any invitation goes out, and progress comes back here. SAMPLEON completes are shown apart from the completes SampTrek routes itself.
      </p>
      <Requests project={project} rows={view.requests} editable={editable} reload={load} />
      {editable && <NewRequest project={project} onSent={load} />}
      <QuotaMapping project={project} editable={editable} />
    </div>
  );
}

function Requests({ project, rows, editable, reload }: { project: ProjectDetail; rows: RequestRow[]; editable: boolean; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const sync = async (r: RequestRow) => {
    setBusy(r.id);
    setError(null);
    setDone(null);
    try {
      await post(`/projects/${project.id}/sampleon/${r.id}/sync`);
      setDone(`Sent the current targets${r.usesProjectQuotas ? ', quotas' : ''} and fieldwork dates for ${r.audienceRequestId}.`);
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section title="Audience requests">
      <ErrorBox error={error} />
      {done && <p className="mb-3 flex items-center gap-2 text-sm text-ok"><CheckCircle2 className="h-4 w-4" /> {done}</p>}
      {rows.length === 0 ? (
        <Empty>No audience requests yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Request</th>
                <th className="py-2 pr-3 font-medium">Survey</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">SAMPLEON completes</th>
                <th className="py-2 pr-3 font-medium">Last update</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-middle">
                  <td className="py-2 pr-3 font-mono text-xs">{r.audienceRequestId}</td>
                  <td className="py-2 pr-3">{r.surveyId}</td>
                  <td className="py-2 pr-3"><span className={clsx('chip', STATUS_TONE[r.status] ?? 'bg-sunken text-muted')}>{statusLabel(r.status)}</span></td>
                  <td className="min-w-[160px] py-2 pr-3">
                    <div className="mb-1 text-xs tabular-nums">{r.completes} / {r.requiredCompletes}</div>
                    <Progress value={r.completes} max={r.requiredCompletes} />
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted">{r.lastEventType ? `${r.lastEventType.replace(/[._]/g, ' ')} · ${new Date(r.lastEventAt!).toLocaleString()}` : 'Waiting for SAMPLEON'}</td>
                  <td className="py-2 text-right">
                    {editable && r.status !== 'closed' && r.status !== 'rejected' && (
                      <button className="btn-ghost px-2.5 py-1 text-xs" disabled={busy === r.id} onClick={() => sync(r)} title="Send the project's current targets and fieldwork dates">
                        <RefreshCw className={clsx('h-3.5 w-3.5', busy === r.id && 'animate-spin')} /> Send changes
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function NewRequest({ project, onSent }: { project: ProjectDetail; onSent: () => void }) {
  const [form, setForm] = useState({ surveyId: '', launchUrl: '', naturalLanguage: '', rewardPoints: '500', allowRouting: true, useProjectQuotas: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ id: string; sent: number; skipped: QuotaPreview['skipped'] } | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const urlOk = /^https?:\/\/\S+$/.test(form.launchUrl) && form.launchUrl.includes('{token}');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await post<{ record: RequestRow; quotas: { sent: unknown[]; skipped: QuotaPreview['skipped'] } }>(`/projects/${project.id}/sampleon/audience-requests`, {
        surveyId: form.surveyId.trim(),
        launchUrl: form.launchUrl.trim(),
        targeting: { naturalLanguage: form.naturalLanguage.trim() },
        rewardPoints: Number(form.rewardPoints),
        allowRouting: form.allowRouting,
        useProjectQuotas: form.useProjectQuotas,
      });
      setResult({ id: r.record.audienceRequestId, sent: r.quotas.sent.length, skipped: r.quotas.skipped });
      setForm((f) => ({ ...f, surveyId: '', launchUrl: '', naturalLanguage: '' }));
      onSent();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Request an audience">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <Field label="Survey ID at the survey host" hint="For ZAPX, the survey's ID (zsv_…).">
          <input className="input" required maxLength={120} value={form.surveyId} onChange={(e) => set('surveyId', e.target.value)} />
        </Field>
        <Field label="Launch link" hint="ZAPX shows it on the survey's SAMPLEON page. It must contain {token}.">
          <input className="input" required type="url" value={form.launchUrl} onChange={(e) => set('launchUrl', e.target.value)} placeholder="https://…?vid=SAMPLEON&uid={token}" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Who should take part" hint="Plain language. SAMPLEON turns it into SUPPLY360 profile filters and shows them to the approver.">
            <textarea className="input min-h-[80px]" required minLength={3} maxLength={2000} value={form.naturalLanguage} onChange={(e) => set('naturalLanguage', e.target.value)} placeholder="Cardiologists with at least five years of professional experience" />
          </Field>
        </div>
        <Field label="Reward (points)">
          <input className="input tabular-nums" required type="number" min={0} max={1_000_000} step={1} value={form.rewardPoints} onChange={(e) => set('rewardPoints', e.target.value)} />
        </Field>
        <div className="space-y-3 pt-6">
          <label className="flex items-center gap-3 text-sm"><Toggle checked={form.allowRouting} onChange={(v) => set('allowRouting', v)} label="Allow routing" /> Offer screened-out respondents another survey</label>
          <label className="flex items-center gap-3 text-sm"><Toggle checked={form.useProjectQuotas} onChange={(v) => set('useProjectQuotas', v)} label="Send quota cells" /> Send this project's quota cells (mapped below)</label>
        </div>
        <p className="text-xs text-muted md:col-span-2">
          Sends {project.countries.length} market{project.countries.length === 1 ? '' : 's'} with their targets, LOI, incidence and fieldwork dates. Nobody is invited until a supply approver approves the audience in SAMPLEON.
        </p>
        <div className="md:col-span-2">
          <ErrorBox error={error} />
          {result && (
            <div className="mb-3 rounded-lg border border-ok/30 bg-ok/10 p-3 text-sm text-ok">
              <div className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" /> Sent as {result.id} with {result.sent} quota{result.sent === 1 ? '' : 's'}.</div>
              {result.skipped.length > 0 && <div className="mt-1 text-xs">{result.skipped.length} quota cell{result.skipped.length === 1 ? ' was' : 's were'} not sent; see below.</div>}
            </div>
          )}
          <button className="btn-primary" disabled={busy || !urlOk}><Send className="h-4 w-4" /> {busy ? 'Sending…' : 'Send to SAMPLEON'}</button>
          {form.launchUrl && !urlOk && <span className="ml-3 text-xs text-warn">The launch link needs {'{token}'}.</span>}
        </div>
      </form>
    </Section>
  );
}

function QuotaMapping({ project, editable }: { project: ProjectDetail; editable: boolean }) {
  const [view, setView] = useState<QuotaPreview | null>(null);
  const [draft, setDraft] = useState<QuotaPreview['map']>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const show = (v: QuotaPreview) => {
    setView(v);
    // Start from the saved map, filling in suggestions so a person only confirms them.
    const m: QuotaPreview['map'] = {};
    for (const q of v.questions) {
      if (!q.attribute) continue;
      const values: Record<string, Scalar> = { ...(v.map[q.key]?.attribute === q.attribute ? v.map[q.key].values : {}) };
      for (const a of q.answers) if (values[a.id] === undefined && a.value !== null) values[a.id] = a.value;
      m[q.key] = { attribute: q.attribute, values };
    }
    setDraft(m);
  };
  useEffect(() => {
    get<QuotaPreview>(`/projects/${project.id}/sampleon/quotas`).then(show).catch(setError);
  }, [project.id]);

  if (!view) return error ? <Section title="Quota cells for SAMPLEON"><ErrorBox error={error} /></Section> : <Loading label="Loading quota cells" />;
  const attrs = view.attributes;
  const pending = view.questions.some((q) => q.suggested);

  const setAttr = (key: string, attribute: string) => {
    setSaved(false);
    setDraft((d) => {
      const n = { ...d };
      if (!attribute) delete n[key];
      else n[key] = { attribute, values: {} };
      return n;
    });
  };
  const setValue = (key: string, answerId: string, raw: string, a: Attribute) => {
    setSaved(false);
    setDraft((d) => {
      const cur = d[key] ?? { attribute: a.key, values: {} };
      const values = { ...cur.values };
      if (raw === '') delete values[answerId];
      else values[answerId] = a.type === 'boolean' ? raw === 'true' : a.type === 'number' ? Number(raw) : raw;
      return { ...d, [key]: { ...cur, values } };
    });
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      show(await api<QuotaPreview>(`/projects/${project.id}/sampleon/quotas`, { method: 'PUT', json: { map: draft } }));
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Quota cells for SAMPLEON" actions={editable && view.questions.length > 0 && <button className="btn-primary px-3 py-1.5 text-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save mapping'}</button>}>
      {view.cells === 0 ? (
        <Empty>This project has no quota cells. SAMPLEON gets the per-market targets only.</Empty>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-muted">
            SAMPLEON counts its respondents by their SUPPLY360 profile, not by gate answers. Map each question your cells use to a profile attribute once, and each answer to one of its values. Answers with the same name are matched for you. SampTrek keeps counting its own cells for the respondents it routes itself.
          </p>
          {pending && (
            <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Some questions have only a suggested attribute. Check them and save the mapping; until then their cells are not sent.</span>
            </div>
          )}
          <ErrorBox error={error} />
          {saved && <p className="flex items-center gap-2 text-sm text-ok"><CheckCircle2 className="h-4 w-4" /> Mapping saved. New requests and “Send changes” use it.</p>}
          <div className="space-y-4">
            {view.questions.map((q) => {
              const m = draft[q.key];
              const a = attrs.find((x) => x.key === m?.attribute);
              const fit = attrs.filter((x) => (q.type === 'number' ? x.type === 'number' : x.type !== 'number'));
              return (
                <div key={q.key} className="rounded-lg border border-line p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{q.text}</div>
                      <div className="text-xs text-muted">{q.key.startsWith('gate:') ? 'Gate survey' : 'Prescreener'} · {q.type}</div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-muted">SUPPLY360 attribute</span>
                      <select className="input w-auto py-1" disabled={!editable} value={m?.attribute ?? ''} onChange={(e) => setAttr(q.key, e.target.value)}>
                        <option value="">Not mapped</option>
                        {fit.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                      {q.suggested && m?.attribute === q.attribute && <span className="chip bg-warn/15 text-warn">Suggested</span>}
                    </label>
                  </div>
                  {a && q.type !== 'number' && q.answers.length > 0 && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {q.answers.map((ans) => {
                        const v = m?.values[ans.id];
                        return (
                          <label key={ans.id} className="flex items-center justify-between gap-3 rounded-md bg-sunken px-3 py-1.5 text-sm">
                            <span className="truncate">{ans.label}</span>
                            {a.type === 'string' ? (
                              <input className="input w-40 py-1" disabled={!editable} value={v === undefined ? '' : String(v)} onChange={(e) => setValue(q.key, ans.id, e.target.value, a)} />
                            ) : (
                              <select className="input w-40 py-1" disabled={!editable} value={v === undefined ? '' : String(v)} onChange={(e) => setValue(q.key, ans.id, e.target.value, a)}>
                                <option value="">Not mapped</option>
                                {(a.type === 'boolean' ? ['true', 'false'] : a.values ?? []).map((x) => (
                                  <option key={x} value={x}>{a.type === 'boolean' ? (x === 'true' ? 'Yes' : 'No') : x.replace(/_/g, ' ')}</option>
                                ))}
                              </select>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {a && q.type === 'number' && <p className="text-xs text-muted">Cell ranges are sent as ranges on {a.label}.</p>}
                </div>
              );
            })}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Sent to SAMPLEON ({view.quotas.length})</h3>
            {view.quotas.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {view.quotas.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>{flag(x.country)} {x.country} · <span className="font-medium">{x.label}</span> <span className="text-muted">— {x.conditions.map((c) => describe(c, attrs)).join(' and ')}</span></span>
                    <span className="tabular-nums text-muted">{x.target}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {view.skipped.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Not sent ({view.skipped.length})</h3>
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {view.skipped.map((x) => (
                  <li key={x.cellId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>{flag(x.country)} {x.country} · <span className="font-medium">{x.name}</span></span>
                    <span className="text-xs text-muted">{x.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
