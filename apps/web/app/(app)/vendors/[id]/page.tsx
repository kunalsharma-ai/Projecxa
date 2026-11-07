'use client';
import { CopyIcon, Copyable } from '@/components/copy';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { FilesPanel } from '@/components/requests/files-panel';
import { Empty, ErrorBox, Loading, PageHeader, Section, StatusChip } from '@/components/ui';
import { LogoUpload, PartyLogo } from '@/components/parties/logo';
import { PART_LABELS, PartBar, ScoreBadge, WEIGHTS, type Grade, type ScoreParts, type VendorStats } from '@/components/vendors/score';
import { api, get, patch } from '@/lib/api';
import { VendorForm, type VendorDetail } from '@/components/parties/vendor-form';
import { VENDOR_FALLBACK, VENDOR_REDIRECTS } from '@/lib/contact-rules';
import { COUNTRIES, countryName, flag } from '@/lib/countries';

interface Market { countryCode: string; stats: VendorStats; score: number | null; grade: Grade; notes: string[]; capacity: { completesPerDay: number | null; completesPerMonth: number | null; note: string | null } | null; committed: number; headroom: number | null }
interface LinkRow { id: string; project: { id: string; projectCode: string; name: string; status: string }; countryCode: string; currency: string; cpi: number; status: string; target: number; completes: number; finished: boolean; clicks: number; qualityRate: number; rejected: number }
interface Card { id: string; name: string; code: string; status: string; days: number; minClicks: number; stats: VendorStats; score: number | null; grade: Grade; parts: ScoreParts; notes: string[]; markets: Market[]; links: LinkRow[] }
interface CapRow { countryCode: string; completesPerDay: string; completesPerMonth: string; note: string }

const PERIODS = [90, 180, 365];

export default function VendorScorecard() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const [days, setDays] = useState(180);
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [cap, setCap] = useState<CapRow[] | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<VendorDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);

  const load = useCallback(() => get<Card>(`/vendors/${id}/scorecard?days=${days}`).then(setCard).catch(setError), [id, days]);
  const loadDetail = useCallback(() => get<VendorDetail>(`/vendors/${id}`).then(setDetail).catch(setError), [id]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  async function startEdit() {
    setEditing(true);
    get<{ code: string }[]>('/vendors').then((r) => setCodes(r.map((v) => v.code))).catch(() => undefined);
  }
  async function saveDetail(body: Record<string, unknown>) {
    setError(null);
    try {
      setDetail(await patch<VendorDetail>(`/vendors/${id}`, body));
      setEditing(false);
      load();
    } catch (e) {
      setError(e);
      throw e;
    }
  }

  function editCapacity() {
    if (!card) return;
    setCap(card.markets.filter((m) => m.capacity).map((m) => ({ countryCode: m.countryCode, completesPerDay: String(m.capacity!.completesPerDay ?? ''), completesPerMonth: String(m.capacity!.completesPerMonth ?? ''), note: m.capacity!.note ?? '' })));
  }
  async function saveCapacity() {
    if (!cap) return;
    setSaving(true);
    setError(null);
    try {
      const n = (v: string) => (v.trim() === '' ? null : Number(v));
      await api(`/vendors/${id}/capacity`, { method: 'PUT', json: { rows: cap.map((r) => ({ countryCode: r.countryCode, completesPerDay: n(r.completesPerDay), completesPerMonth: n(r.completesPerMonth), note: r.note.trim() || null })) } });
      setCap(null);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  if (!card) return error ? <ErrorBox error={error} /> : <Loading />;
  const s = card.stats;
  const tiles: [string, string, string?][] = [
    ['Clicks', s.clicks.toLocaleString()],
    ['Completes', s.completes.toLocaleString(), `${s.conversion}% conversion`],
    ['Quality rejects', `${s.qualityRate}%`, `${s.quality} clicks`],
    ['Client rejections', s.rejectionRate === null ? '–' : `${s.rejectionRate}%`, `${s.rejected} of ${s.approved + s.rejected} reconciled`],
    ['Delivery', s.delivery === null ? '–' : `${s.delivery}%`, `${s.finishedLinks} finished link${s.finishedLinks === 1 ? '' : 's'}`],
    ['Projects', String(s.projects)],
  ];
  return (
    <>
      <Link href="/vendors" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Vendors</Link>
      <PageHeader
        title={card.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><PartyLogo url={detail?.logoUrl} name={card.name} size={24} /><StatusChip status={card.status} /><Copyable text={card.code} label="vendor ID" /></span>}
        actions={
          <label className="flex items-center gap-2 text-sm text-muted">
            Period
            <select className="input w-auto py-1.5" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {PERIODS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
            </select>
          </label>
        }
      />
      <div className="mb-4"><ErrorBox error={error} /></div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="card p-5">
          <div className="text-xs text-muted">Score</div>
          <div className="mt-2"><ScoreBadge score={card.score} grade={card.grade} size="lg" /></div>
          <ul className="mt-4 space-y-1.5 text-sm">
            {card.notes.map((n) => <li key={n} className={n === 'No problems found' ? 'text-ok' : n.startsWith('Not enough') ? 'text-muted' : 'text-warn'}>{n}</li>)}
          </ul>
          {card.score === null && <p className="mt-3 text-xs text-muted">A score needs {card.minClicks} clicks in the period. Counts below are shown anyway.</p>}
        </div>
        <div className="card p-5">
          <div className="mb-3 text-xs text-muted">How the score is made</div>
          <dl className="space-y-3">
            {(Object.keys(PART_LABELS) as (keyof ScoreParts)[]).map((k) => (
              <div key={k} className="grid grid-cols-1 gap-1 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center">
                <dt className="text-sm"><span className="font-medium">{PART_LABELS[k][0]}</span> <span className="text-xs text-muted">· {WEIGHTS[k]}%</span><span className="block text-xs text-muted">{PART_LABELS[k][1]}</span></dt>
                <dd><PartBar value={card.parts[k]} /></dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(([l, v, sub]) => (
          <div key={l} className="card p-4">
            <div className="text-xs text-muted">{l}</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{v}</div>
            {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
          </div>
        ))}
      </div>

      {detail && (
        <Section
          title="Details, redirects and callback"
          className="mb-6"
          actions={canEdit(me) && !editing && <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={startEdit}><Pencil className="h-3.5 w-3.5" /> Edit</button>}
        >
          <div className="mb-4"><LogoUpload kind="vendor" id={detail.id} name={detail.name} url={detail.logoUrl ?? null} editable={canEdit(me)} onChange={(url) => setDetail({ ...detail, logoUrl: url })} /></div>
          {editing ? (
            <VendorForm vendor={detail} taken={codes} onSubmit={saveDetail} onCancel={() => setEditing(false)} />
          ) : (
            <div className="space-y-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {([
                  ['Contact', [detail.contactName, detail.contactEmail].filter(Boolean).join(' · ')],
                  ['Phone', detail.contactPhone],
                  ['Website', detail.website?.replace(/^https?:\/\//, '')],
                  ['Allowed redirect hosts', detail.redirectAllowedDomains.join(', ')],
                ] as const).map(([l, v]) => (
                  <div key={l}><dt className="text-xs text-muted">{l}</dt><dd className="mt-0.5 break-words">{v || <span className="text-muted">Not set</span>}</dd></div>
                ))}
              </dl>
              <div className="-mx-5 -mb-5 overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead className="border-y border-line bg-sunken/60"><tr><th className="th w-56">Redirect</th><th className="th">URL</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {VENDOR_REDIRECTS.map((r) => {
                      const own = detail.redirectUrls?.[r.status];
                      const fb = VENDOR_FALLBACK[r.status];
                      const used = own ?? (fb ? detail.redirectUrls?.[fb] : undefined);
                      return (
                        <tr key={r.status}>
                          <td className="td text-sm font-medium">{r.label}</td>
                          <td className="td break-all font-mono text-xs">
                            {own ? <span className="flex items-start gap-1"><span className="min-w-0 flex-1">{own}</span><CopyIcon text={own} label={`${r.label} URL`} /></span> : used ? <span className="text-muted">Uses the {VENDOR_REDIRECTS.find((x) => x.status === fb)?.label.toLowerCase()} URL</span> : <span className="text-warn">Not set: respondents see the SampTrek end page</span>}
                          </td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="td text-sm font-medium">Callback (server to server)</td>
                      <td className="td break-all font-mono text-xs">{detail.callbackUrlTemplate ? <span className="flex items-start gap-1"><span className="min-w-0 flex-1">{detail.callbackUrlTemplate}</span><CopyIcon text={detail.callbackUrlTemplate} label="callback URL" /></span> : <span className="text-muted">Not set</span>}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Section>
      )}

      <Section
        title="Markets and capacity"
        className="mb-6"
        actions={canEdit(me) && !cap && <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={editCapacity}>Edit capacity</button>}
      >
        {cap ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">The markets this vendor covers and what it says it can deliver. Suggestions use these figures against what the vendor already owes on live projects.</p>
            {cap.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-lg bg-sunken/60 p-3 sm:grid-cols-[180px_130px_150px_minmax(0,1fr)_auto] sm:items-end">
                <label className="col-span-2 text-xs text-muted sm:col-span-1">Market
                  <select className="input mt-1" value={r.countryCode} onChange={(e) => setCap(cap.map((x, n) => (n === i ? { ...x, countryCode: e.target.value } : x)))}>
                    {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{flag(c.code)} {c.name}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted">Completes a day<input className="input mt-1" type="number" min={1} value={r.completesPerDay} onChange={(e) => setCap(cap.map((x, n) => (n === i ? { ...x, completesPerDay: e.target.value } : x)))} /></label>
                <label className="text-xs text-muted">Completes a month<input className="input mt-1" type="number" min={1} value={r.completesPerMonth} onChange={(e) => setCap(cap.map((x, n) => (n === i ? { ...x, completesPerMonth: e.target.value } : x)))} /></label>
                <label className="col-span-2 text-xs text-muted sm:col-span-1">Note<input className="input mt-1" maxLength={500} value={r.note} placeholder="e.g. B2C only, no healthcare" onChange={(e) => setCap(cap.map((x, n) => (n === i ? { ...x, note: e.target.value } : x)))} /></label>
                <button className="btn-ghost h-10 px-2" aria-label={`Remove ${r.countryCode}`} onClick={() => setCap(cap.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => setCap([...cap, { countryCode: COUNTRIES.find((c) => !cap.some((r) => r.countryCode === c.code))?.code ?? 'US', completesPerDay: '', completesPerMonth: '', note: '' }])}><Plus className="h-4 w-4" /> Add market</button>
              <button className="btn-primary" disabled={saving} onClick={saveCapacity}>{saving ? 'Saving…' : 'Save capacity'}</button>
              <button className="btn-ghost" onClick={() => setCap(null)}>Cancel</button>
            </div>
          </div>
        ) : card.markets.length === 0 ? (
          <Empty>No markets yet. Add the markets this vendor covers with Edit capacity.</Empty>
        ) : (
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-y border-line bg-sunken/60"><tr><th className="th">Market</th><th className="th">Score</th><th className="th text-right">Clicks</th><th className="th text-right">Completes</th><th className="th text-right">Quality rejects</th><th className="th text-right">Capacity a month</th><th className="th text-right">Owed on live projects</th><th className="th text-right">Room left</th></tr></thead>
              <tbody className="divide-y divide-line">
                {card.markets.map((m) => (
                  <tr key={m.countryCode}>
                    <td className="td"><span className="mr-1.5">{flag(m.countryCode)}</span>{countryName(m.countryCode)}{m.capacity?.note && <span className="block text-xs text-muted">{m.capacity.note}</span>}</td>
                    <td className="td"><ScoreBadge score={m.score} grade={m.grade} /></td>
                    <td className="td text-right tabular-nums">{m.stats.clicks}</td>
                    <td className="td text-right tabular-nums">{m.stats.completes}</td>
                    <td className="td text-right tabular-nums">{m.stats.clicks ? `${m.stats.qualityRate}%` : '–'}</td>
                    <td className="td text-right tabular-nums">{m.capacity?.completesPerMonth?.toLocaleString() ?? (m.capacity ? 'Not set' : '–')}</td>
                    <td className="td text-right tabular-nums">{m.committed.toLocaleString()}</td>
                    <td className={`td text-right tabular-nums ${m.headroom !== null && m.headroom <= 0 ? 'text-bad' : ''}`}>{m.headroom?.toLocaleString() ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Compliance documents">
        <p className="mb-4 text-sm text-muted">Certificates, data-protection agreements and panel books, with the date each stops being valid. The vendor can upload these from their portal; the bell warns 30 days before one expires.</p>
        <FilesPanel portal={false} query={{ vendorId: id, kind: 'COMPLIANCE' }} kinds={['COMPLIANCE']} fixed={{ vendorId: id }} canUpload={canEdit(me)} canDelete={() => canEdit(me)} empty="No compliance documents yet." />
      </Section>

      <Section title="Recent links">
        {card.links.length === 0 ? (
          <Empty>No traffic in this period.</Empty>
        ) : (
          <div className="-mx-5 -mb-5 overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-y border-line bg-sunken/60"><tr><th className="th">Project</th><th className="th">Market</th><th className="th">Status</th><th className="th text-right">CPI</th><th className="th text-right">Completes</th><th className="th text-right">Clicks</th><th className="th text-right">Quality rejects</th><th className="th text-right">Client rejections</th></tr></thead>
              <tbody className="divide-y divide-line">
                {card.links.map((l) => (
                  <tr key={l.id}>
                    <td className="td"><Link className="font-medium hover:text-brand hover:underline" href={`/projects/${l.project.id}`}>{l.project.projectCode}</Link> <span className="text-muted">{l.project.name}</span></td>
                    <td className="td">{flag(l.countryCode)} {l.countryCode}</td>
                    <td className="td"><StatusChip status={l.finished ? 'CLOSED' : l.status} /></td>
                    <td className="td text-right tabular-nums">{l.currency} {l.cpi.toFixed(2)}</td>
                    <td className="td text-right tabular-nums">{l.completes} / {l.target}</td>
                    <td className="td text-right tabular-nums">{l.clicks}</td>
                    <td className="td text-right tabular-nums">{l.qualityRate}%</td>
                    <td className="td text-right tabular-nums">{l.rejected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
