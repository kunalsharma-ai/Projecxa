'use client';
import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ClipboardList, FileText, Upload } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBox, Field, Loading, Section } from '@/components/ui';
import { get, post } from '@/lib/api';
import type { ProjectDetail } from './types';

type Mode = 'final_list' | 'approve_listed' | 'reject_listed';
interface Bucket { completes: number; byCurrency: { currency: string; completes: number; revenue: number; payout: number }[] }
interface Summary {
  pending: Bucket; approved: Bucket; rejected: Bucket; toInvoice: Bucket; invoiced: Bucket;
  history: { id: string; mode: Mode; submitted: number; matched: number; approved: number; rejected: number; unchanged: number; unknown: number; locked: number; note: string | null; actor: string | null; createdAt: string; unknownSample: string[] | null }[];
}
interface Result {
  mode: Mode; submitted: number; matched: number; approve: number; reject: number; unchanged: number; locked: number; unknown: number; unknownSample: string[]; ambiguous: number;
  notComplete: { count: number; sample: { id: string; status: string }[] };
  approvedAfter: { currency: string; completes: number; revenue: number }[];
}
interface Invoice { id: string; number: string; status: string; currency: string; total: number; completes: number; createdAt: string; dueAt: string | null; overdue: boolean }

const MODES: { id: Mode; name: string; help: string }[] = [
  { id: 'final_list', name: 'Final list', help: 'The client’s list of valid completes. Listed IDs are approved; every other complete is rejected.' },
  { id: 'approve_listed', name: 'Approve listed', help: 'Approve only the listed IDs. Others stay as they are.' },
  { id: 'reject_listed', name: 'Reject listed', help: 'Reject only the listed IDs, e.g. a client’s list of bad completes.' },
];
const amt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const money = (b: { currency: string; revenue: number }[]) => (b.length ? b.map((x) => `${x.currency} ${amt.format(x.revenue)}`).join(' · ') : '–');

/** Splits pasted text or a CSV/TXT file into IDs: one per line, or the first column of a CSV. */
export function parseIds(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.split(/[,;\t]/)[0].trim().replace(/^"|"$/g, ''))
    .filter((x) => x && !/^(id|rid|uid|token|respondent.?id)$/i.test(x));
}

export function FinanceTab({ project, editable, reload }: { project: ProjectDetail; editable: boolean; reload: () => void }) {
  const [s, setS] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>('final_list');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    get<Summary>(`/projects/${project.id}/reconciliation`).then(setS).catch(setError);
    get<Invoice[]>(`/invoices?projectId=${project.id}`).then(setInvoices).catch(setError);
  }, [project.id]);
  useEffect(load, [load]);

  const ids = parseIds(text);
  // A changed list or mode invalidates the preview.
  useEffect(() => setPreview(null), [text, mode]);

  async function run(apply: boolean) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await post<Result>(`/projects/${project.id}/reconciliation${apply ? '' : '/preview'}`, { ids, mode, note: note || undefined });
      if (apply) {
        setDone(`Reconciled: ${r.approve} approved, ${r.reject} rejected${r.locked ? `, ${r.locked} already invoiced and left as they were` : ''}.`);
        setText('');
        setNote('');
        setPreview(null);
        load();
        reload();
      } else setPreview(r);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function invoice() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await post<{ invoices: Invoice[]; pendingNotInvoiced: number }>(`/projects/${project.id}/invoices`, {});
      setDone(`Created ${r.invoices.map((i) => i.number).join(', ')} as draft${r.invoices.length > 1 ? 's' : ''}.${r.pendingNotInvoiced ? ` ${r.pendingNotInvoiced} completes still await reconciliation and were not included.` : ''}`);
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!s) return error ? <ErrorBox error={error} /> : <Loading />;

  const cards = [
    { label: 'Awaiting reconciliation', b: s.pending, tone: s.pending.completes ? 'text-warn' : '' },
    { label: 'Approved', b: s.approved, tone: 'text-ok' },
    { label: 'Rejected', b: s.rejected, tone: s.rejected.completes ? 'text-bad' : '' },
    { label: 'Ready to invoice', b: s.toInvoice, tone: s.toInvoice.completes ? 'text-brand' : '' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">{c.label}</div>
            <div className={clsx('mt-1 text-2xl font-semibold tabular-nums', c.tone)}>{c.b.completes}</div>
            <div className="mt-0.5 truncate text-xs text-muted">{money(c.b.byCurrency)}</div>
          </div>
        ))}
      </div>
      {done && <div className="flex items-start gap-2 rounded-lg border border-ok/40 bg-ok/10 p-3 text-sm text-ok"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{done}</div>}
      <ErrorBox error={error} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Section title={<span className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-brand" /> Reconcile with the client’s list</span>}>
          {!editable ? (
            <p className="text-sm text-muted">Only admins and project managers can reconcile.</p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted">Paste the IDs from the client’s file, one per line. Use the respondent IDs the client survey received (our session tokens) or vendor UIDs. Completes already on an invoice never change.</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {MODES.map((m) => (
                  <button key={m.id} type="button" onClick={() => setMode(m.id)} aria-pressed={mode === m.id} className={clsx('rounded-lg border p-3 text-left', mode === m.id ? 'border-brand bg-brand/5 ring-2 ring-brand/20' : 'border-line hover:bg-sunken')}>
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="mt-0.5 text-xs text-muted">{m.help}</div>
                  </button>
                ))}
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="label mb-0">Client IDs</span>
                  <button type="button" className="flex items-center gap-1 text-xs text-brand hover:underline" onClick={() => file.current?.click()}><Upload className="h-3.5 w-3.5" />Load CSV or TXT</button>
                </div>
                <textarea className="input min-h-40 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={'k7Qm2…\nk9Pa1…'} aria-label="Client IDs" />
                <input ref={file} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); e.target.value = ''; }} />
                <div className="mt-1 text-xs text-muted">{ids.length} {ids.length === 1 ? 'ID' : 'IDs'} found{ids.length !== new Set(ids).size ? ` (${ids.length - new Set(ids).size} repeated)` : ''}. The first column is used when the file has several.</div>
              </div>
              <Field label="Note (optional)">
                <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Client reconciliation file, 3 Nov" />
              </Field>
              <div className="flex flex-wrap gap-2">
                <button className="btn-ghost" disabled={!ids.length || busy} onClick={() => run(false)}>{busy && !preview ? 'Checking…' : 'Preview changes'}</button>
                <button className="btn-primary" disabled={!preview || busy || (!preview.approve && !preview.reject)} onClick={() => run(true)}>Apply reconciliation</button>
              </div>

              {preview && (
                <div className="rounded-lg border border-line p-4">
                  <div className="mb-3 text-sm font-medium">Preview: nothing is saved until you apply</div>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    <div><dt className="text-xs text-muted">IDs submitted</dt><dd className="tabular-nums">{preview.submitted}</dd></div>
                    <div><dt className="text-xs text-muted">Matched completes</dt><dd className="tabular-nums">{preview.matched}</dd></div>
                    <div><dt className="text-xs text-muted">Already correct</dt><dd className="tabular-nums">{preview.unchanged}</dd></div>
                    <div><dt className="text-xs text-muted">Will be approved</dt><dd className="font-semibold tabular-nums text-ok">{preview.approve}</dd></div>
                    <div><dt className="text-xs text-muted">Will be rejected</dt><dd className="font-semibold tabular-nums text-bad">{preview.reject}</dd></div>
                    <div><dt className="text-xs text-muted">Invoiced, left as is</dt><dd className="tabular-nums">{preview.locked}</dd></div>
                  </dl>
                  <div className="mt-3 text-sm">Approved after this: <span className="font-medium">{preview.approvedAfter.length ? preview.approvedAfter.map((a) => `${a.completes} (${a.currency} ${amt.format(a.revenue)})`).join(' · ') : 'none'}</span></div>
                  {(preview.unknown > 0 || preview.notComplete.count > 0 || preview.ambiguous > 0) && (
                    <div className="mt-3 space-y-2 rounded-md bg-warn/10 p-3 text-sm text-warn">
                      <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Worth checking with the client</div>
                      {preview.notComplete.count > 0 && (
                        <div>
                          {preview.notComplete.count} listed {preview.notComplete.count === 1 ? 'ID was' : 'IDs were'} recorded with another outcome:{' '}
                          <span className="font-mono text-xs">{preview.notComplete.sample.slice(0, 8).map((x) => `${x.id} (${x.status.toLowerCase().replace('_', ' ')})`).join(', ')}</span>
                        </div>
                      )}
                      {preview.unknown > 0 && <div>{preview.unknown} {preview.unknown === 1 ? 'ID matches' : 'IDs match'} nothing in this project: <span className="font-mono text-xs">{preview.unknownSample.slice(0, 8).join(', ')}{preview.unknown > 8 ? ' …' : ''}</span></div>}
                      {preview.ambiguous > 0 && <div>{preview.ambiguous} vendor {preview.ambiguous === 1 ? 'UID matches' : 'UIDs match'} more than one complete; use the session tokens for those.</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Section>

        <div className="space-y-6">
          <Section
            title={<span className="flex items-center gap-2"><FileText className="h-4 w-4 text-brand" /> Invoices</span>}
            actions={<Link href={`/invoices?projectId=${project.id}`} className="text-xs text-brand hover:underline">All invoices</Link>}
          >
            {editable && (
              <div className="mb-4 rounded-lg border border-line p-3">
                <div className="text-sm">{s.toInvoice.completes ? <>{s.toInvoice.completes} approved {s.toInvoice.completes === 1 ? 'complete is' : 'completes are'} ready to bill: <span className="font-medium">{money(s.toInvoice.byCurrency)}</span></> : 'No approved completes waiting to be billed.'}</div>
                {s.pending.completes > 0 && <div className="mt-1 text-xs text-warn">{s.pending.completes} completes still await reconciliation and won’t be included.</div>}
                <button className="btn-primary mt-3" disabled={!s.toInvoice.completes || busy} onClick={invoice}>Create draft invoice{s.toInvoice.byCurrency.length > 1 ? 's' : ''}</button>
                {s.toInvoice.byCurrency.length > 1 && <div className="mt-1 text-xs text-muted">One invoice per currency.</div>}
              </div>
            )}
            {!invoices ? <Loading /> : invoices.length === 0 ? (
              <p className="text-sm text-muted">No invoices yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {invoices.map((i) => (
                  <li key={i.id}>
                    <Link href={`/invoices/${i.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-sunken/50">
                      <span className="min-w-0">
                        <span className="font-mono text-sm">{i.number}</span>
                        <span className="ml-2 text-xs text-muted">{i.completes} completes</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-sm tabular-nums">{i.currency} {amt.format(i.total)}</span>
                        <InvoiceStatus status={i.status} overdue={i.overdue} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Reconciliation history">
            {s.history.length === 0 ? (
              <p className="text-sm text-muted">No reconciliations yet. Approvals made one by one in the Respondents tab are in the audit log.</p>
            ) : (
              <ul className="space-y-3">
                {s.history.map((h) => (
                  <li key={h.id} className="rounded-lg border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{MODES.find((m) => m.id === h.mode)?.name ?? h.mode}</span>
                      <span className="text-xs text-muted">{new Date(h.createdAt).toLocaleString()}{h.actor ? ` · ${h.actor}` : ''}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {h.submitted} IDs · <span className="text-ok">{h.approved} approved</span> · <span className="text-bad">{h.rejected} rejected</span> · {h.unchanged} unchanged{h.locked ? ` · ${h.locked} invoiced` : ''}{h.unknown ? ` · ${h.unknown} unknown` : ''}
                    </div>
                    {h.note && <div className="mt-1 text-xs">{h.note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

export function InvoiceStatus({ status, overdue }: { status: string; overdue?: boolean }) {
  const cls = overdue ? 'bg-bad/15 text-bad' : status === 'PAID' ? 'bg-ok/15 text-ok' : status === 'SENT' ? 'bg-info/15 text-info' : status === 'VOID' ? 'bg-sunken text-muted line-through' : 'bg-warn/15 text-warn';
  return <span className={clsx('chip', cls)}>{overdue ? 'Overdue' : status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}
