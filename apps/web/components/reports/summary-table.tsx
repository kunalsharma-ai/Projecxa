'use client';
import { Download } from 'lucide-react';
import { downloadCsv } from '@/lib/csv';
import { Empty } from '@/components/ui';
import { marginFor, moneyLines, type MoneyKey, type MoneyMode, type SummaryRow } from './types';

const n = (v: number) => v.toLocaleString();

/** Money cell: one line per currency, or one converted amount. */
export function MoneyCell({ r, k, mode = 'market' }: { r: SummaryRow; k: MoneyKey; mode?: MoneyMode }) {
  return (
    <>
      {moneyLines(r, k, mode).map((l) => (
        <div key={l} className={l.includes('-') ? 'text-bad' : undefined}>{l}</div>
      ))}
    </>
  );
}

/** CSV with both views of money: per market currency (text) and converted into the reporting currency (numbers). */
export function summaryCsv(filename: string, nameHeader: string, rows: SummaryRow[], withSub: string | null) {
  const cur = rows.find((r) => r.reporting?.currency)?.reporting.currency ?? 'reporting currency';
  downloadCsv(
    filename,
    [nameHeader, ...(withSub ? [withSub] : []), 'Clicks', 'Completes', 'Conversion %', 'Terminates', 'Quota full', 'Quality fails', 'Partial or error', 'In survey', 'Approved', 'Pending', 'Rejected', 'Median LOI (min)', 'Revenue', 'Payout', 'Profit', 'Margin %',
      `Revenue (${cur})`, `Payout (${cur})`, `Profit (${cur})`, `Margin % (${cur})`, 'Not converted (no rate)'],
    rows.map((r) => [r.label, ...(withSub ? [r.sublabel ?? ''] : []), r.clicks, r.completes, r.conversion, r.terminates, r.quotaFull, r.qualityFail, r.partial, r.inProgress, r.approved, r.pending, r.rejected, r.medianLoiMinutes ?? '', moneyLines(r, 'revenue').join('; '), moneyLines(r, 'payout').join('; '), moneyLines(r, 'profit').join('; '), r.margin ?? '',
      r.reporting.revenue.toFixed(2), r.reporting.payout.toFixed(2), r.reporting.profit.toFixed(2), r.reporting.margin ?? '', r.reporting.missing.join(' ')]),
  );
}

export function CsvButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={onClick} disabled={disabled}>
      <Download className="h-3.5 w-3.5" /> CSV
    </button>
  );
}

/** Grouped metrics table used by the client and vendor reports. */
export function SummaryTable({ rows, totals, nameHeader, subHeader, mode = 'market' }: { rows: SummaryRow[]; totals: SummaryRow | null; nameHeader: string; subHeader?: string; mode?: MoneyMode }) {
  if (rows.length === 0) return <Empty>No traffic matches these filters.</Empty>;
  const Row = ({ r, total }: { r: SummaryRow; total?: boolean }) => (
    <tr className={total ? 'bg-sunken/60 font-medium' : undefined}>
      <td className="td">
        <div className="max-w-[240px] truncate">{r.label}</div>
        {!subHeader && r.sublabel && <div className="text-xs text-muted">{r.sublabel}</div>}
      </td>
      {subHeader && <td className="td">{r.sublabel ?? ''}</td>}
      <td className="td text-right tabular-nums">{n(r.clicks)}</td>
      <td className="td text-right tabular-nums">{n(r.completes)}</td>
      <td className="td text-right tabular-nums">{r.conversion}%</td>
      <td className="td text-right tabular-nums">{n(r.terminates)}</td>
      <td className="td text-right tabular-nums">{n(r.quotaFull)}</td>
      <td className="td text-right tabular-nums">{n(r.qualityFail)}</td>
      <td className="td text-right tabular-nums">{r.medianLoiMinutes ?? '–'}</td>
      <td className="td text-right tabular-nums">{n(r.pending)} / {n(r.rejected)}</td>
      <td className="td text-right align-top tabular-nums"><MoneyCell r={r} k="revenue" mode={mode} /></td>
      <td className="td text-right align-top tabular-nums"><MoneyCell r={r} k="payout" mode={mode} /></td>
      <td className="td text-right align-top tabular-nums"><MoneyCell r={r} k="profit" mode={mode} /></td>
      <td className="td text-right tabular-nums">{marginFor(r, mode) == null ? '–' : `${marginFor(r, mode)}%`}</td>
    </tr>
  );
  return (
    <div className="-m-5 overflow-x-auto">
      <table className="w-full min-w-[1100px]">
        <thead className="border-b border-line bg-sunken/60">
          <tr>
            <th className="th">{nameHeader}</th>
            {subHeader && <th className="th">{subHeader}</th>}
            <th className="th text-right">Clicks</th>
            <th className="th text-right">Completes</th>
            <th className="th text-right">Conv.</th>
            <th className="th text-right">Terms</th>
            <th className="th text-right">Quota full</th>
            <th className="th text-right">Quality</th>
            <th className="th text-right" title="Median minutes from entry to complete">LOI</th>
            <th className="th text-right" title="Completes waiting for approval / rejected">Pending / rej.</th>
            <th className="th text-right">Revenue</th>
            <th className="th text-right">Payout</th>
            <th className="th text-right">Profit</th>
            <th className="th text-right">Margin</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => <Row key={r.key} r={r} />)}
          {totals && rows.length > 1 && <Row r={{ ...totals, label: 'Total', sublabel: null }} total />}
        </tbody>
      </table>
    </div>
  );
}
