import { Http, PacedClient } from './client';
import { Check, Ledger, LedgerContext, LedgerDoc, LedgerError, Party, Remote } from './types';

/**
 * QuickBooks Online Accounting API (docs/ACCOUNTING_SYNC.md). Invoices use the service item named in
 * the accounting settings (created if missing), bills post to the expense account, payments to the
 * bank account. QuickBooks has no void for bills, so a voided bill is deleted there.
 */

export async function quickBooksCompany(http: Http, apiUrl: string, minor: string, realm: string, access: string): Promise<string | null> {
  const res = await http(`${apiUrl}/v3/company/${encodeURIComponent(realm)}/companyinfo/${encodeURIComponent(realm)}?minorversion=${minor}`, { method: 'GET', headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' } });
  if (res.status !== 200) return null;
  const j = JSON.parse(await res.text()) as { CompanyInfo?: { CompanyName?: string } };
  return j.CompanyInfo?.CompanyName ?? null;
}

type Ref = { value: string; name?: string };
type Account = { Id: string; Name: string; FullyQualifiedName?: string; AccountType: string; Active?: boolean };
type Fault = { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } };
type Txn = { Id: string; SyncToken: string; DocNumber?: string; Balance?: number; TotalAmt?: number; CustomerRef?: Ref; VendorRef?: Ref; CurrencyRef?: Ref };

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const DUPLICATE_NAME = '6240';

export class QuickBooksLedger implements Ledger {
  private home = '';
  private company = '';
  private multiCurrency = false;
  private accounts: Account[] = [];
  private taxCodes: { Id: string; Name: string }[] = [];
  private itemId: string | null = null;
  private loaded = false;

  constructor(
    private readonly api: PacedClient,
    private readonly apiUrl: string,
    private readonly minor: string,
    private readonly realm: string,
    private readonly ctx: LedgerContext,
  ) {}

  private url(path: string, params: Record<string, string> = {}) {
    const p = new URLSearchParams({ ...params, minorversion: this.minor });
    return `${this.apiUrl}/v3/company/${encodeURIComponent(this.realm)}${path}?${p}`;
  }
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, params: Record<string, string> = {}): Promise<T> {
    const r = await this.api.json<T & Fault>(method, this.url(path, params), body);
    if (r.status >= 200 && r.status < 300 && r.data && !r.data.Fault) return r.data;
    const errs = r.data?.Fault?.Error ?? [];
    const msg = errs.map((e) => [e.Message, e.Detail].filter(Boolean).join(': ')).join('; ') || r.raw.slice(0, 200) || `error ${r.status}`;
    const err = new LedgerError(`QuickBooks: ${msg}`, r.status);
    (err as LedgerError & { code?: string }).code = errs[0]?.code;
    throw err;
  }
  private async query<T>(sql: string): Promise<T[]> {
    const r = await this.call<{ QueryResponse: Record<string, T[] | number | undefined> }>('GET', '/query', undefined, { query: sql });
    const v = Object.values(r.QueryResponse ?? {}).find(Array.isArray);
    return (v as T[] | undefined) ?? [];
  }

  async load() {
    if (this.loaded) return;
    const [info, prefs, accounts, taxCodes] = await Promise.all([
      this.call<{ CompanyInfo: { CompanyName: string } }>('GET', `/companyinfo/${encodeURIComponent(this.realm)}`),
      this.call<{ Preferences: { CurrencyPrefs?: { MultiCurrencyEnabled?: boolean; HomeCurrency?: Ref } } }>('GET', '/preferences'),
      this.query<Account>('select * from Account where Active = true maxresults 1000'),
      this.query<{ Id: string; Name: string; Active?: boolean }>('select * from TaxCode maxresults 1000').catch(() => []),
    ]);
    this.company = info.CompanyInfo.CompanyName;
    this.multiCurrency = !!prefs.Preferences.CurrencyPrefs?.MultiCurrencyEnabled;
    this.home = prefs.Preferences.CurrencyPrefs?.HomeCurrency?.value ?? '';
    this.accounts = accounts;
    this.taxCodes = taxCodes.filter((t) => t.Active !== false);
    this.loaded = true;
  }

  private account(name: string, types?: string[]) {
    const k = name.trim().toLowerCase();
    const ok = (a: Account) => !types || types.includes(a.AccountType);
    return this.accounts.find((a) => ok(a) && a.Name.toLowerCase() === k) ?? this.accounts.find((a) => ok(a) && a.FullyQualifiedName?.toLowerCase() === k);
  }
  private need(name: string, what: string, types?: string[]) {
    const a = this.account(name, types);
    if (!a) throw new LedgerError(`No ${what} named "${name}" in QuickBooks. Change it under Account names.`);
    return a;
  }
  private currency(doc: LedgerDoc) {
    if (doc.currency === this.home) return {};
    if (!this.multiCurrency) throw new LedgerError(`${doc.currency} documents need multicurrency turned on in QuickBooks (home currency is ${this.home})`);
    // ExchangeRate is home-currency units per unit of the document currency: SampTrek's rate, when both use the same base.
    const rate = this.ctx.baseCurrency === this.home ? this.ctx.rate(doc.currency) : null;
    return { CurrencyRef: { value: doc.currency }, ...(rate ? { ExchangeRate: rate } : {}) };
  }
  private taxCode(doc: LedgerDoc) {
    if (!(doc.taxPercent > 0)) return {};
    const name = doc.taxName?.trim().toLowerCase();
    const t = name ? this.taxCodes.find((x) => x.Name.toLowerCase() === name) : undefined;
    if (!t) throw new LedgerError(`Taxed documents need a QuickBooks tax code with the same name as the tax${doc.taxName ? ` ("${doc.taxName}")` : ''}. Create it in QuickBooks or rename the tax in SampTrek.`);
    return { TaxCodeRef: { value: t.Id } };
  }
  private async item() {
    if (this.itemId) return this.itemId;
    const name = this.ctx.cfg.itemName;
    const found = await this.query<{ Id: string; Name: string }>(`select * from Item where Name = '${q(name)}'`);
    if (found[0]) return (this.itemId = found[0].Id);
    const income = this.need(this.ctx.cfg.incomeAccount, 'income account', ['Income', 'Other Income']);
    const r = await this.call<{ Item: { Id: string } }>('POST', '/item', { Name: name.slice(0, 100), Type: 'Service', IncomeAccountRef: { value: income.Id } });
    return (this.itemId = r.Item.Id);
  }

  async test(): Promise<Check[]> {
    await this.load();
    const checks: Check[] = [{ label: 'Connection', ok: true, detail: `Signed in to ${this.company} (${this.home}${this.multiCurrency ? ', multicurrency on' : ''})` }];
    const cfg = this.ctx.cfg;
    for (const [label, name, types] of [['Income account', cfg.incomeAccount, ['Income', 'Other Income']], ['Expense account', cfg.expenseAccount, ['Expense', 'Cost of Goods Sold', 'Other Expense']], ['Bank account', cfg.bankAccount, ['Bank']]] as const) {
      const a = this.account(name, [...types]);
      checks.push({ label, ok: !!a, detail: a ? `"${a.Name}" found` : `No ${label.toLowerCase()} named "${name}". Change it under Account names.` });
    }
    return checks;
  }

  async contact(kind: 'customer' | 'vendor', p: Party, currency: string): Promise<{ id: string; created: boolean }> {
    const base = (this.ctx.cfg.partyName === 'code' ? p.code : p.name).slice(0, 80);
    // A QuickBooks customer or vendor has one currency; names are unique across customers, vendors and employees.
    const name = currency === this.home || !this.multiCurrency ? base : `${base} (${currency})`;
    const entity = kind === 'customer' ? 'Customer' : 'Vendor';
    const names = [name, `${name} (${kind === 'customer' ? 'client' : 'vendor'})`];
    for (const n of names) {
      const hit = (await this.query<{ Id: string; DisplayName: string; CurrencyRef?: Ref }>(`select * from ${entity} where DisplayName = '${q(n)}'`))[0];
      if (hit) {
        if (hit.CurrencyRef?.value && hit.CurrencyRef.value !== currency && this.multiCurrency) throw new LedgerError(`"${n}" is in QuickBooks with currency ${hit.CurrencyRef.value}, not ${currency}`);
        return { id: hit.Id, created: false };
      }
    }
    for (const n of names) {
      try {
        const r = await this.call<Record<string, { Id: string }>>('POST', `/${entity.toLowerCase()}`, { DisplayName: n, ...(this.multiCurrency ? { CurrencyRef: { value: currency } } : {}) });
        return { id: r[entity].Id, created: true };
      } catch (e) {
        // The plain name may belong to the other side (a client that is also a vendor): use the suffixed one.
        if ((e as { code?: string }).code !== DUPLICATE_NAME || n !== names[0]) throw e;
      }
    }
    throw new LedgerError(`Could not create "${name}" in QuickBooks`);
  }

  async find(doc: LedgerDoc, contactId: string): Promise<Remote | null> {
    const entity = doc.kind === 'invoice' ? 'Invoice' : 'Bill';
    const rows = await this.query<Txn>(`select * from ${entity} where DocNumber = '${q(doc.number.slice(0, 21))}'`);
    const hit = rows.find((t) => doc.kind === 'invoice' || t.VendorRef?.value === contactId);
    return hit ? { id: hit.Id, state: Number(hit.Balance ?? 1) === 0 && Number(hit.TotalAmt ?? 0) > 0 ? 'paid' : 'open' } : null;
  }

  async create(doc: LedgerDoc, contactId: string): Promise<Remote> {
    if (doc.number.length > 21) throw new LedgerError('QuickBooks numbers are at most 21 characters');
    const tax = this.taxCode(doc);
    const common = {
      DocNumber: doc.number,
      TxnDate: this.ctx.day(doc.date),
      ...(doc.dueAt ? { DueDate: this.ctx.day(doc.dueAt) } : {}),
      ...this.currency(doc),
      ...(doc.notes || doc.reference ? { PrivateNote: [doc.reference && (doc.kind === 'invoice' ? `Project ${doc.reference}` : `Vendor invoice ${doc.reference}`), doc.notes].filter(Boolean).join('. ').slice(0, 4000) } : {}),
    };
    if (doc.kind === 'invoice') {
      const item = await this.item();
      const r = await this.call<{ Invoice: Txn }>('POST', '/invoice', {
        CustomerRef: { value: contactId },
        ...common,
        Line: doc.lines.map((l) => ({ DetailType: 'SalesItemLineDetail', Amount: Math.round(l.quantity * l.unitPrice * 100) / 100, Description: l.description.slice(0, 4000), SalesItemLineDetail: { ItemRef: { value: item }, Qty: l.quantity, UnitPrice: l.unitPrice, ...tax } })),
      }, { requestid: `inv-${doc.id}`.slice(0, 50) });
      return { id: r.Invoice.Id, state: 'open' };
    }
    const expense = this.need(this.ctx.cfg.expenseAccount, 'expense account', ['Expense', 'Cost of Goods Sold', 'Other Expense']);
    const r = await this.call<{ Bill: Txn }>('POST', '/bill', {
      VendorRef: { value: contactId },
      ...common,
      Line: doc.lines.map((l) => ({ DetailType: 'AccountBasedExpenseLineDetail', Amount: Math.round(l.quantity * l.unitPrice * 100) / 100, Description: l.description.slice(0, 4000), AccountBasedExpenseLineDetail: { AccountRef: { value: expense.Id }, ...tax } })),
    }, { requestid: `bill-${doc.id}`.slice(0, 50) });
    return { id: r.Bill.Id, state: 'open' };
  }

  async void(doc: LedgerDoc, remote: Remote) {
    if (doc.kind === 'invoice') {
      const cur = (await this.call<{ Invoice: Txn }>('GET', `/invoice/${remote.id}`)).Invoice;
      await this.call('POST', '/invoice', { Id: cur.Id, SyncToken: cur.SyncToken }, { operation: 'void' });
      return;
    }
    const cur = (await this.call<{ Bill: Txn }>('GET', `/bill/${remote.id}`)).Bill;
    if (Number(cur.Balance ?? 0) < Number(cur.TotalAmt ?? 0)) throw new LedgerError('This bill has payments in QuickBooks. Remove them there first; QuickBooks cannot void a bill.');
    await this.call('POST', '/bill', { Id: cur.Id, SyncToken: cur.SyncToken }, { operation: 'delete' });
  }

  async pay(doc: LedgerDoc, remote: Remote, contactId: string): Promise<string | null> {
    const bank = this.need(this.ctx.cfg.bankAccount, 'bank account', ['Bank']);
    const date = this.ctx.day(doc.paidAt ?? new Date());
    const ref = doc.paymentReference?.slice(0, 21);
    if (doc.kind === 'invoice') {
      const inv = (await this.call<{ Invoice: Txn }>('GET', `/invoice/${remote.id}`)).Invoice;
      const due = Math.round(Number(inv.Balance ?? 0) * 100) / 100;
      if (!(due > 0)) return null;
      const r = await this.call<{ Payment: { Id: string } }>('POST', '/payment', {
        CustomerRef: { value: contactId }, TotalAmt: due, TxnDate: date, DepositToAccountRef: { value: bank.Id }, ...(ref ? { PaymentRefNum: ref } : {}), ...this.currency(doc),
        Line: [{ Amount: due, LinkedTxn: [{ TxnId: remote.id, TxnType: 'Invoice' }] }],
      }, { requestid: `pay-${doc.id}`.slice(0, 50) });
      return r.Payment.Id;
    }
    const bill = (await this.call<{ Bill: Txn }>('GET', `/bill/${remote.id}`)).Bill;
    const due = Math.round(Number(bill.Balance ?? 0) * 100) / 100;
    if (!(due > 0)) return null;
    const r = await this.call<{ BillPayment: { Id: string } }>('POST', '/billpayment', {
      VendorRef: { value: contactId }, PayType: 'Check', CheckPayment: { BankAccountRef: { value: bank.Id } }, TotalAmt: due, TxnDate: date, ...(ref ? { DocNumber: ref } : {}), ...this.currency(doc),
      Line: [{ Amount: due, LinkedTxn: [{ TxnId: remote.id, TxnType: 'Bill' }] }],
    }, { requestid: `billpay-${doc.id}`.slice(0, 50) });
    return r.BillPayment.Id;
  }
}
