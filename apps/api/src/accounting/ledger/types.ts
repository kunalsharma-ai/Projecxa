import { AccountingConfig } from '../formats';

/**
 * What the sync engine needs from an accounting system. Each provider (Xero, QuickBooks Online,
 * Tally Prime) implements it; the engine decides what to send and remembers what was sent.
 */

export type LedgerProvider = 'xero' | 'quickbooks' | 'tally';
export const LEDGER_PROVIDERS: LedgerProvider[] = ['xero', 'quickbooks', 'tally'];
export const LEDGER_LABEL: Record<LedgerProvider, string> = { xero: 'Xero', quickbooks: 'QuickBooks Online', tally: 'Tally Prime' };

export interface Party { id: string; name: string; code: string }
export interface LedgerLine { description: string; quantity: number; unitPrice: number; amount: number }

/** An invoice or vendor bill as the engine hands it to a provider. Money is in the document currency. */
export interface LedgerDoc {
  id: string;
  kind: 'invoice' | 'bill';
  number: string;
  date: Date;
  dueAt: Date | null;
  status: string;
  currency: string;
  party: Party;
  lines: LedgerLine[];
  subtotal: number;
  taxName: string | null;
  taxPercent: number;
  taxAmount: number;
  total: number;
  /** Invoice: project code. Bill: the vendor's own invoice number. */
  reference: string | null;
  notes: string | null;
  paidAt: Date | null;
  paymentReference: string | null;
}

export interface Remote { id: string; state: string }
export interface Check { label: string; ok: boolean; detail: string }

export interface LedgerContext {
  cfg: AccountingConfig;
  /** SampTrek's reporting currency and a rate from each currency to it (Settings → Finance). */
  baseCurrency: string;
  rate: (currency: string) => number | null;
  /** Day in the organisation's time zone, YYYY-MM-DD. */
  day: (d: Date) => string;
}

export interface Ledger {
  /** Read what every document needs once per run (currencies, accounts, taxes). */
  load(): Promise<void>;
  /** Connection and setup checks for the settings screen. */
  test(): Promise<Check[]>;
  /** The customer or vendor for this client or vendor in this currency: found by name or created. */
  contact(kind: 'customer' | 'vendor', p: Party, currency: string): Promise<{ id: string; created: boolean }>;
  /** A document with the same number already in the accounting system (entered by hand, or by an earlier run that died). */
  find(doc: LedgerDoc, contactId: string): Promise<Remote | null>;
  create(doc: LedgerDoc, contactId: string): Promise<Remote>;
  void(doc: LedgerDoc, remote: Remote): Promise<void>;
  /** Record the payment of the open balance. Returns null when nothing was left to pay. */
  pay(doc: LedgerDoc, remote: Remote, contactId: string): Promise<string | null>;
}

/** A problem with one document, shown in the run's list and not retried until the next run. */
export class LedgerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
/** The run used its request allowance. The next run carries on where this one stopped. */
export class LedgerBudgetSpent extends Error {
  constructor() {
    super('Stopped at the request allowance for one run. The next run carries on.');
  }
}
/** The sign-in is no longer valid; somebody has to connect again. */
export class LedgerSignInExpired extends Error {}
