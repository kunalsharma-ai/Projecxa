import { Controller, Get, Injectable, Logger, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CallbackState } from '@prisma/client';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { config } from '../common/config';
import { hmacSha256 } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ status: number }>;

/** Exponential backoff with jitter: 30s, 60s, 120s ... capped at 1h, scaled by 50–100%. */
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(30_000 * 2 ** (attempt - 1), 3_600_000);
  return Math.round(base * (0.5 + random() * 0.5));
}

/** 4xx responses (except timeouts and rate limits) are permanent: retrying will not help. */
export function isPermanentFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

@Injectable()
export class CallbacksService {
  private readonly log = new Logger(CallbacksService.name);
  private running = false;
  fetcher: Fetcher = (url, init) => fetch(url, init);

  constructor(private readonly prisma: PrismaService) {}

  @Interval(5000)
  async tick() {
    if (!config.callbackWorkerEnabled || this.running) return;
    this.running = true;
    try {
      await this.processDue();
    } catch (e) {
      this.log.error(`Callback worker failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Deliver due callbacks. Each row is claimed with a guarded update so parallel workers never double-send. */
  async processDue(limit = 25): Promise<number> {
    const due = await this.prisma.callbackDelivery.findMany({
      where: { state: { in: ['PENDING', 'QUEUED', 'RETRY_SCHEDULED'] }, nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
    });
    let processed = 0;
    for (const d of due) {
      const claimed = await this.prisma.callbackDelivery.updateMany({ where: { id: d.id, state: d.state }, data: { state: 'SENDING' } });
      if (!claimed.count) continue;
      processed++;
      const attempts = d.attempts + 1;
      let secret = '';
      if (d.targetType === 'VENDOR' && d.targetId) {
        secret = (await this.prisma.vendor.findUnique({ where: { id: d.targetId }, select: { callbackSecret: true } }))?.callbackSecret ?? '';
      }
      const body = d.body ? JSON.stringify(d.body) : undefined;
      const ts = Math.floor(Date.now() / 1000).toString();
      const headers: Record<string, string> = {
        'User-Agent': 'PROJEXA-Callbacks/1.0',
        'X-Idempotency-Key': d.idempotencyKey,
        'X-Projexa-Timestamp': ts,
      };
      if (secret) headers['X-Projexa-Signature'] = hmacSha256(secret, `${ts}.${d.url}.${body ?? ''}`);
      if (body) headers['Content-Type'] = 'application/json';

      let status = 0;
      let error: string | null = null;
      try {
        const res = await this.fetcher(d.url, { method: d.method, headers, body, signal: AbortSignal.timeout(10_000) });
        status = res.status;
      } catch (e) {
        error = (e as Error).name === 'TimeoutError' ? 'Timed out after 10s' : (e as Error).message;
      }

      let state: CallbackState;
      let nextAttemptAt = d.nextAttemptAt;
      if (status >= 200 && status < 300) state = 'DELIVERED';
      else if (status && isPermanentFailure(status)) state = 'FAILED';
      else if (attempts >= d.maxAttempts) state = 'DEAD_LETTER';
      else {
        state = 'RETRY_SCHEDULED';
        nextAttemptAt = new Date(Date.now() + backoffMs(attempts));
      }
      await this.prisma.callbackDelivery.update({
        where: { id: d.id },
        data: {
          state,
          attempts,
          nextAttemptAt,
          lastStatusCode: status || null,
          lastError: error ?? (state === 'DELIVERED' ? null : `HTTP ${status}`),
          deliveredAt: state === 'DELIVERED' ? new Date() : null,
        },
      });
    }
    return processed;
  }
}

@Controller('callbacks')
export class CallbacksController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('state') state?: CallbackState) {
    return this.prisma.callbackDelivery.findMany({
      where: { organizationId: u.organizationId, ...(state ? { state } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Replay a failed or dead-lettered callback (same idempotency key, so the receiver can de-duplicate). */
  @Post(':id/replay')
  @Roles(...EDITORS)
  async replay(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const d = await this.prisma.callbackDelivery.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!d) throw new NotFoundException();
    return this.prisma.callbackDelivery.update({
      where: { id },
      data: { state: 'PENDING', nextAttemptAt: new Date(), maxAttempts: d.attempts + 3 },
    });
  }
}

@Module({ controllers: [CallbacksController], providers: [CallbacksService], exports: [CallbacksService] })
export class CallbacksModule {}
