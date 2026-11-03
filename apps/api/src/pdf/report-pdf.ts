import { SummaryRow } from '../reports/reports.service';
import { amount, BRAND, Column, count, footer, INK, LINE, MUTED, newDoc, table, toBuffer, widths } from './pdf';

export interface ReportPdfInput {
  org: string;
  title: string;
  reportLabel: string;
  from: string | null;
  to: string | null;
  filters: string[];
  totals: SummaryRow | null;
  rows: SummaryRow[];
  rowLabel: string;
  generated: string;
}

const money = (r: SummaryRow, k: 'revenue' | 'payout' | 'profit') => (r.money.length ? r.money.map((m) => `${m.currency} ${amount(m[k])}`) : ['–']);

/** A landscape A4 report: title, filters, total tiles and the grouped table. Money stays per currency. */
export async function renderReportPdf(e: ReportPdfInput): Promise<Buffer> {
  const doc = newDoc({ landscape: true, title: e.title, author: e.org });
  const range = !e.from && !e.to ? 'All time' : e.from === e.to ? e.from! : `${e.from ?? 'start'} to ${e.to ?? 'today'}`;
  doc.font('bold').fontSize(8).fillColor(MUTED).text(`${e.org.toUpperCase()} · PROJEXA`, { characterSpacing: 0.5 });
  doc.moveDown(0.2).font('bold').fontSize(18).fillColor(INK).text(e.title);
  doc.moveDown(0.1).font('body').fontSize(9).fillColor(MUTED).text([e.reportLabel, range, ...e.filters].join(' · '));
  doc.moveDown(0.8);

  const t = e.totals;
  if (t) {
    const tiles: [string, string[]][] = [
      ['Clicks', [count(t.clicks)]], ['Completes', [count(t.completes)]], ['Conversion', [`${t.conversion}%`]], ['Median LOI', [t.medianLoiMinutes == null ? '–' : `${t.medianLoiMinutes} min`]],
      ['Revenue', money(t, 'revenue')], ['Payout', money(t, 'payout')], ['Profit', money(t, 'profit')],
    ];
    const w = widths(doc, tiles.map((x) => (x[1].some((l) => l.length > 12) ? 1.6 : 1)));
    const top = doc.y;
    const h = 30 + Math.max(...tiles.map((x) => x[1].length)) * 13;
    let x = doc.page.margins.left;
    tiles.forEach(([label, lines], i) => {
      doc.roundedRect(x, top, w[i] - 6, h, 4).lineWidth(0.75).strokeColor(LINE).stroke();
      doc.font('body').fontSize(7).fillColor(MUTED).text(label.toUpperCase(), x + 8, top + 8, { width: w[i] - 22 });
      doc.font('bold').fontSize(lines.length > 1 ? 9 : 12).fillColor(i < 4 ? INK : BRAND);
      lines.forEach((l, k) => doc.text(l, x + 8, top + 20 + k * 13, { width: w[i] - 22, lineBreak: false }));
      x += w[i];
    });
    doc.y = top + h + 14;
    doc.x = doc.page.margins.left;
  }

  if (!e.rows.length) {
    doc.font('body').fontSize(10).fillColor(MUTED).text('No traffic in this period.');
  } else {
    const w = widths(doc, [2.6, 0.9, 1.2, 0.9, 1.25, 1.1, 0.95, 0.7, 1.6, 1.6, 1.6]);
    const cols: Column<SummaryRow>[] = [
      { label: e.rowLabel, width: w[0], value: (r) => (r.sublabel ? [r.label, r.sublabel] : r.label), bold: false },
      { label: 'Clicks', width: w[1], align: 'right', value: (r) => count(r.clicks) },
      { label: 'Completes', width: w[2], align: 'right', value: (r) => count(r.completes) },
      { label: 'Conv. %', width: w[3], align: 'right', value: (r) => `${r.conversion}` },
      { label: 'Terminates', width: w[4], align: 'right', value: (r) => count(r.terminates) },
      { label: 'Quota full', width: w[5], align: 'right', value: (r) => count(r.quotaFull) },
      { label: 'Quality', width: w[6], align: 'right', value: (r) => count(r.qualityFail) },
      { label: 'LOI', width: w[7], align: 'right', value: (r) => (r.medianLoiMinutes == null ? '–' : `${r.medianLoiMinutes}`) },
      { label: 'Revenue', width: w[8], align: 'right', value: (r) => money(r, 'revenue') },
      { label: 'Payout', width: w[9], align: 'right', value: (r) => money(r, 'payout') },
      { label: 'Profit', width: w[10], align: 'right', value: (r) => money(r, 'profit') },
    ];
    table(doc, cols, e.rows, { zebra: true, total: t ? { ...t, label: 'Total', sublabel: null } : undefined });
  }
  doc.moveDown(0.8).font('body').fontSize(7.5).fillColor(MUTED).text('Money is summed in each market’s own currency and never mixed across currencies. Test traffic is not counted.', doc.page.margins.left);
  footer(doc, `${e.title} · generated ${e.generated}`);
  return toBuffer(doc);
}
