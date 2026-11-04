'use client';
import clsx from 'clsx';
import { Ban, Download, KeyRound, Link2, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Empty, ErrorBox, Field, Loading, OutcomeChip, Section, Toggle } from '@/components/ui';
import { get, post } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import { downloadFile } from '@/lib/download';
import { CopyButton } from './vendors-tab';
import type { ProjectDetail } from './types';

interface AllocationSummary {
  id: string;
  status: string;
  uniqueLinksOnly: boolean;
  vendor: { id: string; name: string; code: string };
  projectCountry: { id: string; countryCode: string };
  total: number;
  unused: number;
  used: number;
  revoked: number;
  expired: number;
  completes: number;
  inSurvey: number;
}
interface Batch {
  id: string;
  label: string | null;
  allocationId: string;
  vendor: string;
  countryCode: string;
  count: number;
  unused: number;
  used: number;
  revoked: number;
  expired: number;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string | null;
}
interface Summary { linkBase: string; maxPerBatch: number; allocations: AllocationSummary[]; batches: Batch[] }
interface LinkRow {
  id: string;
  key: string;
  url: string;
  shownStatus: 'UNUSED' | 'USED' | 'REVOKED' | 'EXPIRED';
  usedAt: string | null;
  blockedAttempts: number;
  batch: { id: string; label: string | null };
  vendorAllocation: { vendor: { name: string }; projectCountry: { countryCode: string } };
  session: { status: string; statusDetail: string | null } | null;
}

const LINK_TONE: Record<LinkRow['shownStatus'], string> = {
  UNUSED: 'bg-ok/15 text-ok',
  USED: 'bg-info/15 text-info',
  REVOKED: 'bg-sunken text-muted',
  EXPIRED: 'bg-warn/15 text-warn',
};
const LINK_LABEL: Record<LinkRow['shownStatus'], string> = { UNUSED: 'Unused', USED: 'Used', REVOKED: 'Revoked', EXPIRED: 'Expired' };
const PAGE = 100;
const when = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

export function UniqueLinksTab({ project, editable }: { project: ProjectDetail; editable: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [links, setLinks] = useState<{ total: number; rows: LinkRow[] } | null>(null);
  const [filter, setFilter] = useState({ allocationId: '', batchId: '', status: '', q: '' });
  const [page, setPage] = useState(0);
  const [form, setForm] = useState({ allocationId: '', count: '100', label: '', expiresAt: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const query = useCallback(
    (extra: Record<string, string> = {}) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries({ ...filter, ...extra })) if (v) q.set(k, v);
      return q.toString();
    },
    [filter],
  );

  const loadSummary = useCallback(() => get<Summary>(`/projects/${project.id}/unique-links/summary`).then(setSummary).catch(setError), [project.id]);
  const loadLinks = useCallback(
    () => get<{ total: number; rows: LinkRow[] }>(`/projects/${project.id}/unique-links?${query({ skip: String(page * PAGE), take: String(PAGE) })}`).then(setLinks).catch(setError),
    [project.id, query, page],
  );
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadLinks(); }, [loadLinks]);
  const reload = () => { loadSummary(); loadLinks(); };

  async function generate() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const r = await post<{ created: number; batch: Batch }>(`/projects/${project.id}/unique-links`, {
        allocationId: form.allocationId,
        count: Number(form.count),
        ...(form.label.trim() ? { label: form.label.trim() } : {}),
        ...(form.expiresAt ? { expiresAt: new Date(form.expiresAt).toISOString() } : {}),
      });
      setNotice(`${r.created.toLocaleString()} unique links created. Download them below and give one link to each respondent.`);
      setForm({ ...form, label: '', expiresAt: '' });
      setFilter({ allocationId: '', batchId: r.batch.id, status: '', q: '' });
      setPage(0);
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(body: { batchId?: string; linkIds?: string[] }, what: string) {
    if (!window.confirm(`Revoke ${what}? Respondents who have not opened them yet will be turned away. Links already used are kept as they are.`)) return;
    try {
      const r = await post<{ revoked: number }>(`/projects/${project.id}/unique-links/revoke`, body);
      setNotice(`${r.revoked.toLocaleString()} unused link${r.revoked === 1 ? '' : 's'} revoked.`);
      reload();
    } catch (e) {
      setError(e);
    }
  }

  async function setOnly(a: AllocationSummary, on: boolean) {
    try {
      await post(`/projects/${project.id}/unique-links/allocations/${a.id}/only`, { uniqueLinksOnly: on });
      loadSummary();
    } catch (e) {
      setError(e);
    }
  }

  const download = (extra: Record<string, string>) => downloadFile(`/projects/${project.id}/unique-links/export.csv?${new URLSearchParams(Object.entries(extra).filter(([, v]) => v)).toString()}`, `${project.projectCode}-unique-links.csv`).catch(setError);

  if (!summary) return error ? <ErrorBox error={error} /> : <Loading />;
  const allocations = summary.allocations;
  const count = Number(form.count);
  const canGenerate = !!form.allocationId && Number.isInteger(count) && count >= 1 && count <= summary.maxPerBatch && !busy;

  return (
    <div className="space-y-6">
      <ErrorBox error={error} />
      {notice && <p role="status" className="rounded-lg bg-ok/10 px-4 py-2.5 text-sm text-ok">{notice}</p>}
      <p className="text-sm text-muted">
        Unique links give every respondent their own entry link with its own random key. A link works <strong className="text-ink">once</strong>: the first person to open it enters the survey,
        and anyone who opens it again, in another tab or on another device, is sent to the Duplicate page. Links opened while the project or vendor is paused are not used up.
      </p>

      {editable && (
        <Section title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand" /> Generate unique links</span>}>
          {allocations.length === 0 ? (
            <Empty>Add a vendor on the Vendors &amp; links tab first. Unique links belong to a vendor in a market, so completes, payouts and callbacks are counted correctly.</Empty>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Vendor and market">
                <select className="input" value={form.allocationId} onChange={(e) => setForm({ ...form, allocationId: e.target.value })}>
                  <option value="">Choose…</option>
                  {allocations.map((a) => <option key={a.id} value={a.id}>{flag(a.projectCountry.countryCode)} {a.projectCountry.countryCode} · {a.vendor.name}</option>)}
                </select>
              </Field>
              <Field label="How many links" hint={`Up to ${summary.maxPerBatch.toLocaleString()} at a time`}>
                <input className="input" type="number" min={1} max={summary.maxPerBatch} value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
              </Field>
              <Field label="Batch name (optional)">
                <input className="input" maxLength={120} placeholder="e.g. Wave 1 email list" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </Field>
              <Field label="Stop working after (optional)">
                <input className="input" type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <button className="btn-primary w-full" disabled={!canGenerate} onClick={generate}>
                  <Link2 className="h-4 w-4" /> {busy ? 'Generating…' : `Generate ${Number.isFinite(count) && count > 0 ? count.toLocaleString() : ''} links`}
                </button>
              </div>
            </div>
          )}
        </Section>
      )}

      <Section title="By vendor and market">
        {allocations.length === 0 ? (
          <Empty>No vendors on this project yet.</Empty>
        ) : (
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="border-y border-line bg-sunken/60">
                <tr>
                  <th className="th">Market</th><th className="th">Vendor</th><th className="th text-right">Links</th><th className="th text-right">Unused</th><th className="th text-right">Used</th>
                  <th className="th text-right">Completes</th><th className="th text-right">Revoked / expired</th><th className="th">Unique links only</th><th className="th" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {allocations.map((a) => (
                  <tr key={a.id}>
                    <td className="td whitespace-nowrap">{flag(a.projectCountry.countryCode)} {countryName(a.projectCountry.countryCode)}</td>
                    <td className="td font-medium">{a.vendor.name}</td>
                    <td className="td text-right tabular-nums">{a.total.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{a.unused.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{a.used.toLocaleString()}{a.inSurvey > 0 && <span className="ml-1 text-xs text-muted">({a.inSurvey} in survey)</span>}</td>
                    <td className="td text-right tabular-nums">{a.completes.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{(a.revoked + a.expired).toLocaleString()}</td>
                    <td className="td">
                      <div className="flex items-center gap-2" title="When on, the shared live vendor link stops working and respondents can only enter with a unique link. The test link keeps working.">
                        <Toggle checked={a.uniqueLinksOnly} label={`Unique links only for ${a.vendor.name} in ${a.projectCountry.countryCode}`} onChange={(v) => (editable ? setOnly(a, v) : undefined)} />
                        <span className="text-xs text-muted">{a.uniqueLinksOnly ? 'Shared link closed' : 'Shared link open'}</span>
                      </div>
                    </td>
                    <td className="td text-right">
                      {a.total > 0 && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => download({ allocationId: a.id, status: 'UNUSED' })}><Download className="h-3.5 w-3.5" /> Unused CSV</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {summary.batches.length > 0 && (
        <Section title="Batches">
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead className="border-y border-line bg-sunken/60">
                <tr><th className="th">Batch</th><th className="th">Vendor and market</th><th className="th text-right">Links</th><th className="th text-right">Unused</th><th className="th text-right">Used</th><th className="th">Expires</th><th className="th">Created</th><th className="th" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {summary.batches.map((b) => (
                  <tr key={b.id} className={clsx(filter.batchId === b.id && 'bg-brand/5')}>
                    <td className="td font-medium">
                      <button className="text-left hover:underline" onClick={() => { setFilter({ allocationId: '', batchId: b.id, status: '', q: '' }); setPage(0); }}>{b.label || 'Untitled batch'}</button>
                    </td>
                    <td className="td whitespace-nowrap">{flag(b.countryCode)} {b.countryCode} · {b.vendor}</td>
                    <td className="td text-right tabular-nums">{b.count.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{b.unused.toLocaleString()}</td>
                    <td className="td text-right tabular-nums">{b.used.toLocaleString()}</td>
                    <td className="td whitespace-nowrap text-xs">{b.expiresAt ? <span className={clsx(b.expired > 0 && 'text-warn')}>{when(b.expiresAt)}</span> : <span className="text-muted">Never</span>}</td>
                    <td className="td whitespace-nowrap text-xs text-muted">{when(b.createdAt)}{b.createdBy ? ` · ${b.createdBy}` : ''}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1.5">
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => download({ batchId: b.id })}><Download className="h-3.5 w-3.5" /> CSV</button>
                        {editable && b.unused > 0 && <button className="btn-ghost px-2 py-1 text-xs text-bad" onClick={() => revoke({ batchId: b.id }, `the ${b.unused.toLocaleString()} unused links in “${b.label || 'Untitled batch'}”`)}><Ban className="h-3.5 w-3.5" /> Revoke unused</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section
        title="Links"
        actions={
          <button className="btn-ghost px-2.5 py-1.5 text-xs" disabled={!links?.total} onClick={() => download(filter)}>
            <Download className="h-3.5 w-3.5" /> Download {links?.total ? links.total.toLocaleString() : ''} as CSV
          </button>
        }
      >
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Vendor and market">
            <select className="input" value={filter.allocationId} onChange={(e) => { setFilter({ ...filter, allocationId: e.target.value, batchId: '' }); setPage(0); }}>
              <option value="">All</option>
              {allocations.map((a) => <option key={a.id} value={a.id}>{a.projectCountry.countryCode} · {a.vendor.name}</option>)}
            </select>
          </Field>
          <Field label="Batch">
            <select className="input" value={filter.batchId} onChange={(e) => { setFilter({ ...filter, batchId: e.target.value }); setPage(0); }}>
              <option value="">All</option>
              {summary.batches.map((b) => <option key={b.id} value={b.id}>{b.label || 'Untitled batch'} ({b.countryCode} · {b.vendor})</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={filter.status} onChange={(e) => { setFilter({ ...filter, status: e.target.value }); setPage(0); }}>
              <option value="">All</option>
              <option value="UNUSED">Unused</option>
              <option value="USED">Used</option>
              <option value="EXPIRED">Expired</option>
              <option value="REVOKED">Revoked</option>
            </select>
          </Field>
          <Field label="Find a key">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className="input pl-8" placeholder="Paste a key or link" value={filter.q} onChange={(e) => { setFilter({ ...filter, q: e.target.value.trim() }); setPage(0); }} />
            </div>
          </Field>
        </div>
        {!links ? (
          <Loading />
        ) : links.rows.length === 0 ? (
          <Empty>{summary.batches.length ? 'No links match these filters.' : 'No unique links yet. Generate a batch above.'}</Empty>
        ) : (
          <>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead className="border-y border-line bg-sunken/60">
                  <tr><th className="th">Key</th><th className="th">Vendor and market</th><th className="th">Link</th><th className="th">Respondent</th><th className="th">Used at</th><th className="th text-right">Re-use blocked</th><th className="th" /></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {links.rows.map((l) => (
                    <tr key={l.id}>
                      <td className="td font-mono text-xs">{l.key}</td>
                      <td className="td whitespace-nowrap text-sm">{l.vendorAllocation.projectCountry.countryCode} · {l.vendorAllocation.vendor.name}</td>
                      <td className="td"><span className={clsx('chip', LINK_TONE[l.shownStatus])}>{LINK_LABEL[l.shownStatus]}</span></td>
                      <td className="td">{l.session ? <OutcomeChip status={l.session.status} /> : <span className="text-xs text-muted">{l.shownStatus === 'USED' ? 'Turned away at entry' : '–'}</span>}</td>
                      <td className="td whitespace-nowrap text-xs text-muted">{when(l.usedAt)}</td>
                      <td className="td text-right tabular-nums">{l.blockedAttempts || ''}</td>
                      <td className="td">
                        <div className="flex justify-end gap-1.5">
                          <CopyButton text={l.url} label="Copy" />
                          {editable && l.shownStatus === 'UNUSED' && <button className="btn-ghost px-2 py-1 text-xs text-bad" onClick={() => revoke({ linkIds: [l.id] }, 'this link')}><Ban className="h-3.5 w-3.5" /> Revoke</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-muted">
              <span>{(page * PAGE + 1).toLocaleString()}–{Math.min((page + 1) * PAGE, links.total).toLocaleString()} of {links.total.toLocaleString()}</span>
              <div className="flex gap-2">
                <button className="btn-ghost px-2.5 py-1 text-xs" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
                <button className="btn-ghost px-2.5 py-1 text-xs" disabled={(page + 1) * PAGE >= links.total} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
