'use client';
import { Pencil, Plus, Search, Upload, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { ScoreBadge, type Grade } from '@/components/vendors/score';
import { flag } from '@/lib/countries';
import { useEffect, useMemo, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { BulkImport, type ImportColumn } from '@/components/parties/bulk-import';
import { VendorForm, type VendorDetail } from '@/components/parties/vendor-form';
import { VENDOR_REDIRECTS } from '@/lib/contact-rules';
import { Empty, ErrorBox, Loading, PageHeader, Section, StatusChip } from '@/components/ui';
import { hostOf } from '@/lib/suggest';
import { get, patch, post } from '@/lib/api';

interface ScoreRow { id: string; score: number | null; grade: Grade; markets: string[]; committed: number; stats: { clicks: number; completes: number; qualityRate: number } }
type VendorRow = VendorDetail & { _count: { allocations: number } };

const VENDOR_IMPORT_COLUMNS: ImportColumn[] = [
  { key: 'name', label: 'Vendor name', required: true, example: 'Nordic Panels', example2: 'Asia Sample Hub' },
  { key: 'code', label: 'Short code; made from the name when empty', example: 'NORDIC', example2: '' },
  { key: 'website', label: 'Website', example: 'nordicpanels.com', example2: '' },
  { key: 'contact_name', label: 'Main contact', example: 'Liv Berg', example2: 'Ken Ito' },
  { key: 'contact_email', label: 'Main contact’s email', example: 'ops@nordicpanels.com', example2: 'pm@asiasamplehub.com' },
  { key: 'contact_phone', label: 'Main contact’s phone', example: '+46 8 555 0100', example2: '' },
  { key: 'complete_url', label: 'Complete redirect', example: 'https://nordicpanels.com/end?st=complete&uid={respondent_uid}', example2: 'https://r.asiasamplehub.com/c?id={respondent_uid}' },
  { key: 'terminate_url', label: 'Terminate redirect', example: 'https://nordicpanels.com/end?st=terminate&uid={respondent_uid}', example2: 'https://r.asiasamplehub.com/t?id={respondent_uid}' },
  { key: 'quota_full_url', label: 'Quota full redirect', example: 'https://nordicpanels.com/end?st=quotafull&uid={respondent_uid}', example2: 'https://r.asiasamplehub.com/q?id={respondent_uid}' },
  { key: 'security_url', label: 'Security / quality redirect', example: 'https://nordicpanels.com/end?st=security&uid={respondent_uid}', example2: 'https://r.asiasamplehub.com/s?id={respondent_uid}' },
  { key: 'callback_url', label: 'Server-to-server callback', example: 'https://api.nordicpanels.com/cb?uid={uid}&status={status}', example2: '' },
  { key: 'redirect_domains', label: 'Extra allowed hosts, comma separated', example: '', example2: '' },
];

/** "4 of 4" with the missing ones named, so a vendor without redirects stands out. */
function RedirectCount({ urls }: { urls: Record<string, string> | null }) {
  const main = VENDOR_REDIRECTS.filter((r) => r.main);
  const missing = main.filter((r) => !urls?.[r.status]);
  if (!missing.length) return <span className="text-ok">All 4 set</span>;
  if (missing.length === main.length) return <span className="text-warn">None yet</span>;
  return <span className="text-warn" title={`Missing: ${missing.map((r) => r.label).join(', ')}`}>{main.length - missing.length} of 4 · no {missing.map((r) => r.label.split(' ')[0].toLowerCase()).join(', ')}</span>;
}

export default function VendorsPage() {
  const me = useMe();
  const [rows, setRows] = useState<VendorRow[] | null>(null);
  const [panel, setPanel] = useState<'new' | 'import' | null>(null);
  const [editing, setEditing] = useState<VendorDetail | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [scores, setScores] = useState<Map<string, ScoreRow>>(new Map());
  const load = () => {
    get<VendorRow[]>('/vendors').then(setRows).catch(setError);
    get<{ vendors: ScoreRow[] }>('/vendors/scores').then((r) => setScores(new Map(r.vendors.map((x) => [x.id, x])))).catch(() => undefined);
  };
  useEffect(() => {
    load();
  }, []);

  const taken = rows?.map((v) => v.code) ?? [];
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter((v) => (!status || v.status === status) && (!t || [v.name, v.code, v.contactName ?? '', v.contactEmail ?? '', ...v.redirectAllowedDomains].some((s) => s.toLowerCase().includes(t))));
  }, [rows, q, status]);

  async function openEdit(id: string) {
    setError(null);
    setPanel(null);
    try {
      setEditing(await get<VendorDetail>(`/vendors/${id}`));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError(e);
    }
  }
  async function create(body: Record<string, unknown>) {
    setError(null);
    try {
      await post('/vendors', body);
      setPanel(null);
      load();
    } catch (e) {
      setError(e);
      throw e;
    }
  }
  async function save(body: Record<string, unknown>) {
    if (!editing) return;
    setError(null);
    try {
      await patch(`/vendors/${editing.id}`, body);
      setEditing(null);
      load();
    } catch (e) {
      setError(e);
      throw e;
    }
  }

  return (
    <>
      <PageHeader title="Vendors" subtitle="Scores come from the last 180 days of traffic. Open a vendor for its scorecard and the markets it covers." actions={<div className="flex flex-wrap gap-2"><Link href="/vendors/applications" className="btn-ghost"><UserPlus className="h-4 w-4" /> Applications</Link>{canEdit(me) && <button className="btn-ghost" onClick={() => { setEditing(null); setPanel(panel === 'import' ? null : 'import'); }}><Upload className="h-4 w-4" /> Bulk add</button>}{canEdit(me) && <button className="btn-primary" onClick={() => { setEditing(null); setPanel(panel === 'new' ? null : 'new'); }}><Plus className="h-4 w-4" /> Add vendor</button>}</div>} />
      <div className="mb-4"><ErrorBox error={error} /></div>
      {panel === 'new' && (
        <Section title="New vendor" className="mb-6">
          <VendorForm taken={taken} onSubmit={create} onCancel={() => setPanel(null)} />
        </Section>
      )}
      {panel === 'import' && <BulkImport kind="vendors" columns={VENDOR_IMPORT_COLUMNS} onDone={load} onClose={() => setPanel(null)} />}
      {editing && (
        <Section title={`Edit vendor · ${editing.name}`} className="mb-6">
          <VendorForm vendor={editing} taken={taken} onSubmit={save} onCancel={() => setEditing(null)} />
        </Section>
      )}
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>No vendors yet. Add one, or bulk add them from a spreadsheet.</Empty> : (
        <>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <input className="input pl-8" placeholder="Search name, code, contact, domain" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search vendors" />
          </label>
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option>
          </select>
          <span className="text-xs text-muted">{shown.length} of {rows.length}</span>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line bg-sunken/60"><tr><th className="th">Vendor</th><th className="th">Code</th><th className="th">Status</th><th className="th">Score (180 days)</th><th className="th">Markets</th><th className="th text-right">Owed on live projects</th><th className="th">Redirects</th><th className="th">Callback</th><th className="th text-right">Allocations</th>{canEdit(me) && <th className="th" />}</tr></thead>
            <tbody className="divide-y divide-line">
              {shown.map((v) => (
                <tr key={v.id} className={editing?.id === v.id ? 'bg-brand/5' : undefined}>
                  <td className="td font-medium"><Link className="hover:text-brand hover:underline" href={`/vendors/${v.id}`}>{v.name}</Link></td><td className="td">{v.code}</td><td className="td"><StatusChip status={v.status} /></td>
                  <td className="td"><Link href={`/vendors/${v.id}`}><ScoreBadge score={scores.get(v.id)?.score ?? null} grade={scores.get(v.id)?.grade ?? null} /></Link></td>
                  <td className="td text-sm" title={scores.get(v.id)?.markets.join(', ')}>{scores.get(v.id)?.markets.length ? scores.get(v.id)!.markets.slice(0, 6).map(flag).join(' ') + (scores.get(v.id)!.markets.length > 6 ? ` +${scores.get(v.id)!.markets.length - 6}` : '') : <span className="text-muted">–</span>}</td>
                  <td className="td text-right tabular-nums">{scores.get(v.id)?.committed ?? 0}</td>
                  <td className="td text-xs"><RedirectCount urls={v.redirectUrls} /></td>
                  <td className="td max-w-[240px] truncate font-mono text-xs text-muted" title={v.callbackUrlTemplate ?? ''}>{v.callbackUrlTemplate ? hostOf(v.callbackUrlTemplate) ?? 'set' : '–'}</td>
                  <td className="td text-right tabular-nums">{v._count.allocations}</td>
                  {canEdit(me) && <td className="td text-right"><button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => openEdit(v.id)}><Pencil className="h-3.5 w-3.5" /> Edit</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div className="p-6 text-center text-sm text-muted">No vendor matches.</div>}
        </div>
        </>
      )}
    </>
  );
}
