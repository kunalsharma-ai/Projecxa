/**
 * Team chat (docs/TEAM_CHAT.md): staff-only chat that runs on this SampTrek server, with no outside chat service.
 *
 * - Channels: General (everyone), Announcements (everyone reads, admins and the Super Admin post),
 *   one room per project, private groups and direct messages between two people.
 * - Live: the browser keeps one Server-Sent Events stream open (GET /chat/stream).
 * - Offline: every message has a growing `seq`, so a device that lost its connection asks for
 *   "everything after N" (GET /chat/sync). Messages written offline carry an id from the device
 *   (`clientId`); sending the same one twice saves it once, so the device can retry safely.
 * - Access (docs/TEAM_CHAT.md → Who gets chat): chat and its options are features. The Super Admin's plan gives them to
 *   the organisation and its admins; an admin then turns them on for their users in Settings → Features & access.
 * Client and vendor portal users never see the chat.
 */
import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param, Patch, Post, Query, Sse, MessageEvent } from '@nestjs/common';
import { ChatChannelKind, Prisma } from '@prisma/client';
import { Observable, Subject } from 'rxjs';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, STAFF } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService, userFeatures } from '../super-admin/entitlements';

const OPEN_KINDS: ChatChannelKind[] = ['GENERAL', 'ANNOUNCEMENTS', 'PROJECT'];
/** What someone may do in chat besides reading Announcements and General. */
export const CHAT_OPTIONS = ['general', 'project_rooms', 'groups', 'direct'] as const;
export type ChatOption = (typeof CHAT_OPTIONS)[number];
/** Present = chat is on for this person; the set holds their options. */
type Access = Set<ChatOption>;
const OFF = { statusCode: 403, code: 'CHAT_OFF', message: 'Team chat is not turned on for you. Ask your admin to allow it in Settings → Features & access.' };
export const TONES = ['on_track', 'at_risk', 'blocked', 'done'] as const;
const PAGE = 50;
const SYNC_LIMIT = 500;

const id = z.string().min(1).max(64);
export const sendSchema = z
  .object({
    body: z.string().trim().min(1, 'Write a message').max(4000),
    clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
    type: z.enum(['TEXT', 'UPDATE']).default('TEXT'),
    tone: z.enum(TONES).optional(),
  })
  .strict()
  .refine((b) => b.type !== 'UPDATE' || !!b.tone, { message: 'Pick how the project is doing', path: ['tone'] });
export const editSchema = z.object({ body: z.string().trim().min(1).max(4000) }).strict();
export const directSchema = z.object({ userId: id }).strict();
export const groupSchema = z.object({ name: z.string().trim().min(1).max(80), userIds: z.array(id).min(1).max(100) }).strict();
export const membersSchema = z.object({ userIds: z.array(id).min(1).max(100) }).strict();
export const channelSettingsSchema = z
  .object({ name: z.string().trim().min(1).max(80).optional(), adminsOnly: z.boolean().optional(), archived: z.boolean().optional(), muted: z.boolean().optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export const readSchema = z.object({ seq: z.number().int().min(0) }).strict();
export const messagesQuery = z.object({ before: z.coerce.number().int().optional(), after: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(200).optional() });
export const syncQuery = z.object({ after: z.coerce.number().int().min(0).default(0), changedSince: z.string().datetime().optional(), latestOnly: z.enum(['true', 'false']).optional() });

/** What travels on the live stream. `audience` limits private channels to their members. */
interface ChatEvent { organizationId: string; audience: string[] | null; type: string; data: unknown; kind?: ChatChannelKind }

const author = { select: { id: true, name: true, role: true, superAdmin: true } } as const;
type MsgRow = Prisma.ChatMessageGetPayload<{ include: { author: typeof author } }>;

const isAdmin = (u: AuthUser) => u.role === 'ADMIN' || !!u.superAdmin;

export function shapeMessage(m: MsgRow) {
  return {
    id: m.id,
    seq: m.seq,
    channelId: m.channelId,
    type: m.type,
    tone: m.tone,
    body: m.deletedAt ? '' : m.body,
    clientId: m.clientId,
    author: m.author ? { id: m.author.id, name: m.author.name, role: m.author.role, superAdmin: m.author.superAdmin } : null,
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    deletedAt: m.deletedAt,
  };
}
export type ChatMessageOut = ReturnType<typeof shapeMessage>;

@Injectable()
export class ChatService {
  private readonly bus = new Subject<ChatEvent>();
  /** Open live streams per person, for the green "online" dot. One API process; see docs/TEAM_CHAT.md for several. */
  private readonly online = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  // ─── Access ──────────────────────────────────────────────────────────────

  /**
   * Everyone in the organisation who has chat, with their options. Chat and each option are features
   * (docs/FEATURE_ACCESS.md): the Super Admin's plan and switches decide what the organisation and each admin
   * get, and the organisation's Admin decides which users get chat and which options (Settings → Features & access).
   */
  async accessMap(orgId: string): Promise<Map<string, Access>> {
    const [org, rows] = await Promise.all([
      this.entitlements.loadOrg(orgId),
      this.prisma.user.findMany({ where: { organizationId: orgId, active: true, role: { in: STAFF } }, select: { id: true, role: true, superAdmin: true, mobileAccess: true, featuresOff: true, mobileFeaturesOff: true } }),
    ]);
    const map = new Map<string, Access>();
    for (const r of rows) {
      const f = userFeatures(org, r).web;
      if (f.chat) map.set(r.id, new Set(CHAT_OPTIONS.filter((o) => f[`chat.${o}`])));
    }
    return map;
  }

  /** This person's chat access, worked out once per request. */
  private readonly accessCache = new WeakMap<AuthUser, Promise<Access | null>>();
  access(u: AuthUser): Promise<Access | null> {
    let p = this.accessCache.get(u);
    if (!p) {
      p = this.accessMap(u.organizationId).then((m) => m.get(u.id) ?? null);
      this.accessCache.set(u, p);
    }
    return p;
  }
  private async need(u: AuthUser, option?: ChatOption, message?: string): Promise<Access> {
    const a = await this.access(u);
    if (!a) throw new ForbiddenException(OFF);
    if (option && !a.has(option)) throw new ForbiddenException(message ?? 'Your admin has not turned this on for you (Settings → Features & access).');
    return a;
  }

  async me(u: AuthUser) {
    const a = await this.access(u);
    return { enabled: !!a, options: a ? [...a] : [] };
  }

  /** General and Announcements always exist; made on first use, once per organisation. */
  private async ensureDefaults(orgId: string) {
    for (const [key, kind] of [['general', 'GENERAL'], ['announcements', 'ANNOUNCEMENTS']] as const) {
      await this.prisma.chatChannel.upsert({
        where: { organizationId_key: { organizationId: orgId, key } },
        create: { organizationId: orgId, key, kind, adminsOnly: kind === 'ANNOUNCEMENTS' },
        update: {},
      });
    }
  }

  private async visible(u: AuthUser): Promise<Prisma.ChatChannelWhereInput> {
    const a = await this.need(u);
    return {
      organizationId: u.organizationId,
      OR: [
        { kind: { in: a.has('project_rooms') ? OPEN_KINDS : ['GENERAL', 'ANNOUNCEMENTS'] } },
        { kind: { in: a.has('direct') ? ['GROUP', 'DIRECT'] : ['GROUP'] }, members: { some: { userId: u.id, member: true } } },
      ],
    };
  }

  private async channelFor(u: AuthUser, channelId: string) {
    const ch = await this.prisma.chatChannel.findFirst({ where: { id: channelId, ...(await this.visible(u)) }, include: { members: { where: { member: true }, select: { userId: true } } } });
    if (!ch) throw new NotFoundException('Conversation not found');
    return ch;
  }

  /** Who may post here, in plain words, or null when this person may. */
  private postBlock(u: AuthUser, ch: { kind: ChatChannelKind; adminsOnly: boolean; archivedAt: Date | null }, a: Access) {
    if (ch.archivedAt) return 'This conversation is archived.';
    if ((ch.kind === 'ANNOUNCEMENTS' || ch.adminsOnly) && !isAdmin(u)) return 'Only admins and the Super Admin post here.';
    if (ch.kind === 'GENERAL' && !a.has('general')) return 'You can read General. Your admin has not turned on posting here for you.';
    return null;
  }

  private audienceOf(ch: { kind: ChatChannelKind; members: { userId: string }[] }) {
    return OPEN_KINDS.includes(ch.kind) ? null : ch.members.map((m) => m.userId);
  }

  private emit(organizationId: string, audience: string[] | null, type: string, data: unknown, kind?: ChatChannelKind) {
    this.bus.next({ organizationId, audience, type, data, kind });
  }

  /** Teammates who have chat (and, for direct messages, that option). */
  private async staffIds(u: AuthUser, ids: string[], option?: ChatOption) {
    const unique = [...new Set(ids)];
    const map = await this.accessMap(u.organizationId);
    if (unique.some((id) => !map.has(id))) throw new BadRequestException('Pick people from your team who have team chat');
    if (option && unique.some((id) => !map.get(id)!.has(option))) throw new BadRequestException('That person does not have direct messages turned on');
    return unique;
  }

  // ─── Channels ────────────────────────────────────────────────────────────

  async channels(u: AuthUser) {
    const a = await this.need(u);
    await this.ensureDefaults(u.organizationId);
    const rows = await this.prisma.chatChannel.findMany({
      where: await this.visible(u),
      include: {
        project: { select: { id: true, projectCode: true, name: true, status: true } },
        members: { where: { member: true }, select: { userId: true, user: { select: { id: true, name: true, role: true, superAdmin: true } } } },
      },
    });
    const ids = rows.map((r) => r.id);
    const [reads, unread, last] = ids.length
      ? await Promise.all([
          this.prisma.chatMember.findMany({ where: { userId: u.id, channelId: { in: ids } }, select: { channelId: true, readSeq: true, muted: true } }),
          this.prisma.$queryRaw<{ channelId: string; n: bigint }[]>`
            SELECT m."channelId", count(*) AS n FROM "ChatMessage" m
            LEFT JOIN "ChatMember" r ON r."channelId" = m."channelId" AND r."userId" = ${u.id}
            WHERE m."channelId" = ANY(${ids}) AND m.seq > COALESCE(r."readSeq", 0)
              AND m."authorId" IS DISTINCT FROM ${u.id} AND m."deletedAt" IS NULL
            GROUP BY m."channelId"`,
          this.prisma.$queryRaw<{ id: string }[]>`
            SELECT DISTINCT ON ("channelId") id FROM "ChatMessage" WHERE "channelId" = ANY(${ids}) ORDER BY "channelId", seq DESC`,
        ])
      : [[], [], []];
    const lastMsgs = last.length ? await this.prisma.chatMessage.findMany({ where: { id: { in: last.map((l) => l.id) } }, include: { author } }) : [];
    const readBy = new Map(reads.map((r) => [r.channelId, r]));
    const unreadBy = new Map(unread.map((r) => [r.channelId, Number(r.n)]));
    const lastBy = new Map(lastMsgs.map((m) => [m.channelId, shapeMessage(m)]));
    const order: Record<ChatChannelKind, number> = { ANNOUNCEMENTS: 0, GENERAL: 1, PROJECT: 2, GROUP: 3, DIRECT: 4 };
    return rows
      .map((c) => {
        const other = c.kind === 'DIRECT' ? c.members.find((m) => m.userId !== u.id)?.user ?? null : null;
        return {
          id: c.id,
          kind: c.kind,
          name: c.kind === 'GENERAL' ? 'General' : c.kind === 'ANNOUNCEMENTS' ? 'Announcements' : c.kind === 'PROJECT' ? `${c.project?.projectCode} · ${c.project?.name}` : c.kind === 'DIRECT' ? other?.name ?? 'Former teammate' : c.name ?? 'Group',
          project: c.project,
          other,
          members: c.kind === 'GROUP' || c.kind === 'DIRECT' ? c.members.map((m) => m.user) : null,
          adminsOnly: c.adminsOnly || c.kind === 'ANNOUNCEMENTS',
          canPost: !this.postBlock(u, c, a),
          postBlock: this.postBlock(u, c, a),
          canManage: isAdmin(u) || (c.kind === 'GROUP' && c.createdById === u.id),
          archived: !!c.archivedAt,
          muted: readBy.get(c.id)?.muted ?? false,
          readSeq: readBy.get(c.id)?.readSeq ?? 0,
          unread: unreadBy.get(c.id) ?? 0,
          lastMessage: lastBy.get(c.id) ?? null,
          lastMessageAt: c.lastMessageAt,
        };
      })
      .sort((a, b) => order[a.kind] - order[b.kind] || (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0) || a.name.localeCompare(b.name));
  }

  async channel(u: AuthUser, channelId: string) {
    await this.channelFor(u, channelId);
    return (await this.channels(u)).find((c) => c.id === channelId)!;
  }

  /** The project's room, made the first time someone opens it. */
  async openProject(u: AuthUser, projectId: string) {
    await this.need(u, 'project_rooms', 'Your admin has not turned on project rooms for you.');
    const p = await this.prisma.project.findFirst({ where: { id: projectId, organizationId: u.organizationId }, select: { id: true, projectCode: true } });
    if (!p) throw new NotFoundException('Project not found');
    const existing = await this.prisma.chatChannel.findUnique({ where: { projectId } });
    const ch = existing ?? (await this.prisma.chatChannel.upsert({ where: { projectId }, create: { organizationId: u.organizationId, kind: 'PROJECT', projectId, createdById: u.id }, update: {} }));
    if (!existing) await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'chat.room.create', entityType: 'Project', entityId: p.id, detail: { projectId: p.id, projectCode: p.projectCode } });
    return this.channel(u, ch.id);
  }

  async openDirect(u: AuthUser, userId: string) {
    await this.need(u, 'direct', 'Your admin has not turned on direct messages for you.');
    if (userId === u.id) throw new BadRequestException('Pick someone else');
    await this.staffIds(u, [userId], 'direct');
    const key = [u.id, userId].sort().join(':');
    const ch = await this.prisma.chatChannel.upsert({
      where: { organizationId_key: { organizationId: u.organizationId, key } },
      create: { organizationId: u.organizationId, kind: 'DIRECT', key, createdById: u.id, members: { create: [{ userId: u.id }, { userId }] } },
      update: {},
    });
    return this.channel(u, ch.id);
  }

  async createGroup(u: AuthUser, b: z.infer<typeof groupSchema>) {
    await this.need(u, 'groups', 'Your admin has not turned on making groups for you.');
    const ids = await this.staffIds(u, [u.id, ...b.userIds]);
    const ch = await this.prisma.chatChannel.create({ data: { organizationId: u.organizationId, kind: 'GROUP', name: b.name, createdById: u.id, members: { create: ids.map((userId) => ({ userId })) } } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'chat.group.create', entityType: 'ChatChannel', entityId: ch.id, detail: { name: b.name, members: ids.length } });
    this.emit(u.organizationId, ids, 'channel', { channelId: ch.id });
    return this.channel(u, ch.id);
  }

  async addMembers(u: AuthUser, channelId: string, userIds: string[]) {
    const ch = await this.channelFor(u, channelId);
    if (ch.kind !== 'GROUP') throw new BadRequestException('People can be added to groups only');
    if (!isAdmin(u) && ch.createdById !== u.id) throw new ForbiddenException('Only the person who made the group, or an admin, adds people');
    const ids = await this.staffIds(u, userIds);
    for (const userId of ids) {
      await this.prisma.chatMember.upsert({ where: { channelId_userId: { channelId, userId } }, create: { channelId, userId }, update: { member: true } });
    }
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'chat.group.members', entityType: 'ChatChannel', entityId: channelId, detail: { added: ids.length } });
    this.emit(u.organizationId, [...ch.members.map((m) => m.userId), ...ids], 'channel', { channelId });
    return this.channel(u, channelId);
  }

  async leave(u: AuthUser, channelId: string) {
    const ch = await this.channelFor(u, channelId);
    if (ch.kind !== 'GROUP') throw new BadRequestException('Only groups can be left');
    await this.prisma.chatMember.update({ where: { channelId_userId: { channelId, userId: u.id } }, data: { member: false } });
    this.emit(u.organizationId, ch.members.map((m) => m.userId), 'channel', { channelId });
    return { ok: true };
  }

  async updateChannel(u: AuthUser, channelId: string, b: z.infer<typeof channelSettingsSchema>) {
    const ch = await this.channelFor(u, channelId);
    if (b.muted !== undefined) {
      await this.prisma.chatMember.upsert({ where: { channelId_userId: { channelId, userId: u.id } }, create: { channelId, userId: u.id, member: !OPEN_KINDS.includes(ch.kind), muted: b.muted }, update: { muted: b.muted } });
    }
    const { muted: _m, ...rest } = b;
    if (Object.keys(rest).length) {
      const manage = isAdmin(u) || (ch.kind === 'GROUP' && ch.createdById === u.id);
      if (!manage) throw new ForbiddenException('Only admins change this conversation');
      if (rest.name && ch.kind !== 'GROUP') throw new BadRequestException('Only groups can be renamed');
      if (rest.adminsOnly === false && ch.kind === 'ANNOUNCEMENTS') throw new BadRequestException('Announcements are always admins only');
      if (rest.archived !== undefined && (ch.kind === 'GENERAL' || ch.kind === 'ANNOUNCEMENTS')) throw new BadRequestException('General and Announcements cannot be archived');
      await this.prisma.chatChannel.update({
        where: { id: channelId },
        data: { ...(rest.name ? { name: rest.name } : {}), ...(rest.adminsOnly !== undefined ? { adminsOnly: rest.adminsOnly } : {}), ...(rest.archived !== undefined ? { archivedAt: rest.archived ? new Date() : null } : {}) },
      });
      await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'chat.channel.update', entityType: 'ChatChannel', entityId: channelId, detail: rest });
      this.emit(u.organizationId, this.audienceOf(ch), 'channel', { channelId });
    }
    return this.channel(u, channelId);
  }

  // ─── Messages ────────────────────────────────────────────────────────────

  async messages(u: AuthUser, channelId: string, q: z.infer<typeof messagesQuery>) {
    await this.channelFor(u, channelId);
    const take = q.limit ?? PAGE;
    const rows = await this.prisma.chatMessage.findMany({
      where: { channelId, ...(q.before ? { seq: { lt: q.before } } : q.after ? { seq: { gt: q.after } } : {}) },
      include: { author },
      orderBy: { seq: q.after ? 'asc' : 'desc' },
      take: take + 1,
    });
    const more = rows.length > take;
    const page = rows.slice(0, take).map(shapeMessage);
    return { items: q.after ? page : page.reverse(), more };
  }

  async send(u: AuthUser, channelId: string, b: z.infer<typeof sendSchema>) {
    const ch = await this.channelFor(u, channelId);
    if (b.clientId) {
      // Sent again after a dropped connection: the first one already arrived.
      const dup = await this.prisma.chatMessage.findUnique({ where: { authorId_clientId: { authorId: u.id, clientId: b.clientId } }, include: { author } });
      if (dup) {
        if (dup.channelId !== channelId) throw new BadRequestException('That message id was used for another conversation');
        return shapeMessage(dup);
      }
    }
    const block = this.postBlock(u, ch, await this.need(u));
    if (block) throw new ForbiddenException(block);
    if (b.type === 'UPDATE' && ch.kind !== 'PROJECT') throw new BadRequestException('Project updates go in a project room');
    let m: MsgRow;
    try {
      m = await this.prisma.chatMessage.create({
        data: { organizationId: u.organizationId, channelId, authorId: u.id, body: b.body, type: b.type, tone: b.type === 'UPDATE' ? b.tone : null, clientId: b.clientId ?? null },
        include: { author },
      });
    } catch (e) {
      if (b.clientId && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return shapeMessage((await this.prisma.chatMessage.findUnique({ where: { authorId_clientId: { authorId: u.id, clientId: b.clientId } }, include: { author } }))!);
      }
      throw e;
    }
    await this.prisma.chatChannel.update({ where: { id: channelId }, data: { lastMessageAt: m.createdAt } });
    await this.markRead(u, channelId, m.seq, ch.kind);
    const out = shapeMessage(m);
    this.emit(u.organizationId, this.audienceOf(ch), 'message', out, ch.kind);
    return out;
  }

  private async ownMessage(u: AuthUser, messageId: string) {
    const m = await this.prisma.chatMessage.findFirst({ where: { id: messageId, organizationId: u.organizationId } });
    if (!m) throw new NotFoundException('Message not found');
    const ch = await this.channelFor(u, m.channelId);
    return { m, ch };
  }

  async edit(u: AuthUser, messageId: string, body: string) {
    const { m, ch } = await this.ownMessage(u, messageId);
    if (m.authorId !== u.id) throw new ForbiddenException('You can edit your own messages only');
    if (m.deletedAt) throw new BadRequestException('This message was deleted');
    const r = await this.prisma.chatMessage.update({ where: { id: m.id }, data: { body, editedAt: new Date() }, include: { author } });
    const out = shapeMessage(r);
    this.emit(u.organizationId, this.audienceOf(ch), 'message', out, ch.kind);
    return out;
  }

  async remove(u: AuthUser, messageId: string) {
    const { m, ch } = await this.ownMessage(u, messageId);
    if (m.authorId !== u.id && !isAdmin(u)) throw new ForbiddenException('You can delete your own messages only');
    const r = await this.prisma.chatMessage.update({ where: { id: m.id }, data: { deletedAt: new Date() }, include: { author } });
    if (m.authorId !== u.id) await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'chat.message.delete', entityType: 'ChatChannel', entityId: ch.id, detail: { messageId: m.id, authorId: m.authorId } });
    const out = shapeMessage(r);
    this.emit(u.organizationId, this.audienceOf(ch), 'message', out, ch.kind);
    return out;
  }

  private async markRead(u: AuthUser, channelId: string, seq: number, kind: ChatChannelKind) {
    // Only moves forward, so an old device catching up never marks newer messages unread.
    const updated = await this.prisma.chatMember.updateMany({ where: { channelId, userId: u.id, readSeq: { lt: seq } }, data: { readSeq: seq } });
    if (!updated.count) {
      await this.prisma.chatMember.upsert({ where: { channelId_userId: { channelId, userId: u.id } }, create: { channelId, userId: u.id, member: !OPEN_KINDS.includes(kind), readSeq: seq }, update: {} });
    }
  }

  async read(u: AuthUser, channelId: string, seq: number) {
    const ch = await this.channelFor(u, channelId);
    await this.markRead(u, channelId, seq, ch.kind);
    this.emit(u.organizationId, [u.id], 'read', { channelId, seq });
    return { ok: true };
  }

  /**
   * Catching up after being offline: new messages after `after`, and edits/deletions since `changedSince`,
   * in every conversation this person can see.
   */
  async sync(u: AuthUser, q: z.infer<typeof syncQuery>) {
    await this.need(u);
    if (q.latestOnly === 'true') {
      // A new device: start from now and load each conversation when it is opened.
      const top = await this.prisma.chatMessage.aggregate({ where: { organizationId: u.organizationId }, _max: { seq: true } });
      return { items: [], more: false, latestSeq: top._max.seq ?? 0, serverTime: new Date().toISOString() };
    }
    const visible = await this.prisma.chatChannel.findMany({ where: await this.visible(u), select: { id: true } });
    const ids = visible.map((c) => c.id);
    const fresh = await this.prisma.chatMessage.findMany({ where: { channelId: { in: ids }, seq: { gt: q.after } }, include: { author }, orderBy: { seq: 'asc' }, take: SYNC_LIMIT + 1 });
    const changed = q.changedSince
      ? await this.prisma.chatMessage.findMany({ where: { channelId: { in: ids }, seq: { lte: q.after }, updatedAt: { gt: new Date(q.changedSince) } }, include: { author }, orderBy: { seq: 'asc' }, take: SYNC_LIMIT })
      : [];
    const more = fresh.length > SYNC_LIMIT;
    const items = [...changed, ...fresh.slice(0, SYNC_LIMIT)].map(shapeMessage);
    const top = await this.prisma.chatMessage.aggregate({ where: { organizationId: u.organizationId }, _max: { seq: true } });
    return { items, more, latestSeq: more ? fresh[SYNC_LIMIT - 1].seq : Math.max(q.after, top._max.seq ?? 0), serverTime: new Date().toISOString() };
  }

  // ─── People and live stream ──────────────────────────────────────────────

  /** Teammates who have chat. */
  async people(u: AuthUser) {
    await this.need(u);
    const map = await this.accessMap(u.organizationId);
    const rows = await this.prisma.user.findMany({ where: { id: { in: [...map.keys()] } }, select: { id: true, name: true, email: true, role: true, superAdmin: true, lastSeenAt: true }, orderBy: { name: 'asc' } });
    return rows.map((p) => ({ ...p, direct: map.get(p.id)!.has('direct'), online: (this.online.get(p.id) ?? 0) > 0 }));
  }

  stream(u: AuthUser): Observable<MessageEvent> {
    return new Observable<MessageEvent>((sub) => {
      let a: Access | null = null;
      let closed = false;
      this.access(u).then((x) => { a = x; if (!x && !closed) sub.error(new ForbiddenException(OFF)); });
      const was = this.online.get(u.id) ?? 0;
      this.online.set(u.id, was + 1);
      if (!was) this.emit(u.organizationId, null, 'presence', { userId: u.id, online: true });
      sub.next({ type: 'hello', data: { userId: u.id, serverTime: new Date().toISOString() } });
      const s = this.bus.subscribe((e) => {
        if (e.organizationId !== u.organizationId) return;
        if (e.audience && !e.audience.includes(u.id)) return;
        if (!a || (e.kind === 'PROJECT' && !a.has('project_rooms')) || (e.kind === 'DIRECT' && !a.has('direct'))) return;
        sub.next({ type: e.type, data: e.data as object });
      });
      // Keeps proxies from closing a quiet connection.
      const ping = setInterval(() => sub.next({ type: 'ping', data: String(Date.now()) }), 25_000);
      return () => {
        closed = true;
        s.unsubscribe();
        clearInterval(ping);
        const n = (this.online.get(u.id) ?? 1) - 1;
        if (n > 0) this.online.set(u.id, n);
        else {
          this.online.delete(u.id);
          this.emit(u.organizationId, null, 'presence', { userId: u.id, online: false });
        }
      };
    });
  }
}

@Controller('chat')
export class ChatController {
  constructor(private readonly svc: ChatService) {}

  @Sse('stream')
  stream(@CurrentUser() u: AuthUser) {
    return this.svc.stream(u);
  }

  @Get('sync')
  sync(@CurrentUser() u: AuthUser, @Query(new ZodPipe(syncQuery)) q: z.infer<typeof syncQuery>) {
    return this.svc.sync(u, q);
  }

  @Get('people')
  people(@CurrentUser() u: AuthUser) {
    return this.svc.people(u);
  }

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.svc.me(u);
  }

  @Get('channels')
  channels(@CurrentUser() u: AuthUser) {
    return this.svc.channels(u);
  }

  @Post('direct')
  direct(@CurrentUser() u: AuthUser, @Body(new ZodPipe(directSchema)) b: z.infer<typeof directSchema>) {
    return this.svc.openDirect(u, b.userId);
  }

  @Post('groups')
  group(@CurrentUser() u: AuthUser, @Body(new ZodPipe(groupSchema)) b: z.infer<typeof groupSchema>) {
    return this.svc.createGroup(u, b);
  }

  @Post('projects/:projectId')
  @HttpCode(200)
  project(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string) {
    return this.svc.openProject(u, projectId);
  }

  @Get('channels/:id')
  channel(@CurrentUser() u: AuthUser, @Param('id') channelId: string) {
    return this.svc.channel(u, channelId);
  }

  @Patch('channels/:id')
  update(@CurrentUser() u: AuthUser, @Param('id') channelId: string, @Body(new ZodPipe(channelSettingsSchema)) b: z.infer<typeof channelSettingsSchema>) {
    return this.svc.updateChannel(u, channelId, b);
  }

  @Post('channels/:id/members')
  @HttpCode(200)
  members(@CurrentUser() u: AuthUser, @Param('id') channelId: string, @Body(new ZodPipe(membersSchema)) b: z.infer<typeof membersSchema>) {
    return this.svc.addMembers(u, channelId, b.userIds);
  }

  @Delete('channels/:id/members/me')
  leave(@CurrentUser() u: AuthUser, @Param('id') channelId: string) {
    return this.svc.leave(u, channelId);
  }

  @Get('channels/:id/messages')
  messages(@CurrentUser() u: AuthUser, @Param('id') channelId: string, @Query(new ZodPipe(messagesQuery)) q: z.infer<typeof messagesQuery>) {
    return this.svc.messages(u, channelId, q);
  }

  @Post('channels/:id/messages')
  send(@CurrentUser() u: AuthUser, @Param('id') channelId: string, @Body(new ZodPipe(sendSchema)) b: z.infer<typeof sendSchema>) {
    return this.svc.send(u, channelId, b);
  }

  @Post('channels/:id/read')
  @HttpCode(200)
  read(@CurrentUser() u: AuthUser, @Param('id') channelId: string, @Body(new ZodPipe(readSchema)) b: z.infer<typeof readSchema>) {
    return this.svc.read(u, channelId, b.seq);
  }

  @Patch('messages/:id')
  edit(@CurrentUser() u: AuthUser, @Param('id') messageId: string, @Body(new ZodPipe(editSchema)) b: z.infer<typeof editSchema>) {
    return this.svc.edit(u, messageId, b.body);
  }

  @Delete('messages/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id') messageId: string) {
    return this.svc.remove(u, messageId);
  }
}

@Module({ controllers: [ChatController], providers: [ChatService], exports: [ChatService] })
export class ChatModule {}

