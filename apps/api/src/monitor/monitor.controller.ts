import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { config } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { alertSettingsSchema, DEFAULT_ALERT_SETTINGS, settingsOf } from './monitor.rules';
import { MonitorService } from './monitor.service';
import { ReallocationController, ReallocationService } from './reallocation.service';
import { RoutingController } from './routing.controller';
import { RoutingService } from './routing.service';
import { VendorsModule } from '../vendors/vendors.controller';

const listSchema = z.object({
  state: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ACTIVE']).default('ACTIVE'),
  projectId: z.string().max(64).optional(),
});
const monitorQuery = z.object({ projectId: z.string().max(64).optional() });
const forecastQuery = z.object({ projectId: z.string().min(1).max(64) });
const webhookUrl = z
  .string()
  .url()
  .max(500)
  .refine((u) => u.startsWith('https://') || (config.allowHttpRedirects && u.startsWith('http://')), 'Use an https:// URL');
const settingsBody = z.object({ settings: alertSettingsSchema.optional(), webhookUrl: webhookUrl.nullable().optional() }).strict();

@Controller()
export class MonitorController {
  constructor(
    private readonly monitor: MonitorService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Live markets and vendor links with pace, plus the alerts that are not resolved. */
  @Get('monitor')
  async view(@CurrentUser() u: AuthUser, @Query(new ZodPipe(monitorQuery)) q: z.infer<typeof monitorQuery>) {
    if (q.projectId && !(await this.prisma.project.count({ where: { id: q.projectId, organizationId: u.organizationId } }))) throw new NotFoundException('Project not found');
    const [markets, alerts, org] = await Promise.all([
      this.monitor.markets(u.organizationId, q.projectId),
      this.alerts(u, { state: 'ACTIVE', projectId: q.projectId }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { alertSettings: true } }),
    ]);
    return { generatedAt: new Date(), markets, alerts, settings: settingsOf(org.alertSettings) };
  }

  /**
   * Predicted finish date, cost and margin for one live project (docs/PROFIT_FORECAST.md).
   * `forecast` is null when the project is not live or has no live or held markets.
   */
  @Get('monitor/forecast')
  async forecast(@CurrentUser() u: AuthUser, @Query(new ZodPipe(forecastQuery)) q: z.infer<typeof forecastQuery>) {
    const p = await this.prisma.project.findFirst({ where: { id: q.projectId, organizationId: u.organizationId }, select: { id: true, status: true } });
    if (!p) throw new NotFoundException('Project not found');
    const f = p.status === 'LIVE' ? (await this.monitor.forecasts(u.organizationId, p.id)).get(p.id) : undefined;
    return { forecast: f ?? null, reason: f ? null : p.status !== 'LIVE' ? 'The forecast runs while the project is live.' : 'No market is live or on hold.' };
  }

  /** Runs the rules now instead of waiting for the five-minute check. */
  @Post('monitor/run')
  @Roles(...EDITORS)
  run(@CurrentUser() u: AuthUser) {
    return this.monitor.evaluate(u.organizationId);
  }

  @Get('alerts')
  async alerts(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    const rows = await this.prisma.alert.findMany({
      where: {
        organizationId: u.organizationId,
        ...(q.state === 'ACTIVE' ? { state: { not: 'RESOLVED' } } : { state: q.state }),
        ...(q.projectId ? { projectId: q.projectId } : {}),
      },
      include: { project: { select: { id: true, projectCode: true, name: true } } },
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
    });
    const users = await this.prisma.user.findMany({
      where: { organizationId: u.organizationId, id: { in: rows.flatMap((r) => [r.acknowledgedById, r.resolvedBy]).filter((x): x is string => !!x && x !== 'auto') } },
      select: { id: true, name: true },
    });
    const name = (id: string | null) => (id === 'auto' ? 'Cleared by itself' : users.find((x) => x.id === id)?.name ?? null);
    return rows
      .sort(q.state === 'RESOLVED' ? () => 0 : MonitorService.rank)
      .map((r) => ({ ...r, acknowledgedBy: name(r.acknowledgedById), resolvedByName: name(r.resolvedBy) }));
  }

  @Post('alerts/:id/acknowledge')
  @Roles(...EDITORS)
  async acknowledge(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.prisma.alert.updateMany({ where: { id, organizationId: u.organizationId, state: 'OPEN' }, data: { state: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedById: u.id } });
    if (!r.count) throw new BadRequestException('Only open alerts can be acknowledged');
    return { ok: true };
  }

  /** Closes an alert by hand. If the problem is still there, the next check opens a new one. */
  @Post('alerts/:id/resolve')
  @Roles(...EDITORS)
  async resolve(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.prisma.alert.updateMany({ where: { id, organizationId: u.organizationId, state: { not: 'RESOLVED' } }, data: { state: 'RESOLVED', resolvedAt: new Date(), resolvedBy: u.id } });
    if (!r.count) throw new BadRequestException('This alert is already resolved');
    return { ok: true };
  }

  @Get('organization/alert-settings')
  @Roles('ADMIN')
  async getSettings(@CurrentUser() u: AuthUser) {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { alertSettings: true, alertWebhookUrl: true, alertWebhookSecret: true } });
    return { settings: settingsOf(o.alertSettings), defaults: DEFAULT_ALERT_SETTINGS, webhookUrl: o.alertWebhookUrl, hasSecret: !!o.alertWebhookSecret };
  }

  /** Saves thresholds and the webhook. A signing secret is created with the first webhook and shown once. */
  @Put('organization/alert-settings')
  @Roles('ADMIN')
  async saveSettings(@CurrentUser() u: AuthUser, @Body(new ZodPipe(settingsBody)) body: z.infer<typeof settingsBody>) {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { alertWebhookSecret: true } });
    const secret = body.webhookUrl && !o.alertWebhookSecret ? MonitorService.newSecret() : undefined;
    await this.prisma.organization.update({
      where: { id: u.organizationId },
      data: {
        ...(body.settings ? { alertSettings: body.settings } : {}),
        ...(body.webhookUrl !== undefined ? { alertWebhookUrl: body.webhookUrl } : {}),
        ...(secret ? { alertWebhookSecret: secret } : {}),
        ...(body.webhookUrl === null ? { alertWebhookSecret: null } : {}),
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'organization.alert-settings', entityType: 'Organization', entityId: u.organizationId, detail: { settings: body.settings, webhook: body.webhookUrl === undefined ? undefined : body.webhookUrl ? 'set' : 'removed' } });
    return { ...(await this.getSettings(u)), ...(secret ? { secret } : {}) };
  }

  @Post('organization/alert-settings/rotate-secret')
  @Roles('ADMIN')
  async rotate(@CurrentUser() u: AuthUser) {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { alertWebhookUrl: true } });
    if (!o.alertWebhookUrl) throw new BadRequestException('Add a webhook URL first');
    const secret = MonitorService.newSecret();
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { alertWebhookSecret: secret } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'organization.alert-webhook-rotate', entityType: 'Organization', entityId: u.organizationId });
    return { secret };
  }

  @Post('organization/alert-settings/test')
  @Roles('ADMIN')
  async test(@CurrentUser() u: AuthUser) {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { alertWebhookUrl: true, alertWebhookSecret: true } });
    if (!o.alertWebhookUrl || !o.alertWebhookSecret) throw new BadRequestException('Add a webhook URL first');
    return { status: await this.monitor.notify('test', o.alertWebhookUrl, o.alertWebhookSecret, true) };
  }
}

@Module({ imports: [VendorsModule], controllers: [MonitorController, ReallocationController, RoutingController], providers: [MonitorService, ReallocationService, RoutingService], exports: [MonitorService, ReallocationService, RoutingService] })
export class MonitorModule {}
