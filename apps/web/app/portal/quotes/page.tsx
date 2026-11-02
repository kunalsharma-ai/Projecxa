'use client';
import clsx from 'clsx';
import { Send, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Empty, ErrorBox, Field, Loading, money, PageHeader } from '@/components/ui';
import { get, post } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';

type QStatus = 'REQUESTED' | 'QUOTED' | 'DECLINED' | 'ACCEPTED' | 'CLOSED';
interface Quote {
  id: string; status: QStatus; project: { projectCode: string; name: string; category: string }; countryCode: string; language: string;
  completesWanted: number; loiMinutes: number; irPercent: number; targetGroup: string | null; note: string | null; respondBy: string | null; overdue: boolean;
  currency: string; cpi: number | null; feasibleCompletes: number | null; daysNeeded: number | null; vendorNote: string | null; respondedAt: string | null; createdAt: string;
}
const TONE: Record<QStatus, string> = { REQUESTED: 'bg-warn/15 text-warn', QUOTED: 'bg-info/15 text-info', DECLINED: 'bg-sunken text-muted', ACCEPTED: 'bg-ok/15 text-ok', CLOSED: 'bg-sunken text-muted' };
const LABEL: Record<QStatus, string> = { REQUESTED: 'Needs your quote', QUOTED: 'Quote sent', DECLINED: 'Declined', ACCEPTED: 'Accepted', CLOSED: 'Closed' };

export default function PortalQuotesPage() {
  const [rows, setRows] = useState<Quote[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ cpi: '', feasible: '', days: '', note: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => get<Quote[]>('/portal/vendor/quotes').then(setRows).catch(setError), []);
  useEffect(() => {
    load();
  }, [load]);

  function edit(q: Quote) {
    setEditing(q.id);
    setForm({ cpi: q.cpi !== null ? String(q.cpi) : '', feasible: String(q.feasibleCompletes ?? q.completesWanted), days: q.daysNeeded ? String(q.daysNeeded) : '', note: q.vendorNote ?? '' });
  }
  async function send(q: Quote, decline = false) {
    setBusy(true);
    setError(null);
    try {
      await post(`/portal/vendor/quotes/${q.id}`, decline ? { decline: true, ...(form.note.trim() ? { note: form.note.trim() } : {}) } : { cpi: Number(form.cpi), feasibleCompletes: Number(form.feasible), ...(form.days ? { daysNeeded: Number(form.days) } : {}), ...(form.note.trim() ? { note: form.note.trim() } : {}) });
      setEditing(null);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Quote requests" subtitle="Tell us your CPI and how many completes you can deliver. You can change a quote until it is accepted." />
      <ErrorBox error={error} />
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>No quote requests yet.</Empty>
      ) : (
        <div className="space-y-4">
          {rows.map((q) => {
            const open = q.status === 'REQUESTED' || q.status === 'QUOTED' || q.status === 'DECLINED';
            return (
              <article key={q.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold">{flag(q.countryCode)} {countryName(q.countryCode)} · {q.completesWanted.toLocaleString()} completes</h2>
                    <div className="text-sm text-muted">{q.project.projectCode} · {q.project.category} · LOI {q.loiMinutes} min · IR {q.irPercent}% · {q.language.toUpperCase()}{q.targetGroup ? ` · ${q.targetGroup}` : ''}</div>
                  </div>
                  <div className="text-right">
                    <span className={clsx('chip', TONE[q.status])}>{LABEL[q.status]}</span>
                    {q.respondBy && q.status === 'REQUESTED' && <div className={clsx('mt-1 text-xs', q.overdue ? 'text-bad' : 'text-muted')}>Answer by {new Date(q.respondBy).toLocaleString()}</div>}
                  </div>
                </div>
                {q.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{q.note}</p>}
                {q.cpi !== null && editing !== q.id && (
                  <p className="mt-3 text-sm">Your quote: <b>{money(q.cpi, q.currency)}</b> per complete, {q.feasibleCompletes?.toLocaleString()} completes{q.daysNeeded ? ` in ${q.daysNeeded} days` : ''}.{q.vendorNote ? ` “${q.vendorNote}”` : ''}</p>
                )}
                {q.status === 'DECLINED' && editing !== q.id && <p className="mt-3 text-sm text-muted">You declined{q.vendorNote ? `: ${q.vendorNote}` : '.'}</p>}
                {editing === q.id ? (
                  <div className="mt-4 grid gap-3 rounded-lg bg-sunken/60 p-4 sm:grid-cols-[150px_150px_120px_1fr]">
                    <Field label={`CPI (${q.currency})`}><input className="input" type="number" min={0.01} step={0.01} value={form.cpi} onChange={(e) => setForm({ ...form, cpi: e.target.value })} /></Field>
                    <Field label="Completes you can do"><input className="input" type="number" min={1} value={form.feasible} onChange={(e) => setForm({ ...form, feasible: e.target.value })} /></Field>
                    <Field label="Days needed"><input className="input" type="number" min={1} value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} /></Field>
                    <Field label="Note (optional)"><input className="input" maxLength={2000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
                    <div className="flex flex-wrap gap-2 sm:col-span-full">
                      <button className="btn-primary" disabled={busy || !(Number(form.cpi) > 0) || !(Number(form.feasible) >= 1)} onClick={() => send(q)}><Send className="h-4 w-4" /> Send quote</button>
                      <button className="btn-ghost" disabled={busy} onClick={() => send(q, true)}><X className="h-4 w-4" /> We can&apos;t do this</button>
                      <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  open && <button className="btn-ghost mt-3 text-sm" onClick={() => edit(q)}>{q.status === 'REQUESTED' ? 'Answer' : 'Change my answer'}</button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
