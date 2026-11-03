import { z } from 'zod';
import { localParts } from '../schedules/schedule.rules';

/** Accounting exports: pure builders that turn invoices and vendor bills into files other systems import. */

export const FORMATS = ['zoho_books', 'tally', 'quickbooks', 'xero', 'journal'] as const;
export type Format = (typeof FORMATS)[number];
export type Kind = 'invoices' | 'bills' | 'both' | 'payments_received' | 'payments_made';
export const PAYMENT_KINDS: Kind[] = ['payments_received', 'payments_made'];

export const FORMAT_INFO: Record<Format, { label: string; kinds: Kind[]; ext: 'csv' | 'xml'; note: string }> = {
  zoho_books: { label: 'Zoho Books', kinds: ['invoices', 'bills', 'payments_received', 'payments_made'], ext: 'csv', note: 'Import in Zoho Books under Sales → Invoices (or Purchases → Bills, Payments Received, Payments Made) → Import. Or sync directly below.' },
  tally: { label: 'Tally Prime', kinds: ['invoices', 'bills', 'both', 'payments_received', 'payments_made'], ext: 'xml', note: 'Sales, Purchase, Receipt and Payment vouchers in the reporting currency. Import in Tally Prime under Import → Transactions.' },
  quickbooks: { label: 'QuickBooks Online', kinds: ['invoices', 'bills'], ext: 'csv', note: 'Invoices import under Settings → Import data → Invoices. Bills use the same layout for bill import tools.' },
  xero: { label: 'Xero', kinds: ['invoices', 'bills'], ext: 'csv', note: 'Xero import templates: Business → Invoices → Import, or Bills to pay → Import.' },
  journal: { label: 'General journal (CSV)', kinds: ['invoices', 'bills', 'both', 'payments_received', 'payments_made'], ext: 'csv', note: 'Double-entry lines (debit and credit) for any accounting system or your accountant.' },
};

const name = z.string().trim().min(1).max(80);
export const DATE_FORMATS = ['yyyy-mm-dd', 'dd/mm/yyyy', 'mm/dd/yyyy'] as const;
export const accountingConfigSchema = z
  .object({
    /** Customer and vendor names in the file: their name, or their code. Must match the contacts in the accounting system. */
    partyName: z.enum(['name', 'code']),
    itemName: name,
    incomeAccount: name,
    expenseAccount: name,
    receivableAccount: name,
    payableAccount: name,
    salesTaxAccount: name,
    purchaseTaxAccount: name,
    /** Bank account payments go into and out of. */
    bankAccount: name,
    paymentMode: name,
    dateFormat: z.enum(DATE_FORMATS),
    timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Unknown timezone'),
    xero: z.object({ incomeCode: name, expenseCode: name, salesTaxType: name, purchaseTaxType: name, noTaxType: name }),
    tally: z.object({ company: z.string().trim().max(120), salesVoucherType: name, purchaseVoucherType: name, receiptVoucherType: name, paymentVoucherType: name, includeLedgers: z.boolean(), debtorsGroup: name, creditorsGroup: name }),
  })
  .strict();
export type AccountingConfig = z.infer<typeof accountingConfigSchema>;

export const DEFAULT_CONFIG: AccountingConfig = {
  partyName: 'name',
  itemName: 'Survey completes',
  incomeAccount: 'Sales',
  expenseAccount: 'Cost of Goods Sold',
  receivableAccount: 'Accounts Receivable',
  payableAccount: 'Accounts Payable',
  salesTaxAccount: 'Output Tax',
  purchaseTaxAccount: 'Input Tax',
  bankAccount: 'Bank',
  paymentMode: 'Bank Transfer',
  dateFormat: 'yyyy-mm-dd',
  timezone: 'Asia/Kolkata',
  xero: { incomeCode: '200', expenseCode: '310', salesTaxType: 'Tax on Sales', purchaseTaxType: 'Tax on Purchases', noTaxType: 'Tax Exempt' },
  tally: { company: '', salesVoucherType: 'Sales', purchaseVoucherType: 'Purchase', receiptVoucherType: 'Receipt', paymentVoucherType: 'Payment', includeLedgers: false, debtorsGroup: 'Sundry Debtors', creditorsGroup: 'Sundry Creditors' },
};

/** Stored config merged over the defaults, so new fields always have a value. */
export function configOf(v: unknown): AccountingConfig {
  const c = (v ?? {}) as Partial<AccountingConfig>;
  return { ...DEFAULT_CONFIG, ...c, xero: { ...DEFAULT_CONFIG.xero, ...c.xero }, tally: { ...DEFAULT_CONFIG.tally, ...c.tally } };
}

export interface DocLine { description: string; quantity: number; unitPrice: number; amount: number }
export interface Doc {
  type: 'invoice' | 'bill';
  number: string;
  date: Date;
  dueAt: Date | null;
  status: string;
  party: { name: string; code: string };
  currency: string;
  lines: DocLine[];
  subtotal: number;
  taxName: string | null;
  taxPercent: number;
  taxAmount: number;
  total: number;
  /** Invoice: project code. Bill: the vendor's own invoice number. */
  reference: string | null;
  notes: string | null;
  /** When it was paid, and the bank or payment reference (payment exports). */
  paidAt?: Date | null;
  paymentReference?: string | null;
}

export interface BuildContext {
  config: AccountingConfig;
  /** For Tally: the reporting currency and a rate from each document currency to it. */
  baseCurrency: string;
  rate: (currency: string) => number | null;
}

export interface Built { content: string; contentType: string; ext: 'csv' | 'xml' }

// ───────────── helpers ─────────────

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // never a spreadsheet formula
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
/** Numbers are written raw (a leading minus is a number, not a formula). */
const num = (n: number) => n.toFixed(2);
const csv = (header: string[], rows: unknown[][]) =>
  `${[header.map(cell).join(','), ...rows.map((r) => r.map((v) => (typeof v === 'number' ? num(v) : cell(v))).join(','))].join('\r\n')}\r\n`;
const qty = (n: number) => String(n);

export function fmtDate(d: Date | null, c: AccountingConfig) {
  if (!d) return '';
  const p = localParts(d, c.timezone);
  const dd = String(p.d).padStart(2, '0');
  const mm = String(p.m).padStart(2, '0');
  return c.dateFormat === 'dd/mm/yyyy' ? `${dd}/${mm}/${p.y}` : c.dateFormat === 'mm/dd/yyyy' ? `${mm}/${dd}/${p.y}` : `${p.y}-${mm}-${dd}`;
}
const party = (d: Doc, c: AccountingConfig) => (c.partyName === 'code' ? d.party.code : d.party.name);
const r2 = (n: number) => Math.round(n * 100) / 100;

// ───────────── Zoho Books ─────────────

function zohoBooks(docs: Doc[], c: AccountingConfig, kind: 'invoices' | 'bills'): string {
  if (kind === 'invoices') {
    const header = ['Invoice Date', 'Invoice Number', 'Invoice Status', 'Customer Name', 'Due Date', 'Currency Code', 'Reference#', 'Item Name', 'Item Desc', 'Quantity', 'Item Price', 'Account', 'Item Tax', 'Item Tax %', 'Notes'];
    return csv(header, docs.flatMap((d) => d.lines.map((l) => [fmtDate(d.date, c), d.number, 'Sent', party(d, c), fmtDate(d.dueAt, c), d.currency, d.reference ?? '', c.itemName, l.description, qty(l.quantity), l.unitPrice, c.incomeAccount, d.taxPercent > 0 ? d.taxName ?? 'Tax' : '', d.taxPercent > 0 ? d.taxPercent : '', d.notes ?? ''])));
  }
  const header = ['Bill Date', 'Bill Number', 'Bill Status', 'Vendor Name', 'Due Date', 'Currency Code', 'Reference Number', 'Item Name', 'Description', 'Quantity', 'Rate', 'Account', 'Tax Name', 'Tax Percentage', 'Notes'];
  return csv(header, docs.flatMap((d) => d.lines.map((l) => [fmtDate(d.date, c), d.number, 'Open', party(d, c), fmtDate(d.dueAt, c), d.currency, d.reference ?? '', c.itemName, l.description, qty(l.quantity), l.unitPrice, c.expenseAccount, d.taxPercent > 0 ? d.taxName ?? 'Tax' : '', d.taxPercent > 0 ? d.taxPercent : '', d.notes ?? ''])));
}

// ───────────── QuickBooks Online ─────────────

function quickbooks(docs: Doc[], c: AccountingConfig, kind: 'invoices' | 'bills'): string {
  if (kind === 'invoices') {
    const header = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Memo', 'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount', 'Taxable', 'TaxRate', 'Currency'];
    return csv(header, docs.flatMap((d) => d.lines.map((l) => [d.number, party(d, c), fmtDate(d.date, c), fmtDate(d.dueAt, c), d.notes ?? d.reference ?? '', c.itemName, l.description, qty(l.quantity), l.unitPrice, l.amount, d.taxPercent > 0 ? 'Y' : 'N', d.taxPercent > 0 ? `${d.taxPercent}%` : '', d.currency])));
  }
  const header = ['BillNo', 'Supplier', 'BillDate', 'DueDate', 'Memo', 'Account', 'LineDescription', 'LineAmount', 'LineTaxCode', 'LineTaxAmount', 'Currency'];
  return csv(header, docs.flatMap((d) => d.lines.map((l, i) => [d.number, party(d, c), fmtDate(d.date, c), fmtDate(d.dueAt, c), d.reference ?? d.notes ?? '', c.expenseAccount, `${l.description} (${qty(l.quantity)} × ${l.unitPrice.toFixed(2)})`, l.amount, d.taxPercent > 0 ? d.taxName ?? 'Tax' : '', i === 0 ? d.taxAmount : 0, d.currency])));
}

// ───────────── Xero ─────────────

const XERO_HEADER = ['*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4', 'POCity', 'PORegion', 'POPostalCode', 'POCountry', '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate', 'Total', 'InventoryItemCode', '*Description', '*Quantity', '*UnitAmount', 'Discount', '*AccountCode', '*TaxType', 'TaxAmount', 'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency'];

function xero(docs: Doc[], c: AccountingConfig, kind: 'invoices' | 'bills'): string {
  const account = kind === 'invoices' ? c.xero.incomeCode : c.xero.expenseCode;
  const taxType = kind === 'invoices' ? c.xero.salesTaxType : c.xero.purchaseTaxType;
  return csv(
    XERO_HEADER,
    docs.flatMap((d) =>
      d.lines.map((l, i) => [
        party(d, c), '', '', '', '', '', '', '', '', '',
        d.number, d.reference ?? '', fmtDate(d.date, c), fmtDate(d.dueAt ?? d.date, c), i === 0 ? d.total : '', '',
        l.description, qty(l.quantity), l.unitPrice, '', account, d.taxPercent > 0 ? taxType : c.xero.noTaxType,
        d.taxPercent > 0 ? r2(d.taxAmount * (d.subtotal ? l.amount / d.subtotal : 0)) : '', '', '', '', '', d.currency,
      ]),
    ),
  );
}

// ───────────── General journal ─────────────

function journal(docs: Doc[], c: AccountingConfig): string {
  const header = ['Date', 'Type', 'Number', 'Party', 'Account', 'Debit', 'Credit', 'Currency', 'Description', 'Reference'];
  const rows: unknown[][] = [];
  for (const d of docs) {
    const base = [fmtDate(d.date, c), d.type === 'invoice' ? 'Sales invoice' : 'Vendor bill', d.number, party(d, c)];
    const tail = [d.currency, d.type === 'invoice' ? `Invoice ${d.number} to ${d.party.name}` : `Bill ${d.number} from ${d.party.name}`, d.reference ?? ''];
    const line = (account: string, debit: number, credit: number) => rows.push([...base, account, debit ? debit : '', credit ? credit : '', ...tail]);
    if (d.type === 'invoice') {
      line(c.receivableAccount, d.total, 0);
      line(c.incomeAccount, 0, d.subtotal);
      if (d.taxAmount) line(c.salesTaxAccount, 0, d.taxAmount);
    } else {
      line(c.expenseAccount, d.subtotal, 0);
      if (d.taxAmount) line(c.purchaseTaxAccount, d.taxAmount, 0);
      line(c.payableAccount, 0, d.total);
    }
  }
  return csv(header, rows);
}

// ───────────── Tally Prime ─────────────

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const tallyDate = (d: Date, c: AccountingConfig) => {
  const p = localParts(d, c.timezone);
  return `${p.y}${String(p.m).padStart(2, '0')}${String(p.d).padStart(2, '0')}`;
};

export class MissingRates extends Error {
  constructor(public currencies: string[]) {
    super(`Add an exchange rate for ${currencies.join(', ')} in Settings → Finance first. Tally gets amounts in the reporting currency.`);
  }
}

function tally(docs: Doc[], ctx: BuildContext): string {
  const c = ctx.config;
  const missing = [...new Set(docs.map((d) => d.currency).filter((cur) => cur !== ctx.baseCurrency && ctx.rate(cur) == null))];
  if (missing.length) throw new MissingRates(missing);
  // Tally: negative amount = debit, positive = credit.
  const entry = (ledger: string, amount: number) =>
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${amount < 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amount.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
  const messages: string[] = [];
  if (c.tally.includeLedgers) {
    const seen = new Set<string>();
    for (const d of docs) {
      const n = party(d, c);
      const key = `${d.type}:${n}`;
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push(`<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${xml(n)}" ACTION="Create"><NAME>${xml(n)}</NAME><PARENT>${xml(d.type === 'invoice' ? c.tally.debtorsGroup : c.tally.creditorsGroup)}</PARENT><ISBILLWISEON>Yes</ISBILLWISEON></LEDGER></TALLYMESSAGE>`);
    }
  }
  for (const d of docs) {
    const rate = d.currency === ctx.baseCurrency ? 1 : ctx.rate(d.currency)!;
    const sub = r2(d.subtotal * rate);
    const tax = r2(d.taxAmount * rate);
    const total = r2(sub + tax);
    const p = party(d, c);
    const sale = d.type === 'invoice';
    const vchType = sale ? c.tally.salesVoucherType : c.tally.purchaseVoucherType;
    const narration = `${sale ? 'Invoice' : 'Bill'} ${d.number}${d.reference ? ` (${d.reference})` : ''}${rate !== 1 ? `: ${d.currency} ${d.total.toFixed(2)} at ${rate} ${ctx.baseCurrency}` : ''}`;
    const entries = sale
      ? [entry(p, -total), entry(c.incomeAccount, sub), ...(tax ? [entry(c.salesTaxAccount, tax)] : [])]
      : [entry(p, total), entry(c.expenseAccount, -sub), ...(tax ? [entry(c.purchaseTaxAccount, -tax)] : [])];
    messages.push(
      `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${xml(vchType)}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${tallyDate(d.date, c)}</DATE><VOUCHERTYPENAME>${xml(vchType)}</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(d.number)}</VOUCHERNUMBER>${!sale && d.reference ? `<REFERENCE>${xml(d.reference)}</REFERENCE>` : ''}<PARTYLEDGERNAME>${xml(p)}</PARTYLEDGERNAME><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>${xml(narration)}</NARRATION>${entries.join('')}</VOUCHER></TALLYMESSAGE>`,
    );
  }
  const company = c.tally.company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xml(c.tally.company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${company}</REQUESTDESC><REQUESTDATA>\n${messages.join('\n')}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
}

// ───────────── Payments ─────────────

const payDate = (d: Doc) => d.paidAt ?? d.date;

function zohoPayments(docs: Doc[], c: AccountingConfig, kind: 'payments_received' | 'payments_made'): string {
  if (kind === 'payments_received') {
    const header = ['Date', 'Customer Name', 'Payment Mode', 'Deposit To', 'Amount', 'Reference Number', 'Invoice Number', 'Amount Applied to Invoice', 'Currency Code', 'Description'];
    return csv(header, docs.map((d) => [fmtDate(payDate(d), c), party(d, c), c.paymentMode, c.bankAccount, d.total, d.paymentReference ?? '', d.number, d.total, d.currency, `Payment for ${d.number}`]));
  }
  const header = ['Date', 'Vendor Name', 'Payment Mode', 'Paid Through', 'Amount', 'Reference Number', 'Bill Number', 'Amount Applied to Bill', 'Currency Code', 'Description'];
  return csv(header, docs.map((d) => [fmtDate(payDate(d), c), party(d, c), c.paymentMode, c.bankAccount, d.total, d.paymentReference ?? '', d.number, d.total, d.currency, `Payment for ${d.number}${d.reference ? ` (${d.reference})` : ''}`]));
}

function journalPayments(docs: Doc[], c: AccountingConfig, kind: 'payments_received' | 'payments_made'): string {
  const header = ['Date', 'Type', 'Number', 'Party', 'Account', 'Debit', 'Credit', 'Currency', 'Description', 'Reference'];
  const rows: unknown[][] = [];
  for (const d of docs) {
    const base = [fmtDate(payDate(d), c), kind === 'payments_received' ? 'Payment received' : 'Payment made', d.number, party(d, c)];
    const tail = [d.currency, `Payment for ${d.number}`, d.paymentReference ?? ''];
    if (kind === 'payments_received') {
      rows.push([...base, c.bankAccount, d.total, '', ...tail], [...base, c.receivableAccount, '', d.total, ...tail]);
    } else {
      rows.push([...base, c.payableAccount, d.total, '', ...tail], [...base, c.bankAccount, '', d.total, ...tail]);
    }
  }
  return csv(header, rows);
}

function tallyPayments(docs: Doc[], ctx: BuildContext, kind: 'payments_received' | 'payments_made'): string {
  const c = ctx.config;
  const missing = [...new Set(docs.map((d) => d.currency).filter((cur) => cur !== ctx.baseCurrency && ctx.rate(cur) == null))];
  if (missing.length) throw new MissingRates(missing);
  const entry = (ledger: string, amount: number) =>
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${amount < 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amount.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
  const received = kind === 'payments_received';
  const vchType = received ? c.tally.receiptVoucherType : c.tally.paymentVoucherType;
  const messages = docs.map((d) => {
    const rate = d.currency === ctx.baseCurrency ? 1 : ctx.rate(d.currency)!;
    const amount = r2(d.total * rate);
    const p = party(d, c);
    const narration = `Payment for ${d.number}${d.paymentReference ? `, ref ${d.paymentReference}` : ''}${rate !== 1 ? `: ${d.currency} ${d.total.toFixed(2)} at ${rate} ${ctx.baseCurrency}` : ''}`;
    // Receipt: bank debit, client credit. Payment: vendor debit, bank credit.
    const entries = received ? [entry(c.bankAccount, -amount), entry(p, amount)] : [entry(p, -amount), entry(c.bankAccount, amount)];
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${xml(vchType)}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${tallyDate(payDate(d), c)}</DATE><VOUCHERTYPENAME>${xml(vchType)}</VOUCHERTYPENAME>${d.paymentReference ? `<REFERENCE>${xml(d.paymentReference)}</REFERENCE>` : ''}<PARTYLEDGERNAME>${xml(p)}</PARTYLEDGERNAME><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><NARRATION>${xml(narration)}</NARRATION>${entries.join('')}</VOUCHER></TALLYMESSAGE>`;
  });
  const company = c.tally.company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xml(c.tally.company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${company}</REQUESTDESC><REQUESTDATA>\n${messages.join('\n')}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
}

/** Builds the file. `docs` are already filtered to the kind (Tally and journal may mix invoices and bills). */
export function build(format: Format, kind: Kind, docs: Doc[], ctx: BuildContext): Built {
  const info = FORMAT_INFO[format];
  if (!info.kinds.includes(kind)) throw new Error(`${info.label} exports invoices and bills as separate files`);
  if (kind === 'payments_received' || kind === 'payments_made') {
    const content = format === 'zoho_books' ? zohoPayments(docs, ctx.config, kind) : format === 'journal' ? journalPayments(docs, ctx.config, kind) : tallyPayments(docs, ctx, kind);
    return { content, contentType: info.ext === 'xml' ? 'application/xml; charset=utf-8' : 'text/csv; charset=utf-8', ext: info.ext };
  }
  const one = kind as 'invoices' | 'bills';
  const content =
    format === 'zoho_books' ? zohoBooks(docs, ctx.config, one)
      : format === 'quickbooks' ? quickbooks(docs, ctx.config, one)
        : format === 'xero' ? xero(docs, ctx.config, one)
          : format === 'journal' ? journal(docs, ctx.config)
            : tally(docs, ctx);
  return { content, contentType: info.ext === 'xml' ? 'application/xml; charset=utf-8' : 'text/csv; charset=utf-8', ext: info.ext };
}
