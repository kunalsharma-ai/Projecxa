'use client';
import { Plus, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { ScoreBadge, type Grade } from '@/components/vendors/score';
import { flag } from '@/lib/countries';
import { useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { SmartForm, type FormSchema, type Values } from '@/components/form/smart-form';
import { Empty, ErrorBox, Loading, PageHeader, Section, StatusChip } from '@/components/ui';
import { hostOf, suggestCode } from '@/lib/suggest';
import { get, post } from '@/lib/api';

interface ScoreRow { id: string; score: number | null; grade: Grade; markets: string[]; committed: number; stats: { clicks: number; completes: number; qualityRate: number } }
interface VendorRow { id: string; name: string; code: string; status: string; redirectAllowedDomains: string[]; callbackUrlTemplate: string | null; _count: { allocations: number } }

export default function VendorsPage() {
  const me = useMe();
  const [rows, setRows] = useState<VendorRow[] | null>(null);
  const [open, setOpen] = useState(false);
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
  const DOMAIN = /^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$|^localhost$/i;
  const schema: FormSchema = {
    sections: [
      {
        fields: [
          { name: 'name', type: 'text', label: 'Name', required: true, maxLength: 200, placeholder: 'e.g. Nordic Panels' },
          {
            name: 'code', type: 'text', label: 'Code', required: true, pattern: [/^[A-Za-z0-9_-]{2,20}$/, 'Use 2–20 letters, digits, - or _.'],
            validate: (v) => (taken.includes(String(v).trim().toUpperCase()) ? 'Another vendor already uses this code.' : null),
            suggest: (v) => { const c = suggestCode(String(v.name ?? ''), taken); return c ? { value: c, reason: 'from the name, not used yet' } : null; },
          },
          {
            name: 'callback', type: 'url', label: 'Callback URL template', span: 'full', placeholder: 'https://panel.example.com/cb?uid={uid}&status={status}',
            hint: 'Optional. Macros: {uid} {status} {vendor_id} {country_code} {project_code}',
            help: 'SampTrek calls this address when a respondent finishes, so the vendor learns the outcome server to server.',
          },
          {
            name: 'domains', type: 'tags', label: 'Redirect domains', span: 'full', placeholder: 'panel.example.com, then Enter',
            hint: 'Hostnames this vendor\u2019s redirect URLs may use. Paste a list or press Enter after each.',
            props: { normalise: (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), validateTag: (t: string) => (DOMAIN.test(t) ? null : 'use a hostname like example.com or *.example.com') },
            suggest: (v) => { const h = hostOf(String(v.callback ?? '')); return h && !(v.domains as string[]).includes(h) ? { value: [...(v.domains as string[]), h], label: h, reason: 'the callback URL\u2019s host' } : null; },
          },
        ],
      },
    ],
  };
  async function create(v: Values) {
    setError(null);
    try {
      await post('/vendors', { name: v.name, code: v.code, redirectAllowedDomains: v.domains, ...(v.callback ? { callbackUrlTemplate: v.callback } : {}) });
      setOpen(false);
      load();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <>
      <PageHeader title="Vendors" subtitle="Scores come from the last 180 days of traffic. Open a vendor for its scorecard and the markets it covers." actions={<div className="flex flex-wrap gap-2"><Link href="/vendors/applications" className="btn-ghost"><UserPlus className="h-4 w-4" /> Applications</Link>{canEdit(me) && <button className="btn-primary" onClick={() => setOpen(!open)}><Plus className="h-4 w-4" /> Add vendor</button>}</div>} />
      <div className="mb-4"><ErrorBox error={error} /></div>
      {open && (
        <Section title="New vendor" className="mb-6">
          <SmartForm schema={schema} onSubmit={create} submitLabel="Save vendor" onCancel={() => setOpen(false)} draftKey="vendor-new" />
        </Section>
      )}
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>No vendors yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-line bg-sunken/60"><tr><th className="th">Vendor</th><th className="th">Code</th><th className="th">Status</th><th className="th">Score (180 days)</th><th className="th">Markets</th><th className="th text-right">Owed on live projects</th><th className="th">Redirect domains</th><th className="th">Callback</th><th className="th text-right">Allocations</th></tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="td font-medium"><Link className="hover:text-brand hover:underline" href={`/vendors/${v.id}`}>{v.name}</Link></td><td className="td">{v.code}</td><td className="td"><StatusChip status={v.status} /></td>
                  <td className="td"><Link href={`/vendors/${v.id}`}><ScoreBadge score={scores.get(v.id)?.score ?? null} grade={scores.get(v.id)?.grade ?? null} /></Link></td>
                  <td className="td text-sm" title={scores.get(v.id)?.markets.join(', ')}>{scores.get(v.id)?.markets.length ? scores.get(v.id)!.markets.slice(0, 6).map(flag).join(' ') + (scores.get(v.id)!.markets.length > 6 ? ` +${scores.get(v.id)!.markets.length - 6}` : '') : <span className="text-muted">–</span>}</td>
                  <td className="td text-right tabular-nums">{scores.get(v.id)?.committed ?? 0}</td>
                  <td className="td text-xs text-muted">{v.redirectAllowedDomains.join(', ') || '–'}</td>
                  <td className="td max-w-[320px] truncate font-mono text-xs text-muted" title={v.callbackUrlTemplate ?? ''}>{v.callbackUrlTemplate ?? '–'}</td>
                  <td className="td text-right tabular-nums">{v._count.allocations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
