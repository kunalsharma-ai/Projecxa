/**
 * Reconciliation and client invoicing.
 *
 * Reconciliation: the client sends its final list of valid respondent IDs for a project
 * (our session tokens, which the client survey received, or the vendor UIDs). We match the
 * list against the project's live completes and approve or reject them. Completes already
 * on an invoice are locked and never change.
 *
 * Invoicing: approved completes that are not yet billed become a client invoice, one per
 * currency, with one line per market and price. Voiding an invoice releases its completes.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStatus, InvoiceStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

export const RECON_MODES = ['final_list', 'approve_listed', 'reject_listed'] as const;
export const reconcileSchema = z.object({
  ids: z.array(z.string().max(200)).min(1).max(50_000),
  mode: z.enum(RECON_MODES),
  note: z.string().max(500).optional(),
});
export type ReconcileInput = z.infer<typeof reconcileSchema>;

export const createInvoiceSchema = z.object({ notes: z.string().max(1000).optional() });
export const updateInvoiceSchema = z
  .object({
    status: z.enum(['SENT', 'PAID', 'VOID']).optional(),
    /** Payment terms in days, used when the invoice is sent. */
    dueDays: z.number().int().min(0).max(180).optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine((b) => b.status || b.notes !== undefined, { message: 'Nothing to change' });
export const invoiceListSchema = z.object({
  status: z.nativeEnum(InvoiceStatus).optional(),
  projectId: z.string().max(64).optional(),
  clientId: z.string().max(64).optional(),
});

const NEXT: Record<InvoiceStatus, InvoiceStatus[]> = { DRAFT: ['SENT', 'VOID'], SENT: ['PAID', 'VOID'], PAID: [], VOID: [] };
const SAMPLE = 50;
const money = (n: Prisma.Decimal | number | null | undefined) => Math.round(Number(n ?? 0) * 100) / 100;

export interface ReconcileResult {
  mode: (typeof RECON_MODES)[number];
  submitted: number;
  matched: number;
  approve: number;
  reject: number;
  unchanged: number;
  /** Changes that were skipped because the complete is already invoiced. */
  locked: number;
  unknown: number;
  unknownSample: string[];
  /** IDs that match more than one complete by vendor UID (use the session token instead). */
  ambiguous: number;
  /** IDs the client listed that we recorded with another outcome, e.g. terminate. */
  notComplete: { count: number; sample: { id: string; status: string }[] };
  /** Approved revenue per currency once applied. */
  approvedAfter: { currency: string; completes: number; revenue: number }[];
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async project(u: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, organizationId: u.organizationId }, select: { id: true, name: true, projectCode: true, status: true, clientId: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  /** Approval and billing state of a project's live completes, plus reconciliation history. */
  async reconciliationSummary(u: AuthUser, projectId: string) {
    await this.project(u, projectId);
    const rows = await this.prisma.$queryRaw<{ approval: ApprovalStatus; invoiced: boolean; currency: string; completes: number; revenue: number; payout: number }[]>`
      SELECT s.approval, (s."invoiceId" IS NOT NULL) AS invoiced, pc.currency, COUNT(*)::int AS completes,
        COALESCE(SUM(s.revenue), 0)::float8 AS revenue, COALESCE(SUM(s.payout), 0)::float8 AS payout
      FROM "RespondentSession" s JOIN "ProjectCountry" pc ON pc.id = s."projectCountryId"
      WHERE s."projectId" = ${projectId} AND s."isTest" = false AND s.status = 'COMPLETE'
      GROUP BY 1, 2, 3 ORDER BY 3`;
    const bucket = (pick: (r: (typeof rows)[number]) => boolean) => {
      const by = new Map<string, { currency: string; completes: number; revenue: number; payout: number }>();
      for (const r of rows.filter(pick)) {
        const b = by.get(r.currency) ?? { currency: r.currency, completes: 0, revenue: 0, payout: 0 };
        b.completes += r.completes;
        b.revenue = money(b.revenue + r.revenue);
        b.payout = money(b.payout + r.payout);
        by.set(r.currency, b);
      }
      const list = [...by.values()];
      return { completes: list.reduce((a, b) => a + b.completes, 0), byCurrency: list };
    };
    const history = await this.prisma.reconciliation.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const actors = await this.prisma.user.findMany({ where: { id: { in: history.map((h) => h.actorId).filter((x): x is string => !!x) }, organizationId: u.organizationId }, select: { id: true, name: true } });
    return {
      pending: bucket((r) => r.approval === 'PENDING'),
      approved: bucket((r) => r.approval === 'APPROVED'),
      rejected: bucket((r) => r.approval === 'REJECTED'),
      toInvoice: bucket((r) => r.approval === 'APPROVED' && !r.invoiced),
      invoiced: bucket((r) => r.invoiced),
      history: history.map((h) => ({ ...h, actor: actors.find((a) => a.id === h.actorId)?.name ?? null })),
    };
  }

  /** Works out what a reconciliation would change. With `apply`, makes the change in one transaction. */
  async reconcile(u: AuthUser, projectId: string, input: ReconcileInput, apply: boolean): Promise<ReconcileResult> {
    await this.project(u, projectId);
    const ids = [...new Set(input.ids.map((x) => x.trim()).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('Paste at least one ID');

    return this.prisma.$transaction(
      async (tx) => {
        const completes = await tx.respondentSession.findMany({
          where: { projectId, isTest: false, status: 'COMPLETE' },
          select: { id: true, token: true, vendorRespondentId: true, approval: true, invoiceId: true, revenue: true, projectCountry: { select: { currency: true } } },
        });
        const byToken = new Map(completes.map((c) => [c.token, c]));
        const byUid = new Map<string, typeof completes>();
        for (const c of completes) byUid.set(c.vendorRespondentId, [...(byUid.get(c.vendorRespondentId) ?? []), c]);

        const matched = new Map<string, (typeof completes)[number]>();
        const unmatched: string[] = [];
        let ambiguous = 0;
        for (const id of ids) {
          const t = byToken.get(id);
          const uids = byUid.get(id);
          if (t) matched.set(t.id, t);
          else if (uids?.length === 1) matched.set(uids[0].id, uids[0]);
          else if (uids && uids.length > 1) ambiguous++;
          else unmatched.push(id);
        }

        // Listed IDs that exist with another outcome (worth raising with the client).
        const others = unmatched.length
          ? await tx.respondentSession.findMany({
              where: { projectId, isTest: false, status: { not: 'COMPLETE' }, OR: [{ token: { in: unmatched } }, { vendorRespondentId: { in: unmatched } }] },
              select: { token: true, vendorRespondentId: true, status: true },
            })
          : [];
        const otherIds = new Map<string, string>();
        for (const o of others) {
          if (unmatched.includes(o.token)) otherIds.set(o.token, o.status);
          if (unmatched.includes(o.vendorRespondentId)) otherIds.set(o.vendorRespondentId, o.status);
        }
        const unknown = unmatched.filter((x) => !otherIds.has(x));

        const target = new Map<string, ApprovalStatus>();
        if (input.mode === 'final_list') for (const c of completes) target.set(c.id, matched.has(c.id) ? 'APPROVED' : 'REJECTED');
        else for (const id of matched.keys()) target.set(id, input.mode === 'approve_listed' ? 'APPROVED' : 'REJECTED');

        const approve: string[] = [];
        const reject: string[] = [];
        let unchanged = 0;
        let locked = 0;
        const after = new Map<string, ApprovalStatus>();
        for (const c of completes) {
          const want = target.get(c.id);
          after.set(c.id, c.approval);
          if (!want || want === c.approval) {
            if (want) unchanged++;
            continue;
          }
          if (c.invoiceId) {
            locked++;
            continue;
          }
          (want === 'APPROVED' ? approve : reject).push(c.id);
          after.set(c.id, want);
        }

        const approvedAfter = new Map<string, { currency: string; completes: number; revenue: number }>();
        for (const c of completes) {
          if (after.get(c.id) !== 'APPROVED') continue;
          const cur = c.projectCountry.currency;
          const b = approvedAfter.get(cur) ?? { currency: cur, completes: 0, revenue: 0 };
          b.completes++;
          b.revenue = money(b.revenue + Number(c.revenue ?? 0));
          approvedAfter.set(cur, b);
        }

        const result: ReconcileResult = {
          mode: input.mode,
          submitted: ids.length,
          matched: matched.size,
          approve: approve.length,
          reject: reject.length,
          unchanged,
          locked,
          unknown: unknown.length,
          unknownSample: unknown.slice(0, SAMPLE),
          ambiguous,
          notComplete: { count: otherIds.size, sample: [...otherIds].slice(0, SAMPLE).map(([id, status]) => ({ id, status })) },
          approvedAfter: [...approvedAfter.values()],
        };
        if (!apply) return result;

        const now = new Date();
        for (const [list, approval] of [[approve, 'APPROVED'], [reject, 'REJECTED']] as const) {
          for (let i = 0; i < list.length; i += 5000) {
            await tx.respondentSession.updateMany({ where: { id: { in: list.slice(i, i + 5000) }, invoiceId: null }, data: { approval, approvalAt: now } });
          }
        }
        const rec = await tx.reconciliation.create({
          data: {
            organizationId: u.organizationId,
            projectId,
            mode: input.mode,
            submitted: result.submitted,
            matched: result.matched,
            approved: result.approve,
            rejected: result.reject,
            unchanged,
            locked,
            unknown: result.unknown,
            unknownSample: result.unknownSample,
            note: input.note,
            actorId: u.id,
          },
        });
        await this.audit.record({
          organizationId: u.organizationId,
          actorId: u.id,
          action: 'project.reconcile',
          entityType: 'Project',
          entityId: projectId,
          detail: { reconciliationId: rec.id, mode: input.mode, approved: result.approve, rejected: result.reject, unknown: result.unknown, locked },
        });
        return result;
      },
      { timeout: 60_000 },
    );
  }

  /** Bills every approved, not yet invoiced complete of a project: one draft invoice per currency. */
  async createInvoices(u: AuthUser, projectId: string, notes?: string) {
    const p = await this.project(u, projectId);
    return this.prisma.$transaction(async (tx) => {
      const sessions = await tx.respondentSession.findMany({
        where: { projectId, isTest: false, status: 'COMPLETE', approval: 'APPROVED', invoiceId: null },
        select: { id: true, revenue: true, projectCountry: { select: { countryCode: true, currency: true } } },
      });
      if (!sessions.length) throw new BadRequestException('There are no approved completes waiting to be invoiced');
      const pending = await tx.respondentSession.count({ where: { projectId, isTest: false, status: 'COMPLETE', approval: 'PENDING' } });

      const byCurrency = new Map<string, typeof sessions>();
      for (const s of sessions) byCurrency.set(s.projectCountry.currency, [...(byCurrency.get(s.projectCountry.currency) ?? []), s]);

      const created = [];
      for (const [currency, list] of [...byCurrency].sort(([a], [b]) => a.localeCompare(b))) {
        const lines = new Map<string, { countryCode: string; description: string; quantity: number; unitPrice: number; amount: number }>();
        for (const s of list) {
          const price = money(s.revenue);
          const key = `${s.projectCountry.countryCode}:${price}`;
          const l = lines.get(key) ?? { countryCode: s.projectCountry.countryCode, description: `${p.projectCode} ${p.name}: completes, ${s.projectCountry.countryCode}`, quantity: 0, unitPrice: price, amount: 0 };
          l.quantity++;
          l.amount = money(l.quantity * l.unitPrice);
          lines.set(key, l);
        }
        const sorted = [...lines.values()].sort((a, b) => a.countryCode.localeCompare(b.countryCode) || b.unitPrice - a.unitPrice);
        const total = money(sorted.reduce((a, l) => a + l.amount, 0));
        const org = await tx.organization.update({ where: { id: u.organizationId }, data: { invoiceSeq: { increment: 1 } }, select: { invoiceSeq: true } });
        const number = `INV-${new Date().getUTCFullYear()}-${String(org.invoiceSeq).padStart(5, '0')}`;
        const inv = await tx.invoice.create({
          data: {
            organizationId: u.organizationId,
            projectId,
            clientId: p.clientId,
            number,
            currency,
            lines: sorted,
            completes: list.length,
            total,
            notes,
            createdById: u.id,
          },
        });
        const ids = list.map((s) => s.id);
        let linked = 0;
        for (let i = 0; i < ids.length; i += 5000) {
          linked += (await tx.respondentSession.updateMany({ where: { id: { in: ids.slice(i, i + 5000) }, invoiceId: null, approval: 'APPROVED' }, data: { invoiceId: inv.id } })).count;
        }
        // Another request billed some of these at the same moment: roll everything back.
        if (linked !== ids.length) throw new ConflictException('These completes were just invoiced by someone else. Reload and try again.');
        created.push(inv);
      }
      await this.audit.record({
        organizationId: u.organizationId,
        actorId: u.id,
        action: 'invoice.create',
        entityType: 'Project',
        entityId: projectId,
        detail: { invoices: created.map((i) => ({ id: i.id, number: i.number, currency: i.currency, total: Number(i.total) })) },
      });
      return { invoices: created.map(shape), pendingNotInvoiced: pending };
    });
  }

  async listInvoices(u: AuthUser, q: z.infer<typeof invoiceListSchema>) {
    const rows = await this.prisma.invoice.findMany({
      where: { organizationId: u.organizationId, ...(q.status ? { status: q.status } : {}), ...(q.projectId ? { projectId: q.projectId } : {}), ...(q.clientId ? { clientId: q.clientId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { project: { select: { id: true, projectCode: true, name: true } }, client: { select: { id: true, name: true, code: true } } },
    });
    const now = Date.now();
    return rows.map((r) => ({ ...shape(r), project: r.project, client: r.client, overdue: r.status === 'SENT' && !!r.dueAt && r.dueAt.getTime() < now }));
  }

  async getInvoice(u: AuthUser, id: string) {
    const r = await this.prisma.invoice.findFirst({
      where: { id, organizationId: u.organizationId },
      include: {
        project: { select: { id: true, projectCode: true, name: true, workOrderNo: true } },
        client: { select: { id: true, name: true, code: true } },
        organization: { select: { name: true } },
      },
    });
    if (!r) throw new NotFoundException('Invoice not found');
    return { ...shape(r), project: r.project, client: r.client, issuer: r.organization.name, overdue: r.status === 'SENT' && !!r.dueAt && r.dueAt.getTime() < Date.now() };
  }

  async updateInvoice(u: AuthUser, id: string, body: z.infer<typeof updateInvoiceSchema>) {
    const inv = await this.prisma.invoice.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (body.notes !== undefined && inv.status !== 'DRAFT') throw new BadRequestException('Notes can only be changed on a draft');
    if (body.status && !NEXT[inv.status].includes(body.status)) {
      throw new BadRequestException(`A ${inv.status.toLowerCase()} invoice cannot be marked ${body.status.toLowerCase()}`);
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Guard against a concurrent status change: only move from the status we read.
      const r = await tx.invoice.updateMany({
        where: { id, status: inv.status },
        data: {
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.status ? { status: body.status } : {}),
          ...(body.status === 'SENT' ? { issuedAt: now, dueAt: new Date(now.getTime() + (body.dueDays ?? 30) * 86_400_000) } : {}),
          ...(body.status === 'PAID' ? { paidAt: now } : {}),
          ...(body.status === 'VOID' ? { voidedAt: now } : {}),
        },
      });
      if (r.count !== 1) throw new ConflictException('This invoice was just changed by someone else. Reload and try again.');
      if (body.status === 'VOID') await tx.respondentSession.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
      if (body.status === 'SENT') await tx.project.updateMany({ where: { id: inv.projectId, status: 'CLOSED' }, data: { status: 'INVOICED' } });
    });
    if (body.status) {
      await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: `invoice.${body.status.toLowerCase()}`, entityType: 'Invoice', entityId: id, detail: { number: inv.number, total: Number(inv.total), currency: inv.currency } });
    }
    return this.getInvoice(u, id);
  }

  /** Organisation-wide reconciliation and invoicing totals for the dashboard, in completes and revenue per currency. */
  async financeTiles(org: string) {
    const rows = await this.prisma.$queryRaw<{ bucket: string; currency: string; n: number; amount: number }[]>`
      SELECT CASE WHEN s.approval = 'PENDING' THEN 'pending'
                  WHEN s.approval <> 'APPROVED' THEN 'rejected'
                  WHEN i.status IS NULL OR i.status = 'DRAFT' THEN 'invoicePending'
                  WHEN i.status = 'SENT' THEN 'invoiced'
                  ELSE 'paid' END AS bucket,
        pc.currency, COUNT(*)::int AS n, COALESCE(SUM(s.revenue), 0)::float8 AS amount
      FROM "RespondentSession" s
      JOIN "ProjectCountry" pc ON pc.id = s."projectCountryId"
      LEFT JOIN "Invoice" i ON i.id = s."invoiceId"
      WHERE s."organizationId" = ${org} AND s."isTest" = false AND s.status = 'COMPLETE'
      GROUP BY 1, 2`;
    const tile = (buckets: string[]) => {
      const by = new Map<string, number>();
      let count = 0;
      for (const r of rows.filter((x) => buckets.includes(x.bucket))) {
        count += r.n;
        by.set(r.currency, (by.get(r.currency) ?? 0) + r.amount);
      }
      return { count, byCurrency: [...by].map(([currency, amount]) => ({ currency, amount: money(amount) })).sort((a, b) => b.amount - a.amount) };
    };
    return {
      reconciled: tile(['invoicePending', 'invoiced', 'paid']),
      pendingReconciliation: tile(['pending']),
      invoicePending: tile(['invoicePending']),
      invoiced: tile(['invoiced']),
      paymentReceived: tile(['paid']),
    };
  }
}

function shape(r: { id: string; number: string; status: InvoiceStatus; currency: string; lines: Prisma.JsonValue; completes: number; total: Prisma.Decimal; notes: string | null; issuedAt: Date | null; dueAt: Date | null; paidAt: Date | null; voidedAt: Date | null; createdAt: Date; projectId: string; clientId: string }) {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    currency: r.currency,
    lines: r.lines as { countryCode: string; description: string; quantity: number; unitPrice: number; amount: number }[],
    completes: r.completes,
    total: Number(r.total),
    notes: r.notes,
    issuedAt: r.issuedAt,
    dueAt: r.dueAt,
    paidAt: r.paidAt,
    voidedAt: r.voidedAt,
    createdAt: r.createdAt,
    projectId: r.projectId,
    clientId: r.clientId,
  };
}
