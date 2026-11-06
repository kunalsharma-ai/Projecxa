import { forVendor } from '../common/vendor-safe';
import { BadRequestException, Body, Controller, Delete, Get, Module, NotFoundException, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { FinanceModule } from '../finance/finance.controller';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_FILE_BYTES, RequestsService } from './requests.service';

const KINDS = ['QUESTION', 'ISSUE', 'DISPUTE'] as const;
const STATUSES = ['OPEN', 'ANSWERED', 'CLOSED'] as const;
const FILE_KINDS = ['QUESTIONNAIRE', 'DELIVERABLE', 'COMPLIANCE', 'OTHER'] as const;
const id = z.string().min(1).max(40);

const listSchema = z.object({ status: z.enum(STATUSES).optional(), kind: z.enum(KINDS).optional(), clientId: id.optional(), vendorId: id.optional(), projectId: id.optional() });
const createSchema = z
  .object({
    subject: z.string().trim().min(3).max(200),
    body: z.string().trim().min(1).max(10_000),
    kind: z.enum(KINDS).optional(),
    projectId: id.optional(),
    sessionIds: z.array(id).max(500).optional(),
    clientId: id.optional(),
    vendorId: id.optional(),
  })
  .strict();
const replySchema = z.object({ body: z.string().trim().min(1).max(10_000), internal: z.boolean().optional() }).strict();
const updateSchema = z.object({ status: z.enum(STATUSES).optional(), assigneeId: id.nullable().optional() }).strict();
const disputeSchema = z.object({ decision: z.enum(['APPROVE', 'KEEP_REJECTED']), message: z.string().max(5000).optional() }).strict();
const fileListSchema = z.object({ projectId: id.optional(), vendorId: id.optional(), clientId: id.optional(), kind: z.enum(FILE_KINDS).optional() });
/** Multipart fields arrive as strings. */
const uploadSchema = z
  .object({
    kind: z.enum(FILE_KINDS).optional(),
    projectId: id.optional(),
    ticketId: id.optional(),
    note: z.string().max(500).optional(),
    expiresAt: z.coerce.date().optional(),
    clientId: id.optional(),
    vendorId: id.optional(),
  })
  .strict();

type Uploaded = { originalname: string; mimetype: string; size: number; buffer: Buffer };
const fileInterceptor = FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES + 1, files: 1 } });

function sendFile(res: Response, f: { name: string; contentType: string; data: Uint8Array }) {
  const ascii = f.name.replace(/[^\w.() -]/g, '_');
  res.set({
    'Content-Type': f.contentType,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'no-store',
  });
  res.send(Buffer.from(f.data));
}

// ─────────────────────────────── Staff ───────────────────────────────

/** Requests from clients and vendors, answered by staff. Viewers can read; editors answer. */
@Controller('requests')
export class RequestsController {
  constructor(private readonly svc: RequestsService) {}
  private readonly staff = { kind: 'staff' } as const;

  @Get()
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.svc.list(u.organizationId, this.staff, q);
  }

  @Post()
  @Roles(...EDITORS)
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    if (b.kind === 'DISPUTE') throw new BadRequestException('Only a vendor can dispute rejected completes');
    return this.svc.create(u, this.staff, b);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') rid: string) {
    return this.svc.get(u.organizationId, this.staff, rid, u.id);
  }

  @Post(':id/messages')
  @Roles(...EDITORS)
  reply(@CurrentUser() u: AuthUser, @Param('id') rid: string, @Body(new ZodPipe(replySchema)) b: z.infer<typeof replySchema>) {
    return this.svc.reply(u, this.staff, rid, b);
  }

  @Patch(':id')
  @Roles(...EDITORS)
  update(@CurrentUser() u: AuthUser, @Param('id') rid: string, @Body(new ZodPipe(updateSchema)) b: z.infer<typeof updateSchema>) {
    return this.svc.update(u, this.staff, rid, b);
  }

  @Post(':id/dispute')
  @Roles(...EDITORS)
  dispute(@CurrentUser() u: AuthUser, @Param('id') rid: string, @Body(new ZodPipe(disputeSchema)) b: z.infer<typeof disputeSchema>) {
    return this.svc.decideDispute(u, rid, b);
  }
}

@Controller('files')
export class FilesController {
  constructor(private readonly svc: RequestsService) {}
  private readonly staff = { kind: 'staff' } as const;

  @Get()
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(fileListSchema)) q: z.infer<typeof fileListSchema>) {
    return this.svc.listFiles(u.organizationId, this.staff, q, u.id);
  }

  @Get('compliance/expiring')
  expiring(@CurrentUser() u: AuthUser) {
    return this.svc.expiringCompliance(u.organizationId);
  }

  @Post()
  @Roles(...EDITORS)
  @UseInterceptors(fileInterceptor)
  upload(@CurrentUser() u: AuthUser, @Body(new ZodPipe(uploadSchema)) b: z.infer<typeof uploadSchema>, @UploadedFile() file?: Uploaded) {
    return this.svc.upload(u, this.staff, file, b);
  }

  @Get(':id/download')
  async download(@CurrentUser() u: AuthUser, @Param('id') fid: string, @Res() res: Response) {
    sendFile(res, await this.svc.download(u, this.staff, fid));
  }

  @Delete(':id')
  @Roles(...EDITORS)
  remove(@CurrentUser() u: AuthUser, @Param('id') fid: string) {
    return this.svc.remove(u, this.staff, fid);
  }
}

// ─────────────────────────────── Portals ───────────────────────────────

@Controller('portal/requests')
@Roles('CLIENT_USER', 'VENDOR_USER')
export class PortalRequestsController {
  constructor(private readonly svc: RequestsService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.svc.list(u.organizationId, await this.svc.partyOf(u), { status: q.status, kind: q.kind, projectId: q.projectId });
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>) {
    if (b.clientId || b.vendorId) throw new BadRequestException('clientId and vendorId are set by your login');
    return this.svc.create(u, await this.svc.partyOf(u), b);
  }

  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id') rid: string) {
    return this.svc.get(u.organizationId, await this.svc.partyOf(u), rid, u.id);
  }

  @Post(':id/messages')
  async reply(@CurrentUser() u: AuthUser, @Param('id') rid: string, @Body(new ZodPipe(replySchema)) b: z.infer<typeof replySchema>) {
    if (b.internal) throw new BadRequestException('Internal notes are for staff');
    return this.svc.reply(u, await this.svc.partyOf(u), rid, b);
  }

  @Post(':id/close')
  async close(@CurrentUser() u: AuthUser, @Param('id') rid: string) {
    return this.svc.update(u, await this.svc.partyOf(u), rid, { status: 'CLOSED' });
  }
}

@Controller('portal/files')
@Roles('CLIENT_USER', 'VENDOR_USER')
export class PortalFilesController {
  constructor(private readonly svc: RequestsService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(fileListSchema)) q: z.infer<typeof fileListSchema>) {
    return this.svc.listFiles(u.organizationId, await this.svc.partyOf(u), { projectId: q.projectId, kind: q.kind }, u.id);
  }

  @Post()
  @UseInterceptors(fileInterceptor)
  async upload(@CurrentUser() u: AuthUser, @Body(new ZodPipe(uploadSchema)) b: z.infer<typeof uploadSchema>, @UploadedFile() file?: Uploaded) {
    if (b.clientId || b.vendorId) throw new BadRequestException('clientId and vendorId are set by your login');
    return this.svc.upload(u, await this.svc.partyOf(u), file, b);
  }

  @Get(':id/download')
  async download(@CurrentUser() u: AuthUser, @Param('id') fid: string, @Res() res: Response) {
    sendFile(res, await this.svc.download(u, await this.svc.partyOf(u), fid));
  }

  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') fid: string) {
    return this.svc.remove(u, await this.svc.partyOf(u), fid);
  }
}

/** Invoices a client has been sent (drafts and voided invoices stay internal), with the PDF. */
@Controller('portal/client/invoices')
@Roles('CLIENT_USER')
export class PortalInvoicesController {
  constructor(private readonly svc: RequestsService, private readonly prisma: PrismaService, private readonly finance: FinanceService) {}

  private async clientId(u: AuthUser) {
    const p = await this.svc.partyOf(u);
    if (p.kind !== 'client') throw new NotFoundException();
    return p.clientId;
  }

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.invoice.findMany({
      where: { organizationId: u.organizationId, clientId: await this.clientId(u), status: { in: ['SENT', 'PAID'] } },
      orderBy: { issuedAt: 'desc' },
      select: { id: true, number: true, status: true, currency: true, total: true, completes: true, issuedAt: true, dueAt: true, paidAt: true, project: { select: { id: true, projectCode: true, name: true } } },
    });
    const now = Date.now();
    return rows.map((r) => ({ ...r, total: Number(r.total), overdue: r.status === 'SENT' && !!r.dueAt && r.dueAt.getTime() < now }));
  }

  @Get(':id/pdf')
  async pdf(@CurrentUser() u: AuthUser, @Param('id') iid: string, @Res() res: Response) {
    const inv = await this.prisma.invoice.findFirst({ where: { id: iid, organizationId: u.organizationId, clientId: await this.clientId(u), status: { in: ['SENT', 'PAID'] } }, select: { id: true } });
    if (!inv) throw new NotFoundException('Invoice not found');
    const { buf, fileName } = await this.finance.invoicePdf(u, inv.id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName.replace(/[^\w.-]/g, '_')}"`, 'Cache-Control': 'no-store' });
    res.send(buf);
  }
}

/** Rejected completes a vendor can still dispute (not invoiced, not already in an open dispute). */
@Controller('portal/vendor/disputable')
@Roles('VENDOR_USER')
export class PortalDisputableController {
  constructor(private readonly svc: RequestsService, private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Query('projectId') projectId?: string) {
    const p = await this.svc.partyOf(u);
    if (p.kind !== 'vendor') throw new NotFoundException();
    const open = await this.prisma.ticket.findMany({ where: { organizationId: u.organizationId, vendorId: p.vendorId, kind: 'DISPUTE', status: { not: 'CLOSED' } }, select: { sessionIds: true } });
    const taken = new Set(open.flatMap((t) => t.sessionIds));
    const rows = await this.prisma.respondentSession.findMany({
      where: { organizationId: u.organizationId, isTest: false, status: 'COMPLETE', approval: 'REJECTED', invoiceId: null, vendorAllocation: { vendorId: p.vendorId }, ...(projectId ? { projectId } : {}) },
      select: { id: true, vendorRespondentId: true, approvalAt: true, outcomeAt: true, project: { select: { id: true, projectCode: true, name: true, vendorTitle: true } }, projectCountry: { select: { countryCode: true } } },
      orderBy: { approvalAt: 'desc' },
      take: 1000,
    });
    return rows.filter((r) => !taken.has(r.id)).map((r) => ({ id: r.id, uid: r.vendorRespondentId, rejectedAt: r.approvalAt, completedAt: r.outcomeAt, countryCode: r.projectCountry.countryCode, project: forVendor(r.project) }));
  }
}

@Module({
  imports: [FinanceModule],
  controllers: [RequestsController, FilesController, PortalRequestsController, PortalFilesController, PortalInvoicesController, PortalDisputableController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
