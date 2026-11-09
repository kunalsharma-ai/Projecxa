/**
 * Push notifications to the SampTrek phone app (docs/MOBILE_APP.md → Push notifications).
 *
 * Phones register their Expo push token with the categories the person wants. Messages go through
 * Expo's push service, which is free and needs no key unless the Expo account turned on enhanced
 * security (then the access token is saved in Settings → Integrations → Push notifications).
 * Sending never blocks or fails the action that caused it.
 */
import { BadRequestException, Body, Controller, Global, HttpCode, Injectable, Logger, Module, NotFoundException, Post } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { AllowWithoutMfa, CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';

export const PUSH_CATEGORIES = [
  { key: 'alerts', label: 'Fieldwork alerts', hint: 'Projects you manage: stalled, behind pace, quality spikes', staff: true },
  { key: 'requests', label: 'Requests', hint: 'New requests and replies meant for you', staff: false },
  { key: 'tasks', label: 'Task reminders', hint: 'When a reminder on your task is due', staff: true },
  { key: 'team', label: 'Mentions and handovers', hint: 'Someone @mentions you on a project or hands a project to you', staff: true },
  { key: 'won_bids', label: 'Won bids', hint: 'A bid won in SampBidx is ready to set up', staff: true },
] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number]['key'];

const PORTAL: Role[] = ['CLIENT_USER', 'VENDOR_USER'];
export const categoriesFor = (role: Role) => PUSH_CATEGORIES.filter((c) => !c.staff || !PORTAL.includes(role));

export interface PushMessage { title: string; body: string; path: string }

const tokenRe = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;
const deviceSchema = z
  .object({
    token: z.string().regex(tokenRe, 'Not an Expo push token'),
    platform: z.enum(['ios', 'android']),
    name: z.string().trim().max(80).optional(),
    categories: z.array(z.string().max(32)).max(10).optional(),
  })
  .strict();
const tokenSchema = z.object({ token: z.string().max(260) }).strict();

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  private shape(d: { id: string; categories: string[] }, role: Role, enabled: boolean) {
    return { id: d.id, categories: d.categories, available: categoriesFor(role).map(({ key, label, hint }) => ({ key, label, hint })), enabled };
  }

  /** Adds or refreshes a phone. A token signed in by someone else before moves to this person. */
  async register(u: AuthUser, b: z.infer<typeof deviceSchema>) {
    const allowed = categoriesFor(u.role as Role).map((c) => c.key as string);
    const existing = await this.prisma.pushDevice.findUnique({ where: { token: b.token } });
    const keep = existing && existing.userId === u.id;
    const categories = b.categories ? b.categories.filter((c) => allowed.includes(c)) : keep ? existing.categories.filter((c) => allowed.includes(c)) : allowed;
    const data = { organizationId: u.organizationId, userId: u.id, platform: b.platform, name: b.name ?? null, categories, lastSeenAt: new Date(), lastError: null };
    const d = await this.prisma.pushDevice.upsert({ where: { token: b.token }, create: { token: b.token, ...data }, update: data });
    return this.shape(d, u.role as Role, (await this.integrations.push()).enabled);
  }

  async remove(u: AuthUser, token: string) {
    await this.prisma.pushDevice.deleteMany({ where: { token, userId: u.id } });
    return { ok: true };
  }

  async test(u: AuthUser, token: string) {
    const d = await this.prisma.pushDevice.findFirst({ where: { token, userId: u.id } });
    if (!d) throw new NotFoundException('This phone is not registered. Open Account in the app again.');
    const c = await this.integrations.push();
    if (!c.enabled) throw new BadRequestException('Push notifications are not turned on for this server yet.');
    const sent = await this.deliver([d], { title: 'SampTrek', body: 'Push notifications work on this phone.', path: '/' }, c.accessToken);
    if (!sent) throw new BadRequestException(d.lastError ?? (await this.prisma.pushDevice.findUnique({ where: { id: d.id } }))?.lastError ?? 'Expo could not send the test push.');
    return { ok: true };
  }

  /** Sends to the phones of these people that want this category. */
  async notify(userIds: (string | null | undefined)[], category: PushCategory, m: PushMessage): Promise<number> {
    try {
      const ids = [...new Set(userIds.filter((x): x is string => !!x))];
      if (!ids.length) return 0;
      const c = await this.integrations.push();
      if (!c.enabled) return 0;
      const devices = await this.prisma.pushDevice.findMany({ where: { userId: { in: ids }, categories: { has: category }, user: { active: true } } });
      if (!devices.length) return 0;
      return await this.deliver(devices, m, c.accessToken);
    } catch (e) {
      this.log.warn(`Push (${category}) failed: ${(e as Error).message}`);
      return 0;
    }
  }

  /** Expo takes up to 100 messages a request. Tokens Expo reports as gone are removed. */
  private async deliver(devices: { id: string; token: string }[], m: PushMessage, accessToken: string | null): Promise<number> {
    let ok = 0;
    for (let i = 0; i < devices.length; i += 100) {
      const chunk = devices.slice(i, i + 100);
      const messages = chunk.map((d) => ({ to: d.token, title: clip(m.title, 80), body: clip(m.body, 180), sound: 'default', priority: 'high', channelId: 'default', data: { path: m.path } }));
      let status = 0;
      let j: { data?: { status: string; message?: string; details?: { error?: string } }[]; errors?: { message?: string }[] } = {};
      try {
        const r = await this.integrations.pushSend(messages, accessToken);
        status = r.status;
        j = JSON.parse((await r.text()) || '{}');
      } catch (e) {
        await this.prisma.pushDevice.updateMany({ where: { id: { in: chunk.map((d) => d.id) } }, data: { lastError: clip(`Could not reach Expo: ${(e as Error).message}`, 300) } });
        continue;
      }
      if (status !== 200 || !Array.isArray(j.data)) {
        const msg = clip(`Expo answered ${status}${j.errors?.[0]?.message ? `: ${j.errors[0].message}` : ''}`, 300);
        await this.prisma.pushDevice.updateMany({ where: { id: { in: chunk.map((d) => d.id) } }, data: { lastError: msg } });
        continue;
      }
      const now = new Date();
      for (let k = 0; k < chunk.length; k++) {
        const t = j.data[k];
        if (t?.status === 'ok') {
          ok++;
          await this.prisma.pushDevice.update({ where: { id: chunk[k].id }, data: { lastSentAt: now, lastError: null } });
        } else if (t?.details?.error === 'DeviceNotRegistered') {
          await this.prisma.pushDevice.deleteMany({ where: { id: chunk[k].id } });
        } else {
          await this.prisma.pushDevice.updateMany({ where: { id: chunk[k].id }, data: { lastError: clip(t?.message ?? 'Not sent', 300) } });
        }
      }
    }
    return ok;
  }

  // ───────────── What causes a push ─────────────

  /** A new fieldwork alert (warn or bad) goes to the project's manager, or the admins when it has no project. */
  async alertOpened(org: string, a: { severity: string; title: string; detail: string; project: { id: string; projectCode: string; name: string } | null }) {
    if (a.severity === 'info') return 0;
    let to: string[];
    if (a.project) {
      const p = await this.prisma.project.findUnique({ where: { id: a.project.id }, select: { projectManagerId: true } });
      to = p ? [p.projectManagerId] : [];
    } else {
      to = (await this.prisma.user.findMany({ where: { organizationId: org, role: 'ADMIN', active: true }, select: { id: true } })).map((x) => x.id);
    }
    return this.notify(to, 'alerts', {
      title: `${a.severity === 'bad' ? 'Urgent' : 'Check'}: ${a.project ? `${a.project.projectCode} · ` : ''}${a.title}`,
      body: a.detail,
      path: a.project ? `/projects/${a.project.id}` : '/monitor',
    });
  }

  /** A won bid arrived from SampBidx: admins and project managers. */
  async wonBidReceived(org: string, bid: { name: string; bidNumber?: string | null }) {
    const to = (await this.prisma.user.findMany({ where: { organizationId: org, role: { in: EDITORS }, active: true }, select: { id: true } })).map((x) => x.id);
    return this.notify(to, 'won_bids', { title: 'Won bid ready to set up', body: [bid.bidNumber, bid.name].filter(Boolean).join(' · '), path: '/won-bids' });
  }

  /** A request or reply meant for this person (the same person the email goes to). */
  async request(toId: string, toRole: Role, t: { id: string; ref: string; subject: string }, author: string, what: 'created' | 'reply') {
    const path = toRole === 'CLIENT_USER' ? '/portal/client' : toRole === 'VENDOR_USER' ? '/portal/vendor' : `/requests/${t.id}`;
    return this.notify([toId], 'requests', { title: what === 'created' ? `New request ${t.ref}` : `${author} replied on ${t.ref}`, body: t.subject, path });
  }

  /** Task reminders that came due since the last check, once each. */
  async taskReminders(now = new Date()) {
    const due = await this.prisma.task.findMany({
      where: { remindAt: { lte: now }, remindPushedAt: null, assigneeId: { not: null }, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      select: { id: true, title: true, assigneeId: true, dueAt: true, project: { select: { projectCode: true } } },
      take: 200,
    });
    let sent = 0;
    for (const t of due) {
      // Mark first, so a slow send is never repeated by the next run.
      const claimed = await this.prisma.task.updateMany({ where: { id: t.id, remindPushedAt: null }, data: { remindPushedAt: now } });
      if (!claimed.count) continue;
      sent += await this.notify([t.assigneeId], 'tasks', {
        title: `Reminder: ${t.title}`,
        body: [t.project?.projectCode, t.dueAt ? `due ${t.dueAt.toISOString().slice(0, 10)}` : null].filter(Boolean).join(' · ') || 'Open your tasks',
        path: '/tasks',
      });
    }
    return { due: due.length, sent };
  }

  @Interval(60_000)
  async tick() {
    if (process.env.PUSH_SCHEDULER_ENABLED === 'false' || this.running) return;
    this.running = true;
    try {
      await this.taskReminders();
    } catch (e) {
      this.log.error(`Task reminder push failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

/** The phone registers itself; everyone who can sign in to the app may. */
@Controller('push')
@AllowWithoutMfa()
@Roles('ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER', 'CLIENT_USER', 'VENDOR_USER')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('devices')
  @HttpCode(200)
  register(@CurrentUser() u: AuthUser, @Body(new ZodPipe(deviceSchema)) b: z.infer<typeof deviceSchema>) {
    return this.push.register(u, b);
  }

  @Post('devices/remove')
  @HttpCode(200)
  remove(@CurrentUser() u: AuthUser, @Body(new ZodPipe(tokenSchema)) b: z.infer<typeof tokenSchema>) {
    return this.push.remove(u, b.token);
  }

  @Post('test')
  @HttpCode(200)
  test(@CurrentUser() u: AuthUser, @Body(new ZodPipe(tokenSchema)) b: z.infer<typeof tokenSchema>) {
    return this.push.test(u, b.token);
  }
}

@Global()
@Module({ providers: [PushService], controllers: [PushController], exports: [PushService] })
export class PushModule {}
