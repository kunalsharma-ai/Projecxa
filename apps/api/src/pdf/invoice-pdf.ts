import { amount, BRAND, footer, INK, LINE, MUTED, newDoc, table, toBuffer, widths } from './pdf';

/** What the seller prints on its invoices (Settings → Finance → Invoice details). */
export interface InvoiceProfile {
  legalName: string | null;
  address: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  bankDetails: string | null;
  footer: string | null;
}
export const EMPTY_PROFILE: InvoiceProfile = { legalName: null, address: null, taxId: null, email: null, phone: null, bankDetails: null, footer: null };

export interface InvoicePdfInput {
  org: string;
  profile: InvoiceProfile;
  number: string;
  status: string;
  currency: string;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  client: { name: string; code: string; billingAddress: string | null; taxId: string | null };
  project: { code: string; name: string; workOrderNo: string | null };
  lines: { description: string; countryCode: string | null; quantity: number; unitPrice: number; amount: number }[];
  subtotal: number;
  taxName: string | null;
  taxPercent: number;
  taxAmount: number;
  total: number;
  notes: string | null;
}

const STAMP: Record<string, string> = { DRAFT: 'DRAFT', VOID: 'VOID', PAID: 'PAID' };

export async function renderInvoicePdf(e: InvoicePdfInput): Promise<Buffer> {
  const p = e.profile;
  const seller = p.legalName || e.org;
  const doc = newDoc({ title: `Invoice ${e.number}`, author: seller });
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const top = doc.y;

  // Seller, top left.
  doc.font('bold').fontSize(14).fillColor(INK).text(seller, left, top, { width: 280 });
  doc.font('body').fontSize(8.5).fillColor(MUTED);
  for (const l of [p.address, p.taxId && `Tax ID: ${p.taxId}`, [p.email, p.phone].filter(Boolean).join(' · ')].filter(Boolean) as string[]) doc.text(l, { width: 280 });
  const sellerBottom = doc.y;

  // Title and numbers, top right.
  doc.font('bold').fontSize(22).fillColor(BRAND).text('INVOICE', right - 220, top, { width: 220, align: 'right' });
  const meta: [string, string][] = [['Number', e.number], ['Date', e.issuedAt ?? '–'], ['Due', e.dueAt ?? '–'], ...(e.paidAt ? [['Paid', `${e.paidAt}${e.paymentReference ? ` (${e.paymentReference})` : ''}`] as [string, string]] : [])];
  doc.moveDown(0.3);
  for (const [k, v] of meta) {
    const y = doc.y;
    doc.font('body').fontSize(8.5).fillColor(MUTED).text(k, right - 220, y, { width: 80 });
    doc.font('bold').fillColor(INK).text(v, right - 140, y, { width: 140, align: 'right' });
  }
  doc.y = Math.max(sellerBottom, doc.y) + 20;

  // Bill to, and what it is for.
  const y0 = doc.y;
  doc.font('body').fontSize(7.5).fillColor(MUTED).text('BILL TO', left, y0);
  doc.font('bold').fontSize(10).fillColor(INK).text(e.client.name, left, doc.y + 2, { width: 250 });
  doc.font('body').fontSize(8.5).fillColor(MUTED);
  for (const l of [e.client.billingAddress, e.client.taxId && `Tax ID: ${e.client.taxId}`].filter(Boolean) as string[]) doc.text(l, { width: 250 });
  const billBottom = doc.y;
  doc.font('body').fontSize(7.5).fillColor(MUTED).text('FOR', right - 240, y0, { width: 240 });
  doc.font('bold').fontSize(10).fillColor(INK).text(`${e.project.code} · ${e.project.name}`, right - 240, doc.y + 2, { width: 240 });
  if (e.project.workOrderNo) doc.font('body').fontSize(8.5).fillColor(MUTED).text(`Work order ${e.project.workOrderNo}`, right - 240, doc.y, { width: 240 });
  doc.y = Math.max(billBottom, doc.y) + 18;
  doc.x = left;

  // Lines.
  const w = widths(doc, [4, 1, 1, 1.4, 1.6]);
  type L = InvoicePdfInput['lines'][number];
  table<L>(doc, [
    { label: 'Description', width: w[0], value: (l) => l.description },
    { label: 'Market', width: w[1], value: (l) => l.countryCode ?? '' },
    { label: 'Quantity', width: w[2], align: 'right', value: (l) => l.quantity.toLocaleString('en-US') },
    { label: `Unit price (${e.currency})`, width: w[3], align: 'right', value: (l) => amount(l.unitPrice) },
    { label: `Amount (${e.currency})`, width: w[4], align: 'right', value: (l) => amount(l.amount) },
  ], e.lines);

  // Totals.
  doc.moveDown(0.6);
  const sums: [string, string, boolean][] = [
    ['Subtotal', amount(e.subtotal), false],
    ...(e.taxPercent > 0 ? [[`${e.taxName ?? 'Tax'} (${e.taxPercent}%)`, amount(e.taxAmount), false] as [string, string, boolean]] : []),
    [`Total (${e.currency})`, amount(e.total), true],
  ];
  if (doc.y + sums.length * 18 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  for (const [k, v, strong] of sums) {
    const y = doc.y;
    if (strong) doc.moveTo(right - 240, y - 2).lineTo(right, y - 2).lineWidth(0.75).strokeColor(LINE).stroke();
    doc.font(strong ? 'bold' : 'body').fontSize(strong ? 11 : 9).fillColor(INK);
    doc.text(k, right - 240, y + 2, { width: 130 });
    doc.text(v, right - 110, y + 2, { width: 110, align: 'right' });
    doc.y = y + (strong ? 20 : 16);
  }
  doc.x = left;

  const block = (title: string, body: string | null) => {
    if (!body) return;
    doc.moveDown(0.8);
    doc.font('bold').fontSize(7.5).fillColor(MUTED).text(title.toUpperCase(), left);
    doc.font('body').fontSize(8.5).fillColor(INK).text(body, left, doc.y + 2, { width: right - left });
  };
  block('Notes', e.notes);
  block('Payment details', p.bankDetails);

  const stamp = STAMP[e.status];
  if (stamp) {
    doc.switchToPage(doc.bufferedPageRange().start);
    doc.save();
    doc.rotate(-20, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('bold').fontSize(90).fillColor(stamp === 'PAID' ? '#16a34a' : '#dc2626').fillOpacity(0.12).text(stamp, 0, doc.page.height / 2 - 50, { width: doc.page.width, align: 'center', lineBreak: false });
    doc.restore();
    doc.fillOpacity(1);
  }
  footer(doc, p.footer || `${seller} · Invoice ${e.number}`);
  return toBuffer(doc);
}
