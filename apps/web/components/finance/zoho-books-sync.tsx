'use client';
import clsx from 'clsx';
import { CheckCircle2, PlugZap, RefreshCw, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { ErrorBox, Loading, Section, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';

interface Settings { hourly: boolean; since: string | null; invoices: boolean; bills: boolean; payments: boolean }
interface Counts { customers: number; vendors: number; invoices: number; bills: number; matched: number; paymentsReceived: number; paymentsMade: number; voided: number }
interface Run { id: string; trigger: 'manual' | 'schedule'; status: 'running' | 'ok' | 'partial' | 'failed'; counts: Counts; errors: { type: string; number: string | null; message: string }[]; startedAt: string; finishedAt: string | null; by: string | null }
interface Status {
  configured: boolean; missing: string[]; boundHere: boolean; otherTenant: boolean; dataCentre: string | null; apiHost: string | null; zohoOrganizationId: string | null;
  settings: Settings; linked: Record<string, number>; running: boolean; runs: Run[];
}
interface TestResult { ok: boolean; organization: { name: string; currency: string } | null; checks: { label: string; ok: boolean; detail: string }[] }

const STATUS: Record<Run['status'], [string, string]> = {
  running: ['Running', 'bg-info/15 text-info'],
  ok: ['Done', 'bg-ok/15 text-ok'],
  partial: ['Partly done', 'bg-warn/15 text-warn'],
  failed: ['Failed', 'bg-bad/15 text-bad'],
};

function summary(c: Counts) {
  const parts = [
    c.invoices && `${c.invoices} ${c.invoices === 1 ? 'invoice' : 'invoices'}`,
    c.bills && `${c.bills} ${c.bills === 1 ? 'bill' : 'bills'}`,
    c.paymentsReceived && `${c.paymentsReceived} received`,
    c.paymentsMade && `${c.paymentsMade} paid out`,
    c.voided && `${c.voided} voided`,
    c.customers + c.vendors && `${c.customers + c.vendors} new contacts`,
    c.matched && `${c.matched} already there`,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Nothing new';
}

/** Direct sync to Zoho Books: settings, test, sync now and the run history. */
export function ZohoBooksSync({ onSynced }: { onSynced?: () => void }) {
  const me = useMe();
  const admin = me?.user.role === 'ADMIN';
  const [s, setS] = useState<Status | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState<'' | 'test' | 'sync' | 'save'>('');
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => get<Status>('/accounting/zoho-books').then((x) => { setS(x); setForm((f) => f ?? x.settings); return x; }), []);
  useEffect(() => { load().catch(setError); }, [load]);
  // While a run is going, check on it every few seconds.
  useEffect(() => {
    if (!s?.running) return;
    const t = setInterval(() => load().then((x) => { if (!x.running) onSynced?.(); }).catch(setError), 3000);
    return () => clearInterval(t);
  }, [s?.running, load, onSynced]);

  if (!s || !form) return <Section title="Zoho Books sync" className="mt-6">{error ? <ErrorBox error={error} /> : <Loading />}</Section>;

  const set = (p: Partial<Settings>) => { setForm({ ...form, ...p }); setSaved(false); };
  const act = async (what: 'test' | 'sync' | 'save') => {
    setBusy(what);
    setError(null);
    try {
      if (what === 'test') setTest(await post<TestResult>('/accounting/zoho-books/test'));
      if (what === 'save') { setForm(await api<Settings>('/accounting/zoho-books/settings', { method: 'PUT', json: form })); setSaved(true); }
      if (what === 'sync') await post('/accounting/zoho-books/sync');
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy('');
    }
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(s.settings);
  const ready = s.configured && s.boundHere;

  return (
    <Section
      title={<span className="inline-flex items-center gap-2"><PlugZap className="h-4 w-4" />Zoho Books sync</span>}
      className="mt-6"
      actions={ready && (
        <div className="flex flex-wrap gap-2">
          {admin && <button className="btn-ghost" disabled={!!busy} onClick={() => act('test')}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>}
          <button className="btn-primary" disabled={!!busy || s.running || !s.settings.since || dirty} title={dirty ? 'Save the settings first' : !s.settings.since ? 'Pick the date to sync from first' : undefined} onClick={() => act('sync')}>
            <RefreshCw className={clsx('h-4 w-4', s.running && 'animate-spin')} />{s.running ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      )}
    >
      <div className="space-y-5">
        <ErrorBox error={error} />
        {!s.configured ? (
          <div className="rounded-lg border border-dashed border-line p-4 text-sm">
            <p className="font-medium">Not connected yet</p>
            <p className="mt-1 text-muted">Send sent and paid invoices, vendor bills and their payments straight into Zoho Books, without importing files. Your server administrator connects it once with a Zoho self-client (see <code className="font-mono text-xs">docs/ZOHO_BOOKS.md</code>). Still to set:</p>
            <div className="mt-2 flex flex-wrap gap-1.5">{s.missing.map((m) => <code key={m} className="chip bg-sunken font-mono text-xs text-ink">{m}</code>)}</div>
          </div>
        ) : s.otherTenant ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">This server&rsquo;s Zoho Books connection belongs to another Projexa organisation.</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              Connected to Zoho Books organisation <span className="font-mono text-ink">{s.zohoOrganizationId}</span> on <span className="font-mono text-ink">{s.apiHost}</span>.
              {' '}Each document is looked up by its number first, so nothing is created twice, and synced documents count as exported.
            </p>
            {test && (
              <ul className="space-y-1.5 rounded-lg border border-line p-3 text-sm">
                {test.checks.map((c) => (
                  <li key={c.label} className="flex items-start gap-2">
                    {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />}
                    <span><span className="font-medium">{c.label}:</span> {c.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <label className="block">
                <span className="label">Sync documents from</span>
                <input type="date" className="input" disabled={!admin} value={form.since ?? ''} onChange={(e) => set({ since: e.target.value || null })} />
                <span className="mt-1 block text-xs text-muted">Invoice or bill date. Older ones are left alone.</span>
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                {([['invoices', 'Client invoices', 'Sent and paid'], ['bills', 'Vendor bills', 'Approved and paid'], ['payments', 'Payments', 'Record payments for paid documents'], ['hourly', 'Every hour', 'Sync by itself once an hour']] as [keyof Settings, string, string][]).map(([k, label, hint]) => (
                  <div key={k} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                    <div className="min-w-0 text-sm"><div className="font-medium">{label}</div><div className="text-xs text-muted">{hint}</div></div>
                    <Toggle checked={!!form[k]} onChange={(v) => admin && set({ [k]: v })} label={label} />
                  </div>
                ))}
              </div>
            </div>
            {admin && (dirty || saved) && <div className="flex justify-end"><button className="btn-primary" disabled={!dirty || !!busy} onClick={() => act('save')}>{saved && !dirty ? 'Saved' : 'Save sync settings'}</button></div>}
            {!admin && <p className="text-xs text-muted">Only admins change these settings. Project managers can sync.</p>}
          </>
        )}

        {s.runs.length > 0 && (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[600px] text-sm">
              <thead><tr><th className="th">When</th><th className="th">Status</th><th className="th">What happened</th><th className="th">By</th></tr></thead>
              <tbody>
                {s.runs.map((r) => (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="td whitespace-nowrap text-xs">{new Date(r.startedAt).toLocaleString()}</td>
                    <td className="td"><span className={clsx('chip', STATUS[r.status][1])}>{STATUS[r.status][0]}</span></td>
                    <td className="td">
                      {r.status === 'running' ? <span className="text-muted">Working through documents…</span> : summary(r.counts)}
                      {r.errors.length > 0 && (
                        <div className="mt-1">
                          <button className="text-xs font-medium text-bad underline-offset-2 hover:underline" onClick={() => setOpen(open === r.id ? null : r.id)}>
                            {r.errors.length} {r.errors.length === 1 ? 'problem' : 'problems'}
                          </button>
                          {open === r.id && (
                            <ul className="mt-1 space-y-1 text-xs">
                              {r.errors.map((e, i) => <li key={i}>{e.number && <span className="font-mono">{e.number}: </span>}{e.message}</li>)}
                            </ul>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="td text-xs">{r.trigger === 'schedule' ? 'Hourly' : r.by ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}
