import { BadRequestException, Body, Controller, Delete, Get, Global, Injectable, Logger, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CallbackState, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { backoffMs, isPermanentFailure } from '../callbacks/callbacks.service';
import { config } from '../common/config';
import { hmacSha256, randomToken } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { EVENT_NAMES, WEBHOOK_EVENTS, WebhookEvent } from './webhook.events';

export type WebhookFetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string; redirect: 'manual'; signal: AbortSignal }) => Promise<{ status: number }>;

const MAX_ENDPOINTS = 10;
/** With the shared backoff (30s doubling, capped at 1h) this spreads retries over roughly six hours. */
const MAX_ATTEMPTS = 12;

const urlSchema = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine((u) => u.startsWith('https://') || (config.allowHttpRedirects && u.startsWith('http://')), 'Use an https:// URL');
const eventsSchema = z.array(z.enum(EVENT_NAMES as [WebhookEvent, ...WebhookEvent[]])).min(1, 'Pick at least one event').max(EVENT_NAMES.length);
export const createEndpointSchema = z.object({ url: urlSchema, description: z.string().trim().max(120).optional(), events: eventsSchema });
export const updateEndpointSchema = z.object({ url: urlSchema.optional(), description: z.string().trim().max(120).nullable().optional(), events: eventsSchema.optional(), active: z.boolean().optional() });

/** Signature over `${timestamp}.${body}`, sent as `sha256=<hex>` (same scheme as the alert webhook). */
export function signWebhook(secret: string, timestamp: string, body: string) {
  return `sha256=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

@Injectable()
export class WebhooksService {
  private readonly log = new Logger(WebhooksService.name);
  private running = false;
  fetcher: WebhookFetcher = (url, init) => fetch(url, init);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Queue an event for every active endpoint that subscribed to it. Never throws: a webhook
   * problem must not break the action that caused the event.
   */
  async emit(organizationId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<number> {
    try {
      const endpoints = await this.prisma.webhookEndpoint.findMany({ where: { organizationId, active: true, events: { has: event } }, select: { id: true } });
      if (!endpoints.length) return 0;
      const eventId = `evt_${randomToken(12)}`;
      const payload = { id: eventId, event, createdAt: new Date().toISOString(), data } as Prisma.InputJsonValue;
      await this.prisma.webhookDelivery.createMany({ data: endpoints.map((e) => ({ organizationId, endpointId: e.id, event, eventId, payload, maxAttempts: MAX_ATTEMPTS })) });
      return endpoints.length;
    } catch (e) {
      this.log.error(`Could not queue ${event}: ${(e as Error).message}`);
      return 0;
    }
  }

  @Interval(5000)
  async tick() {
    if (!config.callbackWorkerEnabled || this.running) return;
    this.running = true;
    try {
      await this.processDue();
    } catch (e) {
      this.log.error(`Webhook worker failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Send due deliveries. Rows are claimed with a guarded update so parallel workers never double-send. */
  async processDue(limit = 25): Promise<number> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { state: { in: ['PENDING', 'RETRY_SCHEDULED'] }, nextAttemptAt: { lte: new Date() } },
      include: { endpoint: { select: { url: true, secret: true, active: true } } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    let processed = 0;
    for (const d of due) {
      if (!d.endpoint.active) {
        await this.prisma.webhookDelivery.updateMany({ where: { id: d.id, state: d.state }, data: { state: 'CANCELLED', lastError: 'Endpoint turned off' } });
        continue;
      }
      const claimed = await this.prisma.webhookDelivery.updateMany({ where: { id: d.id, state: d.state }, data: { state: 'SENDING' } });
      if (!claimed.count) continue;
      processed++;
      const r = await this.send(d.endpoint.url, d.endpoint.secret, d.id, d.event, JSON.stringify(d.payload));
      const attempts = d.attempts + 1;
      let state: CallbackState;
      let nextAttemptAt = d.nextAttemptAt;
      if (r.status >= 200 && r.status < 300) state = 'DELIVERED';
      else if (r.status && isPermanentFailure(r.status)) state = 'FAILED';
      else if (attempts >= d.maxAttempts) state = 'DEAD_LETTER';
      else {
        state = 'RETRY_SCHEDULED';
        nextAttemptAt = new Date(Date.now() + backoffMs(attempts));
      }
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { state, attempts, nextAttemptAt, lastStatusCode: r.status || null, lastError: state === 'DELIVERED' ? null : (r.error ?? `HTTP ${r.status}`), deliveredAt: state === 'DELIVERED' ? new Date() : null },
      });
    }
    return processed;
  }

  async send(url: string, secret: string, deliveryId: string, event: string, body: string): Promise<{ status: number; error?: string }> {
    const ts = Math.floor(Date.now() / 1000).toString();
    try {
      const res = await this.fetcher(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PROJEXA-Webhooks/1',
          'X-Projexa-Event': event,
          'X-Projexa-Delivery': deliveryId,
          'X-Projexa-Timestamp': ts,
          'X-Projexa-Signature': signWebhook(secret, ts, body),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      return { status: res.status };
    } catch (e) {
      return { status: 0, error: (e as Error).name === 'TimeoutError' ? 'Timed out after 10s' : (e as Error).message.slice(0, 200) };
    }
  }
}

const view = (e: { id: string; url: string; description: string | null; events: string[]; active: boolean; createdAt: Date; updatedAt: Date }) => ({
  id: e.id, url: e.url, description: e.description, events: e.events, active: e.active, createdAt: e.createdAt, updatedAt: e.updatedAt,
});

/** Admin management of webhook endpoints and their delivery log. */
@Controller('webhooks')
@Roles('ADMIN')
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hooks: WebhooksService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.webhookEndpoint.findMany({ where: { organizationId: u.organizationId }, orderBy: { createdAt: 'asc' } });
    const stats = await this.prisma.webhookDelivery.groupBy({ by: ['endpointId', 'state'], where: { organizationId: u.organizationId, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: { _all: true } });
    return {
      events: EVENT_NAMES.map((name) => ({ name, description: WEBHOOK_EVENTS[name] })),
      endpoints: rows.map((r) => {
        const s = stats.filter((x) => x.endpointId === r.id);
        const n = (states: CallbackState[]) => s.filter((x) => states.includes(x.state)).reduce((a, x) => a + x._count._all, 0);
        return { ...view(r), last7d: { delivered: n(['DELIVERED']), pending: n(['PENDING', 'SENDING', 'RETRY_SCHEDULED']), failed: n(['FAILED', 'DEAD_LETTER']) } };
      }),
    };
  }

  /** The signing secret is returned once, here and on rotate. */
  @Post()
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createEndpointSchema)) body: z.infer<typeof createEndpointSchema>) {
    if ((await this.prisma.webhookEndpoint.count({ where: { organizationId: u.organizationId } })) >= MAX_ENDPOINTS) throw new BadRequestException(`You can have up to ${MAX_ENDPOINTS} endpoints`);
    const secret = `whsec_${randomToken(24)}`;
    const e = await this.prisma.webhookEndpoint.create({ data: { organizationId: u.organizationId, url: body.url, description: body.description || null, events: body.events, secret } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'webhook.create', entityType: 'WebhookEndpoint', entityId: e.id, detail: { url: e.url, events: e.events } });
    return { ...view(e), secret };
  }

  @Patch(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateEndpointSchema)) body: z.infer<typeof updateEndpointSchema>) {
    await this.own(u, id);
    const e = await this.prisma.webhookEndpoint.update({ where: { id }, data: { ...body, ...(body.description !== undefined ? { description: body.description || null } : {}) } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'webhook.update', entityType: 'WebhookEndpoint', entityId: id, detail: body });
    return view(e);
  }

  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const e = await this.own(u, id);
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'webhook.delete', entityType: 'WebhookEndpoint', entityId: id, detail: { url: e.url } });
    return { ok: true };
  }

  @Post(':id/rotate-secret')
  async rotate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.own(u, id);
    const secret = `whsec_${randomToken(24)}`;
    await this.prisma.webhookEndpoint.update({ where: { id }, data: { secret } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'webhook.rotate_secret', entityType: 'WebhookEndpoint', entityId: id });
    return { secret };
  }

  /** Sends a signed `ping` right away (not queued, no retries) and reports the HTTP status. */
  @Post(':id/test')
  async test(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const e = await this.own(u, id);
    const body = JSON.stringify({ id: `evt_test_${randomToken(6)}`, event: 'ping', createdAt: new Date().toISOString(), data: { message: 'Your SampTrek webhook works.' } });
    return this.hooks.send(e.url, e.secret, 'test', 'ping', body);
  }

  @Get(':id/deliveries')
  async deliveries(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('state') state?: string) {
    await this.own(u, id);
    const states = state === 'failed' ? (['FAILED', 'DEAD_LETTER'] as CallbackState[]) : undefined;
    return this.prisma.webhookDelivery.findMany({
      where: { endpointId: id, ...(states ? { state: { in: states } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, event: true, eventId: true, state: true, attempts: true, lastStatusCode: true, lastError: true, nextAttemptAt: true, deliveredAt: true, createdAt: true, payload: true },
    });
  }

  /** Send a failed delivery again, with the same event id so the receiver can de-duplicate. */
  @Post('deliveries/:deliveryId/replay')
  async replay(@CurrentUser() u: AuthUser, @Param('deliveryId') deliveryId: string) {
    const d = await this.prisma.webhookDelivery.findFirst({ where: { id: deliveryId, organizationId: u.organizationId } });
    if (!d) throw new NotFoundException('Delivery not found');
    if (!['FAILED', 'DEAD_LETTER', 'CANCELLED'].includes(d.state)) throw new BadRequestException('Only failed deliveries can be sent again');
    return this.prisma.webhookDelivery.update({ where: { id: d.id }, data: { state: 'PENDING', nextAttemptAt: new Date(), maxAttempts: d.attempts + 3 }, select: { id: true, state: true } });
  }

  private async own(u: AuthUser, id: string) {
    const e = await this.prisma.webhookEndpoint.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!e) throw new NotFoundException('Webhook endpoint not found');
    return e;
  }
}

@Global()
@Module({ controllers: [WebhooksController], providers: [WebhooksService], exports: [WebhooksService] })
export class WebhooksModule {}
