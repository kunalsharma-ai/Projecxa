/**
 * Won bids (legacy "Won bids" list): Bidzo sends a signed "bid.won" webhook, the bid appears
 * here for project managers, and "Set up project" opens the project wizard prefilled from it.
 * A project can be created from a won bid once (enforced in ProjectsService.create).
 */
import {
  BadRequestException, Body, ConflictException, Controller, Get, Headers, HttpCode, Module, NotFoundException, Param, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, EDITORS, Public, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { config } from '../common/config';
import { hmacSha256, randomToken, safeEqualHex } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { bidzoEventSchema, dismissSchema, listSchema } from './won-bids.schemas';

/** Signed requests older or newer than this are rejected (replay protection). */
export const SIGNATURE_WINDOW_SECONDS = 300;

@Controller()
export class WonBidsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ───────────── Intake from Bidzo (public, HMAC-signed) ─────────────

  @Public()
  @Post('integrations/bidzo/events')
  @HttpCode(202)
  async intake(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-bidzo-tenant') tenant?: string,
    @Headers('x-bidzo-timestamp') ts?: string,
    @Headers('x-bidzo-signature') sig?: string,
  ) {
    // Same answer for unknown tenant, missing secret and bad signature: nothing to probe.
    const reject = () => new UnauthorizedException('Invalid signature');
    if (!tenant || !ts || !sig || !req.rawBody) throw reject();
    const org = await this.prisma.organization.findUnique({ where: { slug: tenant }, select: { id: true, bidzoWebhookSecret: true } });
    const raw = req.rawBody.toString('utf8');
    const expected = org?.bidzoWebhookSecret ? hmacSha256(org.bidzoWebhookSecret, `${ts}.${raw}`) : null;
    const given = sig.replace(/^sha256=/, '');
    if (!org || !expected || !/^[0-9a-f]{64}$/i.test(given) || !safeEqualHex(expected, given)) throw reject();
    const age = Math.abs(Date.now() / 1000 - Number(ts));
    if (!Number.isFinite(age) || age > SIGNATURE_WINDOW_SECONDS) throw new UnauthorizedException('Timestamp outside the allowed window');

    const parsed = bidzoEventSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Invalid event', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const { eventId, occurredAt, bid } = parsed.data;
    const data = {
      bidNumber: bid.bidNumber,
      bidVersion: bid.version ?? null,
      projectName: bid.projectName,
      description: bid.projectDescription ?? null,
      projectType: bid.projectType ?? null,
      projectCategory: bid.projectCategory ?? null,
      clientName: bid.client.name,
      clientExternalId: bid.client.id ?? null,
      contactName: bid.contact?.name ?? null,
      contactEmail: bid.contact?.email ?? null,
      bidderName: bid.biddingPerson?.name ?? null,
      currency: bid.currency,
      totalAmount: bid.totalAmount == null ? null : new Prisma.Decimal(bid.totalAmount),
      countries: bid.countries as unknown as Prisma.InputJsonValue,
      wonAt: new Date(occurredAt),
      lastEventId: eventId,
      payload: parsed.data as unknown as Prisma.InputJsonValue,
    };
    const key = { organizationId_source_externalId: { organizationId: org.id, source: 'BIDZO', externalId: bid.id } };
    const existing = await this.prisma.wonBid.findUnique({ where: key });
    if (!existing) {
      try {
        const created = await this.prisma.wonBid.create({ data: { organizationId: org.id, source: 'BIDZO', externalId: bid.id, ...data } });
        await this.audit.record({ organizationId: org.id, actorId: null, action: 'won-bid.received', entityType: 'WonBid', entityId: created.id, detail: { bidNumber: bid.bidNumber, eventId } });
        return { wonBidId: created.id, status: created.status, duplicate: false };
      } catch (e) {
        // A concurrent delivery of the same bid created it first; fall through to the update path.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    // Re-delivery: refresh the details only while nobody has acted on the bid yet.
    const r = await this.prisma.wonBid.updateMany({
      where: { organizationId: org.id, source: 'BIDZO', externalId: bid.id, status: 'NEW' },
      data: { ...data, deliveries: { increment: 1 } },
    });
    const row = await this.prisma.wonBid.findUniqueOrThrow({ where: key });
    if (!r.count) await this.prisma.wonBid.update({ where: { id: row.id }, data: { deliveries: { increment: 1 } } });
    return { wonBidId: row.id, status: row.status, duplicate: true };
  }

  // ───────────── Staff ─────────────

  @Get('won-bids')
  async list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    const [rows, counts] = await Promise.all([
      this.prisma.wonBid.findMany({
        where: { organizationId: u.organizationId, ...(q.status ? { status: q.status } : {}) },
        orderBy: { wonAt: 'desc' },
        take: 500,
        include: { project: { select: { id: true, projectCode: true, status: true } } },
      }),
      this.prisma.wonBid.groupBy({ by: ['status'], where: { organizationId: u.organizationId }, _count: { _all: true } }),
    ]);
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      items: rows.map(({ payload: _p, ...r }) => r),
    };
  }

  @Get('won-bids/:id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const r = await this.prisma.wonBid.findFirst({
      where: { id, organizationId: u.organizationId },
      include: { project: { select: { id: true, projectCode: true, status: true } } },
    });
    if (!r) throw new NotFoundException();
    // Suggest the PROJEXA client whose name matches Bidzo's (case-insensitive).
    const match = await this.prisma.client.findFirst({
      where: { organizationId: u.organizationId, name: { equals: r.clientName, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    const { payload: _p, ...rest } = r;
    return { ...rest, suggestedClient: match };
  }

  @Post('won-bids/:id/dismiss')
  @Roles(...EDITORS)
  @HttpCode(200)
  async dismiss(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(dismissSchema)) body: z.infer<typeof dismissSchema>) {
    return this.move(u, id, 'NEW', 'DISMISSED', body.reason ?? null);
  }

  @Post('won-bids/:id/restore')
  @Roles(...EDITORS)
  @HttpCode(200)
  async restore(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.move(u, id, 'DISMISSED', 'NEW', null);
  }

  private async move(u: AuthUser, id: string, from: 'NEW' | 'DISMISSED', to: 'NEW' | 'DISMISSED', reason: string | null) {
    const r = await this.prisma.wonBid.updateMany({ where: { id, organizationId: u.organizationId, status: from }, data: { status: to, dismissReason: reason } });
    if (!r.count) {
      const exists = await this.prisma.wonBid.count({ where: { id, organizationId: u.organizationId } });
      if (!exists) throw new NotFoundException();
      throw new ConflictException(from === 'NEW' ? 'Only bids waiting for setup can be dismissed' : 'Only dismissed bids can be restored');
    }
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: to === 'DISMISSED' ? 'won-bid.dismiss' : 'won-bid.restore', entityType: 'WonBid', entityId: id, detail: reason ? { reason } : undefined });
    return this.get(u, id);
  }

  // ───────────── Integration settings (admin) ─────────────

  @Get('integrations/bidzo')
  async settings(@CurrentUser() u: AuthUser) {
    const [org, last] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { slug: true, bidzoWebhookSecret: true } }),
      this.prisma.wonBid.findFirst({ where: { organizationId: u.organizationId, source: 'BIDZO' }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    ]);
    return {
      enabled: !!org.bidzoWebhookSecret,
      tenant: org.slug,
      endpoint: `${config.publicBaseUrl}/api/v1/integrations/bidzo/events`,
      lastReceivedAt: last?.updatedAt ?? null,
    };
  }

  /** Creates or rotates the signing secret. It is returned once; Bidzo must be updated with it. */
  @Post('integrations/bidzo/secret')
  @Roles('ADMIN')
  @HttpCode(200)
  async rotate(@CurrentUser() u: AuthUser) {
    const secret = `bzw_${randomToken(32)}`;
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { bidzoWebhookSecret: secret } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'integration.bidzo.secret-rotated', entityType: 'Organization', entityId: u.organizationId });
    return { ...(await this.settings(u)), secret };
  }

  @Post('integrations/bidzo/disable')
  @Roles('ADMIN')
  @HttpCode(200)
  async disable(@CurrentUser() u: AuthUser) {
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { bidzoWebhookSecret: null } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'integration.bidzo.disabled', entityType: 'Organization', entityId: u.organizationId });
    return this.settings(u);
  }
}

@Module({ controllers: [WonBidsController] })
export class WonBidsModule {}
