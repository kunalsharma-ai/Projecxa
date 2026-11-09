import { Prisma } from '@prisma/client';
import { money } from '../../finance/finance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Ledger, LedgerBudgetSpent, LedgerDoc, LedgerProvider, LedgerSignInExpired, Party, Remote } from './types';

/**
 * The provider-independent part of a sync: which invoices and bills need work, in what order, and
 * what reached the accounting system (LedgerLink). Runs can repeat any number of times without
 * creating duplicates: every created record is linked, and documents are looked up by number first.
 */

export interface SyncSettings { hourly: boolean; since: string | null; invoices: boolean; bills: boolean; payments: boolean }
export const DEFAULT_SYNC: SyncSettings = { hourly: false, since: null, invoices: true, bills: true, payments: true };
export interface Counts { customers: number; vendors: number; invoices: number; bills: number; matched: number; paymentsReceived: number; paymentsMade: number; voided: number }
export const zeroCounts = (): Counts => ({ customers: 0, vendors: 0, invoices: 0, bills: 0, matched: 0, paymentsReceived: 0, paymentsMade: 0, voided: 0 });
export type RunError = { type: string; number: string | null; message: string };

export const MAX_DOCS_PER_RUN = 500;
type Link = { entityType: string; entityId: string; remoteId: string; state: string | null };

export class SyncEngine {
  private links = new Map<string, Link>();
  readonly counts = zeroCounts();
  readonly errors: RunError[] = [];
  stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly org: string,
    private readonly provider: LedgerProvider,
    private readonly ledger: Ledger,
  ) {}

  private key(type: string, id: string) {
    return `${type}:${id}`;
  }
  private link(type: string, id: string) {
    return this.links.get(this.key(type, id));
  }
  private async save(type: string, id: string, remoteId: string, state: string | null) {
    const where = { organizationId_provider_entityType_entityId: { organizationId: this.org, provider: this.provider, entityType: type, entityId: id } };
    const l = await this.prisma.ledgerLink.upsert({ where, create: { organizationId: this.org, provider: this.provider, entityType: type, entityId: id, remoteId, state }, update: { remoteId, state, syncedAt: new Date() } });
    this.links.set(this.key(type, id), l);
  }

  async run(since: Date, s: SyncSettings) {
    try {
      for (const l of await this.prisma.ledgerLink.findMany({ where: { organizationId: this.org, provider: this.provider } })) this.links.set(this.key(l.entityType, l.entityId), l);
      const linked = (type: string) => [...this.links.values()].filter((l) => l.entityType === type && l.state !== 'void').map((l) => l.entityId);
      const docs: LedgerDoc[] = [];
      if (s.invoices) {
        const rows = await this.prisma.invoice.findMany({
          where: { organizationId: this.org, OR: [{ status: { in: ['SENT', 'PAID'] }, issuedAt: { gte: since } }, { status: 'VOID', id: { in: linked('invoice') } }] },
          include: { client: { select: { id: true, name: true, code: true } }, project: { select: { projectCode: true } } },
          orderBy: [{ issuedAt: 'asc' }, { number: 'asc' }],
        });
        for (const i of rows) docs.push(toDoc('invoice', i, i.client, i.issuedAt ?? i.createdAt, i.project.projectCode));
      }
      if (s.bills) {
        const rows = await this.prisma.vendorBill.findMany({
          where: { organizationId: this.org, OR: [{ status: { in: ['APPROVED', 'PAID'] }, approvedAt: { gte: since } }, { status: 'VOID', id: { in: linked('bill') } }] },
          include: { vendor: { select: { id: true, name: true, code: true } } },
          orderBy: [{ approvedAt: 'asc' }, { number: 'asc' }],
        });
        for (const b of rows) docs.push(toDoc('bill', b, b.vendor, b.approvedAt ?? b.createdAt, b.vendorReference));
      }
      const work = docs.filter((d) => this.needsWork(d, s));
      if (work.length > MAX_DOCS_PER_RUN) this.stopped = true;
      if (work.length) await this.ledger.load();
      for (const d of work.slice(0, MAX_DOCS_PER_RUN)) {
        try {
          await this.doc(d, s);
        } catch (e) {
          if (e instanceof LedgerBudgetSpent || e instanceof LedgerSignInExpired) throw e;
          this.errors.push({ type: d.kind, number: d.number, message: (e as Error).message.slice(0, 500) });
        }
      }
    } catch (e) {
      if (e instanceof LedgerBudgetSpent) this.stopped = true;
      else {
        this.errors.push({ type: 'run', number: null, message: (e as Error).message.slice(0, 500) });
        if (e instanceof LedgerSignInExpired) throw e;
      }
    } finally {
      if (this.stopped) this.errors.push({ type: 'run', number: null, message: 'Stopped at the limit for one run. The next run carries on.' });
    }
  }

  get status(): 'ok' | 'partial' | 'failed' {
    if (!this.errors.length) return 'ok';
    const did = Object.values(this.counts).some(Boolean);
    return this.errors.every((e) => e.type === 'run' && e.message.startsWith('Stopped')) || did ? 'partial' : 'failed';
  }

  needsWork(d: LedgerDoc, s: SyncSettings) {
    const l = this.link(d.kind, d.id);
    if (!l) return d.status !== 'VOID';
    if (d.status === 'VOID') return l.state !== 'void';
    return d.status === 'PAID' && s.payments && !this.link(`${d.kind}_payment`, d.id);
  }

  private async contact(d: LedgerDoc) {
    const kind = d.kind === 'invoice' ? 'customer' : 'vendor';
    const key = `${d.party.id}:${d.currency}`;
    const l = this.link(kind, key);
    if (l) return l.remoteId;
    const c = await this.ledger.contact(kind, d.party, d.currency);
    if (c.created) this.counts[kind === 'customer' ? 'customers' : 'vendors']++;
    await this.save(kind, key, c.id, null);
    return c.id;
  }

  private async doc(d: LedgerDoc, s: SyncSettings) {
    const contact = await this.contact(d);
    let l = this.link(d.kind, d.id);
    if (!l) {
      const hit = await this.ledger.find(d, contact);
      if (hit) {
        await this.save(d.kind, d.id, hit.id, hit.state);
        this.counts.matched++;
      } else {
        const r = await this.ledger.create(d, contact);
        await this.save(d.kind, d.id, r.id, r.state);
        this.counts[d.kind === 'invoice' ? 'invoices' : 'bills']++;
      }
      if (d.kind === 'invoice') await this.prisma.invoice.updateMany({ where: { id: d.id, exportedAt: null }, data: { exportedAt: new Date() } });
      else await this.prisma.vendorBill.updateMany({ where: { id: d.id, exportedAt: null }, data: { exportedAt: new Date() } });
      l = this.link(d.kind, d.id)!;
    }
    const remote: Remote = { id: l.remoteId, state: l.state ?? '' };
    if (d.status === 'VOID') {
      if (l.state !== 'void') {
        await this.ledger.void(d, remote);
        await this.save(d.kind, d.id, l.remoteId, 'void');
        this.counts.voided++;
      }
      return;
    }
    if (d.status === 'PAID' && s.payments && !this.link(`${d.kind}_payment`, d.id)) {
      const paid = await this.ledger.pay(d, remote, contact);
      if (paid) this.counts[d.kind === 'invoice' ? 'paymentsReceived' : 'paymentsMade']++;
      await this.save(`${d.kind}_payment`, d.id, paid ?? 'already-paid', 'paid');
      await this.save(d.kind, d.id, l.remoteId, 'paid');
      if (d.kind === 'invoice') await this.prisma.invoice.updateMany({ where: { id: d.id, paymentExportedAt: null }, data: { paymentExportedAt: new Date() } });
      else await this.prisma.vendorBill.updateMany({ where: { id: d.id, paymentExportedAt: null }, data: { paymentExportedAt: new Date() } });
    }
  }
}

type Row = {
  id: string; number: string; dueAt: Date | null; status: string; currency: string; lines: Prisma.JsonValue; subtotal: number; taxName: string | null; taxPercent: number; taxAmount: number; total: number; notes: string | null; paidAt: Date | null; paymentReference: string | null;
};
function toDoc(kind: 'invoice' | 'bill', r: Row, party: Party, date: Date, reference: string | null): LedgerDoc {
  const lines = (r.lines as unknown as { description: string; quantity: number; unitPrice: number; amount: number }[]).map((l) => ({ description: String(l.description), quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), amount: Number(l.amount) }));
  return {
    id: r.id, kind, number: r.number, date, dueAt: r.dueAt, status: r.status, currency: r.currency, party, lines,
    subtotal: money(r.subtotal), taxName: r.taxName, taxPercent: Number(r.taxPercent), taxAmount: money(r.taxAmount), total: money(r.total),
    reference, notes: r.notes, paidAt: r.paidAt, paymentReference: r.paymentReference,
  };
}
