'use client';
import clsx from 'clsx';
import { ArrowRight, CheckCircle2, ClipboardPaste, Download, FileUp, Link2, Search, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyIcon } from '@/components/copy';
import { Empty, ErrorBox, Field, Loading, OutcomeChip, Section, StatusChip, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { countryName, flag } from '@/lib/countries';
import { downloadFile } from '@/lib/download';
import { downloadXlsx, isXlsx, readXlsx } from '@/lib/xlsx';
import type { ProjectDetail } from './types';

interface Market {
  id: string; countryCode: string; language: string; targetGroup: string | null; status: string;
  useClientLinks: boolean; hasLiveSurveyUrl: boolean; targetCompletes: number; completes: number;
  total: number; unused: number; assigned: number; low: boolean;
}
interface Summary { maxPerUpload: number; markets: Market[]; uploads: { countryId: string; label: string | null; count: number; createdAt: string }[] }
interface Report { dryRun: boolean; valid: number; added: number; invalid: number; invalidSamples: { line: number; value: string }[]; repeatedInFile: number; alreadyUploaded: number }
interface LinkRow {
  id: string; url: string; seq: number; status: 'UNUSED' | 'ASSIGNED'; assignedAt: string | null; label: string | null;
  projectCountry: { countryCode: string; language: string; targetGroup: string | null };
  session: { status: string; statusDetail: string | null; token: string; vendorAllocation: { vendor: { name: string } } } | null;
}

const PAGE = 100;
const marketName = (m: Pick<Market, 'countryCode' | 'targetGroup' | 'language'>) => `${flag(m.countryCode)} ${countryName(m.countryCode)} (${m.language})${m.targetGroup ? ` · ${m.targetGroup}` : ''}`;
const when = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** The links in an Excel sheet: the first cell of each row that holds an http(s) link. */
async function linesFromFile(file: File): Promise<{ blob: Blob; name: string }> {
  if (isXlsx(file)) {
    const rows = await readXlsx(await file.arrayBuffer());
    const links = rows.map((r) => r.find((c) => /^https?:\/\//i.test(c.trim()))?.trim()).filter(Boolean);
    return { blob: new Blob([links.join('\n')], { type: 'text/plain' }), name: file.name.replace(/\.xlsx$/i, '.txt') };
  }
  if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files cannot be read. Save the sheet as .xlsx or CSV.');
  return { blob: file, name: file.name };
}

/**
 * Client unique links (docs/CLIENT_UNIQUE_LINKS.md): survey links the client made, one per
 * respondent. Upload them per market, turn them on, and each respondent gets their own.
 */
export function ClientLinksTab({ project, editable }: { project: ProjectDetail; editable: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [links, setLinks] = useState<{ total: number; rows: LinkRow[] } | null>(null);
  const [filter, setFilter] = useState({ countryId: '', status: '', q: '' });
  const [page, setPage] = useState(0);
  const [form, setForm] = useState<{ countryId: string; label: string; paste: string; file: File | null }>({ countryId: '', label: '', paste: '', file: null });
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadSummary = useCallback(() => get<Summary>(`/projects/${project.id}/client-links/summary`).then((s) => {
    setSummary(s);
    setForm((f) => (f.countryId || !s.markets[0] ? f : { ...f, countryId: s.markets[0].id }));
  }).catch(setError), [project.id]);
  const loadLinks = useCallback(() => {
    const q = new URLSearchParams({ skip: String(page * PAGE), take: String(PAGE) });
    for (const [k, v] of Object.entries(filter)) if (v) q.set(k, v);
    return get<{ total: number; rows: LinkRow[] }>(`/projects/${project.id}/client-links?${q}`).then(setLinks).catch(setError);
  }, [project.id, filter, page]);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadLinks(); }, [loadLinks]);
  const reload = () => { loadSummary(); loadLinks(); };

  /** Sends the file (or pasted links) as text; dryRun first, then for real. */
  async function send(dryRun: boolean) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const src = form.file ? await linesFromFile(form.file) : { blob: new Blob([form.paste], { type: 'text/plain' }), name: 'pasted-links.txt' };
      const fd = new FormData();
      fd.append('countryId', form.countryId);
      fd.append('dryRun', String(dryRun));
      const label = form.label.trim() || (form.file ? form.file.name : '');
      if (label) fd.append('label', label);
      fd.append('file', src.blob, src.name);
      const r = await api<Report>(`/projects/${project.id}/client-links/file`, { method: 'POST', body: fd });
      setReport(r);
      if (!dryRun) {
        setNotice(`${r.added.toLocaleString()} client link${r.added === 1 ? '' : 's'} added.`);
        setForm((f) => ({ ...f, label: '', paste: '', file: null }));
        setReport(null);
        reload();
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function setMode(m: Market, on: boolean) {
    setError(null);
    try {
      await post(`/projects/${project.id}/client-links/countries/${m.id}/mode`, { useClientLinks: on });
      loadSummary();
    } catch (e) {
      setError(e);
    }
  }

  async function removeUnused(m: Market) {
    if (!window.confirm(`Remove the ${m.unused.toLocaleString()} unused client links of ${countryName(m.countryCode)}? Links already given out are kept.`)) return;
    try {
      const r = await post<{ removed: number }>(`/projects/${project.id}/client-links/remove`, { countryId: m.id });
      setNotice(`${r.removed.toLocaleString()} unused link${r.removed === 1 ? '' : 's'} removed.`);
      reload();
    } catch (e) {
      setError(e);
    }
  }

  const example = () => downloadXlsx('client-unique-links-example.xlsx', [['link'], ['https://survey.client.com/s/AB12CD?src=samptrek'], ['https://survey.client.com/s/EF34GH?src=samptrek'], ['https://survey.client.com/s/IJ56KL?src=samptrek']], 'Client links');

  if (!summary) return error ? <ErrorBox error={error} /> : <Loading />;
  const hasInput = !!form.file || !!form.paste.trim();

  return (
    <div className="space-y-6">
      <ErrorBox error={error} />
      {notice && <p role="status" className="rounded-lg bg-ok/10 px-4 py-2.5 text-sm text-ok">{notice}</p>}
      <p className="text-sm text-muted">
        Some clients send one survey link per respondent instead of one shared live link. Upload those links here, per market, and turn on
        <strong className="text-ink"> Use client unique links</strong>. Every respondent who enters, through any vendor, is then sent to the next unused link,
        and no link is ever given to two people. These are different from <strong className="text-ink">vendor unique links</strong>, which are entry links you give vendors.
      </p>

      <div className="rounded-lg border border-line p-4 text-sm" aria-label="Example">
        <div className="mb-2 font-medium">How it works, with an example</div>
        <ol className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
          <li className="rounded-md bg-sunken/60 p-2.5"><div className="text-xs text-muted">1. Respondent opens the vendor link</div><code className="break-all text-xs">…/s/k3Xy9?vid=PANEL-77</code></li>
          <ArrowRight className="mx-auto hidden h-4 w-4 text-muted md:block" aria-hidden />
          <li className="rounded-md bg-sunken/60 p-2.5"><div className="text-xs text-muted">2. SampTrek gives the next unused client link, adding the respondent UID</div><code className="break-all text-xs">https://survey.client.com/s/AB12CD?src=samptrek&amp;token=SMP-q8…</code></li>
          <ArrowRight className="mx-auto hidden h-4 w-4 text-muted md:block" aria-hidden />
          <li className="rounded-md bg-sunken/60 p-2.5"><div className="text-xs text-muted">3. At the end the client survey sends them back with the same UID</div><code className="break-all text-xs">{project.outcomeEndpoints.browser.replace('{status}', 'complete').replace('{session_token}', 'SMP-q8…')}</code></li>
        </ol>
        <p className="mt-2 text-xs text-muted">Put <code>{'{session_token}'}</code> in a link where the client wants the UID; otherwise it is added as <code>token=</code>. Test links borrow the first unused link without using it up.</p>
      </div>

      <Section help="project.clientLinks.markets" title="Markets">
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-y border-line bg-sunken/60">
              <tr><th className="th">Market</th><th className="th">Status</th><th className="th">Use client unique links</th><th className="th text-right">Unused</th><th className="th text-right">Given out</th><th className="th text-right">Completes still needed</th><th className="th" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.markets.map((m) => (
                <tr key={m.id}>
                  <td className="td whitespace-nowrap text-sm">{marketName(m)}</td>
                  <td className="td"><StatusChip status={m.status} /></td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <Toggle checked={m.useClientLinks} label={`Use client unique links in ${countryName(m.countryCode)}`} onChange={(v) => (editable ? setMode(m, v) : undefined)} />
                      <span className="text-xs text-muted">{m.useClientLinks ? 'On: each respondent gets their own link' : m.hasLiveSurveyUrl ? 'Off: the live survey link is used' : 'Off'}</span>
                    </div>
                  </td>
                  <td className={clsx('td text-right tabular-nums', m.low && 'font-medium text-warn')}>
                    {m.unused.toLocaleString()}
                    {m.low && <span className="ml-1 inline-flex items-center gap-1 text-xs" title="Fewer than twice the completes still needed. Respondents who drop out use a link too."><TriangleAlert className="h-3.5 w-3.5" /> low</span>}
                  </td>
                  <td className="td text-right tabular-nums">{m.assigned.toLocaleString()}</td>
                  <td className="td text-right tabular-nums">{Math.max(0, m.targetCompletes - m.completes).toLocaleString()}</td>
                  <td className="td text-right">
                    {editable && m.unused > 0 && <button className="btn-ghost px-2 py-1 text-xs text-bad" onClick={() => removeUnused(m)}><Trash2 className="h-3.5 w-3.5" /> Remove unused</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {editable && (
        <Section help="project.clientLinks.upload" title={<span className="flex items-center gap-2"><Upload className="h-4 w-4 text-brand" /> Upload client links</span>}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Market">
              <select className="input" value={form.countryId} onChange={(e) => { setForm({ ...form, countryId: e.target.value }); setReport(null); }}>
                {summary.markets.map((m) => <option key={m.id} value={m.id}>{marketName(m)}</option>)}
              </select>
            </Field>
            <Field label="Name (optional)" hint="Shown in the list, e.g. “Wave 1”"><input className="input" maxLength={200} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
            <Field label="File" hint="Excel (.xlsx), CSV or text: one link per row">
              <input ref={fileInput} type="file" className="sr-only" aria-label="File with client links" accept=".xlsx,.csv,.txt,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { const f = e.target.files?.[0] ?? null; setForm({ ...form, file: f, paste: '' }); setReport(null); e.target.value = ''; }} />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-ghost h-9 px-2.5 text-xs" onClick={() => fileInput.current?.click()}><FileUp className="h-3.5 w-3.5" /> {form.file ? 'Choose another' : 'Choose file'}</button>
                <button type="button" className="btn-ghost h-9 px-2.5 text-xs" onClick={example}><Download className="h-3.5 w-3.5" /> Example</button>
              </div>
              {form.file && <div className="mt-1 truncate text-xs text-muted">{form.file.name} · {Math.ceil(form.file.size / 1024).toLocaleString()} KB</div>}
            </Field>
          </div>
          {!form.file && (
            <div className="mt-3">
              <Field label="Or paste the links" hint="One per line">
                <textarea className="input min-h-[96px] font-mono text-xs" placeholder={'https://survey.client.com/s/AB12CD\nhttps://survey.client.com/s/EF34GH'} value={form.paste} onChange={(e) => { setForm({ ...form, paste: e.target.value }); setReport(null); }} />
              </Field>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="btn-ghost" disabled={busy || !hasInput || !form.countryId} onClick={() => send(true)}><ClipboardPaste className="h-4 w-4" /> Check links</button>
            <button className="btn-primary" disabled={busy || !report || report.valid === 0} onClick={() => send(false)}><Upload className="h-4 w-4" /> Add {report ? report.valid.toLocaleString() : ''} link{report?.valid === 1 ? '' : 's'}</button>
            <span className="text-xs text-muted">Up to {summary.maxPerUpload.toLocaleString()} links per upload. Nothing is added until you press Add.</span>
          </div>
          {report && (
            <div className={clsx('mt-3 rounded-lg border p-3 text-sm', report.invalid ? 'border-warn/30 bg-warn/10' : 'border-ok/30 bg-ok/10')} role="status">
              <div className="flex items-center gap-2">{report.invalid ? <TriangleAlert className="h-4 w-4 text-warn" /> : <CheckCircle2 className="h-4 w-4 text-ok" />} {report.valid.toLocaleString()} new link{report.valid === 1 ? '' : 's'} ready.</div>
              <ul className="mt-1 list-inside list-disc text-xs text-muted">
                {report.alreadyUploaded > 0 && <li>{report.alreadyUploaded.toLocaleString()} already uploaded to this market (skipped)</li>}
                {report.repeatedInFile > 0 && <li>{report.repeatedInFile.toLocaleString()} repeated in the file (skipped)</li>}
                {report.invalid > 0 && <li>{report.invalid.toLocaleString()} line{report.invalid === 1 ? ' is' : 's are'} not a link (skipped){report.invalidSamples.length ? `, e.g. line ${report.invalidSamples[0].line}: “${report.invalidSamples[0].value}”` : ''}</li>}
              </ul>
            </div>
          )}
        </Section>
      )}

      <Section
        help="project.clientLinks.list"
        title={<span className="flex items-center gap-2"><Link2 className="h-4 w-4 text-muted" /> Links</span>}
        actions={
          <button className="btn-ghost px-2.5 py-1.5 text-xs" disabled={!links?.total} onClick={() => downloadFile(`/projects/${project.id}/client-links/export.csv?${new URLSearchParams(Object.entries(filter).filter(([, v]) => v))}`, `${project.projectCode}-client-unique-links.csv`).catch(setError)}>
            <Download className="h-3.5 w-3.5" /> Download {links?.total ? links.total.toLocaleString() : ''} as CSV
          </button>
        }
      >
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Market">
            <select className="input" value={filter.countryId} onChange={(e) => { setFilter({ ...filter, countryId: e.target.value }); setPage(0); }}>
              <option value="">All</option>
              {summary.markets.map((m) => <option key={m.id} value={m.id}>{marketName(m)}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={filter.status} onChange={(e) => { setFilter({ ...filter, status: e.target.value }); setPage(0); }}>
              <option value="">All</option>
              <option value="UNUSED">Unused</option>
              <option value="ASSIGNED">Given out</option>
            </select>
          </Field>
          <Field label="Find a link">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input className="input pl-8" placeholder="Part of the link" value={filter.q} onChange={(e) => { setFilter({ ...filter, q: e.target.value.trim() }); setPage(0); }} />
            </div>
          </Field>
        </div>
        {!links ? (
          <Loading />
        ) : links.rows.length === 0 ? (
          <Empty>{summary.markets.some((m) => m.total) ? 'No links match these filters.' : 'No client links yet. Upload the file your client sent above.'}</Empty>
        ) : (
          <>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead className="border-y border-line bg-sunken/60">
                  <tr><th className="th">#</th><th className="th">Client link</th><th className="th">Market</th><th className="th">Link</th><th className="th">Respondent UID</th><th className="th">Vendor</th><th className="th">Outcome</th><th className="th">Given out at</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {links.rows.map((l) => (
                    <tr key={l.id}>
                      <td className="td tabular-nums text-xs text-muted">{l.seq}</td>
                      <td className="td max-w-[320px]"><span className="flex items-center gap-1"><span className="truncate font-mono text-xs" title={l.url}>{l.url}</span><CopyIcon text={l.url} label="client link" /></span>{l.label && <span className="block truncate text-xs text-muted">{l.label}</span>}</td>
                      <td className="td whitespace-nowrap text-sm">{flag(l.projectCountry.countryCode)} {l.projectCountry.countryCode}{l.projectCountry.targetGroup ? ` · ${l.projectCountry.targetGroup}` : ''}</td>
                      <td className="td"><span className={clsx('chip', l.status === 'UNUSED' ? 'bg-ok/15 text-ok' : 'bg-info/15 text-info')}>{l.status === 'UNUSED' ? 'Unused' : 'Given out'}</span></td>
                      <td className="td font-mono text-xs">{l.session ? <span className="inline-flex items-center">{l.session.token.slice(0, 14)}…<CopyIcon text={l.session.token} label="respondent UID" /></span> : '–'}</td>
                      <td className="td text-sm">{l.session?.vendorAllocation.vendor.name ?? '–'}</td>
                      <td className="td">{l.session ? <OutcomeChip status={l.session.status} /> : '–'}</td>
                      <td className="td whitespace-nowrap text-xs text-muted">{when(l.assignedAt)}</td>
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
