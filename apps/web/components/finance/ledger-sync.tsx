'use client';
import clsx from 'clsx';
import { CheckCircle2, ExternalLink, Link2, Link2Off, RefreshCw, XCircle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { ErrorBox, Loading, Section, Toggle } from '@/components/ui';
import { API_URL, api, get, post } from '@/lib/api';
import { Run, Settings, STATUS, summary } from './zoho-books-sync';

type Provider = 'xero' | 'quickbooks' | 'tally';
interface Conn {
  provider: Provider; label: string; configured: boolean; sandbox: boolean; otherTenant: boolean;
  status: 'connected' | 'expired' | 'disconnected'; connected: boolean; company: string | null; connectedBy: string | null; connectedAt: string | null; lastError: string | null; redirectUri: string | null;
  settings: Settings; linked: Record<string, number>; running: boolean; runs: Run[];
}
interface TestResult { ok: boolean; checks: { label: string; ok: boolean; detail: string }[] }

const ABOUT: Record<Provider, string> = {
  xero: 'Sales invoices, bills, payments and voids go straight into your Xero organisation. An admin signs in to Xero once and picks the organisation.',
  quickbooks: 'Invoices, bills, payments and voids go straight into your QuickBooks Online company. An admin signs in to Intuit once and picks the company.',
  tally: 'Sales, Purchase, Receipt and Payment vouchers are posted to Tally Prime’s XML server, in the reporting currency. The Tally computer must be reachable from the PROJEXA server, for example over a VPN.',
};

/** Direct sync to Xero, QuickBooks Online and Tally Prime: connect, settings, test, sync now and the run history. */
export function LedgerSync({ onSynced }: { onSynced?: () => void }) {
  const me = useMe();
  const admin = me?.user.role === 'ADMIN';
  const params = useSearchParams();
  const [list, setList] = useState<Conn[] | null>(null);
  const [tab, setTab] = useState<Provider>((params.get('ledger') as Provider) || 'xero');
  const [forms, setForms] = useState<Partial<Record<Provider, Settings>>>({});
  const [error, setError] = useState<unknown>(null);
  const [test, setTest] = useState<Partial<Record<Provider, TestResult>>>({});
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const flash = params.get('ledger_error') ? { bad: true, text: params.get('ledger_error')! } : params.get('connected') ? { bad: false, text: 'Connected.' } : null;

  const load = useCallback(() => get<Conn[]>('/accounting/ledgers').then((x) => { setList(x); setForms((f) => Object.fromEntries(x.map((c) => [c.provider, f[c.provider] ?? c.settings]))); return x; }), []);
  useEffect(() => { load().catch(setError); }, [load]);
  const running = list?.some((c) => c.running);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => load().then((x) => { if (!x.some((c) => c.running)) onSynced?.(); }).catch(setError), 3000);
    return () => clearInterval(t);
  }, [running, load, onSynced]);

  if (!list) return <Section title="Xero, QuickBooks and Tally sync" className="mt-6">{error ? <ErrorBox error={error} /> : <Loading />}</Section>;
  const c = list.find((x) => x.provider === tab)!;
  const form = forms[tab] ?? c.settings;
  const set = (p: Partial<Settings>) => { setForms({ ...forms, [tab]: { ...form, ...p } }); setSaved(false); };
  const act = async (what: 'test' | 'sync' | 'save' | 'disconnect') => {
    setBusy(what);
    setError(null);
    try {
      if (what === 'test') setTest({ ...test, [tab]: await post<TestResult>(`/accounting/ledgers/${tab}/test`) });
      if (what === 'save') { const r = await api<Settings>(`/accounting/ledgers/${tab}/settings`, { method: 'PUT', json: form }); setForms({ ...forms, [tab]: r }); setSaved(true); }
      if (what === 'sync') await post(`/accounting/ledgers/${tab}/sync`);
      if (what === 'disconnect') { if (!confirm(`Disconnect ${c.label}? Synced documents stay there. Connect again to carry on.`)) return; await api(`/accounting/ledgers/${tab}`, { method: 'DELETE' }); }
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy('');
    }
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(c.settings);
  const connectUrl = `${API_URL}/api/v1/accounting/ledgers/${tab}/connect`;
  const t = test[tab];

  return (
    <Section
      id="direct-sync"
      title={<span className="inline-flex items-center gap-2"><Link2 className="h-4 w-4" />Xero, QuickBooks and Tally sync</span>}
      className="mt-6"
      actions={c.connected && (
        <div className="flex flex-wrap gap-2">
          {admin && <button className="btn-ghost" disabled={!!busy} onClick={() => act('test')}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>}
          <button className="btn-primary" disabled={!!busy || c.running || !c.settings.since || dirty} title={dirty ? 'Save the settings first' : !c.settings.since ? 'Pick the date to sync from first' : undefined} onClick={() => act('sync')}>
            <RefreshCw className={clsx('h-4 w-4', c.running && 'animate-spin')} />{c.running ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      )}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Accounting system">
          {list.map((x) => (
            <button key={x.provider} role="tab" aria-selected={tab === x.provider} className={clsx('chip px-3 py-1.5 text-sm', tab === x.provider ? 'bg-brand text-brand-ink' : 'bg-sunken text-ink hover:bg-line')} onClick={() => { setTab(x.provider); setSaved(false); }}>
              {x.label}
              {x.connected && <span className={clsx('ml-1.5 inline-block h-2 w-2 rounded-full', tab === x.provider ? 'bg-brand-ink' : 'bg-ok')} aria-label="connected" />}
              {x.status === 'expired' && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-bad" aria-label="needs signing in again" />}
            </button>
          ))}
        </div>
        {flash && params.get('ledger') === tab && (
          <p className={clsx('rounded-lg px-3 py-2 text-sm', flash.bad ? 'bg-bad/10 text-bad' : 'bg-ok/10 text-ok')}>{flash.text}</p>
        )}
        <ErrorBox error={error} />
        <p className="text-sm text-muted">{ABOUT[tab]}</p>

        {!c.configured ? (
          <div className="rounded-lg border border-dashed border-line p-4 text-sm">
            <p className="font-medium">Not set up yet</p>
            <p className="mt-1 text-muted">
              An admin {tab === 'tally' ? 'enters the address of the Tally Prime XML server' : `adds the ${c.label} app's client ID and secret`} in <Link href={`/settings/integrations#${tab}`} className="text-brand hover:underline">Settings → Integrations</Link>, with step-by-step help.
            </p>
            {c.redirectUri && <p className="mt-2 text-xs text-muted">Redirect URI for the app: <code className="break-all font-mono text-ink">{c.redirectUri}</code></p>}
          </div>
        ) : c.otherTenant ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">This server&rsquo;s Tally Prime connection belongs to another PROJEXA organisation.</p>
        ) : !c.connected ? (
          <div className="rounded-lg border border-dashed border-line p-4 text-sm">
            {c.status === 'expired' ? (
              <>
                <p className="font-medium text-bad">The sign-in to {c.label} has expired</p>
                <p className="mt-1 text-muted">{c.lastError ?? 'Sign in again to carry on syncing.'} Nothing synced so far is lost.</p>
              </>
            ) : (
              <p className="font-medium">Not connected</p>
            )}
            {admin ? (
              <a className="btn-primary mt-3 inline-flex" href={connectUrl}><ExternalLink className="h-4 w-4" />{c.status === 'expired' ? 'Sign in again' : `Connect ${c.label}`}</a>
            ) : (
              <p className="mt-1 text-muted">An admin connects it.</p>
            )}
            {tab === 'quickbooks' && c.sandbox && <p className="mt-2 text-xs text-warn">This server uses the QuickBooks sandbox.</p>}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-muted">
                Connected to <span className="font-medium text-ink">{c.company ?? c.label}</span>
                {c.connectedBy && <> by {c.connectedBy}</>}
                {tab === 'quickbooks' && c.sandbox && <span className="chip ml-2 bg-warn/15 text-warn">Sandbox</span>}.
                {' '}Documents are looked up by number first, so nothing is created twice, and synced documents count as exported.
              </p>
              {admin && tab !== 'tally' && <button className="btn-ghost h-8 text-xs" disabled={!!busy || c.running} onClick={() => act('disconnect')}><Link2Off className="h-3.5 w-3.5" />Disconnect</button>}
            </div>
            {t && (
              <ul className="space-y-1.5 rounded-lg border border-line p-3 text-sm">
                {t.checks.map((x) => (
                  <li key={x.label} className="flex items-start gap-2">
                    {x.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" />}
                    <span><span className="font-medium">{x.label}:</span> {x.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {c.configured && !c.otherTenant && (
          <>
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
                    <Toggle checked={!!form[k]} onChange={(v) => admin && set({ [k]: v })} label={`${c.label}: ${label}`} />
                  </div>
                ))}
              </div>
            </div>
            {admin && (dirty || saved) && <div className="flex justify-end"><button className="btn-primary" disabled={!dirty || !!busy} onClick={() => act('save')}>{saved && !dirty ? 'Saved' : 'Save sync settings'}</button></div>}
            {!admin && <p className="text-xs text-muted">Only admins change these settings. Project managers can sync.</p>}
          </>
        )}

        {c.runs.length > 0 && (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[600px] text-sm">
              <thead><tr><th className="th">When</th><th className="th">Status</th><th className="th">What happened</th><th className="th">By</th></tr></thead>
              <tbody>
                {c.runs.map((r) => (
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
