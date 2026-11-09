/**
 * Public status page (docs/STATUS_PAGE.md). The server checks itself every minute and stores the
 * result; a minute with no check counts as down, so time the server was off shows as downtime.
 * The Super Admin posts incidents and planned maintenance, which appear on /status for clients,
 * vendors and staff, without signing in.
 */
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Logger, Module, NotFoundException, Param, Patch, Post, Put, Res } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma, StatusIncident } from '@prisma/client';
import { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { IntegrationsService } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';

export type Health = 'up' | 'degraded' | 'down';
export const COMPONENTS = [
  { key: 'app', label: 'Website and API', description: 'Signing in, the CRM, portals and the public API.' },
  { key: 'links', label: 'Respondent links and redirects', description: 'Survey entry links, security checks and redirects back to vendors.' },
  { key: 'database', label: 'Database', description: 'Where projects, respondents and reports are stored.' },
  { key: 'callbacks', label: 'Vendor callbacks and webhooks', description: 'Status callbacks and event webhooks sent to vendors and clients.' },
  { key: 'email', label: 'Email sending', description: 'Reports, invitations, password resets and notifications.' },
] as const;
export type ComponentKey = (typeof COMPONENTS)[number]['key'];
const KEYS = COMPONENTS.map((c) => c.key) as string[];

export const IMPACTS = ['minor', 'major', 'maintenance'] as const;
export const INCIDENT_STATES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export const MAINTENANCE_STATES = ['scheduled', 'in_progress', 'completed'] as const;
const CLOSED = ['resolved', 'completed'];

export interface StatusSettings { enabled: boolean; title: string; intro: string; components: string[] }
export const DEFAULT_STATUS_SETTINGS: StatusSettings = { enabled: true, title: 'SampTrek status', intro: 'Live status of SampTrek and the last 90 days of uptime.', components: [...KEYS] };

const DAY = 86_400_000;
const MIN = 60_000;
/** A check stands for this many minutes; a database slower than SLOW_MS counts as degraded. */
const SLOW_MS = 1500;
const CALLBACK_BACKLOG = 50;
const DAYS = 90;

export interface DayStat { date: string; uptime: number | null; minutes: number; downMinutes: number; degradedMinutes: number }

/**
 * Uptime per day from the stored checks. `counts[day][status]` = checks that day. Each check stands for
 * one minute; minutes of the day after `firstAt` and before `now` without a check are counted as down.
 */
export function dayStats(counts: Map<string, Partial<Record<Health, number>>>, firstAt: Date | null, now: Date, days = DAYS): DayStat[] {
  const out: DayStat[] = [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i--) {
    const start = today - i * DAY;
    const date = new Date(start).toISOString().slice(0, 10);
    const from = Math.max(start, firstAt ? firstAt.getTime() : Infinity);
    // The minute in progress counts once it has been checked.
    const to = Math.min(start + DAY, now.getTime() + MIN);
    const expected = Math.floor((to - from) / MIN);
    if (!firstAt || expected <= 0) { out.push({ date, uptime: null, minutes: 0, downMinutes: 0, degradedMinutes: 0 }); continue; }
    const c = counts.get(date) ?? {};
    const up = c.up ?? 0;
    const degraded = c.degraded ?? 0;
    // Checks marked down, and minutes with no check at all (the server was off), are both down.
    const downMinutes = Math.max(0, expected - Math.min(expected, up + degraded));
    out.push({ date, uptime: Math.round(((expected - downMinutes) / expected) * 100_000) / 1000, minutes: expected, downMinutes, degradedMinutes: Math.min(degraded, expected) });
  }
  return out;
}

export function overallOf(current: Health[], incidents: Pick<StatusIncident, 'impact' | 'state'>[]): 'operational' | 'degraded' | 'outage' | 'maintenance' {
  const open = incidents.filter((i) => !CLOSED.includes(i.state));
  if (current.includes('down') || open.some((i) => i.impact === 'major')) return 'outage';
  if (open.some((i) => i.impact === 'maintenance' && i.state === 'in_progress')) return 'maintenance';
  if (current.includes('degraded') || open.some((i) => i.impact === 'minor')) return 'degraded';
  return 'operational';
}

@Injectable()
export class StatusService {
  private readonly log = new Logger(StatusService.name);
  private cache: { at: number; body: unknown } | null = null;
  private lastPrune = 0;
  /** Swapped in tests. */
  now: () => Date = () => new Date();

  constructor(private readonly prisma: PrismaService, private readonly integrations: IntegrationsService, private readonly audit: AuditService) {}

  // ───────────── Checks ─────────────

  /** One look at every component. */
  async probe(): Promise<{ components: Record<ComponentKey, Health>; dbLatencyMs: number | null }> {
    let db: Health = 'down';
    let dbLatencyMs: number | null = null;
    const t = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbLatencyMs = Date.now() - t;
      db = dbLatencyMs > SLOW_MS ? 'degraded' : 'up';
    } catch { db = 'down'; }
    let callbacks: Health = db === 'down' ? 'down' : 'up';
    let email: Health = db === 'down' ? 'down' : 'up';
    if (db !== 'down') {
      const stuck = await this.prisma.callbackDelivery.count({ where: { state: 'PENDING', nextAttemptAt: { lt: new Date(this.now().getTime() - 15 * MIN) } } }).catch(() => 0);
      if (stuck >= CALLBACK_BACKLOG) callbacks = 'degraded';
      const owner = await this.integrations.ownerId().catch(() => null);
      const smtp = owner ? await this.prisma.integrationSetting.findUnique({ where: { organizationId_kind: { organizationId: owner, kind: 'smtp' } }, select: { lastTestOk: true } }).catch(() => null) : null;
      if (smtp?.lastTestOk === false) email = 'degraded';
    }
    const links: Health = db === 'down' ? 'down' : db;
    return { components: { app: 'up', links, database: db, callbacks, email }, dbLatencyMs };
  }

  @Interval(MIN)
  async tick() {
    if (process.env.STATUS_CHECKS_ENABLED === 'false') return;
    await this.check().catch((e: Error) => this.log.warn(`Status check could not be saved: ${e.message}`));
  }

  /** Takes and stores one check; prunes checks older than 90 days once an hour. */
  async check() {
    const p = await this.probe();
    const row = await this.prisma.uptimeCheck.create({ data: { at: this.now(), components: p.components, dbLatencyMs: p.dbLatencyMs } });
    if (Date.now() - this.lastPrune > 3_600_000) {
      this.lastPrune = Date.now();
      await this.prisma.uptimeCheck.deleteMany({ where: { at: { lt: new Date(this.now().getTime() - (DAYS + 1) * DAY) } } });
    }
    this.cache = null;
    return row;
  }

  // ───────────── Settings ─────────────

  async settings(): Promise<StatusSettings> {
    const owner = await this.integrations.ownerId();
    const o = owner ? await this.prisma.organization.findUnique({ where: { id: owner }, select: { platformSettings: true } }) : null;
    const saved = ((o?.platformSettings ?? {}) as { statusPage?: Partial<StatusSettings> }).statusPage ?? {};
    const s = { ...DEFAULT_STATUS_SETTINGS, ...saved };
    s.components = s.components.filter((k) => KEYS.includes(k));
    return s;
  }

  async saveSettings(u: AuthUser, body: Partial<StatusSettings>) {
    const owner = await this.integrations.ownerId();
    if (!owner) throw new BadRequestException('No organisation runs this server yet');
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: owner }, select: { platformSettings: true } });
    const next = { ...(await this.settings()), ...body };
    await this.prisma.organization.update({ where: { id: owner }, data: { platformSettings: { ...((o.platformSettings ?? {}) as object), statusPage: next } as Prisma.InputJsonValue } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'status.settings', entityType: 'StatusPage', entityId: 'settings', detail: { enabled: next.enabled, components: next.components } });
    this.cache = null;
    return this.admin();
  }

  // ───────────── The page ─────────────

  private async uptime(keys: string[]) {
    const now = this.now();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - (DAYS - 1) * DAY);
    const rows = await this.prisma.$queryRaw<{ d: string; key: string; s: string; n: bigint }[]>`
      SELECT to_char(date_trunc('day', c."at"), 'YYYY-MM-DD') AS d, e.key AS key, e.value #>> '{}' AS s, count(*) AS n
      FROM "UptimeCheck" c, jsonb_each(c."components") e
      WHERE c."at" >= ${since} AND c."at" <= ${now}
      GROUP BY 1, 2, 3`;
    const first = await this.prisma.uptimeCheck.findFirst({ orderBy: { at: 'asc' }, select: { at: true } });
    const out: Record<string, DayStat[]> = {};
    for (const k of keys) {
      const counts = new Map<string, Partial<Record<Health, number>>>();
      for (const r of rows.filter((x) => x.key === k)) counts.set(r.d, { ...(counts.get(r.d) ?? {}), [r.s as Health]: Number(r.n) });
      out[k] = dayStats(counts, first?.at ?? null, now);
    }
    return out;
  }

  private async current(): Promise<Record<string, Health>> {
    const last = await this.prisma.uptimeCheck.findFirst({ orderBy: { at: 'desc' } });
    if (last && this.now().getTime() - last.at.getTime() < 3 * MIN) return last.components as Record<string, Health>;
    return (await this.probe()).components;
  }

  private incidentView(i: StatusIncident) {
    return { id: i.id, title: i.title, impact: i.impact, state: i.state, components: i.components, updates: i.updates, startsAt: i.startsAt, endsAt: i.endsAt, resolvedAt: i.resolvedAt, createdAt: i.createdAt };
  }

  /** What /status shows. Cached for 30 seconds. */
  async page() {
    const s = await this.settings();
    if (!s.enabled) throw new NotFoundException('This status page is not published');
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache.body;
    const body = await this.build(s);
    this.cache = { at: Date.now(), body };
    return body;
  }

  private async build(s: StatusSettings) {
    const now = this.now();
    const [current, uptime, incidents] = await Promise.all([
      this.current(),
      this.uptime(s.components),
      this.prisma.statusIncident.findMany({ where: { OR: [{ resolvedAt: null }, { resolvedAt: { gte: new Date(now.getTime() - 14 * DAY) } }] }, orderBy: { startsAt: 'desc' }, take: 50 }),
    ]);
    const open = incidents.filter((i) => !CLOSED.includes(i.state));
    const affected = (k: string) => open.filter((i) => i.components.includes(k) && !(i.impact === 'maintenance' && i.state === 'scheduled'));
    const components = COMPONENTS.filter((c) => s.components.includes(c.key)).map((c) => {
      let status: Health | 'maintenance' = current[c.key] ?? 'up';
      const inc = affected(c.key);
      if (inc.some((i) => i.impact === 'major')) status = 'down';
      else if (inc.some((i) => i.impact === 'maintenance') && status === 'up') status = 'maintenance';
      else if (inc.some((i) => i.impact === 'minor') && status === 'up') status = 'degraded';
      const days = uptime[c.key];
      const counted = days.filter((d) => d.uptime !== null);
      const total = counted.reduce((a, d) => a + d.downMinutes, 0);
      const minutes = counted.reduce((a, d) => a + d.minutes, 0);
      const uptime90 = minutes ? Math.round(((minutes - total) / minutes) * 100_000) / 1000 : null;
      return { key: c.key, label: c.label, description: c.description, status, uptime90, downMinutes90: total, days };
    });
    const health = components.map((c) => (c.status === 'maintenance' ? 'up' : c.status)) as Health[];
    return {
      title: s.title,
      intro: s.intro,
      overall: overallOf(health, incidents.filter((i) => s.components.length === 0 || i.components.length === 0 || i.components.some((k) => s.components.includes(k)))),
      components,
      incidents: {
        active: open.filter((i) => !(i.impact === 'maintenance' && i.state === 'scheduled')).map((i) => this.incidentView(i)),
        upcoming: open.filter((i) => i.impact === 'maintenance' && i.state === 'scheduled').sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()).map((i) => this.incidentView(i)),
        recent: incidents.filter((i) => CLOSED.includes(i.state)).map((i) => this.incidentView(i)),
      },
      checkedAt: now,
    };
  }

  /** Super Admin view: settings, the page as the public sees it (even when unpublished) and every incident. */
  async admin() {
    const s = await this.settings();
    const [page, incidents, last] = await Promise.all([
      this.build(s),
      this.prisma.statusIncident.findMany({ orderBy: { startsAt: 'desc' }, take: 100 }),
      this.prisma.uptimeCheck.findFirst({ orderBy: { at: 'desc' } }),
    ]);
    return { settings: s, catalog: COMPONENTS, page, incidents: incidents.map((i) => this.incidentView(i)), lastCheck: last ? { at: last.at, components: last.components, dbLatencyMs: last.dbLatencyMs } : null };
  }

  // ───────────── Incidents ─────────────

  async createIncident(u: AuthUser, b: z.infer<typeof incidentCreate>) {
    const states: readonly string[] = b.impact === 'maintenance' ? MAINTENANCE_STATES : INCIDENT_STATES;
    const state = b.state ?? (b.impact === 'maintenance' ? 'scheduled' : 'investigating');
    if (!states.includes(state)) throw new BadRequestException(`State must be one of ${states.join(', ')}`);
    const at = this.now();
    const i = await this.prisma.statusIncident.create({
      data: {
        title: b.title, impact: b.impact, state, components: b.components, startsAt: b.startsAt ?? at, endsAt: b.endsAt ?? null,
        resolvedAt: CLOSED.includes(state) ? at : null, createdById: u.id,
        updates: [{ at: at.toISOString(), state, message: b.message, by: u.name }],
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'status.incident_created', entityType: 'StatusIncident', entityId: i.id, detail: { title: b.title, impact: b.impact } });
    this.cache = null;
    return this.incidentView(i);
  }

  async updateIncident(u: AuthUser, id: string, b: z.infer<typeof incidentUpdate>) {
    const i = await this.prisma.statusIncident.findUnique({ where: { id } });
    if (!i) throw new NotFoundException('Incident not found');
    const states: readonly string[] = i.impact === 'maintenance' || b.impact === 'maintenance' ? MAINTENANCE_STATES : INCIDENT_STATES;
    if (b.state && !states.includes(b.state)) throw new BadRequestException(`State must be one of ${states.join(', ')}`);
    const at = this.now();
    const updates = (i.updates as unknown[]) ?? [];
    if (b.message) updates.push({ at: at.toISOString(), state: b.state ?? i.state, message: b.message, by: u.name });
    const state = b.state ?? i.state;
    const next = await this.prisma.statusIncident.update({
      where: { id },
      data: {
        title: b.title, impact: b.impact, components: b.components, startsAt: b.startsAt, endsAt: b.endsAt, state,
        resolvedAt: CLOSED.includes(state) ? (i.resolvedAt ?? at) : null,
        updates: updates as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'status.incident_updated', entityType: 'StatusIncident', entityId: id, detail: { state } });
    this.cache = null;
    return this.incidentView(next);
  }

  async removeIncident(u: AuthUser, id: string) {
    const r = await this.prisma.statusIncident.deleteMany({ where: { id } });
    if (!r.count) throw new NotFoundException('Incident not found');
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'status.incident_deleted', entityType: 'StatusIncident', entityId: id });
    this.cache = null;
    return { ok: true };
  }
}

const componentList = z.array(z.string().refine((k) => KEYS.includes(k), 'Unknown component')).max(KEYS.length);
const statusSettings = z.object({
  enabled: z.boolean().optional(),
  title: z.string().trim().min(1).max(80).optional(),
  intro: z.string().trim().max(400).optional(),
  components: componentList.optional(),
}).strict();
export const incidentCreate = z.object({
  title: z.string().trim().min(3).max(160),
  impact: z.enum(IMPACTS),
  state: z.string().max(20).optional(),
  components: componentList.default([]),
  message: z.string().trim().min(1).max(4000),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullable().optional(),
}).strict();
export const incidentUpdate = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  impact: z.enum(IMPACTS).optional(),
  state: z.string().max(20).optional(),
  components: componentList.optional(),
  message: z.string().trim().min(1).max(4000).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().nullable().optional(),
}).strict();

/** Public: the status page and a ping for outside uptime monitors (UptimeRobot, Better Stack…). */
@Public()
@Controller('public/status')
export class PublicStatusController {
  constructor(private readonly svc: StatusService, private readonly prisma: PrismaService) {}

  @Get() page() { return this.svc.page(); }

  /** 200 when the API and the database answer, 503 when the database does not. */
  @Get('ping')
  async ping(@Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ ok: true, at: new Date().toISOString() });
    } catch {
      res.status(503).json({ ok: false, at: new Date().toISOString(), message: 'The database is not answering' });
    }
  }
}

/** Super Admin → Status page. */
@Controller('super-admin/status')
@Roles('ADMIN')
export class StatusAdminController {
  constructor(private readonly svc: StatusService) {}

  @Get() admin() { return this.svc.admin(); }
  @Put('settings') save(@CurrentUser() u: AuthUser, @Body(new ZodPipe(statusSettings)) b: z.infer<typeof statusSettings>) { return this.svc.saveSettings(u, b); }
  @Post('check') @HttpCode(200) async check() { await this.svc.check(); return this.svc.admin(); }
  @Post('incidents') create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(incidentCreate)) b: z.infer<typeof incidentCreate>) { return this.svc.createIncident(u, b); }
  @Patch('incidents/:id') update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(incidentUpdate)) b: z.infer<typeof incidentUpdate>) { return this.svc.updateIncident(u, id, b); }
  @Delete('incidents/:id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.removeIncident(u, id); }
}

@Module({ providers: [StatusService], controllers: [PublicStatusController, StatusAdminController], exports: [StatusService] })
export class StatusModule {}
