import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Injectable, Logger, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles, STAFF } from '../auth/decorators';
import { BrandingService } from '../branding/branding';
import { ZodPipe } from '../common/zod.pipe';
import { MailNotConfigured, MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsModule } from '../projects/projects.controller';
import { ProjectsService } from '../projects/projects.service';
import { PushService } from '../push/push';
import { idsMatching } from '../prisma/mongo-compat';

/**
 * Team collaboration on a project (docs/TEAM_COLLABORATION.md): staff comments with @mentions,
 * a handover checklist when a project moves to another project manager, and the project's activity feed.
 * Everything here is staff only; portals never see it.
 */

export const DEFAULT_HANDOVER_ITEMS: { key: string; label: string }[] = [
  { key: 'links', label: 'Live and test survey links checked in QA studio' },
  { key: 'redirects', label: 'Redirects and vendor callbacks verified' },
  { key: 'vendors', label: 'Vendors, allocations and CPIs explained' },
  { key: 'quotas', label: 'Quotas, targets and field end date reviewed' },
  { key: 'client', label: 'Client contact, expectations and deadlines shared' },
  { key: 'open-work', label: 'Open requests, tasks and disputes passed on' },
  { key: 'finance', label: 'Reconciliation and invoicing status explained' },
];

export interface HandoverItem { key: string; label: string; done: boolean; doneById: string | null; doneAt: string | null }

export const commentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment').max(5000), mentionIds: z.array(z.string().max(64)).max(20).optional() }).strict();
export const editCommentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment').max(5000), mentionIds: z.array(z.string().max(64)).max(20).optional() }).strict();
export const handoverSchema = z
  .object({
    toUserId: z.string().min(1).max(64),
    note: z.string().trim().max(2000).nullable().optional(),
    extraItems: z.array(z.string().trim().min(1).max(160)).max(10).optional(),
    skip: z.array(z.string().max(32)).max(DEFAULT_HANDOVER_ITEMS.length).optional(),
    makeManager: z.boolean().default(true),
  })
  .strict();
export const tickSchema = z.object({ done: z.boolean() }).strict();
export const activitySchema = z.object({
  kind: z.enum(['all', 'comments', 'handovers', 'changes', 'fieldwork', 'requests']).default('all'),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

const MENTION_WINDOW_DAYS = 14;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the text says "@Name" for this person (not part of a longer word or e-mail address). */
export function mentions(body: string, name: string) {
  if (!name.trim()) return false;
  return new RegExp(`(^|[^\\w@.])@${escRe(name.trim())}(?![\\w])`, 'i').test(body);
}

/** Which kind of feed entry an audit action is, for the filter chips. */
export function activityKind(action: string): 'comments' | 'handovers' | 'fieldwork' | 'requests' | 'changes' {
  if (action.startsWith('comment.')) return 'comments';
  if (action.startsWith('handover.')) return 'handovers';
  if (/^(autopilot|respondent|sessions|monitor|reallocation)\./.test(action)) return 'fieldwork';
  if (/^(request|file)\./.test(action)) return 'requests';
  return 'changes';
}

const LABELS: Record<string, string> = {
  'project.create': 'created the project',
  'project.update': 'changed project settings',
  'project.clone': 'created this project as a clone',
  'project.restore-settings': 'restored earlier settings',
  'project.page-design': 'changed the respondent pages',
  'country.add': 'added a market',
  'country.clone': 'copied a market',
  'comment.create': 'commented',
  'comment.edit': 'edited a comment',
  'comment.delete': 'deleted a comment',
  'handover.start': 'started a handover',
  'handover.tick': 'ticked a handover item',
  'handover.untick': 'unticked a handover item',
  'handover.accept': 'accepted the handover',
  'handover.cancel': 'cancelled the handover',
  'redirect.schedule': 'scheduled a redirect change',
  'redirect.schedule-cancel': 'cancelled a scheduled redirect change',
  'redirect.schedule-failed': 'scheduled redirect change did not go live',
  'sessions.approved': 'approved completes',
  'sessions.rejected': 'rejected completes',
  'sessions.pending': 'reset completes to pending',
  'autopilot.pause_link': 'Autopilot paused a vendor link',
  'autopilot.pause_market': 'Autopilot paused a market',
  'autopilot.close_link': 'Autopilot closed a vendor link',
  'autopilot.auto_pause_off': 'Auto-pause switched off',
  'unique-links.revoke': 'revoked unique links',
  'client-links.upload': 'uploaded client unique links',
  'respondent.bad-signature': 'Blocked an entry with a bad link signature',
  'respondent.shared-link-blocked': 'Blocked a shared respondent link',
  'request.create': 'opened a request',
  'request.update': 'updated a request',
  'request.dispute-decision': 'decided a dispute',
};

export function activityLabel(action: string) {
  if (LABELS[action]) return LABELS[action];
  const words = action.replace(/[._-]+/g, ' ').trim();
  return words.charAt(0).toLowerCase() + words.slice(1);
}

/** One short line about what changed, when the audit detail has something worth showing. */
function activitySummary(action: string, detail: unknown, names: Map<string, string>): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as Record<string, unknown>;
  if (typeof d.summary === 'string') return d.summary;
  if (action === 'project.update') {
    const keys = Object.keys(d).filter((k) => d[k] !== undefined);
    if (d.status) return `Status → ${String(d.status)}`;
    if (typeof d.projectManagerId === 'string') return `Project manager → ${names.get(d.projectManagerId) ?? 'someone else'}`;
    return keys.length ? `Changed: ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? '…' : ''}` : null;
  }
  if (action === 'country.add' && d.countryCode) return String(d.countryCode);
  if (action === 'country.clone' && d.from) return `${String(d.from)} → ${String(d.to)}`;
  if (action.startsWith('sessions.') && typeof d.count === 'number') return `${d.count} complete${d.count === 1 ? '' : 's'}`;
  if (action.startsWith('redirect.') && d.version) return `Version ${String(d.version)}`;
  if (typeof d.text === 'string') return clip(d.text, 160);
  if (typeof d.ref === 'string') return d.ref;
  return null;
}

type Handover = Prisma.ProjectHandoverGetPayload<object>;

@Injectable()
export class CollaborationService {
  private readonly log = new Logger(CollaborationService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly branding: BrandingService,
    private readonly push: PushService,
    private readonly projects: ProjectsService,
  ) {}

  private async project(u: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, organizationId: u.organizationId }, select: { id: true, projectCode: true, name: true, projectManagerId: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private async names(orgId: string, ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = uniq.length ? await this.prisma.user.findMany({ where: { id: { in: uniq }, organizationId: orgId }, select: { id: true, name: true } }) : [];
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Active staff who can be @mentioned (portal logins never). */
  async people(u: AuthUser) {
    return this.prisma.user.findMany({
      where: { organizationId: u.organizationId, active: true, role: { in: STAFF } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * The staff a comment mentions. Ids picked from the @ list count while their "@Name" is still in the
   * text; a typed "@Name" counts when exactly one active staff member has that name.
   */
  async resolveMentions(u: AuthUser, body: string, picked: string[] = []) {
    const staff = await this.people(u);
    const byId = new Map(staff.map((s) => [s.id, s]));
    const out = new Set<string>();
    for (const id of picked) {
      const s = byId.get(id);
      if (s && mentions(body, s.name)) out.add(id);
    }
    const sameName = new Map<string, number>();
    for (const s of staff) sameName.set(s.name.toLowerCase(), (sameName.get(s.name.toLowerCase()) ?? 0) + 1);
    for (const s of staff) {
      if (out.has(s.id) || sameName.get(s.name.toLowerCase())! > 1) continue;
      if (mentions(body, s.name)) out.add(s.id);
    }
    return [...out];
  }

  // ─────────────────────────────── Comments ───────────────────────────────

  async comments(u: AuthUser, projectId: string) {
    await this.project(u, projectId);
    const rows = await this.prisma.projectComment.findMany({ where: { projectId, organizationId: u.organizationId }, orderBy: { createdAt: 'asc' }, take: 500 });
    const people = await this.names(u.organizationId, rows.flatMap((r) => [r.authorId, ...r.mentionIds]));
    return rows.map((r) => this.shapeComment(u, r, people));
  }

  private shapeComment(u: AuthUser, r: Prisma.ProjectCommentGetPayload<object>, people: Map<string, string>) {
    return {
      id: r.id,
      body: r.body,
      author: { id: r.authorId, name: people.get(r.authorId) ?? 'Someone' },
      mentions: r.mentionIds.map((id) => ({ id, name: people.get(id) ?? 'Someone' })),
      mine: r.authorId === u.id,
      canDelete: r.authorId === u.id || u.role === 'ADMIN',
      editedAt: r.editedAt,
      createdAt: r.createdAt,
    };
  }

  async addComment(u: AuthUser, projectId: string, b: z.infer<typeof commentSchema>) {
    const p = await this.project(u, projectId);
    const mentionIds = await this.resolveMentions(u, b.body, b.mentionIds);
    const c = await this.prisma.projectComment.create({ data: { organizationId: u.organizationId, projectId, authorId: u.id, body: b.body, mentionIds } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'comment.create', entityType: 'Project', entityId: projectId, detail: { commentId: c.id, summary: clip(b.body, 160), mentions: mentionIds.length } });
    await this.notifyMentions(u, p, c, mentionIds.filter((id) => id !== u.id));
    return this.shapeComment(u, c, await this.names(u.organizationId, [u.id, ...mentionIds]));
  }

  async editComment(u: AuthUser, projectId: string, id: string, b: z.infer<typeof editCommentSchema>) {
    const p = await this.project(u, projectId);
    const c = await this.prisma.projectComment.findFirst({ where: { id, projectId, organizationId: u.organizationId } });
    if (!c) throw new NotFoundException('Comment not found');
    if (c.authorId !== u.id) throw new ForbiddenException('Only the person who wrote a comment can edit it');
    const mentionIds = await this.resolveMentions(u, b.body, b.mentionIds);
    const updated = await this.prisma.projectComment.update({ where: { id }, data: { body: b.body, mentionIds, editedAt: new Date() } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'comment.edit', entityType: 'Project', entityId: projectId, detail: { commentId: id, summary: clip(b.body, 160) } });
    // Only people newly mentioned by the edit hear about it.
    await this.notifyMentions(u, p, updated, mentionIds.filter((m) => m !== u.id && !c.mentionIds.includes(m)));
    return this.shapeComment(u, updated, await this.names(u.organizationId, [u.id, ...mentionIds]));
  }

  async deleteComment(u: AuthUser, projectId: string, id: string) {
    await this.project(u, projectId);
    const c = await this.prisma.projectComment.findFirst({ where: { id, projectId, organizationId: u.organizationId } });
    if (!c) throw new NotFoundException('Comment not found');
    if (c.authorId !== u.id && u.role !== 'ADMIN') throw new ForbiddenException('Only the writer or an admin can delete a comment');
    await this.prisma.projectComment.delete({ where: { id } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'comment.delete', entityType: 'Project', entityId: projectId, detail: { commentId: id } });
    return { ok: true };
  }

  /** Email (Zoho Mail / SMTP from Settings → Integrations) and phone push to each person mentioned. Never blocks the comment. */
  private async notifyMentions(u: AuthUser, p: { id: string; projectCode: string; name: string }, c: { id: string; body: string }, to: string[]) {
    if (!to.length) return;
    try {
      await this.push.notify(to, 'team', { title: `${u.name} mentioned you on ${p.projectCode}`, body: clip(c.body, 140), path: `/projects/${p.id}` });
      const people = await this.prisma.user.findMany({ where: { id: { in: to }, organizationId: u.organizationId, active: true }, select: { email: true } });
      if (!people.length) return;
      const brand = await this.branding.brand(u.organizationId);
      const link = `${brand.webBase}/projects/${p.id}?tab=team#comment-${c.id}`;
      const subject = `${u.name} mentioned you on ${p.projectCode}: ${p.name}`;
      const text = `${u.name} mentioned you in a comment on ${p.projectCode} (${p.name}) in ${brand.appName}.\n\n"${clip(c.body, 1000)}"\n\nOpen it: ${link}\n`;
      const html = `<p>${esc(u.name)} mentioned you in a comment on <b>${esc(p.projectCode)}</b> (${esc(p.name)}).</p><blockquote style="border-left:3px solid #ccc;margin:0;padding:4px 12px;white-space:pre-wrap">${esc(clip(c.body, 1000))}</blockquote><p><a href="${esc(link)}">Open the comment in ${esc(brand.appName)}</a></p>`;
      for (const person of people) {
        await this.mail.send({ organizationId: u.organizationId, to: [person.email], subject: clip(subject, 200), text, html, fromName: brand.emailFromName, replyTo: brand.emailReplyTo });
      }
    } catch (e) {
      if (!(e instanceof MailNotConfigured)) this.log.warn(`Mention email failed: ${(e as Error).message}`);
    }
  }

  // ─────────────────────────────── Handovers ───────────────────────────────

  private shapeHandover(u: AuthUser, h: Handover, people: Map<string, string>) {
    const items = (h.items as unknown as HandoverItem[]) ?? [];
    const party = h.fromUserId === u.id || h.toUserId === u.id || u.role === 'ADMIN';
    return {
      id: h.id,
      status: h.status,
      from: { id: h.fromUserId, name: people.get(h.fromUserId) ?? 'Someone' },
      to: { id: h.toUserId, name: people.get(h.toUserId) ?? 'Someone' },
      note: h.note,
      makeManager: h.makeManager,
      items: items.map((i) => ({ ...i, doneBy: i.doneById ? people.get(i.doneById) ?? 'Someone' : null })),
      done: items.filter((i) => i.done).length,
      total: items.length,
      canTick: h.status === 'OPEN' && party,
      canAccept: h.status === 'OPEN' && h.toUserId === u.id,
      canCancel: h.status === 'OPEN' && (h.fromUserId === u.id || u.role === 'ADMIN'),
      acceptedAt: h.acceptedAt,
      cancelledAt: h.cancelledAt,
      createdAt: h.createdAt,
    };
  }

  private async shapeAll(u: AuthUser, rows: Handover[]) {
    const people = await this.names(
      u.organizationId,
      rows.flatMap((h) => [h.fromUserId, h.toUserId, ...((h.items as unknown as HandoverItem[]) ?? []).map((i) => i.doneById)]),
    );
    return rows.map((h) => this.shapeHandover(u, h, people));
  }

  async handovers(u: AuthUser, projectId: string) {
    await this.project(u, projectId);
    const rows = await this.prisma.projectHandover.findMany({ where: { projectId, organizationId: u.organizationId }, orderBy: { createdAt: 'desc' }, take: 20 });
    return { handovers: await this.shapeAll(u, rows), defaults: DEFAULT_HANDOVER_ITEMS };
  }

  private async handover(u: AuthUser, projectId: string, id: string) {
    const h = await this.prisma.projectHandover.findFirst({ where: { id, projectId, organizationId: u.organizationId } });
    if (!h) throw new NotFoundException('Handover not found');
    return h;
  }

  async startHandover(u: AuthUser, projectId: string, b: z.infer<typeof handoverSchema>) {
    const p = await this.project(u, projectId);
    if (b.toUserId === u.id) throw new BadRequestException('Hand the project to someone else');
    const to = await this.prisma.user.findFirst({ where: { id: b.toUserId, organizationId: u.organizationId, active: true, role: { in: EDITORS } }, select: { id: true, name: true, email: true } });
    if (!to) throw new BadRequestException('Hand over to an active admin or project manager');
    const open = await this.prisma.projectHandover.findFirst({ where: { projectId, status: 'OPEN' }, select: { id: true } });
    if (open) throw new BadRequestException('This project already has an open handover. Finish or cancel it first.');
    const skip = new Set(b.skip ?? []);
    const items: HandoverItem[] = [
      ...DEFAULT_HANDOVER_ITEMS.filter((i) => !skip.has(i.key)),
      ...(b.extraItems ?? []).map((label, n) => ({ key: `extra-${n + 1}`, label })),
    ].map((i) => ({ ...i, done: false, doneById: null, doneAt: null }));
    if (!items.length) throw new BadRequestException('Keep at least one checklist item');
    const h = await this.prisma.projectHandover.create({
      data: { organizationId: u.organizationId, projectId, fromUserId: u.id, toUserId: to.id, note: b.note || null, makeManager: b.makeManager, items: items as unknown as Prisma.InputJsonValue },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'handover.start', entityType: 'Project', entityId: projectId, detail: { handoverId: h.id, summary: `To ${to.name}, ${items.length} checklist items` } });
    await this.notifyHandover(u, p, [to.id], `${u.name} is handing ${p.projectCode} to you`, `${u.name} started a handover of ${p.projectCode} (${p.name}) to you with ${items.length} checklist items.${b.note ? `\n\nNote: ${b.note}` : ''}`);
    return (await this.shapeAll(u, [h]))[0];
  }

  async tick(u: AuthUser, projectId: string, id: string, key: string, done: boolean) {
    await this.project(u, projectId);
    const h = await this.handover(u, projectId, id);
    if (h.status !== 'OPEN') throw new BadRequestException('This handover is finished');
    if (h.fromUserId !== u.id && h.toUserId !== u.id && u.role !== 'ADMIN') throw new ForbiddenException('Only the two people in the handover can tick items');
    const items = (h.items as unknown as HandoverItem[]).map((i) => ({ ...i }));
    const item = items.find((i) => i.key === key);
    if (!item) throw new NotFoundException('Checklist item not found');
    if (item.done === done) return (await this.shapeAll(u, [h]))[0];
    Object.assign(item, done ? { done: true, doneById: u.id, doneAt: new Date().toISOString() } : { done: false, doneById: null, doneAt: null });
    const updated = await this.prisma.projectHandover.update({ where: { id }, data: { items: items as unknown as Prisma.InputJsonValue } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: done ? 'handover.tick' : 'handover.untick', entityType: 'Project', entityId: projectId, detail: { handoverId: id, summary: item.label } });
    return (await this.shapeAll(u, [updated]))[0];
  }

  async accept(u: AuthUser, projectId: string, id: string) {
    const p = await this.project(u, projectId);
    const h = await this.handover(u, projectId, id);
    if (h.status !== 'OPEN') throw new BadRequestException('This handover is finished');
    if (h.toUserId !== u.id) throw new ForbiddenException('Only the person receiving the project can accept the handover');
    const left = (h.items as unknown as HandoverItem[]).filter((i) => !i.done);
    if (left.length) throw new BadRequestException(`Tick every checklist item first (${left.length} left: ${left.map((i) => i.label).slice(0, 3).join('; ')}${left.length > 3 ? '…' : ''})`);
    const claimed = await this.prisma.projectHandover.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    if (!claimed.count) throw new BadRequestException('This handover is finished');
    // The receiver becomes the project manager through the normal project update, so it shows in History too.
    if (h.makeManager && p.projectManagerId !== u.id) await this.projects.update(u, projectId, { projectManagerId: u.id });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'handover.accept', entityType: 'Project', entityId: projectId, detail: { handoverId: id, summary: h.makeManager ? `${u.name} is now the project manager` : null } });
    await this.notifyHandover(u, p, [h.fromUserId], `${u.name} accepted the handover of ${p.projectCode}`, `${u.name} accepted the handover of ${p.projectCode} (${p.name}).${h.makeManager ? ` ${u.name} is now the project manager.` : ''}`);
    return (await this.shapeAll(u, [await this.handover(u, projectId, id)]))[0];
  }

  async cancel(u: AuthUser, projectId: string, id: string) {
    const p = await this.project(u, projectId);
    const h = await this.handover(u, projectId, id);
    if (h.status !== 'OPEN') throw new BadRequestException('This handover is finished');
    if (h.fromUserId !== u.id && u.role !== 'ADMIN') throw new ForbiddenException('Only the person handing over, or an admin, can cancel');
    const updated = await this.prisma.projectHandover.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'handover.cancel', entityType: 'Project', entityId: projectId, detail: { handoverId: id } });
    await this.notifyHandover(u, p, [h.toUserId], `Handover of ${p.projectCode} cancelled`, `${u.name} cancelled the handover of ${p.projectCode} (${p.name}).`);
    return (await this.shapeAll(u, [updated]))[0];
  }

  private async notifyHandover(u: AuthUser, p: { id: string; projectCode: string; name: string }, to: string[], subject: string, text: string) {
    const ids = to.filter((x) => x !== u.id);
    if (!ids.length) return;
    try {
      await this.push.notify(ids, 'team', { title: subject, body: p.name, path: `/projects/${p.id}` });
      const people = await this.prisma.user.findMany({ where: { id: { in: ids }, organizationId: u.organizationId, active: true }, select: { email: true } });
      if (!people.length) return;
      const brand = await this.branding.brand(u.organizationId);
      const link = `${brand.webBase}/projects/${p.id}?tab=team`;
      for (const person of people) {
        await this.mail.send({
          organizationId: u.organizationId,
          to: [person.email],
          subject: clip(subject, 200),
          text: `${text}\n\nOpen it: ${link}\n`,
          html: `<p style="white-space:pre-wrap">${esc(text)}</p><p><a href="${esc(link)}">Open the handover in ${esc(brand.appName)}</a></p>`,
          fromName: brand.emailFromName,
          replyTo: brand.emailReplyTo,
        });
      }
    } catch (e) {
      if (!(e instanceof MailNotConfigured)) this.log.warn(`Handover email failed: ${(e as Error).message}`);
    }
  }

  // ─────────────────────────────── Activity ───────────────────────────────

  /** Everything that happened on the project, newest first: changes, comments, handovers, fieldwork and requests. */
  async activity(u: AuthUser, projectId: string, q: z.infer<typeof activitySchema>) {
    await this.project(u, projectId);
    const prefix: Record<string, Prisma.AuditEventWhereInput> = {
      comments: { action: { startsWith: 'comment.' } },
      handovers: { action: { startsWith: 'handover.' } },
      requests: { OR: [{ action: { startsWith: 'request.' } }, { action: { startsWith: 'file.' } }] },
      fieldwork: { OR: ['autopilot.', 'respondent.', 'sessions.', 'monitor.', 'reallocation.'].map((s) => ({ action: { startsWith: s } })) },
      changes: { NOT: ['comment.', 'handover.', 'request.', 'file.', 'autopilot.', 'respondent.', 'sessions.', 'monitor.', 'reallocation.'].map((s) => ({ action: { startsWith: s } })) },
    };
    const mentioning = await idsMatching(this.prisma.auditEvent, { organizationId: u.organizationId, 'detail.projectId': projectId });
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        organizationId: u.organizationId,
        AND: [
          { OR: [{ entityType: 'Project', entityId: projectId }, { id: { in: mentioning } }] },
          ...(q.kind !== 'all' ? [prefix[q.kind]] : []),
          ...(q.before ? [{ createdAt: { lt: new Date(q.before) } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const ids = page.flatMap((r) => {
      const d = (r.detail ?? {}) as Record<string, unknown>;
      return [r.actorId, typeof d.projectManagerId === 'string' ? d.projectManagerId : null];
    });
    const people = await this.names(u.organizationId, ids);
    return {
      items: page.map((r) => ({
        id: r.id,
        action: r.action,
        kind: activityKind(r.action),
        actor: r.actorId ? people.get(r.actorId) ?? 'Someone' : 'SampTrek',
        system: !r.actorId,
        label: activityLabel(r.action),
        summary: activitySummary(r.action, r.detail, people),
        at: r.createdAt,
      })),
      next: rows.length > q.limit ? page[page.length - 1].createdAt.toISOString() : null,
    };
  }

  // ─────────────────────────────── Bell ───────────────────────────────

  /** Notifications for the bell: recent @mentions of this person and handovers waiting for them. */
  async notifications(u: AuthUser) {
    const since = new Date(Date.now() - MENTION_WINDOW_DAYS * 86_400_000);
    const [comments, handovers] = await Promise.all([
      this.prisma.projectComment.findMany({
        where: { organizationId: u.organizationId, mentionIds: { has: u.id }, authorId: { not: u.id }, createdAt: { gte: since } },
        include: { project: { select: { id: true, projectCode: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.projectHandover.findMany({
        where: { organizationId: u.organizationId, toUserId: u.id, status: 'OPEN' },
        include: { project: { select: { id: true, projectCode: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);
    const people = await this.names(u.organizationId, [...comments.map((c) => c.authorId), ...handovers.map((h) => h.fromUserId)]);
    return [
      ...handovers.map((h) => {
        const items = h.items as unknown as HandoverItem[];
        return {
          id: `handover-${h.id}`,
          severity: 'warn' as const,
          title: `Handover of ${h.project.projectCode} from ${people.get(h.fromUserId) ?? 'a colleague'}`,
          detail: `${items.filter((i) => i.done).length} of ${items.length} checklist items ticked. Tick the rest and accept it on the Team tab.`,
          href: `/projects/${h.project.id}?tab=team`,
        };
      }),
      ...comments.map((c) => ({
        id: `mention-${c.id}`,
        severity: 'warn' as const,
        title: `${people.get(c.authorId) ?? 'Someone'} mentioned you on ${c.project.projectCode}`,
        detail: clip(c.body, 140),
        href: `/projects/${c.project.id}?tab=team#comment-${c.id}`,
      })),
    ];
  }
}

@Controller('projects/:id')
@Roles(...STAFF)
export class CollaborationController {
  constructor(private readonly svc: CollaborationService) {}

  @Get('mentionable')
  people(@CurrentUser() u: AuthUser) {
    return this.svc.people(u);
  }

  @Get('comments')
  comments(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.comments(u, id);
  }

  @Post('comments')
  addComment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(commentSchema)) b: z.infer<typeof commentSchema>) {
    return this.svc.addComment(u, id, b);
  }

  @Patch('comments/:commentId')
  editComment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('commentId') cid: string, @Body(new ZodPipe(editCommentSchema)) b: z.infer<typeof editCommentSchema>) {
    return this.svc.editComment(u, id, cid, b);
  }

  @Delete('comments/:commentId')
  deleteComment(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('commentId') cid: string) {
    return this.svc.deleteComment(u, id, cid);
  }

  @Get('handovers')
  handovers(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.handovers(u, id);
  }

  @Post('handovers')
  @Roles(...EDITORS)
  start(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(handoverSchema)) b: z.infer<typeof handoverSchema>) {
    return this.svc.startHandover(u, id, b);
  }

  @Patch('handovers/:handoverId/items/:key')
  tick(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('handoverId') hid: string, @Param('key') key: string, @Body(new ZodPipe(tickSchema)) b: z.infer<typeof tickSchema>) {
    return this.svc.tick(u, id, hid, key, b.done);
  }

  @Post('handovers/:handoverId/accept')
  accept(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('handoverId') hid: string) {
    return this.svc.accept(u, id, hid);
  }

  @Post('handovers/:handoverId/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('handoverId') hid: string) {
    return this.svc.cancel(u, id, hid);
  }

  @Get('activity')
  activity(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query(new ZodPipe(activitySchema)) q: z.infer<typeof activitySchema>) {
    return this.svc.activity(u, id, q);
  }
}

@Module({ imports: [ProjectsModule], controllers: [CollaborationController], providers: [CollaborationService], exports: [CollaborationService] })
export class CollaborationModule {}
