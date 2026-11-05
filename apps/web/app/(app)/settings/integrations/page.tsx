'use client';
import clsx from 'clsx';
import { Bot, BookOpenCheck, CreditCard, Check, ChevronDown, Copy, ExternalLink, KeyRound, Link2, Loader2, Mail, PlugZap, Server, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMe } from '@/components/me';
import { ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { api, get, post } from '@/lib/api';

type FieldType = 'text' | 'secret' | 'select' | 'url' | 'email';
interface FieldDef { key: string; label: string; type: FieldType; required?: boolean; options?: { value: string; label: string }[]; placeholder?: string; hint?: string; default?: string; transient?: boolean }
interface Status { state: 'connected' | 'env' | 'off' | 'other'; source: 'app' | 'env' | null; detail: string | null; updatedAt: string | null; updatedBy: string | null; lastTestAt: string | null; lastTestOk: boolean | null; lastTestMessage: string | null }
interface Integration {
  kind: string; group: string; label: string; summary: string; scope: 'org' | 'platform'; ownerOnly?: boolean;
  fields: FieldDef[]; steps: string[]; links: { label: string; href: string }[]; testable: boolean; next?: { label: string; href: string };
  redirectUri: string | null; editable: boolean; managedByServerOwner: boolean; status: Status; values: Record<string, string>; secretsSet: Record<string, boolean>;
}
interface Data { owner: boolean; integrations: Integration[]; bootstrap: { name: string; why: string; set: boolean }[]; encryptionKeySet: boolean }

const GROUPS: { id: string; title: string; icon: typeof Mail; blurb: string }[] = [
  { id: 'Email', title: 'Email', icon: Mail, blurb: 'Reports, invitations, password resets and portal notifications.' },
  { id: 'Sign-in', title: 'Single sign-on apps', icon: KeyRound, blurb: 'The Google, Microsoft and Zoho apps staff sign in through.' },
  { id: 'AI', title: 'AI', icon: Bot, blurb: 'The copilot chat and voice assistant.' },
  { id: 'Accounting', title: 'Accounting', icon: BookOpenCheck, blurb: 'Direct sync of invoices, bills and payments.' },
  { id: 'Payments', title: 'Payments', icon: CreditCard, blurb: 'Online payment gateways organisations pay their plan through (Super Admin → Billing).' },
  { id: 'Bidzo', title: 'Bidzo', icon: Link2, blurb: 'Bids live in Bidzo; PROJEXA links there.' },
];

const when = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function StateChip({ i }: { i: Integration }) {
  const s = i.status;
  if (s.state === 'connected' && s.lastTestOk === false) return <span className="chip bg-warn/15 text-warn">Check settings</span>;
  if (s.state === 'connected') return <span className="chip bg-ok/15 text-ok">{s.lastTestOk ? 'Connected' : 'Saved'}</span>;
  if (s.state === 'env') return <span className="chip bg-info/15 text-info">Server settings</span>;
  if (s.state === 'other') return <span className="chip bg-sunken text-muted">Other organisation</span>;
  return <span className="chip bg-sunken text-muted">Not set up</span>;
}

export default function IntegrationsPage() {
  const me = useMe();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    get<Data>('/integrations/settings').then(setData).catch(setError);
    const h = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    if (h) setOpen(h);
  }, []);
  useEffect(() => {
    if (data && open) document.getElementById(open)?.scrollIntoView({ block: 'start' });
    // Only when the page first loads with a #kind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data]);

  const counts = useMemo(() => {
    const list = data?.integrations ?? [];
    return { ready: list.filter((i) => i.status.state === 'connected' || i.status.state === 'env').length, total: list.length };
  }, [data]);

  if (me && me.user.role !== 'ADMIN') return <><PageHeader title="Integrations" /><p className="text-sm text-muted">Only admins can set up integrations.</p></>;
  if (!data) return error ? <ErrorBox error={error} /> : <Loading />;
  const replace = (i: Integration) => setData({ ...data, integrations: data.integrations.map((x) => (x.kind === i.kind ? i : x)) });

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Connect email, sign-in, AI, accounting and Bidzo here. Nothing needs to change on the server."
        actions={<span className="chip bg-sunken text-muted"><PlugZap className="mr-1 h-3.5 w-3.5" />{counts.ready} of {counts.total} ready</span>}
      />
      <div className="space-y-6">
        {GROUPS.map((g) => {
          const items = data.integrations.filter((i) => i.group === g.id);
          if (!items.length) return null;
          const Icon = g.icon;
          return (
            <section key={g.id}>
              <div className="mb-2 flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted" />
                <h2 className="text-sm font-semibold">{g.title}</h2>
                <span className="hidden text-xs text-muted sm:inline">{g.blurb}</span>
              </div>
              <div className="space-y-3">
                {items.map((i) => <Card key={i.kind} i={i} open={open === i.kind} onToggle={() => setOpen(open === i.kind ? null : i.kind)} onChange={replace} />)}
              </div>
            </section>
          );
        })}

        <Section title={<span className="flex items-center gap-2"><Server className="h-4 w-4 text-muted" /> Server basics</span>}>
          <p className="mb-3 text-sm text-muted">Only these stay on the server, set once by whoever installs PROJEXA (see docs/INTEGRATIONS.md). Everything else is on this page.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.bootstrap.map((b) => (
              <li key={b.name} className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm">
                {b.set ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warn" />}
                <span className="min-w-0"><code className="font-mono text-xs">{b.name}</code><span className="block text-xs text-muted">{b.why}{!b.set && ' Not set: using a development default.'}</span></span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}

function Card({ i, open, onToggle, onChange }: { i: Integration; open: boolean; onToggle: () => void; onChange: (i: Integration) => void }) {
  const initial = () => Object.fromEntries(i.fields.map((f) => [f.key, f.type === 'secret' ? '' : i.values[f.key] ?? f.default ?? '']));
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { setDraft(initial()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [i.status.updatedAt, i.status.source]);

  const s = i.status;
  const lastTest = s.lastTestAt ? { ok: !!s.lastTestOk, message: s.lastTestMessage ?? '' } : null;
  const shown = result ?? lastTest;

  async function save() {
    setBusy('save'); setError(null); setResult(null); setNotice(null);
    try {
      const values = Object.fromEntries(i.fields.map((f) => [f.key, draft[f.key] ?? '']));
      const r = await api<Integration & { notice: string | null }>(`/integrations/settings/${i.kind}`, { method: 'PUT', json: { values } });
      onChange(r);
      setNotice(r.notice ?? 'Saved.');
      if (i.testable && !r.notice) await test(r);
    } catch (e) { setError(e); } finally { setBusy(null); }
  }
  async function test(_after?: Integration) {
    setBusy('test'); setError(null);
    try {
      const r = await post<{ ok: boolean; message: string; integration: Integration }>(`/integrations/settings/${i.kind}/test`);
      setResult({ ok: r.ok, message: r.message });
      onChange(r.integration);
    } catch (e) { setError(e); } finally { setBusy(null); }
  }
  async function remove() {
    if (!confirm(`Remove the saved ${i.label} settings? ${i.kind === 'smtp' ? 'Emails stop' : 'It stops working'} unless the server has its own settings.`)) return;
    setBusy('remove'); setError(null); setResult(null); setNotice(null);
    try { onChange(await api<Integration>(`/integrations/settings/${i.kind}`, { method: 'DELETE' })); } catch (e) { setError(e); } finally { setBusy(null); }
  }
  const copy = async (v: string) => { await navigator.clipboard?.writeText(v).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const missingRequired = i.fields.some((f) => f.required && !(draft[f.key]?.trim() || (f.type === 'secret' && i.secretsSet[f.key] && s.source === 'app')));

  return (
    <div id={i.kind} className="card scroll-mt-20 overflow-hidden" data-integration={i.kind}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-sunken/50 sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{i.label}</span><StateChip i={i} /></div>
          <p className="mt-0.5 text-xs text-muted">{i.summary}</p>
        </div>
        <ChevronDown className={clsx('mt-1 h-4 w-4 shrink-0 text-muted transition-transform sm:mt-0', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="grid gap-5 border-t border-line p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            {i.managedByServerOwner && (
              <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-muted">
                {i.scope === 'platform' ? 'One app serves every organisation on this PROJEXA server, so it is set up by the organisation that runs the server.' : 'This reaches a private office network, so only the organisation that runs this PROJEXA server can set it.'}
                {s.state === 'connected' || s.state === 'env' ? ' It is ready to use.' : ' Ask them to add it.'}
              </p>
            )}
            {s.state === 'env' && i.editable && <p className="rounded-lg bg-info/10 px-3 py-2 text-xs text-info">Working from the server&apos;s settings. Save here to manage it in the app instead{i.fields.some((f) => f.type === 'secret') ? ' (enter the secret again)' : ''}.</p>}
            {s.detail && <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">{s.detail}</p>}
            {i.editable && (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
                {i.fields.map((f) => (
                  <label key={f.key} className="block">
                    <span className="label">{f.label}{f.required && <span className="text-bad"> *</span>}</span>
                    {f.type === 'select' ? (
                      <select className="input" value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                        {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input
                        className={clsx('input', (f.type === 'secret' || f.key.endsWith('_ID')) && 'font-mono text-xs')}
                        type={f.type === 'secret' ? 'password' : f.type === 'email' ? 'email' : f.type === 'url' ? 'url' : 'text'}
                        autoComplete={f.type === 'secret' ? 'new-password' : 'off'}
                        spellCheck={false}
                        placeholder={f.type === 'secret' && i.secretsSet[f.key] ? (s.source === 'app' ? 'Saved. Leave empty to keep it' : 'Set on the server. Enter it to save here') : f.placeholder}
                        value={draft[f.key] ?? ''}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      />
                    )}
                    {f.hint && <span className="mt-1 block text-xs text-muted">{f.hint}</span>}
                  </label>
                ))}
                <ErrorBox error={error} />
                {notice && <p className="text-sm text-ok">{notice}</p>}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button type="submit" className="btn-primary" disabled={!!busy || missingRequired}>{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{i.testable ? 'Save and test' : 'Save'}</button>
                  {i.testable && (s.state === 'connected' || s.state === 'env') && <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => test()}>{busy === 'test' && <Loader2 className="h-4 w-4 animate-spin" />}Test connection</button>}
                  {s.source === 'app' && <button type="button" className="btn-ghost text-bad" disabled={!!busy} onClick={remove}><Trash2 className="h-4 w-4" /> Remove</button>}
                </div>
              </form>
            )}
            {shown && (
              <p className={clsx('rounded-lg px-3 py-2 text-sm', shown.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad')} role="status">
                {shown.ok ? <Check className="mr-1 inline h-4 w-4" /> : null}{shown.message}
                {!result && s.lastTestAt && <span className="ml-1 text-xs opacity-75">({when(s.lastTestAt)})</span>}
              </p>
            )}
            {s.updatedAt && <p className="text-xs text-muted">Last saved {when(s.updatedAt)}{s.updatedBy ? ` by ${s.updatedBy}` : ''}.</p>}
            {i.next && (s.state === 'connected' || s.state === 'env') && <Link href={i.next.href} className="inline-flex items-center gap-1 text-sm text-brand hover:underline">Next: {i.next.label} →</Link>}
          </div>

          <div className="min-w-0 rounded-lg bg-sunken/60 p-4">
            <h3 className="mb-2 text-sm font-semibold">How to set it up</h3>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              {i.steps.map((st, n) => <li key={n} className="break-words">{st}</li>)}
            </ol>
            {i.redirectUri && (
              <div className="mt-3">
                <span className="label">Redirect URI to register</span>
                <button type="button" onClick={() => copy(i.redirectUri!)} className="flex w-full items-center gap-2 rounded border border-line bg-panel px-2 py-1.5 text-left font-mono text-[11px]" title="Copy">
                  <span className="min-w-0 flex-1 truncate">{i.redirectUri}</span>
                  {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5 text-muted" />}
                </button>
              </div>
            )}
            {i.links.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {i.links.map((l) => <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-brand hover:underline">{l.label}<ExternalLink className="h-3 w-3" /></a>)}
              </div>
            )}
            <p className="mt-3 text-xs text-muted">Secrets are encrypted before they are stored and are never shown again.</p>
          </div>
        </div>
      )}
    </div>
  );
}
