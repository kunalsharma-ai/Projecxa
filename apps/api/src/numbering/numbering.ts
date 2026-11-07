/**
 * Numbering (docs/WORK_ORDERS_AND_UID_PREFIX.md): the work order prefix and next number, the
 * last work order generated, and the prefix put in front of respondent UIDs (session tokens).
 */
import { Body, ConflictException, Controller, Get, Module, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { randomToken } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

export const WORK_ORDER_PREFIX_RE = /^[A-Za-z0-9][A-Za-z0-9_/-]{0,11}$/;
/** URL-safe, since the UID travels in survey links and in /g/<token> paths. */
export const UID_PREFIX_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,11}$/;

export const numberingSchema = z.object({
  workOrderPrefix: z.string().trim().regex(WORK_ORDER_PREFIX_RE, 'Use 1–12 letters or digits; - _ and / are allowed after the first one'),
  /** The number the next generated work order gets. */
  nextWorkOrderNumber: z.number().int().min(1).max(999_999_999),
  uidPrefix: z.preprocess((v) => (typeof v === 'string' && !v.trim() ? null : v), z.string().trim().regex(UID_PREFIX_RE, 'Use 1–12 letters or digits; - and _ are allowed after the first one').nullable()),
});

/** Respondent UID (session token) with the organisation's prefix. */
export const newSessionToken = (uidPrefix: string | null | undefined) => `${uidPrefix ?? ''}${randomToken()}`;

type Tx = Prisma.TransactionClient | PrismaService;

/**
 * Takes the next free generated work order number for the organisation (prefix + number) and
 * remembers it as the last one. Numbers someone already typed by hand are skipped.
 */
export async function takeWorkOrder(tx: Tx, organizationId: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const org = await tx.organization.update({ where: { id: organizationId }, data: { workOrderSeq: { increment: 1 } }, select: { workOrderPrefix: true, workOrderSeq: true } });
    const no = `${org.workOrderPrefix}${org.workOrderSeq}`;
    if (!(await tx.project.count({ where: { organizationId, workOrderNo: { equals: no, mode: 'insensitive' } } }))) {
      await tx.organization.update({ where: { id: organizationId }, data: { lastWorkOrderNo: no } });
      return no;
    }
  }
  throw new ConflictException('Could not find a free work order number. Check Settings → Numbering.');
}

/**
 * A work order typed by hand: it must not be used by another project. When it follows the
 * pattern (prefix + a number past the counter), the counter moves on, so the next generated one
 * does not clash.
 */
export async function claimManualWorkOrder(tx: Tx, organizationId: string, workOrderNo: string, exceptProjectId?: string) {
  const clash = await tx.project.findFirst({ where: { organizationId, workOrderNo: { equals: workOrderNo, mode: 'insensitive' }, ...(exceptProjectId ? { id: { not: exceptProjectId } } : {}) }, select: { projectCode: true } });
  if (clash) throw new ConflictException({ message: `Work order ${workOrderNo} is already used by project ${clash.projectCode}`, code: 'WORK_ORDER_TAKEN' });
  const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { workOrderPrefix: true, workOrderSeq: true } });
  const m = workOrderNo.toUpperCase().startsWith(org.workOrderPrefix.toUpperCase()) ? /^(\d{1,9})$/.exec(workOrderNo.slice(org.workOrderPrefix.length)) : null;
  const n = m ? Number(m[1]) : null;
  await tx.organization.update({ where: { id: organizationId }, data: { lastWorkOrderNo: workOrderNo, ...(n !== null && n > org.workOrderSeq ? { workOrderSeq: n } : {}) } });
}

export async function numberingView(prisma: Tx, organizationId: string) {
  const o = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { projectCodePrefix: true, projectSeq: true, workOrderPrefix: true, workOrderSeq: true, lastWorkOrderNo: true, uidPrefix: true } });
  return {
    projectCodePrefix: o.projectCodePrefix,
    nextProjectCode: `${o.projectCodePrefix}${o.projectSeq + 1}`,
    workOrderPrefix: o.workOrderPrefix,
    nextWorkOrderNumber: o.workOrderSeq + 1,
    nextWorkOrderNo: `${o.workOrderPrefix}${o.workOrderSeq + 1}`,
    lastWorkOrderNo: o.lastWorkOrderNo,
    uidPrefix: o.uidPrefix,
    uidExample: `${o.uidPrefix ?? ''}Qm9xT2p4bTFhcjNkZWx0YWdv`,
  };
}

@Controller('numbering')
export class NumberingController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Everyone on staff sees it: Create project shows the next and the last work order. */
  @Get()
  get(@CurrentUser() u: AuthUser) {
    return numberingView(this.prisma, u.organizationId);
  }

  @Put()
  @Roles('ADMIN')
  async set(@CurrentUser() u: AuthUser, @Body(new ZodPipe(numberingSchema)) body: z.infer<typeof numberingSchema>) {
    const next = `${body.workOrderPrefix}${body.nextWorkOrderNumber}`;
    const clash = await this.prisma.project.findFirst({ where: { organizationId: u.organizationId, workOrderNo: { equals: next, mode: 'insensitive' } }, select: { projectCode: true } });
    if (clash) throw new ConflictException({ message: `${next} is already used by project ${clash.projectCode}. Choose a higher number.`, code: 'WORK_ORDER_TAKEN' });
    await this.prisma.organization.update({
      where: { id: u.organizationId },
      data: { workOrderPrefix: body.workOrderPrefix, workOrderSeq: body.nextWorkOrderNumber - 1, uidPrefix: body.uidPrefix },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'numbering.update', entityType: 'Organization', entityId: u.organizationId, detail: body });
    return numberingView(this.prisma, u.organizationId);
  }
}

@Module({ controllers: [NumberingController] })
export class NumberingModule {}
