'use client';
import clsx from 'clsx';
import { ArrowLeft, Check, Copy, Link2, Link2Off, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { Empty, ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { flag } from '@/lib/countries';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED';
interface Application {
  id: string; status: Status; companyName: string; website: string | null; contactName: string; email: string; phone: string | null;
  countries: string[]; panelSize: number | null; specialties: string[]; message: string | null; createdAt: string; reviewedAt: string | null;
  rejectReason: string | null; vendor: { id: string; name: string; code: string } | null; sameNetwork: number; similarVendor: { id: string; name: string } | null;
}
const TONE: Record<Status, string> = { PENDING: 'bg-warn/15 text-warn', APPROVED: 'bg-ok/15 text-ok', REJECTED: 'bg-sunken text-muted' };
const LABEL: Record<Status, string> = { PENDING: 'To review', APPROVED: 'Approved', REJECTED: 'Rejected' };
const suggestCode = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'VENDOR';

export default function VendorApplicationsPage() {
  const me = useMe();
  const editor = canEdit(me);
  const admin = me?.user.role === 'ADMIN';
  const [status, setStatus] = useState<Status>('PENDING');
  const [rows, setRows] = useState<Application[] | null>(null);
  const [link, setLink] = useState<{ enabled: boolean; url: string | null } | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setRows(null);
    get<Application[]>(`/vendor-applications?status=${status}`).then(setRows).catch(setError);
  }, [status]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    get<{ enabled: boolean; url: string | null }>('/vendor-applications/link').then(setLink).catch(setError);
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const approve = (a: Application) =>
    run(async () => {
      const r = await post<{ vendor: { id: string; name: string }; invite: { emailed: boolean; inviteUrl: string } | null }>(`/vendor-applications/${a.id}/approve`, { code: codes[a.id] ?? suggestCode(a.companyName) });
      setDone({ ...done, [a.id]: r.invite?.emailed ? `Approved. ${a.contactName} was emailed a link to set a password.` : `Approved. Email is not set up, so share this link with ${a.contactName}: ${r.invite?.inviteUrl}` });
      load();
    });
  const reject = (a: Application) =>
    run(async () => {
      await post(`/vendor-applications/${a.id}/reject`, { reason: reasons[a.id] || undefined });
      load();
    });

  return (
    <>
      <Link href="/vendors" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Vendors</Link>
      <PageHeader title="Vendor applications" subtitle="Panel companies that signed up through your link. Approving creates the vendor, the markets it covers and its portal login." />
      <ErrorBox error={error} />
      {Object.values(done).map((d) => <div key={d} className="mb-4 rounded-lg border border-ok/30 bg-ok/10 p-3 text-sm break-words">{d}</div>)}

      <Section title="Sign-up link" className="mb-6">
        {!link ? (
          <Loading />
        ) : link.enabled ? (
          <div className="space-y-3 text-sm">
            <p className="text-muted">Share this link with panel companies, for example on your website. Anyone with it can apply; nothing is created until you approve.</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 break-all rounded bg-sunken px-2 py-1 text-xs">{link.url}</code>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => navigator.clipboard?.writeText(link.url!).then(() => setCopied(true))}><Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}</button>
              {admin && <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => run(async () => setLink(await api('/vendor-applications/link', { method: 'PUT' })))}><Link2 className="h-3.5 w-3.5" /> New link</button>}
              {admin && <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => run(async () => setLink(await api('/vendor-applications/link', { method: 'DELETE' })))}><Link2Off className="h-3.5 w-3.5" /> Turn off</button>}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted">Sign-up is off. {admin ? 'Turn it on to get a link panel companies can apply through.' : 'An admin can turn it on.'}</p>
            {admin && <button className="btn-primary" disabled={busy} onClick={() => run(async () => setLink(await api('/vendor-applications/link', { method: 'PUT' })))}><Link2 className="h-4 w-4" /> Turn on sign-up</button>}
          </div>
        )}
      </Section>

      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)} className={clsx('rounded-full px-3 py-1.5 text-sm', status === s ? 'bg-brand text-white' : 'text-muted hover:bg-sunken')}>{LABEL[s]}</button>
        ))}
      </div>
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>{status === 'PENDING' ? 'No applications waiting.' : 'Nothing here yet.'}</Empty>
      ) : (
        <div className="space-y-4">
          {rows.map((a) => (
            <article key={a.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words text-lg font-semibold">{a.companyName}</h2>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
                    <span>{a.contactName}</span>
                    <a className="break-all text-brand hover:underline" href={`mailto:${a.email}`}>{a.email}</a>
                    {a.phone && <span>{a.phone}</span>}
                    {a.website && <a className="break-all text-brand hover:underline" href={a.website} target="_blank" rel="noopener noreferrer nofollow">{a.website.replace(/^https?:\/\//, '')}</a>}
                  </div>
                </div>
                <span className={clsx('chip', TONE[a.status])}>{LABEL[a.status]}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                {a.countries.map((c) => <span key={c} className="chip bg-sunken text-ink">{flag(c)} {c}</span>)}
                {a.specialties.map((s) => <span key={s} className="chip bg-info/10 text-info">{s.toLowerCase()}</span>)}
                {a.panelSize !== null && <span className="chip bg-sunken text-muted">{a.panelSize.toLocaleString()} panel members</span>}
              </div>
              {a.message && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{a.message}</p>}
              {(a.sameNetwork > 0 || a.similarVendor) && (
                <ul className="mt-3 space-y-1 text-xs text-warn">
                  {a.similarVendor && <li>Looks like an existing vendor: <Link className="underline" href={`/vendors/${a.similarVendor.id}`}>{a.similarVendor.name}</Link></li>}
                  {a.sameNetwork > 0 && <li>{a.sameNetwork} other application{a.sameNetwork === 1 ? '' : 's'} came from the same network</li>}
                </ul>
              )}
              <div className="mt-3 text-xs text-muted">
                Applied {new Date(a.createdAt).toLocaleString()}
                {a.reviewedAt && <> · reviewed {new Date(a.reviewedAt).toLocaleDateString()}</>}
                {a.vendor && <> · <Link className="text-brand hover:underline" href={`/vendors/${a.vendor.id}`}>{a.vendor.name} ({a.vendor.code})</Link></>}
                {a.rejectReason && <> · {a.rejectReason}</>}
              </div>
              {editor && a.status === 'PENDING' && (
                <div className="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-[1fr_1fr]">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-muted">Vendor code<input className="input mt-1 w-32 font-mono uppercase" maxLength={20} value={codes[a.id] ?? suggestCode(a.companyName)} onChange={(e) => setCodes({ ...codes, [a.id]: e.target.value })} /></label>
                    <button className="btn-primary" disabled={busy} onClick={() => approve(a)}><Check className="h-4 w-4" /> Approve and invite</button>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-0 flex-1 text-xs text-muted">Reason (kept internal)<input className="input mt-1" maxLength={500} value={reasons[a.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })} /></label>
                    <button className="btn-ghost" disabled={busy} onClick={() => reject(a)}><X className="h-4 w-4" /> Reject</button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
