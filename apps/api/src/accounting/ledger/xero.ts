import { config } from '../../common/config';
import { Http, PacedClient } from './client';
import { Check, Ledger, LedgerContext, LedgerDoc, LedgerError, Party, Remote } from './types';

/**
 * Xero Accounting API (docs/ACCOUNTING_SYNC.md). Sales invoices are ACCREC invoices and vendor bills
 * are ACCPAY invoices; payments go to the bank account named in the accounting settings. Exchange
 * rates are left to Xero (its daily rate), because Xero and PROJEXA may use different base currencies.
 */

/** Granular scopes, required for Xero apps created from March 2026. XERO_SCOPES overrides for older apps. */
export const xeroScopes = () => config.ledgers.xero?.scopes || 'offline_access accounting.contacts accounting.invoices accounting.payments accounting.settings.read';

export async function xeroTenants(http: Http, apiUrl: string, access: string): Promise<{ tenantId: string; tenantName?: string; tenantType?: string }[]> {
  const res = await http(`${apiUrl}/connections`, { method: 'GET', headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' } });
  if (res.status !== 200) throw new LedgerError(`Xero did not list the connected organisations (${res.status})`, res.status);
  const list = JSON.parse(await res.text()) as { tenantId: string; tenantName?: string; tenantType?: string }[];
  return list.filter((t) => !t.tenantType || t.tenantType === 'ORGANISATION');
}

type Account = { AccountID: string; Code?: string; Name: string; Type: string; Status?: string; EnablePaymentsToAccount?: boolean };
type TaxRate = { Name: string; TaxType: string; EffectiveRate?: number; Status?: string; CanApplyToRevenue?: boolean; CanApplyToExpenses?: boolean };
type XInvoice = { InvoiceID: string; InvoiceNumber?: string; Type: string; Status: string; AmountDue?: number; Contact?: { ContactID: string }; HasErrors?: boolean; ValidationErrors?: { Message: string }[] };

const quote = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const stateOf = (status: string) => (status === 'VOIDED' ? 'void' : status === 'PAID' ? 'paid' : 'open');

export class XeroLedger implements Ledger {
  private base = '';
  private orgName = '';
  private currencies = new Set<string>();
  private accounts: Account[] = [];
  private taxes: TaxRate[] = [];
  private loaded = false;

  constructor(
    private readonly api: PacedClient,
    private readonly apiUrl: string,
    private readonly tenantId: string,
    private readonly ctx: LedgerContext,
  ) {}

  private async call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const r = await this.api.json<T & { Message?: string; Detail?: string; Elements?: { ValidationErrors?: { Message: string }[] }[] }>(method, `${this.apiUrl}/api.xro/2.0${path}`, body, {
      'xero-tenant-id': this.tenantId,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    });
    if (r.status >= 200 && r.status < 300 && r.data) return r.data;
    const d = r.data;
    const detail = d?.Elements?.flatMap((e) => e.ValidationErrors ?? []).map((v) => v.Message).join('; ') || d?.Message || d?.Detail || r.raw.slice(0, 200);
    if (r.status === 403) throw new LedgerError(`Xero refused access${detail ? `: ${detail}` : ''}. Disconnect and connect again to grant the needed permissions.`, 403);
    throw new LedgerError(`Xero: ${detail || `error ${r.status}`}`, r.status);
  }

  async load() {
    if (this.loaded) return;
    const [org, cur, acc, tax] = await Promise.all([
      this.call<{ Organisations: { Name: string; BaseCurrency: string }[] }>('GET', '/Organisation'),
      this.call<{ Currencies: { Code: string }[] }>('GET', '/Currencies'),
      this.call<{ Accounts: Account[] }>('GET', '/Accounts'),
      this.call<{ TaxRates: TaxRate[] }>('GET', '/TaxRates'),
    ]);
    this.orgName = org.Organisations[0]?.Name ?? '';
    this.base = org.Organisations[0]?.BaseCurrency ?? '';
    this.currencies = new Set([this.base, ...cur.Currencies.map((c) => c.Code)]);
    this.accounts = acc.Accounts.filter((a) => a.Status !== 'ARCHIVED');
    this.taxes = tax.TaxRates.filter((t) => t.Status !== 'DELETED' && t.Status !== 'ARCHIVED');
    this.loaded = true;
  }

  private account(codeOrName: string) {
    const k = codeOrName.trim().toLowerCase();
    return this.accounts.find((a) => a.Code?.toLowerCase() === k) ?? this.accounts.find((a) => a.Name.toLowerCase() === k);
  }
  private bank() {
    const a = this.account(this.ctx.cfg.bankAccount);
    if (!a) throw new LedgerError(`No account "${this.ctx.cfg.bankAccount}" in Xero. Change the bank account under Account names.`);
    if (a.Type !== 'BANK' && !a.EnablePaymentsToAccount) throw new LedgerError(`"${a.Name}" in Xero is not a bank account and does not allow payments`);
    return a;
  }
  private taxType(doc: LedgerDoc): string | undefined {
    const sale = doc.kind === 'invoice';
    const fits = (t: TaxRate) => (sale ? t.CanApplyToRevenue !== false : t.CanApplyToExpenses !== false);
    const byName = (n: string | null) => (n ? this.taxes.find((t) => t.Name.toLowerCase() === n.toLowerCase() && fits(t)) : undefined);
    if (!(doc.taxPercent > 0)) return (byName(this.ctx.cfg.xero.noTaxType) ?? this.taxes.find((t) => Number(t.EffectiveRate ?? 0) === 0 && fits(t) && /exempt|no |zero|none/i.test(t.Name)))?.TaxType;
    const same = (t: TaxRate) => Math.abs(Number(t.EffectiveRate ?? -1) - doc.taxPercent) < 0.001;
    const named = byName(doc.taxName) ?? byName(sale ? this.ctx.cfg.xero.salesTaxType : this.ctx.cfg.xero.purchaseTaxType);
    const t = named && same(named) ? named : this.taxes.find((x) => same(x) && fits(x));
    if (!t) throw new LedgerError(`No ${sale ? 'sales' : 'purchase'} tax rate of ${doc.taxPercent}% in Xero. Add it under Settings → Tax rates.`);
    return t.TaxType;
  }
  private currency(code: string) {
    if (!this.currencies.has(code)) throw new LedgerError(`${code} is not a currency in this Xero organisation. Add it under Settings → Currencies (needs a Xero plan with multi-currency).`);
  }

  async test(): Promise<Check[]> {
    const checks: Check[] = [];
    await this.load();
    checks.push({ label: 'Connection', ok: true, detail: `Signed in to ${this.orgName} (${this.base})` });
    const cfg = this.ctx.cfg;
    for (const [label, code] of [['Income account', cfg.xero.incomeCode], ['Expense account', cfg.xero.expenseCode]] as const) {
      const a = this.account(code);
      checks.push({ label, ok: !!a, detail: a ? `${a.Code ?? ''} ${a.Name}`.trim() : `No account with code "${code}". Change the Xero account codes under Account names.` });
    }
    try {
      const b = this.bank();
      checks.push({ label: 'Bank account', ok: true, detail: `"${b.Name}" found` });
    } catch (e) {
      checks.push({ label: 'Bank account', ok: false, detail: (e as Error).message });
    }
    return checks;
  }

  async contact(_kind: 'customer' | 'vendor', p: Party): Promise<{ id: string; created: boolean }> {
    // A Xero contact can be both customer and supplier and use any enabled currency, so one per client or vendor.
    const name = (this.ctx.cfg.partyName === 'code' ? p.code : p.name).slice(0, 255);
    const found = await this.call<{ Contacts: { ContactID: string; Name: string; ContactStatus?: string }[] }>('GET', `/Contacts?where=${encodeURIComponent(`Name=="${quote(name)}"`)}`);
    const hit = found.Contacts.find((c) => c.Name.toLowerCase() === name.toLowerCase() && c.ContactStatus !== 'ARCHIVED');
    if (hit) return { id: hit.ContactID, created: false };
    const r = await this.call<{ Contacts: { ContactID: string }[] }>('POST', '/Contacts', { Contacts: [{ Name: name }] }, `projexa-contact-${p.id}`);
    return { id: r.Contacts[0].ContactID, created: true };
  }

  async find(doc: LedgerDoc, contactId: string): Promise<Remote | null> {
    const r = await this.call<{ Invoices: XInvoice[] }>('GET', `/Invoices?InvoiceNumbers=${encodeURIComponent(doc.number)}`);
    const type = doc.kind === 'invoice' ? 'ACCREC' : 'ACCPAY';
    const hit = r.Invoices.find((i) => i.Type === type && i.InvoiceNumber === doc.number && i.Status !== 'DELETED' && (type === 'ACCREC' || i.Contact?.ContactID === contactId));
    return hit ? { id: hit.InvoiceID, state: stateOf(hit.Status) } : null;
  }

  async create(doc: LedgerDoc, contactId: string): Promise<Remote> {
    this.currency(doc.currency);
    const sale = doc.kind === 'invoice';
    const code = sale ? this.ctx.cfg.xero.incomeCode : this.ctx.cfg.xero.expenseCode;
    if (!this.account(code)) throw new LedgerError(`No account with code "${code}" in Xero. Change the Xero account codes under Account names.`);
    const taxType = this.taxType(doc);
    const lines = doc.lines.map((l, i) => ({
      Description: (i === 0 && !sale && doc.reference ? `${l.description} (vendor invoice ${doc.reference})` : l.description).slice(0, 4000),
      Quantity: l.quantity,
      UnitAmount: l.unitPrice,
      AccountCode: code,
      ...(taxType ? { TaxType: taxType } : {}),
    }));
    const body = {
      Type: sale ? 'ACCREC' : 'ACCPAY',
      Contact: { ContactID: contactId },
      // For bills Xero shows InvoiceNumber as the bill's reference; PROJEXA's number keeps them findable.
      InvoiceNumber: doc.number,
      ...(sale && doc.reference ? { Reference: doc.reference } : {}),
      Date: this.ctx.day(doc.date),
      DueDate: this.ctx.day(doc.dueAt ?? doc.date),
      CurrencyCode: doc.currency,
      LineAmountTypes: 'Exclusive',
      Status: 'AUTHORISED',
      LineItems: lines,
    };
    const r = await this.call<{ Invoices: XInvoice[] }>('POST', '/Invoices', { Invoices: [body] }, `projexa-${doc.kind}-${doc.id}`);
    const i = r.Invoices[0];
    if (i.HasErrors) throw new LedgerError(`Xero: ${i.ValidationErrors?.map((v) => v.Message).join('; ')}`);
    return { id: i.InvoiceID, state: stateOf(i.Status) };
  }

  async void(_doc: LedgerDoc, remote: Remote) {
    const r = await this.call<{ Invoices: XInvoice[] }>('GET', `/Invoices/${remote.id}`);
    const cur = r.Invoices[0];
    if (cur.Status === 'VOIDED' || cur.Status === 'DELETED') return;
    const status = cur.Status === 'DRAFT' || cur.Status === 'SUBMITTED' ? 'DELETED' : 'VOIDED';
    await this.call('POST', `/Invoices/${remote.id}`, { Invoices: [{ InvoiceID: remote.id, Status: status }] });
  }

  async pay(doc: LedgerDoc, remote: Remote): Promise<string | null> {
    const r = await this.call<{ Invoices: XInvoice[] }>('GET', `/Invoices/${remote.id}`);
    const due = Math.round(Number(r.Invoices[0].AmountDue ?? 0) * 100) / 100;
    if (!(due > 0)) return null;
    const bank = this.bank();
    const p = await this.call<{ Payments: { PaymentID: string; HasValidationErrors?: boolean; ValidationErrors?: { Message: string }[] }[] }>(
      'PUT',
      '/Payments',
      { Payments: [{ Invoice: { InvoiceID: remote.id }, Account: { AccountID: bank.AccountID }, Date: this.ctx.day(doc.paidAt ?? new Date()), Amount: due, ...(doc.paymentReference ? { Reference: doc.paymentReference.slice(0, 255) } : {}) }] },
      `projexa-${doc.kind}-payment-${doc.id}`,
    );
    const pay = p.Payments[0];
    if (pay.HasValidationErrors) throw new LedgerError(`Xero: ${pay.ValidationErrors?.map((v) => v.Message).join('; ')}`);
    return pay.PaymentID;
  }
}
