import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';

/**
 * Small layout helpers over pdfkit for PROJEXA's PDFs (reports, invoices). Text uses DejaVu Sans,
 * shipped in apps/api/assets/fonts, so names in most scripts render; PDF_FONT_DIR overrides.
 */

export type Doc = PDFKit.PDFDocument;

let fontDir: string | null | undefined;
function fonts(): string | null {
  if (fontDir !== undefined) return fontDir;
  const candidates = [process.env.PDF_FONT_DIR, join(process.cwd(), 'assets/fonts'), join(process.cwd(), 'apps/api/assets/fonts'), join(__dirname, '../../assets/fonts'), join(__dirname, '../../../assets/fonts'), '/usr/share/fonts/truetype/dejavu'].filter(Boolean) as string[];
  fontDir = candidates.find((d) => existsSync(join(d, 'DejaVuSans.ttf'))) ?? null;
  return fontDir;
}

export const INK = '#111827';
export const MUTED = '#6b7280';
export const LINE = '#e5e7eb';
export const BRAND = '#1d4ed8';

export function newDoc(opts: { landscape?: boolean; title: string; author: string }): Doc {
  const doc = new PDFDocument({ size: 'A4', layout: opts.landscape ? 'landscape' : 'portrait', margin: 40, bufferPages: true, info: { Title: opts.title, Author: opts.author, Creator: 'PROJEXA' } });
  const dir = fonts();
  if (dir) {
    doc.registerFont('body', join(dir, 'DejaVuSans.ttf'));
    doc.registerFont('bold', join(dir, 'DejaVuSans-Bold.ttf'));
  } else {
    doc.registerFont('body', 'Helvetica');
    doc.registerFont('bold', 'Helvetica-Bold');
  }
  doc.font('body').fontSize(9).fillColor(INK);
  return doc;
}

export function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** "Page 1 of 3" and a line of text at the foot of every page. */
export function footer(doc: Doc, text: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 28;
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing inside the margin must not add a page
    doc.font('body').fontSize(7.5).fillColor(MUTED);
    doc.text(text, 40, y, { width: doc.page.width - 160, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, doc.page.width - 120, y, { width: 80, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

export interface Column<T> {
  label: string;
  width: number;
  align?: 'left' | 'right';
  /** One string, or several lines (for example one per currency). */
  value: (row: T) => string | string[];
  bold?: boolean;
}

/** A table that continues on new pages and repeats its header. */
export function table<T>(doc: Doc, cols: Column<T>[], rows: T[], opts: { zebra?: boolean; total?: T } = {}) {
  const x0 = doc.page.margins.left;
  const pad = 4;
  const header = () => {
    let x = x0;
    const y = doc.y;
    doc.font('bold').fontSize(7.5).fillColor(MUTED);
    const h = Math.max(...cols.map((c) => doc.heightOfString(c.label.toUpperCase(), { width: c.width - pad * 2 }))) + pad * 2;
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x + pad, y + pad, { width: c.width - pad * 2, align: c.align ?? 'left' });
      x += c.width;
    }
    doc.moveTo(x0, y + h).lineTo(x, y + h).lineWidth(1).strokeColor('#d1d5db').stroke();
    doc.y = y + h;
  };
  const line = (r: T, i: number, strong: boolean) => {
    const cells = cols.map((c) => {
      const v = c.value(r);
      return Array.isArray(v) ? v.join('\n') : v;
    });
    doc.font(strong ? 'bold' : 'body').fontSize(8.5);
    const h = Math.max(...cells.map((t, k) => doc.heightOfString(t || ' ', { width: cols[k].width - pad * 2 }))) + pad * 2;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      header();
    }
    const y = doc.y;
    const width = cols.reduce((t, c) => t + c.width, 0);
    if (opts.zebra && i % 2 === 1 && !strong) doc.rect(x0, y, width, h).fill('#f9fafb');
    let x = x0;
    cols.forEach((c, k) => {
      doc.font(strong || c.bold ? 'bold' : 'body').fontSize(8.5).fillColor(INK);
      doc.text(cells[k], x + pad, y + pad, { width: c.width - pad * 2, align: c.align ?? 'left' });
      x += c.width;
    });
    doc.moveTo(x0, y + h).lineTo(x0 + width, y + h).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y = y + h;
  };
  header();
  rows.forEach((r, i) => line(r, i, false));
  if (opts.total) line(opts.total, 0, true);
  doc.x = x0;
}

/** Fit columns given as relative weights into the page width. */
export function widths(doc: Doc, weights: number[]): number[] {
  const total = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.floor((w / sum) * total));
}

export const amount = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const count = (n: number) => n.toLocaleString('en-US');
/** Safe for a Content-Disposition file name. */
export const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'document';
