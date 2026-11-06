import { SummaryRow } from '../reports/reports.service';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (n: number) => n.toLocaleString('en-US');
const money = (r: SummaryRow, k: 'revenue' | 'payout' | 'profit') => r.money.map((m) => `${m.currency} ${m[k].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(' + ') || '–';

/** True when converting adds information: several currencies, or one that is not the reporting currency. */
const converts = (r: SummaryRow) => !!r.reporting?.currency && r.money.length > 0 && (r.money.length > 1 || r.money[0].currency !== r.reporting.currency);
const convertedLine = (r: SummaryRow) =>
  `${r.reporting.currency} ${r.reporting.profit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${r.reporting.margin == null ? '' : ` (${r.reporting.margin}%)`}${r.reporting.missing.length ? `, without ${r.reporting.missing.join(', ')}` : ''}`;

export const CSV_COLUMNS = ['Name', 'Detail', 'Clicks', 'Completes', 'Terminates', 'Quota full', 'Quality fail', 'Partial', 'In progress', 'Conversion %', 'Approved', 'Pending', 'Rejected', 'Median LOI (min)', 'Currency', 'Revenue', 'Payout', 'Profit'];

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  // Quote when needed, and defuse spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** One line per row and currency, so amounts are never added across currencies. */
export function toCsv(rows: SummaryRow[]): string {
  const lines = [CSV_COLUMNS.map(csvCell).join(',')];
  for (const r of rows) {
    const base = [r.label, r.sublabel, r.clicks, r.completes, r.terminates, r.quotaFull, r.qualityFail, r.partial, r.inProgress, r.conversion, r.approved, r.pending, r.rejected, r.medianLoiMinutes];
    const per = r.money.length ? r.money : [{ currency: '', revenue: 0, payout: 0, profit: 0 }];
    for (const m of per) lines.push([...base, m.currency, m.revenue.toFixed(2), m.payout.toFixed(2), m.profit.toFixed(2)].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export interface EmailInput {
  org: string;
  name: string;
  reportLabel: string;
  from: string;
  to: string;
  filters: string[];
  totals: SummaryRow | null;
  rows: SummaryRow[];
  rowLabel: string;
  appUrl: string;
  /** White-label: product name and logo (defaults to SampTrek). */
  appName?: string;
  logoUrl?: string | null;
  schedule: string;
}

const MAX_ROWS = 25;

/** A plain, table-based email that renders in Zoho, Gmail and Outlook. */
export function renderEmail(e: EmailInput): { subject: string; html: string; text: string } {
  const range = e.from === e.to ? e.from : `${e.from} to ${e.to}`;
  const subject = `${e.name}: ${range}`;
  const t = e.totals;
  const tiles: [string, string][] = t
    ? [['Clicks', num(t.clicks)], ['Completes', num(t.completes)], ['Conversion', `${t.conversion}%`], ['Revenue', money(t, 'revenue')], ['Profit', money(t, 'profit')], ...(converts(t) ? ([["Profit converted", convertedLine(t)]] as [string, string][]) : [])]
    : [];
  const shown = e.rows.slice(0, MAX_ROWS);
  const td = 'padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;';
  const th = 'padding:6px 10px;border-bottom:2px solid #d1d5db;font-size:12px;text-align:left;color:#6b7280;';
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px">
<tr><td style="padding:20px 24px 4px">${e.logoUrl ? `<img src="${esc(e.logoUrl)}" alt="${esc(e.appName ?? 'SampTrek')}" height="28" style="height:28px;max-width:180px;border:0;display:block;margin-bottom:8px">` : ''}<div style="font-size:12px;color:#6b7280;letter-spacing:1px;text-transform:uppercase">${esc(e.org)} · ${esc(e.appName ?? 'SampTrek')}</div>
<h1 style="margin:6px 0 2px;font-size:20px">${esc(e.name)}</h1>
<div style="font-size:13px;color:#6b7280">${esc(e.reportLabel)} · ${esc(range)}${e.filters.length ? ` · ${esc(e.filters.join(', '))}` : ''}</div></td></tr>
${tiles.length ? `<tr><td style="padding:12px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tiles.map(([k, v]) => `<td style="padding:8px;border:1px solid #e5e7eb;border-radius:6px;vertical-align:top"><div style="font-size:11px;color:#6b7280;text-transform:uppercase">${k}</div><div style="font-size:15px;font-weight:bold;margin-top:4px">${esc(v)}</div></td>`).join('<td width="6"></td>')}</tr></table></td></tr>` : ''}
<tr><td style="padding:8px 24px 4px">${
    shown.length
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><th style="${th}">${esc(e.rowLabel)}</th><th style="${th}text-align:right">Clicks</th><th style="${th}text-align:right">Completes</th><th style="${th}text-align:right">Conv.</th><th style="${th}text-align:right">Revenue</th></tr>
${shown.map((r) => `<tr><td style="${td}">${esc(r.label)}${r.sublabel ? ` <span style="color:#6b7280">${esc(r.sublabel)}</span>` : ''}</td><td style="${td}text-align:right">${num(r.clicks)}</td><td style="${td}text-align:right">${num(r.completes)}</td><td style="${td}text-align:right">${r.conversion}%</td><td style="${td}text-align:right">${esc(money(r, 'revenue'))}</td></tr>`).join('\n')}</table>
${e.rows.length > MAX_ROWS ? `<p style="font-size:12px;color:#6b7280">Showing ${MAX_ROWS} of ${e.rows.length} rows. All rows are in the attached CSV.</p>` : ''}`
      : '<p style="font-size:14px;color:#6b7280">No respondent traffic in this period.</p>'
  }</td></tr>
<tr><td style="padding:12px 24px 20px;font-size:12px;color:#6b7280">Amounts are in each market&#39;s currency; converted totals use the exchange rates in Settings. Full detail is in the attached CSV and in <a href="${esc(e.appUrl)}/reports" style="color:#2563eb">${esc(e.appName ?? 'SampTrek')} Reports</a>.<br>${esc(e.schedule)}. Manage it in <a href="${esc(e.appUrl)}/reports/schedules" style="color:#2563eb">Scheduled reports</a>.</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `${e.name} (${e.org})`,
    `${e.reportLabel}, ${range}${e.filters.length ? `, ${e.filters.join(', ')}` : ''}`,
    '',
    ...(t ? [`Clicks ${num(t.clicks)} · Completes ${num(t.completes)} · Conversion ${t.conversion}% · Revenue ${money(t, 'revenue')} · Profit ${money(t, 'profit')}${converts(t) ? ` · Profit converted ${convertedLine(t)}` : ''}`, ''] : []),
    ...(shown.length ? shown.map((r) => `${r.label}${r.sublabel ? ` (${r.sublabel})` : ''}: ${num(r.clicks)} clicks, ${num(r.completes)} completes, ${r.conversion}%, ${money(r, 'revenue')}`) : ['No respondent traffic in this period.']),
    '',
    `Full detail: attached CSV and ${e.appUrl}/reports`,
    `${e.schedule}. Manage: ${e.appUrl}/reports/schedules`,
  ].join('\n');
  return { subject, html, text };
}
