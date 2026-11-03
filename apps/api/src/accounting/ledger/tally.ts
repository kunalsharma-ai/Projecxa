import { build, Doc, MissingRates, party, xml } from '../formats';
import { PacedClient } from './client';
import { Check, Ledger, LedgerContext, LedgerDoc, LedgerError, Party, Remote } from './types';

/**
 * Tally Prime through its XML server (docs/ACCOUNTING_SYNC.md). The same vouchers as the Tally
 * export, posted one document at a time so each gets its own result. Tally has no way to look a
 * voucher up by number here, so PROJEXA relies on what it has sent (LedgerLink).
 */

export interface TallyResult { created: number; altered: number; cancelled: number; errors: number; exceptions: number; lastVoucherId: string | null; lineErrors: string[] }

export function parseTallyResponse(body: string): TallyResult {
  const n = (tag: string) => Number(new RegExp(`<${tag}>\\s*(-?\\d+)\\s*</${tag}>`, 'i').exec(body)?.[1] ?? 0);
  const lineErrors = [...body.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map((m) => m[1].trim()).filter(Boolean);
  const last = /<LASTVCHID>\s*(\d+)\s*<\/LASTVCHID>/i.exec(body)?.[1] ?? null;
  return { created: n('CREATED'), altered: n('ALTERED'), cancelled: n('CANCELLED'), errors: n('ERRORS'), exceptions: n('EXCEPTIONS'), lastVoucherId: last && last !== '0' ? last : null, lineErrors };
}

const envelope = (company: string, report: 'Vouchers' | 'All Masters', messages: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>${report}</REPORTNAME>${company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xml(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : ''}</REQUESTDESC><REQUESTDATA>${messages}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;

export class TallyLedger implements Ledger {
  constructor(
    private readonly api: PacedClient,
    private readonly url: string,
    private readonly ctx: LedgerContext,
  ) {}

  private async post(body: string): Promise<{ status: number; text: string }> {
    let r;
    try {
      r = await this.api.send('POST', this.url, { headers: { 'Content-Type': 'text/xml; charset=utf-8' }, body });
    } catch (e) {
      throw new LedgerError(`Tally Prime could not be reached at ${new URL(this.url).host}: ${(e as Error).message}. Is Tally open with its XML server on?`);
    }
    if (r.status !== 200) throw new LedgerError(`Tally Prime answered ${r.status}`, r.status);
    return { status: r.status, text: r.body };
  }
  private async import(report: 'Vouchers' | 'All Masters', message: string) {
    const r = parseTallyResponse((await this.post(envelope(this.ctx.cfg.tally.company, report, message))).text);
    return r;
  }
  private fail(r: TallyResult, what: string): never {
    throw new LedgerError(`Tally did not accept the ${what}${r.lineErrors.length ? `: ${r.lineErrors.join('; ').slice(0, 400)}` : ` (${r.errors} errors, ${r.exceptions} exceptions)`}`);
  }
  private doc(d: LedgerDoc): Doc {
    return { type: d.kind, number: d.number, date: d.date, dueAt: d.dueAt, status: d.status, party: { name: d.party.name, code: d.party.code }, currency: d.currency, lines: d.lines, subtotal: d.subtotal, taxName: d.taxName, taxPercent: d.taxPercent, taxAmount: d.taxAmount, total: d.total, reference: d.reference, notes: d.notes, paidAt: d.paidAt, paymentReference: d.paymentReference };
  }
  /** The TALLYMESSAGE elements of a one-document export built by the Tally exporter. */
  private messages(kind: 'invoices' | 'bills' | 'payments_received' | 'payments_made', d: LedgerDoc) {
    const cfg = { ...this.ctx.cfg, tally: { ...this.ctx.cfg.tally, includeLedgers: false } };
    let content: string;
    try {
      content = build('tally', kind, [this.doc(d)], { config: cfg, baseCurrency: this.ctx.baseCurrency, rate: this.ctx.rate }).content;
    } catch (e) {
      if (e instanceof MissingRates) throw new LedgerError(e.message);
      throw e;
    }
    return /<REQUESTDATA>([\s\S]*)<\/REQUESTDATA>/.exec(content)?.[1].trim() ?? '';
  }

  async load() {}

  async test(): Promise<Check[]> {
    const company = this.ctx.cfg.tally.company;
    const req = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ProjexaCompanies</ID></HEADER><BODY><DESC><TDL><TDLMESSAGE><COLLECTION NAME="ProjexaCompanies"><TYPE>Company</TYPE><FETCH>NAME</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
    const r = await this.post(req);
    const names = [...r.text.matchAll(/<COMPANY NAME="([^"]*)"/gi)].map((m) => m[1]);
    const checks: Check[] = [{ label: 'Connection', ok: true, detail: `Tally Prime answered at ${new URL(this.url).host}${names.length ? `; open: ${names.join(', ')}` : ''}` }];
    if (company) checks.push({ label: 'Company', ok: !names.length || names.includes(company), detail: names.includes(company) ? `"${company}" is open` : names.length ? `"${company}" is not open in Tally. Open it there or change the company under Account names.` : 'Could not list open companies; vouchers go to the company named in Account names.' });
    else checks.push({ label: 'Company', ok: names.length <= 1, detail: names.length > 1 ? 'Several companies are open. Name the one to use under Account names → Tally company.' : 'Vouchers go to the company open in Tally.' });
    return checks;
  }

  /** Party ledger under Sundry Debtors or Sundry Creditors; "already exists" is fine. */
  async contact(kind: 'customer' | 'vendor', p: Party): Promise<{ id: string; created: boolean }> {
    const c = this.ctx.cfg;
    const name = party({ party: p } as unknown as Doc, c);
    const msg = `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${xml(name)}" ACTION="Create"><NAME>${xml(name)}</NAME><PARENT>${xml(kind === 'customer' ? c.tally.debtorsGroup : c.tally.creditorsGroup)}</PARENT><ISBILLWISEON>Yes</ISBILLWISEON></LEDGER></TALLYMESSAGE>`;
    const r = await this.import('All Masters', msg);
    if (r.created > 0) return { id: name, created: true };
    if (r.lineErrors.some((e) => /already exists/i.test(e)) || (!r.errors && !r.exceptions)) return { id: name, created: false };
    this.fail(r, `ledger "${name}"`);
  }

  async find(): Promise<Remote | null> {
    return null;
  }

  async create(d: LedgerDoc): Promise<Remote> {
    const r = await this.import('Vouchers', this.messages(d.kind === 'invoice' ? 'invoices' : 'bills', d));
    if (r.created < 1 || r.errors || r.exceptions) this.fail(r, `${d.kind === 'invoice' ? 'sales' : 'purchase'} voucher`);
    // The voucher's master id lets a later void find it.
    return { id: r.lastVoucherId ?? `number:${d.number}`, state: 'open' };
  }

  async void(d: LedgerDoc, remote: Remote) {
    if (!/^\d+$/.test(remote.id)) throw new LedgerError('Tally did not report this voucher’s id when it was created. Cancel it in Tally by hand.');
    const vch = d.kind === 'invoice' ? this.ctx.cfg.tally.salesVoucherType : this.ctx.cfg.tally.purchaseVoucherType;
    const msg = `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER TAGNAME="MASTER ID" TAGVALUE="${xml(remote.id)}" VCHTYPE="${xml(vch)}" ACTION="Cancel"><NARRATION>Voided in PROJEXA</NARRATION></VOUCHER></TALLYMESSAGE>`;
    const r = await this.import('Vouchers', msg);
    if (r.cancelled + r.altered < 1 || r.errors || r.exceptions) this.fail(r, 'cancellation');
  }

  async pay(d: LedgerDoc): Promise<string | null> {
    const r = await this.import('Vouchers', this.messages(d.kind === 'invoice' ? 'payments_received' : 'payments_made', d));
    if (r.created < 1 || r.errors || r.exceptions) this.fail(r, `${d.kind === 'invoice' ? 'receipt' : 'payment'} voucher`);
    return r.lastVoucherId ?? `number:${d.number}`;
  }
}
