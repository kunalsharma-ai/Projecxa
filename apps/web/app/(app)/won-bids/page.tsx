'use client';
import { Copyable } from '@/components/copy';
import clsx from 'clsx';
import { ChevronDown, ExternalLink, PlusCircle, RotateCcw, Trophy, XCircle } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { Empty, ErrorBox, Loading, PageHeader, Section, StatusChip } from '@/components/ui';
import { get, post } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import type { WonBid } from '@/lib/types';

const TABS = [
  { id: 'NEW', label: 'Waiting for setup' },
  { id: 'PROJECT_CREATED', label: 'Project created' },
  { id: 'DISMISSED', label: 'Dismissed' },
] as const;

const money = (v: string | number | null, cur: string) =>
  v == null ? '–' : `${cur} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function WonBidsPage() {
  const me = useMe();
  const editable = canEdit(me);
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('NEW');
  const [data, setData] = useState<{ counts: Record<string, number>; items: WonBid[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const req = useRef(0);

  const load = useCallback(() => {
    const n = ++req.current;
    get<{ counts: Record<string, number>; items: WonBid[] }>(`/won-bids?status=${tab}`)
      .then((r) => n === req.current && setData(r))
      .catch(setError);
  }, [tab]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);

  async function act(id: string, action: 'dismiss' | 'restore') {
    let reason: string | undefined;
    if (action === 'dismiss') {
      const r = window.prompt('Why is this bid not becoming a project? (optional)');
      if (r === null) return;
      reason = r || undefined;
    }
    setBusy(id);
    setError(null);
    try {
      await post(`/won-bids/${id}/${action}`, action === 'dismiss' ? { reason } : {});
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const actions = (b: WonBid) => (
    <>
      {b.status === 'NEW' && editable && (
        <div className="flex justify-end gap-1.5">
          <Link href={`/projects/new?wonBid=${b.id}`} className="btn-primary px-3 py-1.5 text-xs"><PlusCircle className="h-3.5 w-3.5" /> Set up project</Link>
          <button onClick={() => act(b.id, 'dismiss')} disabled={busy === b.id} className="btn-ghost px-2 py-1.5 text-xs" aria-label={`Dismiss ${b.bidNumber}`} title="Dismiss"><XCircle className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {b.status === 'PROJECT_CREATED' && b.project && (
        <Link href={`/projects/${b.project.id}`} className="inline-flex items-center gap-2 text-sm text-brand hover:underline">
          {b.project.projectCode} <StatusChip status={b.project.status} /> <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      )}
      {b.status === 'DISMISSED' && editable && (
        <button onClick={() => act(b.id, 'restore')} disabled={busy === b.id} className="btn-ghost px-3 py-1.5 text-xs"><RotateCcw className="h-3.5 w-3.5" /> Restore</button>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title="Won bids"
        subtitle="Bids won in Bidzo arrive here automatically. Set up each one as a project; markets, sample sizes, LOI, IR and CPI are filled in for you."
      />
      <div className="mb-4"><ErrorBox error={error} /></div>
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={clsx('-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm', tab === t.id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink')}>
            {t.label}
            {data?.counts[t.id] ? <span className={clsx('chip', tab === t.id ? 'bg-brand/15 text-brand' : 'bg-sunken text-muted')}>{data.counts[t.id]}</span> : null}
          </button>
        ))}
      </div>

      <Section title={<span className="flex items-center gap-2"><Trophy className="h-4 w-4 text-brand" /> {TABS.find((t) => t.id === tab)!.label}</span>}>
        {!data ? <Loading /> : data.items.length === 0 ? (
          <Empty>
            {tab === 'NEW' ? (
              <>No won bids are waiting. When a bid is marked won in Bidzo it appears here within seconds.{me?.user.role === 'ADMIN' && <> Connect Bidzo in <Link href="/settings" className="text-brand hover:underline">Settings</Link>.</>}</>
            ) : 'Nothing here yet.'}
          </Empty>
        ) : (
          <>
          <ul className="-m-5 divide-y divide-line md:hidden">
            {data.items.map((b) => (
              <li key={b.id} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{b.projectName}</div>
                    <div className="truncate text-xs text-muted">{b.clientName} · <span className="font-mono">{b.bidNumber}</span></div>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums">{money(b.totalAmount, b.currency)}</span>
                </div>
                <div className="text-xs text-muted">
                  {b.countries.map((c) => `${flag(c.countryCode)} ${c.sampleSize.toLocaleString()} n · ${c.loiMinutes}m · ${c.incidencePct}%`).join('   ')}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted">Won {new Date(b.wonAt).toLocaleDateString()}</span>
                  <div>{actions(b)}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="-m-5 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px]">
              <thead className="border-b border-line bg-sunken/60">
                <tr>
                  <th className="th w-8" aria-label="Details" />
                  <th className="th">Bid</th><th className="th">Project</th><th className="th">Client</th><th className="th">Markets</th>
                  <th className="th text-right">Sample</th><th className="th text-right">Bid value</th><th className="th">Won</th><th className="th text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((b) => {
                  const sample = b.countries.reduce((a, c) => a + c.sampleSize, 0);
                  const expanded = open === b.id;
                  return (
                    <Fragment key={b.id}>
                      <tr className={clsx(expanded && 'bg-sunken/40')}>
                        <td className="td">
                          <button onClick={() => setOpen(expanded ? null : b.id)} aria-expanded={expanded} aria-label={`Show markets for ${b.bidNumber}`} className="rounded p-1 text-muted hover:text-ink">
                            <ChevronDown className={clsx('h-4 w-4 transition-transform duration-[var(--dur)]', expanded && 'rotate-180')} />
                          </button>
                        </td>
                        <td className="td">
                          <div className="font-mono text-xs"><Copyable text={b.bidNumber} label="bid number" /></div>
                          {b.bidVersion && <div className="text-xs text-muted">version {b.bidVersion}</div>}
                        </td>
                        <td className="td max-w-[260px]">
                          <div className="truncate font-medium">{b.projectName}</div>
                          <div className="truncate text-xs text-muted">{[b.projectCategory, b.projectType, b.bidderName && `bid by ${b.bidderName}`].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="td max-w-[180px]">
                          <div className="truncate">{b.clientName}</div>
                          {b.contactName && <div className="truncate text-xs text-muted">{b.contactName}</div>}
                        </td>
                        <td className="td"><span title={b.countries.map((c) => countryName(c.countryCode)).join(', ')}>{b.countries.slice(0, 6).map((c) => flag(c.countryCode)).join(' ')}{b.countries.length > 6 ? ` +${b.countries.length - 6}` : ''}</span></td>
                        <td className="td text-right tabular-nums">{sample.toLocaleString()}</td>
                        <td className="td text-right tabular-nums">{money(b.totalAmount, b.currency)}</td>
                        <td className="td text-xs text-muted">{new Date(b.wonAt).toLocaleDateString()}</td>
                        <td className="td text-right">
                          {actions(b)}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-sunken/40">
                          <td />
                          <td colSpan={8} className="px-3 pb-4">
                            {b.description && <p className="mb-3 max-w-3xl whitespace-pre-line text-sm text-muted">{b.description}</p>}
                            {b.dismissReason && <p className="mb-3 text-sm"><span className="text-muted">Dismissed:</span> {b.dismissReason}</p>}
                            <table className="w-full max-w-3xl overflow-hidden rounded-lg border border-line bg-panel">
                              <thead className="bg-sunken/60"><tr><th className="th">Market</th><th className="th text-right">Sample</th><th className="th text-right">LOI</th><th className="th text-right">IR</th><th className="th text-right">CPI</th></tr></thead>
                              <tbody className="divide-y divide-line">
                                {b.countries.map((c) => (
                                  <tr key={c.countryCode}>
                                    <td className="td">{flag(c.countryCode)} {countryName(c.countryCode)}</td>
                                    <td className="td text-right tabular-nums">{c.sampleSize.toLocaleString()}</td>
                                    <td className="td text-right tabular-nums">{c.loiMinutes} min</td>
                                    <td className="td text-right tabular-nums">{c.incidencePct}%</td>
                                    <td className="td text-right tabular-nums">{c.cpi == null ? '–' : money(c.cpi, b.currency)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <p className="mt-2 text-xs text-muted">Received {new Date(b.receivedAt).toLocaleString()}{b.deliveries > 1 ? ` · updated by Bidzo ${b.deliveries - 1} time${b.deliveries === 2 ? '' : 's'}` : ''}</p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Section>
    </>
  );
}
