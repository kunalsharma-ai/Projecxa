import { forVendor } from '../common/vendor-safe';
import { BrandingService } from '../branding/branding';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Prisma, SharedFileKind, TicketKind, TicketStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { config } from '../common/config';
import { MailNotConfigured, MailService } from '../mail/mail.service';
import { PushService } from '../push/push';
import { PrismaService } from '../prisma/prisma.service';

/** Who is asking: staff see everything in the organisation; a portal user only their own company's. */
export type Party = { kind: 'staff' } | { kind: 'client'; clientId: string } | { kind: 'vendor'; vendorId: string };

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const VISIBLE_PROJECT_STATUSES = ['TEST', 'LIVE', 'HOLD', 'CLOSED', 'INVOICED'] as const;

/** File types people can share. Anything a browser could run (HTML, SVG, scripts) is refused. */
const ALLOWED_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  zip: 'application/zip',
  sav: 'application/octet-stream',
};

/** Checks the start of the file matches what its extension says, for the types where that is cheap. */
function bytesMatch(ext: string, b: Buffer) {
  const head = (sig: number[]) => sig.every((x, i) => b[i] === x);
  if (ext === 'pdf') return b.subarray(0, 5).toString('latin1') === '%PDF-';
  if (ext === 'png') return head([0x89, 0x50, 0x4e, 0x47]);
  if (ext === 'jpg' || ext === 'jpeg') return head([0xff, 0xd8, 0xff]);
  if (['docx', 'xlsx', 'pptx', 'zip'].includes(ext)) return head([0x50, 0x4b, 0x03, 0x04]);
  if (['doc', 'xls', 'ppt'].includes(ext)) return head([0xd0, 0xcf, 0x11, 0xe0]);
  if (ext === 'csv' || ext === 'txt') return !b.subarray(0, 4096).includes(0) && !/<\s*(script|html|svg)/i.test(b.subarray(0, 4096).toString('utf8'));
  return true;
}

export const ticketRef = (n: number) => `REQ-${n}`;

type TicketWithParties = Prisma.TicketGetPayload<{ include: { client: { select: { id: true; name: true } }; vendor: { select: { id: true; name: true } }; project: { select: { id: true; projectCode: true; name: true; vendorTitle: true } } } }>;

@Injectable()
export class RequestsService {
  private readonly log = new Logger(RequestsService.name);
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly mail: MailService, private readonly branding: BrandingService, private readonly push: PushService) {}

  /** The company a portal user belongs to. */
  async partyOf(u: AuthUser): Promise<Party> {
    if (u.role !== 'CLIENT_USER' && u.role !== 'VENDOR_USER') return { kind: 'staff' };
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { clientId: true, vendorId: true } });
    if (u.role === 'CLIENT_USER' && user.clientId) return { kind: 'client', clientId: user.clientId };
    if (u.role === 'VENDOR_USER' && user.vendorId) return { kind: 'vendor', vendorId: user.vendorId };
    throw new ForbiddenException('This login is not linked to a company');
  }

  private partyWhere(p: Party) {
    return p.kind === 'client' ? { clientId: p.clientId } : p.kind === 'vendor' ? { vendorId: p.vendorId } : {};
  }

  /** A project the party may attach things to. Portals: their own, not drafts. */
  private async projectFor(orgId: string, p: Party, projectId: string) {
    const where: Prisma.ProjectWhereInput = { id: projectId, organizationId: orgId };
    if (p.kind === 'client') Object.assign(where, { clientId: p.clientId, status: { in: [...VISIBLE_PROJECT_STATUSES] } });
    if (p.kind === 'vendor') Object.assign(where, { status: { in: [...VISIBLE_PROJECT_STATUSES] }, countries: { some: { allocations: { some: { vendorId: p.vendorId } } } } });
    const project = await this.prisma.project.findFirst({ where, select: { id: true, clientId: true, projectCode: true, projectManagerId: true } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  // ─────────────────────────────── Tickets ───────────────────────────────

  async list(orgId: string, p: Party, f: { status?: TicketStatus; kind?: TicketKind; clientId?: string; vendorId?: string; projectId?: string } = {}) {
    const rows = await this.prisma.ticket.findMany({
      where: {
        organizationId: orgId,
        ...this.partyWhere(p),
        ...(f.status ? { status: f.status } : {}),
        ...(f.kind ? { kind: f.kind } : {}),
        ...(p.kind === 'staff' && f.clientId ? { clientId: f.clientId } : {}),
        ...(p.kind === 'staff' && f.vendorId ? { vendorId: f.vendorId } : {}),
        ...(f.projectId ? { projectId: f.projectId } : {}),
      },
      orderBy: [{ lastMessageAt: 'desc' }],
      take: 300,
      include: { client: { select: { id: true, name: true } }, vendor: { select: { id: true, name: true } }, project: { select: { id: true, projectCode: true, name: true, vendorTitle: true } }, _count: { select: { messages: p.kind === 'staff' ? true : { where: { internal: false } } } } },
    });
    const people = await this.names(orgId, rows.flatMap((r) => [r.createdById, r.assigneeId]));
    return rows.map((r) => ({ ...this.shape(r, p, people), messages: r._count.messages }));
  }

  private shape(r: TicketWithParties, p: Party, people: Map<string, string>) {
    return {
      id: r.id,
      ref: ticketRef(r.number),
      number: r.number,
      kind: r.kind,
      status: r.status,
      subject: r.subject,
      // A portal never learns the other side's company; it already knows its own.
      client: p.kind === 'staff' ? r.client : undefined,
      vendor: p.kind === 'staff' ? r.vendor : undefined,
      // Vendors see the vendor-facing title, never the internal project name.
      project: r.project ? (p.kind === 'vendor' ? forVendor(r.project) : (({ vendorTitle: _v, ...x }) => x)(r.project)) : null,
      createdBy: people.get(r.createdById) ?? 'Someone',
      assignee: p.kind === 'staff' && r.assigneeId ? { id: r.assigneeId, name: people.get(r.assigneeId) ?? 'Someone' } : null,
      disputedCompletes: r.sessionIds.length,
      lastMessageAt: r.lastMessageAt,
      closedAt: r.closedAt,
      createdAt: r.createdAt,
    };
  }

  private async names(orgId: string, ids: (string | null)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    const users = uniq.length ? await this.prisma.user.findMany({ where: { id: { in: uniq }, organizationId: orgId }, select: { id: true, name: true } }) : [];
    return new Map(users.map((x) => [x.id, x.name]));
  }

  private async find(orgId: string, p: Party, id: string) {
    const t = await this.prisma.ticket.findFirst({
      where: { id, organizationId: orgId, ...this.partyWhere(p) },
      include: { client: { select: { id: true, name: true } }, vendor: { select: { id: true, name: true } }, project: { select: { id: true, projectCode: true, name: true, vendorTitle: true } } },
    });
    if (!t) throw new NotFoundException('Request not found');
    return t;
  }

  async get(orgId: string, p: Party, id: string, viewerId?: string) {
    const t = await this.find(orgId, p, id);
    const [messages, files, sessions] = await Promise.all([
      this.prisma.ticketMessage.findMany({ where: { ticketId: t.id, ...(p.kind === 'staff' ? {} : { internal: false }) }, orderBy: { createdAt: 'asc' } }),
      this.prisma.sharedFile.findMany({ where: { ticketId: t.id }, select: FILE_FIELDS, orderBy: { createdAt: 'asc' } }),
      t.sessionIds.length
        ? this.prisma.respondentSession.findMany({
            where: { id: { in: t.sessionIds }, organizationId: orgId },
            select: { id: true, vendorRespondentId: true, status: true, approval: true, approvalAt: true, invoiceId: true, outcomeAt: true, projectCountry: { select: { countryCode: true } } },
          })
        : [],
    ]);
    const people = await this.names(orgId, [t.createdById, t.assigneeId, ...messages.map((m) => m.authorId), ...files.map((f) => f.uploadedById)]);
    return {
      ...this.shape(t, p, people),
      messages: messages.map((m) => ({ id: m.id, body: m.body, internal: m.internal, fromPortal: m.fromPortal, author: people.get(m.authorId) ?? 'Someone', createdAt: m.createdAt })),
      files: files.map((f) => fileView(f, people, p.kind === 'staff', viewerId)),
      sessions: sessions.map((s) => ({
        id: s.id,
        uid: s.vendorRespondentId,
        countryCode: s.projectCountry.countryCode,
        status: s.status,
        approval: s.approval,
        invoiced: !!s.invoiceId,
        completedAt: s.outcomeAt,
      })),
    };
  }

  async create(
    u: AuthUser,
    p: Party,
    b: { subject: string; body: string; kind?: TicketKind; projectId?: string; sessionIds?: string[]; clientId?: string; vendorId?: string },
  ) {
    let clientId: string | null = p.kind === 'client' ? p.clientId : null;
    let vendorId: string | null = p.kind === 'vendor' ? p.vendorId : null;
    if (p.kind === 'staff') {
      if (!!b.clientId === !!b.vendorId) throw new BadRequestException('Open a request for one client or one vendor');
      if (b.clientId && !(await this.prisma.client.findFirst({ where: { id: b.clientId, organizationId: u.organizationId } }))) throw new BadRequestException('Unknown client');
      if (b.vendorId && !(await this.prisma.vendor.findFirst({ where: { id: b.vendorId, organizationId: u.organizationId } }))) throw new BadRequestException('Unknown vendor');
      clientId = b.clientId ?? null;
      vendorId = b.vendorId ?? null;
    }
    const kind = b.kind ?? 'QUESTION';
    let projectId = b.projectId ?? null;
    let sessionIds: string[] = [];
    if (kind === 'DISPUTE') {
      if (p.kind !== 'vendor') throw new BadRequestException('Only a vendor can dispute rejected completes');
      const ids = [...new Set(b.sessionIds ?? [])];
      if (!ids.length) throw new BadRequestException('Pick the rejected completes you dispute');
      const rows = await this.prisma.respondentSession.findMany({
        where: { id: { in: ids }, organizationId: u.organizationId, isTest: false, status: 'COMPLETE', approval: 'REJECTED', vendorAllocation: { vendorId: p.vendorId } },
        select: { id: true, projectId: true },
      });
      if (rows.length !== ids.length) throw new BadRequestException('Only your own completes that the client rejected can be disputed');
      const projects = new Set(rows.map((r) => r.projectId));
      if (projects.size !== 1) throw new BadRequestException('Dispute completes from one project at a time');
      projectId = [...projects][0];
      const open = await this.prisma.ticket.findFirst({ where: { organizationId: u.organizationId, kind: 'DISPUTE', status: { not: 'CLOSED' }, sessionIds: { hasSome: ids } }, select: { number: true } });
      if (open) throw new BadRequestException(`Some of these completes are already disputed in ${ticketRef(open.number)}`);
      sessionIds = ids;
    } else if (b.sessionIds?.length) {
      throw new BadRequestException('Completes can only be attached to a dispute');
    }
    let managerId: string | null = null;
    if (projectId) {
      const project = await this.projectFor(u.organizationId, p.kind === 'staff' ? (clientId ? { kind: 'client', clientId } : { kind: 'vendor', vendorId: vendorId! }) : p, projectId);
      managerId = project.projectManagerId;
    }

    const t = await this.withNumber(u.organizationId, (number) =>
      this.prisma.ticket.create({
        data: {
          organizationId: u.organizationId,
          number,
          kind,
          subject: b.subject.trim(),
          status: p.kind === 'staff' ? 'ANSWERED' : 'OPEN',
          clientId,
          vendorId,
          projectId,
          sessionIds,
          createdById: u.id,
          assigneeId: p.kind === 'staff' ? u.id : managerId,
          messages: { create: { authorId: u.id, body: b.body.trim(), fromPortal: p.kind !== 'staff' } },
        },
      }),
    );
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'request.create', entityType: 'Ticket', entityId: t.id, detail: { ref: ticketRef(t.number), kind, sessions: sessionIds.length } });
    await this.notify(t.id, u, 'created');
    return this.get(u.organizationId, p, t.id);
  }

  /** Numbers are per organisation; two requests created at once retry on the unique constraint. */
  private async withNumber<T>(orgId: string, make: (n: number) => Promise<T>): Promise<T> {
    for (let i = 0; i < 5; i++) {
      const last = await this.prisma.ticket.findFirst({ where: { organizationId: orgId }, orderBy: { number: 'desc' }, select: { number: true } });
      try {
        return await make((last?.number ?? 0) + 1);
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    throw new BadRequestException('Could not number the request; try again');
  }

  async reply(u: AuthUser, p: Party, id: string, b: { body: string; internal?: boolean }) {
    const t = await this.find(u.organizationId, p, id);
    const internal = p.kind === 'staff' && !!b.internal;
    const now = new Date();
    // A portal reply always puts the ball back with staff (and reopens a closed request); a staff answer
    // waits for the portal; an internal note changes nothing.
    const status: TicketStatus | undefined = internal ? undefined : p.kind === 'staff' ? (t.status === 'CLOSED' ? 'CLOSED' : 'ANSWERED') : 'OPEN';
    await this.prisma.$transaction([
      this.prisma.ticketMessage.create({ data: { ticketId: t.id, authorId: u.id, body: b.body.trim(), internal, fromPortal: p.kind !== 'staff' } }),
      this.prisma.ticket.update({ where: { id: t.id }, data: { lastMessageAt: now, ...(status ? { status, ...(status === 'OPEN' ? { closedAt: null } : {}) } : {}) } }),
    ]);
    if (!internal) await this.notify(t.id, u, 'reply');
    return this.get(u.organizationId, p, t.id);
  }

  async update(u: AuthUser, p: Party, id: string, b: { status?: TicketStatus; assigneeId?: string | null }) {
    const t = await this.find(u.organizationId, p, id);
    if (p.kind !== 'staff') {
      if (b.assigneeId !== undefined || (b.status && b.status !== 'CLOSED')) throw new ForbiddenException('You can only close your own requests');
    }
    if (b.assigneeId) {
      const staff = await this.prisma.user.findFirst({ where: { id: b.assigneeId, organizationId: u.organizationId, active: true, role: { in: ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER'] } } });
      if (!staff) throw new BadRequestException('Assign to an active staff member');
    }
    await this.prisma.ticket.update({
      where: { id: t.id },
      data: {
        ...(b.status ? { status: b.status, closedAt: b.status === 'CLOSED' ? new Date() : null } : {}),
        ...(b.assigneeId !== undefined ? { assigneeId: b.assigneeId } : {}),
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'request.update', entityType: 'Ticket', entityId: t.id, detail: { ref: ticketRef(t.number), ...b } });
    return this.get(u.organizationId, p, t.id);
  }

  /**
   * Staff decide a dispute: approve the disputed completes (unless already invoiced) or keep them
   * rejected. Either way the vendor gets the decision as a reply.
   */
  async decideDispute(u: AuthUser, id: string, b: { decision: 'APPROVE' | 'KEEP_REJECTED'; message?: string }) {
    const p: Party = { kind: 'staff' };
    const t = await this.find(u.organizationId, p, id);
    if (t.kind !== 'DISPUTE') throw new BadRequestException('This request is not a dispute');
    let changed = 0;
    if (b.decision === 'APPROVE') {
      const r = await this.prisma.respondentSession.updateMany({
        where: { id: { in: t.sessionIds }, organizationId: u.organizationId, status: 'COMPLETE', approval: 'REJECTED', invoiceId: null },
        data: { approval: 'APPROVED', approvalAt: new Date() },
      });
      changed = r.count;
    }
    const text =
      b.decision === 'APPROVE'
        ? `Approved ${changed} of ${t.sessionIds.length} disputed complete${t.sessionIds.length === 1 ? '' : 's'}.`
        : `The client's rejection of ${t.sessionIds.length} complete${t.sessionIds.length === 1 ? '' : 's'} stands.`;
    await this.prisma.$transaction([
      this.prisma.ticketMessage.create({ data: { ticketId: t.id, authorId: u.id, body: [text, b.message?.trim()].filter(Boolean).join('\n\n') } }),
      this.prisma.ticket.update({ where: { id: t.id }, data: { status: 'CLOSED', closedAt: new Date(), lastMessageAt: new Date() } }),
    ]);
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'request.dispute-decision', entityType: 'Ticket', entityId: t.id, detail: { ref: ticketRef(t.number), decision: b.decision, approved: changed, projectId: t.projectId } });
    await this.notify(t.id, u, 'reply');
    return this.get(u.organizationId, p, t.id);
  }

  /**
   * Email (when SMTP is set up) and push to the other side: a portal message goes to the assignee (or the project
   * manager); a staff answer goes to the person who opened the request. Failures never block the request.
   */
  private async notify(ticketId: string, author: AuthUser, what: 'created' | 'reply') {
    try {
      const t = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { project: { select: { projectManagerId: true } }, organization: { select: { name: true } } } });
      const fromPortal = author.role === 'CLIENT_USER' || author.role === 'VENDOR_USER';
      const toId = fromPortal ? t.assigneeId ?? t.project?.projectManagerId : t.createdById;
      if (!toId || toId === author.id) return;
      const to = await this.prisma.user.findFirst({ where: { id: toId, organizationId: t.organizationId, active: true }, select: { email: true, role: true } });
      if (!to) return;
      // Their phone too, when they use the app (independent of email being set up).
      await this.push.request(toId, to.role, { id: t.id, ref: ticketRef(t.number), subject: t.subject }, author.name, what);
      const portal = to.role === 'CLIENT_USER' || to.role === 'VENDOR_USER';
      const brand = await this.branding.brand(t.organizationId);
      const link = `${brand.webBase}${portal ? `/portal/requests/${t.id}` : `/requests/${t.id}`}`;
      const ref = ticketRef(t.number);
      const subject = what === 'created' ? `New request ${ref}: ${t.subject}` : `New reply on ${ref}: ${t.subject}`;
      const text = `${author.name} ${what === 'created' ? 'opened a request' : 'replied'} on ${t.organization.name} ${brand.appName}.\n\n${ref}: ${t.subject}\n\nOpen it: ${link}\n`;
      await this.mail.send({ organizationId: t.organizationId, to: [to.email], subject: subject.slice(0, 200), text, html: `<p>${esc(author.name)} ${what === 'created' ? 'opened a request' : 'replied'}.</p><p><b>${esc(ref)}</b>: ${esc(t.subject)}</p><p><a href="${esc(link)}">Open the request</a></p>`, fromName: brand.emailFromName, replyTo: brand.emailReplyTo });
    } catch (e) {
      if (!(e instanceof MailNotConfigured)) this.log.warn(`Request email failed: ${(e as Error).message}`);
    }
  }

  // ─────────────────────────────── Files ───────────────────────────────

  async listFiles(orgId: string, p: Party, f: { projectId?: string; vendorId?: string; clientId?: string; kind?: SharedFileKind }, viewerId?: string) {
    const rows = await this.prisma.sharedFile.findMany({
      where: {
        organizationId: orgId,
        ...this.partyWhere(p),
        ...(f.projectId ? { projectId: f.projectId } : {}),
        ...(p.kind === 'staff' && f.vendorId ? { vendorId: f.vendorId } : {}),
        ...(p.kind === 'staff' && f.clientId ? { clientId: f.clientId } : {}),
        ...(f.kind ? { kind: f.kind } : {}),
      },
      select: FILE_FIELDS,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const people = await this.names(orgId, rows.map((r) => r.uploadedById));
    return rows.map((r) => fileView(r, people, p.kind === 'staff', viewerId));
  }

  async upload(
    u: AuthUser,
    p: Party,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    b: { kind?: SharedFileKind; projectId?: string; ticketId?: string; note?: string; expiresAt?: Date; clientId?: string; vendorId?: string },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a file');
    if (file.size > MAX_FILE_BYTES || file.buffer.length > MAX_FILE_BYTES) throw new PayloadTooLargeException('Files can be up to 10 MB');
    const name = file.originalname.replace(/[\\/\r\n\t"]/g, '_').slice(0, 180) || 'file';
    const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
    if (!(ext in ALLOWED_TYPES)) throw new BadRequestException(`.${ext || '?'} files cannot be shared. Use PDF, Word, Excel, PowerPoint, CSV, text, PNG, JPEG, ZIP or SPSS (.sav)`);
    if (!bytesMatch(ext, file.buffer)) throw new BadRequestException(`The file does not look like a .${ext} file`);

    const kind = b.kind ?? 'OTHER';
    let clientId: string | null = null;
    let vendorId: string | null = null;
    let projectId = b.projectId ?? null;
    let ticketId: string | null = null;
    if (p.kind === 'client') {
      if (!['QUESTIONNAIRE', 'OTHER'].includes(kind)) throw new BadRequestException('Clients can share questionnaires and other files');
      clientId = p.clientId;
    } else if (p.kind === 'vendor') {
      if (!['COMPLIANCE', 'OTHER'].includes(kind)) throw new BadRequestException('Vendors can share compliance documents and other files');
      vendorId = p.vendorId;
    } else {
      if (b.clientId && b.vendorId) throw new BadRequestException('Share a file with one client or one vendor');
      clientId = b.clientId ?? null;
      vendorId = b.vendorId ?? null;
      if (clientId && !(await this.prisma.client.findFirst({ where: { id: clientId, organizationId: u.organizationId } }))) throw new BadRequestException('Unknown client');
      if (vendorId && !(await this.prisma.vendor.findFirst({ where: { id: vendorId, organizationId: u.organizationId } }))) throw new BadRequestException('Unknown vendor');
    }
    if (b.ticketId) {
      const t = await this.find(u.organizationId, p, b.ticketId);
      ticketId = t.id;
      clientId = t.clientId;
      vendorId = t.vendorId;
      projectId = projectId ?? t.projectId;
    }
    if (projectId) {
      const owner: Party = p.kind !== 'staff' ? p : clientId ? { kind: 'client', clientId } : vendorId ? { kind: 'vendor', vendorId } : p;
      // Staff sharing with a client or vendor: the project must be that client's, or the vendor must work on it.
      const project = await this.projectFor(u.organizationId, owner, projectId).catch(() => {
        throw new BadRequestException(owner.kind === 'staff' ? 'Project not found' : owner.kind === 'client' ? 'That project is not this client’s' : 'This vendor does not work on that project');
      });
      projectId = project.id;
    }
    if (b.expiresAt && kind !== 'COMPLIANCE') throw new BadRequestException('Only compliance documents have an expiry date');

    const created = await this.prisma.sharedFile.create({
      data: {
        organizationId: u.organizationId,
        kind,
        name,
        contentType: ALLOWED_TYPES[ext],
        size: file.buffer.length,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        data: new Uint8Array(file.buffer),
        clientId,
        vendorId,
        projectId,
        ticketId,
        note: b.note?.trim() || null,
        expiresAt: b.expiresAt ?? null,
        uploadedById: u.id,
        fromPortal: p.kind !== 'staff',
      },
      select: FILE_FIELDS,
    });
    if (ticketId) await this.prisma.ticket.update({ where: { id: ticketId }, data: { lastMessageAt: new Date(), ...(p.kind !== 'staff' ? { status: 'OPEN', closedAt: null } : {}) } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'file.upload', entityType: 'SharedFile', entityId: created.id, detail: { name, kind, size: created.size, projectId, clientId, vendorId, ticketId } });
    return fileView(created, new Map([[u.id, u.name]]), p.kind === 'staff', u.id);
  }

  async download(u: AuthUser, p: Party, id: string) {
    const f = await this.prisma.sharedFile.findFirst({ where: { id, organizationId: u.organizationId, ...this.partyWhere(p) } });
    if (!f) throw new NotFoundException('File not found');
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'file.download', entityType: 'SharedFile', entityId: f.id, detail: { name: f.name } });
    return f;
  }

  async remove(u: AuthUser, p: Party, id: string) {
    const f = await this.prisma.sharedFile.findFirst({ where: { id, organizationId: u.organizationId, ...this.partyWhere(p) } });
    if (!f) throw new NotFoundException('File not found');
    if (p.kind !== 'staff' && f.uploadedById !== u.id) throw new ForbiddenException('You can only remove files you shared');
    await this.prisma.sharedFile.delete({ where: { id: f.id } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'file.delete', entityType: 'SharedFile', entityId: f.id, detail: { name: f.name, kind: f.kind } });
    return { ok: true };
  }

  /** Compliance documents that expired or expire within `days`, newest per vendor and name. */
  async expiringCompliance(orgId: string, days = 30, vendorId?: string) {
    const until = new Date(Date.now() + days * 86_400_000);
    return this.prisma.sharedFile.findMany({
      where: { organizationId: orgId, kind: 'COMPLIANCE', expiresAt: { lte: until }, ...(vendorId ? { vendorId } : {}) },
      select: { id: true, name: true, expiresAt: true, vendor: { select: { id: true, name: true } } },
      orderBy: { expiresAt: 'asc' },
      take: 50,
    });
  }
}

const FILE_FIELDS = {
  id: true,
  kind: true,
  name: true,
  contentType: true,
  size: true,
  note: true,
  expiresAt: true,
  uploadedById: true,
  fromPortal: true,
  createdAt: true,
  projectId: true,
  ticketId: true,
  clientId: true,
  vendorId: true,
  project: { select: { id: true, projectCode: true } },
  client: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
} satisfies Prisma.SharedFileSelect;

type FileRow = Prisma.SharedFileGetPayload<{ select: typeof FILE_FIELDS }>;

function fileView(f: FileRow, people: Map<string, string>, staff = true, viewerId?: string) {
  const expired = !!f.expiresAt && f.expiresAt.getTime() < Date.now();
  return {
    id: f.id,
    kind: f.kind,
    name: f.name,
    contentType: f.contentType,
    size: f.size,
    note: f.note,
    expiresAt: f.expiresAt,
    expired,
    fromPortal: f.fromPortal,
    uploadedBy: people.get(f.uploadedById) ?? 'Someone',
    mine: !!viewerId && f.uploadedById === viewerId,
    createdAt: f.createdAt,
    project: f.project,
    ticketId: f.ticketId,
    // Who it is shared with; portals only ever see their own files, so this is staff-only.
    sharedWith: staff ? (f.client ? { kind: 'client', ...f.client } : f.vendor ? { kind: 'vendor', ...f.vendor } : null) : undefined,
  };
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
