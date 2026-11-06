'use client';
import clsx from 'clsx';
import { CheckCircle2, Download, FileUp, TriangleAlert, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { ErrorBox, Section } from '@/components/ui';
import { post } from '@/lib/api';
import { csvObjects, downloadCsv } from '@/lib/csv';
import { downloadXlsx, isXlsx, readXlsx, rowsToObjects } from '@/lib/xlsx';

export interface ImportColumn { key: string; label: string; required?: boolean; example: string; example2?: string }
interface Result { row: number; ok: boolean; name?: string; code?: string; errors?: string[] }
interface Answer { dryRun: boolean; added: number; valid: number; failed: number; results: Result[] }

/**
 * Bulk add clients or vendors: download the Excel or CSV template, fill it in, upload it (.xlsx
 * or .csv), check every row (nothing is saved yet), then add the rows that passed. Adding one by
 * one stays on the page.
 */
export function BulkImport({ kind, columns, onDone, onClose }: { kind: 'clients' | 'vendors'; columns: ImportColumn[]; onDone: () => void; onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [check, setCheck] = useState<Answer | null>(null);
  const [done, setDone] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  const noun = kind === 'clients' ? 'client' : 'vendor';

  function template(format: 'xlsx' | 'csv') {
    const header = columns.map((c) => c.key);
    const examples = [columns.map((c) => c.example), columns.map((c) => c.example2 ?? '')];
    if (format === 'csv') downloadCsv(`samptrek-${kind}-template.csv`, header, examples);
    else downloadXlsx(`samptrek-${kind}-template.xlsx`, [header, ...examples], kind === 'clients' ? 'Clients' : 'Vendors');
  }

  async function read(file: File) {
    setError(null);
    setCheck(null);
    setDone(null);
    setFileName(file.name);
    try {
      const objs = isXlsx(file) ? rowsToObjects(await readXlsx(await file.arrayBuffer())) : /\.xls$/i.test(file.name) ? (() => { throw new Error('Old .xls files cannot be read. In Excel use File → Save As → Excel Workbook (.xlsx) or CSV.'); })() : csvObjects(await file.text());
      const unknown = Object.keys(objs[0] ?? {}).filter((k) => !columns.some((c) => c.key === k));
      if (!objs.length) throw new Error('The file has no rows under the header.');
      if (objs.length > 1000) throw new Error('Up to 1000 rows at a time. Split the file and import it in parts.');
      if (!('name' in objs[0])) throw new Error(`The first row must be the header from the template (name, ${columns[1]?.key ?? ''}, …).`);
      // Drop columns we do not know, so a stray column never fails the whole file.
      const clean = objs.map((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !unknown.includes(k))));
      setRows(clean);
      setBusy(true);
      setCheck(await post<Answer>(`/${kind}/import`, { rows: clean, dryRun: true }));
    } catch (e) {
      setRows(null);
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function importValid() {
    if (!rows || !check) return;
    setBusy(true);
    setError(null);
    try {
      const okRows = check.results.filter((r) => r.ok).map((r) => rows[r.row - 1]);
      const a = await post<Answer>(`/${kind}/import`, { rows: okRows, dryRun: false });
      setDone(a);
      setCheck(null);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={`Bulk add ${kind}`} className="mb-6" actions={<button className="btn-ghost h-8 px-2.5 text-xs" onClick={onClose}>Close</button>}>
      <ol className="mb-4 grid gap-3 text-sm md:grid-cols-3">
        <li className="rounded-lg bg-sunken/60 p-3">
          <div className="font-medium">1. Get the template</div>
          <p className="mt-1 text-xs text-muted">The columns and two example rows. Open it in Excel or Google Sheets and replace the examples.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => template('xlsx')}><Download className="h-3.5 w-3.5" /> Excel template</button>
            <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => template('csv')}><Download className="h-3.5 w-3.5" /> CSV template</button>
          </div>
        </li>
        <li className="rounded-lg bg-sunken/60 p-3">
          <div className="font-medium">2. Upload the filled file</div>
          <p className="mt-1 text-xs text-muted">Excel (.xlsx) or CSV. Every row is checked first; nothing is added yet.</p>
          <input ref={input} type="file" accept=".xlsx,.csv,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" aria-label="Excel or CSV file" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ''; }} />
          <button className="btn-ghost mt-2 px-2.5 py-1.5 text-xs" disabled={busy} onClick={() => input.current?.click()}><FileUp className="h-3.5 w-3.5" /> {fileName ? 'Choose another file' : 'Choose Excel or CSV file'}</button>
          {fileName && <div className="mt-1 truncate text-xs text-muted">{fileName}</div>}
        </li>
        <li className="rounded-lg bg-sunken/60 p-3">
          <div className="font-medium">3. Add the rows that passed</div>
          <p className="mt-1 text-xs text-muted">Rows with problems are left out; fix them in the file and upload it again.</p>
          <button className="btn-primary mt-2 px-2.5 py-1.5 text-xs" disabled={busy || !check?.valid} onClick={importValid}><Upload className="h-3.5 w-3.5" /> Add {check?.valid ?? 0} {check?.valid === 1 ? noun : kind}</button>
        </li>
      </ol>
      <details className="mb-4 text-xs text-muted">
        <summary className="cursor-pointer">Columns</summary>
        <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {columns.map((c) => <li key={c.key}><code>{c.key}</code>{c.required ? ' (required)' : ''} · {c.label}</li>)}
        </ul>
      </details>
      <ErrorBox error={error} />
      {done && (
        <div className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 p-3 text-sm" role="status">
          <CheckCircle2 className="h-4 w-4 text-ok" /> Added {done.added} {done.added === 1 ? noun : kind}.{done.failed ? ` ${done.failed} could not be added (another person may have added the same name meanwhile).` : ''}
        </div>
      )}
      {check && (
        <>
          <div className={clsx('mb-3 flex items-center gap-2 rounded-lg border p-3 text-sm', check.failed ? 'border-warn/30 bg-warn/10' : 'border-ok/30 bg-ok/10')} role="status">
            {check.failed ? <TriangleAlert className="h-4 w-4 text-warn" /> : <CheckCircle2 className="h-4 w-4 text-ok" />}
            {check.valid} of {check.results.length} rows are ready{check.failed ? `; ${check.failed} need fixing` : ''}.
          </div>
          <div className="-mx-5 -mb-5 max-h-[360px] overflow-auto">
            <table className="w-full min-w-[560px]">
              <thead className="sticky top-0 border-y border-line bg-sunken"><tr><th className="th w-16">Row</th><th className="th">Name</th><th className="th">Code</th><th className="th">Check</th></tr></thead>
              <tbody className="divide-y divide-line">
                {check.results.map((r) => (
                  <tr key={r.row} className={r.ok ? undefined : 'bg-bad/5'}>
                    <td className="td tabular-nums text-muted">{r.row + 1}</td>
                    <td className="td font-medium">{r.name || <span className="text-muted">–</span>}</td>
                    <td className="td">{r.code ?? '–'}</td>
                    <td className="td text-xs">{r.ok ? <span className="text-ok">Ready</span> : <ul className="space-y-0.5 text-bad">{r.errors?.map((e) => <li key={e}>{e}</li>)}</ul>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}
