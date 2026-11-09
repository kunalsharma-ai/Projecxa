/**
 * Events SampTrek sends to SAMPLEON (SampAudience), delivered with retries.
 *
 * `project.created` is queued in the same transaction that creates (or copies) a project, so a
 * project never exists without its event, and an event never goes out for a project that was
 * rolled back. A worker posts each one to `{SAMPLEON_URL}/api/v1/events`, signed with SampTrek's
 * Sampledge service signature, with the envelope's eventId as the Idempotency-Key. SAMPLEON
 * dedupes on eventId and keeps the project (code, name, countries) in its list of known projects,
 * so a retry is always safe.
 *
 * 2xx is delivered; a 4xx other than 408/429 is permanent (FAILED); anything else, including a
 * network error, is retried with the shared backoff (30 s doubling, capped at 1 h) up to 12 times,
 * then DEAD_LETTER. A row claimed by a worker that died is picked up again after a minute.
 * Nothing is queued while the integration is not configured.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CallbackState, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { backoffMs, isPermanentFailure } from '../callbacks/callbacks.service';
import { config } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';
import { sampledgeHeaders, sampleonConfig } from './sampleon-config';

export const SAMPLEON_EVENT_MAX_ATTEMPTS = 12;
/** A row left in SENDING this long (its worker died) is sent again. */
const CLAIM_MS = 60_000;

type Tx = Prisma.TransactionClient | PrismaService;
export type SampleonFetcher = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; redirect: 'manual'; signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

/** The event envelope SAMPLEON accepts (its contracts, §6): version 1, source PROJEXA. */
export function projectCreatedEnvelope(p: { organizationId: string; projectCode: string; name: string }, countries: string[], nowMs = Date.now()) {
  return {
    specVersion: '1.0' as const,
    eventId: randomUUID(),
    type: 'project.created',
    version: 1,
    source: 'PROJEXA',
    occurredAt: new Date(nowMs).toISOString(),
    correlationId: p.projectCode,
    causationId: null,
    subject: { sourcePlatform: 'PROJEXA', sourceProjectId: p.projectCode, organizationId: p.organizationId },
    payload: { projectId: p.projectCode, name: p.name, countries: [...new Set(countries)].sort() },
  };
}

@Injectable()
export class SampleonOutbox {
  private readonly log = new Logger(SampleonOutbox.name);
  private running = false;
  fetcher: SampleonFetcher = (url, init) => fetch(url, init);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Queue `project.created` (in the caller's transaction when one is given). SAMPLEON knows a
   * project by its code, the `source.projectId` of its audience requests. Returns null when the
   * integration is not configured.
   */
  async projectCreated(tx: Tx, p: { id: string; organizationId: string; projectCode: string; name: string }, countries: string[]) {
    if (!sampleonConfig().configured) return null;
    const envelope = projectCreatedEnvelope(p, countries);
    return tx.sampleonOutboundEvent.create({
      data: { organizationId: p.organizationId, projectId: p.id, eventId: envelope.eventId, type: envelope.type, envelope: envelope as unknown as Prisma.InputJsonValue },
    });
  }

  /** The latest event of a type for a project, for the project's SampAudience tab. */
  latest(organizationId: string, projectId: string, type = 'project.created') {
    return this.prisma.sampleonOutboundEvent.findFirst({
      where: { organizationId, projectId, type },
      orderBy: { createdAt: 'desc' },
      select: { id: true, eventId: true, type: true, state: true, attempts: true, lastStatusCode: true, lastError: true, createdAt: true, deliveredAt: true, nextAttemptAt: true },
    });
  }

  @Interval(5000)
  async tick() {
    if (!config.callbackWorkerEnabled || this.running) return;
    this.running = true;
    try {
      await this.processDue();
    } catch (e) {
      this.log.error(`SampAudience event worker failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Send due events. A guarded update claims each row, so parallel workers never double-send. */
  async processDue(limit = 25): Promise<number> {
    const cfg = sampleonConfig();
    if (!cfg.configured) return 0;
    const now = new Date();
    const due = await this.prisma.sampleonOutboundEvent.findMany({
      where: { state: { in: ['PENDING', 'RETRY_SCHEDULED', 'SENDING'] }, nextAttemptAt: { lte: now } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    let processed = 0;
    for (const d of due) {
      const claimed = await this.prisma.sampleonOutboundEvent.updateMany({
        where: { id: d.id, state: d.state, nextAttemptAt: d.nextAttemptAt },
        data: { state: 'SENDING', nextAttemptAt: new Date(Date.now() + CLAIM_MS) },
      });
      if (!claimed.count) continue;
      processed++;
      const r = await this.send(cfg, d.eventId, JSON.stringify(d.envelope));
      const attempts = d.attempts + 1;
      let state: CallbackState;
      let nextAttemptAt = new Date();
      if (r.status >= 200 && r.status < 300) state = 'DELIVERED';
      else if (r.status && isPermanentFailure(r.status)) state = 'FAILED';
      else if (attempts >= SAMPLEON_EVENT_MAX_ATTEMPTS) state = 'DEAD_LETTER';
      else {
        state = 'RETRY_SCHEDULED';
        nextAttemptAt = new Date(Date.now() + backoffMs(attempts));
      }
      await this.prisma.sampleonOutboundEvent.update({
        where: { id: d.id },
        data: { state, attempts, nextAttemptAt, lastStatusCode: r.status || null, lastError: state === 'DELIVERED' ? null : (r.error ?? `HTTP ${r.status}`).slice(0, 500), deliveredAt: state === 'DELIVERED' ? new Date() : null },
      });
      if (state === 'FAILED' || state === 'DEAD_LETTER') this.log.warn(`SampAudience did not take ${d.type} ${d.eventId}: ${r.error ?? `HTTP ${r.status}`}`);
    }
    return processed;
  }

  private async send(cfg: ReturnType<typeof sampleonConfig>, eventId: string, body: string): Promise<{ status: number; error?: string }> {
    const path = '/api/v1/events';
    try {
      const res = await this.fetcher(cfg.url + path, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: { 'content-type': 'application/json', 'Idempotency-Key': eventId, ...sampledgeHeaders(cfg.clientId, cfg.secret, 'POST', path, body) },
        body,
      });
      if (res.status >= 200 && res.status < 300) return { status: res.status };
      return { status: res.status, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}` };
    } catch (e) {
      return { status: 0, error: (e as Error).name === 'TimeoutError' ? 'Timed out after 15s' : (e as Error).message.slice(0, 200) };
    }
  }
}
