/**
 * Privacy (docs/PRIVACY.md): data retention, consent notices per market and erasure requests.
 *
 * Anonymising a respondent session removes what can identify a person (the vendor's respondent
 * ID, IP and browser hashes, user agent, geo country and gate answers) and redacts the
 * respondent's redirect destinations and callback URLs. Status, approval, money, device type
 * and timestamps stay, so reports, invoices and bills keep adding up.
 */
import { BadRequestException, Body, Controller, Delete, Get, Injectable, Logger, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { config as appConfig } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const DAY = 86_400_000;
export const MIN_DAYS = 30;
const days = z.number().int().min(MIN_DAYS, `Keep data for at least ${MIN_DAYS} days`).max(3650).nullable();
export const retentionSchema = z.object({ respondentDays: days.default(null), eventDays: days.default(null) }).strict();
export type Retention = z.infer<typeof retentionSchema>;

const countrySchema = z.string().regex(/^([A-Z]{2}|\*)$/, 'Use a two-letter country code, or * for every other market');
const consentSchema = z
  .object({
    enabled: z.boolean().default(true),
    title: z.string().trim().min(3).max(120),
    body: z.string().trim().min(20, 'Explain what you collect and why (at least 20 characters)').max(4000),
    privacyUrl: z.string().trim().url().max(500).refine((u) => u.startsWith('https://'), 'Use an https:// link').nullable().default(null),
  })
  .strict();
const eraseSchema = z.object({ sessionIds: z.array(z.string().min(1).max(64)).min(1).max(500), reason: z.string().trim().max(500).optional() }).strict();

export function retentionOf(v: unknown): Retention {
  const r = retentionSchema.safeParse(v ?? {});
  return r.success ? r.data : { respondentDays: null, eventDays: null };
}

/** The consent notice for a market: its own, else the "*" one. Disabled notices do not apply. */
export async function consentFor(prisma: PrismaService | Prisma.TransactionClient, organizationId: string, countryCode: string) {
  const rows = await prisma.consentPolicy.findMany({ where: { organizationId, countryCode: { in: [countryCode, '*'] } } });
  const p = rows.find((r) => r.countryCode === countryCode) ?? rows.find((r) => r.countryCode === '*');
  return p?.enabled ? p : null;
}

@Injectable()
export class PrivacyService {
  private readonly log = new Logger('Privacy');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Sessions old enough to anonymise: finished (or abandoned, past their expiry), and not
   * waiting for an approval decision.
   */
  private dueWhere(org: string, before: Date, now: Date): Prisma.RespondentSessionWhereInput {
    return { organizationId: org, anonymizedAt: null, startedAt: { lt: before }, OR: [{ status: { not: 'STARTED' } }, { expiresAt: { lt: now } }], approval: { not: 'PENDING' } };
  }

  /** What a run would do now, without changing anything. */
  async preview(org: string, r: Retention, now = new Date()) {
    const [sessions, events, pending] = await Promise.all([
      r.respondentDays ? this.prisma.respondentSession.count({ where: this.dueWhere(org, new Date(now.getTime() - r.respondentDays * DAY), now) }) : 0,
      r.eventDays ? this.prisma.respondentEvent.count({ where: { session: { organizationId: org }, createdAt: { lt: new Date(now.getTime() - r.eventDays * DAY) } } }) : 0,
      r.respondentDays
        ? this.prisma.respondentSession.count({ where: { organizationId: org, anonymizedAt: null, startedAt: { lt: new Date(now.getTime() - r.respondentDays * DAY) }, approval: 'PENDING' } })
        : 0,
    ]);
    return { sessions, events, waitingForApproval: pending };
  }

  /** Removes personal data from these sessions (all in `org`). Returns how many were changed. */
  async anonymise(org: string, ids: string[], now = new Date()) {
    if (!ids.length) return 0;
    let changed = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      changed += await this.prisma.$transaction(async (tx) => {
        // The vendor's respondent ID must stay unique per link, so it becomes "erased:<session id>".
        const n = await tx.$executeRaw`
          UPDATE "RespondentSession" SET "vendorRespondentId" = 'erased:' || id, "ipHash" = NULL, "userAgent" = NULL, "fingerprintHash" = NULL, "deviceHash" = NULL,
            "browserIdHash" = NULL, "geoCountry" = NULL, answers = NULL, "anonymizedAt" = ${now}
          WHERE "organizationId" = ${org} AND id IN (${Prisma.join(chunk)}) AND "anonymizedAt" IS NULL`;
        await tx.respondentEvent.updateMany({ where: { sessionId: { in: chunk }, session: { organizationId: org } }, data: { detail: Prisma.DbNull } });
        await tx.redirectExecution.updateMany({ where: { sessionId: { in: chunk }, session: { organizationId: org } }, data: { destination: '[removed]' } });
        // Callbacks still being retried keep their URL until they finish.
        await tx.callbackDelivery.updateMany({ where: { organizationId: org, sessionId: { in: chunk }, state: { in: ['DELIVERED', 'FAILED', 'DEAD_LETTER'] } }, data: { url: '[removed]', body: Prisma.DbNull } });
        return n;
      });
    }
    return changed;
  }

  /** Applies the organisation's retention settings now. */
  async run(org: string, actorId: string | null, now = new Date()) {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: org }, select: { retention: true } });
    const r = retentionOf(o.retention);
    let sessions = 0;
    let events = 0;
    if (r.respondentDays) {
      const before = new Date(now.getTime() - r.respondentDays * DAY);
      for (;;) {
        const batch = await this.prisma.respondentSession.findMany({ where: this.dueWhere(org, before, now), select: { id: true }, take: 2000 });
        if (!batch.length) break;
        sessions += await this.anonymise(org, batch.map((b) => b.id), now);
        if (batch.length < 2000) break;
      }
    }
    if (r.eventDays) {
      const before = new Date(now.getTime() - r.eventDays * DAY);
      events = (await this.prisma.respondentEvent.deleteMany({ where: { session: { organizationId: org }, createdAt: { lt: before } } })).count;
      await this.prisma.redirectExecution.deleteMany({ where: { session: { organizationId: org }, createdAt: { lt: before } } });
    }
    await this.prisma.organization.update({ where: { id: org }, data: { retentionRunAt: now } });
    if (sessions || events || actorId) {
      await this.audit.record({ organizationId: org, actorId, action: 'privacy.retention_run', entityType: 'Organization', entityId: org, detail: { sessions, events, respondentDays: r.respondentDays, eventDays: r.eventDays } });
    }
    return { sessions, events, ranAt: now };
  }

  /** Hourly: each organisation with retention settings runs once a day. */
  @Interval(3_600_000)
  async tick() {
    if (!appConfig.privacySchedulerEnabled || this.running) return;
    this.running = true;
    try {
      await this.runDue();
    } catch (e) {
      this.log.error(`Retention run failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async runDue(now = new Date()) {
    const orgs = await this.prisma.organization.findMany({
      where: { retention: { not: Prisma.DbNull }, OR: [{ retentionRunAt: null }, { retentionRunAt: { lt: new Date(now.getTime() - DAY + 60_000) } }] },
      select: { id: true, retention: true },
    });
    const out: { org: string; sessions: number; events: number }[] = [];
    for (const o of orgs) {
      const r = retentionOf(o.retention);
      if (!r.respondentDays && !r.eventDays) continue;
      const res = await this.run(o.id, null, now);
      out.push({ org: o.id, sessions: res.sessions, events: res.events });
    }
    return out;
  }
}

@Controller('privacy')
export class PrivacyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: PrivacyService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async get(@CurrentUser() u: AuthUser) {
    const [o, consent] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { retention: true, retentionRunAt: true } }),
      this.prisma.consentPolicy.findMany({ where: { organizationId: u.organizationId }, orderBy: { countryCode: 'asc' } }),
    ]);
    const retention = retentionOf(o.retention);
    const [preview, consented, erased] = await Promise.all([
      this.privacy.preview(u.organizationId, retention),
      this.prisma.respondentSession.count({ where: { organizationId: u.organizationId, consentAt: { not: null } } }),
      this.prisma.respondentSession.count({ where: { organizationId: u.organizationId, anonymizedAt: { not: null } } }),
    ]);
    return {
      retention,
      minDays: MIN_DAYS,
      lastRunAt: o.retentionRunAt,
      preview,
      totals: { consented, anonymised: erased },
      consent: consent.map((c) => ({ countryCode: c.countryCode, enabled: c.enabled, title: c.title, body: c.body, privacyUrl: c.privacyUrl, version: c.version, updatedAt: c.updatedAt })),
    };
  }

  @Put('retention')
  @Roles('ADMIN')
  async setRetention(@CurrentUser() u: AuthUser, @Body(new ZodPipe(retentionSchema)) b: Retention) {
    const value = b.respondentDays || b.eventDays ? (b as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { retention: value } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'privacy.retention_set', entityType: 'Organization', entityId: u.organizationId, detail: b });
    return { retention: b, preview: await this.privacy.preview(u.organizationId, b) };
  }

  @Post('retention/run')
  @Roles('ADMIN')
  run(@CurrentUser() u: AuthUser) {
    return this.privacy.run(u.organizationId, u.id);
  }

  @Put('consent/:countryCode')
  @Roles('ADMIN')
  async setConsent(@CurrentUser() u: AuthUser, @Param('countryCode', new ZodPipe(countrySchema)) countryCode: string, @Body(new ZodPipe(consentSchema)) b: z.infer<typeof consentSchema>) {
    const cur = await this.prisma.consentPolicy.findUnique({ where: { organizationId_countryCode: { organizationId: u.organizationId, countryCode } } });
    const wordingChanged = !cur || cur.title !== b.title || cur.body !== b.body || cur.privacyUrl !== b.privacyUrl;
    const p = await this.prisma.consentPolicy.upsert({
      where: { organizationId_countryCode: { organizationId: u.organizationId, countryCode } },
      create: { organizationId: u.organizationId, countryCode, ...b, updatedById: u.id },
      update: { ...b, updatedById: u.id, ...(wordingChanged ? { version: { increment: 1 } } : {}) },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: cur ? 'privacy.consent_update' : 'privacy.consent_create', entityType: 'ConsentPolicy', entityId: p.id, detail: { countryCode, enabled: p.enabled, version: p.version } });
    return { countryCode: p.countryCode, enabled: p.enabled, title: p.title, body: p.body, privacyUrl: p.privacyUrl, version: p.version, updatedAt: p.updatedAt };
  }

  @Delete('consent/:countryCode')
  @Roles('ADMIN')
  async removeConsent(@CurrentUser() u: AuthUser, @Param('countryCode', new ZodPipe(countrySchema)) countryCode: string) {
    const cur = await this.prisma.consentPolicy.findUnique({ where: { organizationId_countryCode: { organizationId: u.organizationId, countryCode } } });
    if (!cur) throw new NotFoundException('No consent notice for that market');
    await this.prisma.consentPolicy.delete({ where: { id: cur.id } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'privacy.consent_delete', entityType: 'ConsentPolicy', entityId: cur.id, detail: { countryCode } });
    return { ok: true };
  }

  /** Find a respondent's sessions by the ID their panel uses (for access or erasure requests). */
  @Get('respondents')
  @Roles('ADMIN')
  async find(@CurrentUser() u: AuthUser, @Query('uid') uid?: string, @Query('vendorId') vendorId?: string) {
    const id = (uid ?? '').trim();
    if (!id || id.length > 200) throw new BadRequestException('Enter the respondent ID the panel uses');
    const rows = await this.prisma.respondentSession.findMany({
      where: { organizationId: u.organizationId, vendorRespondentId: id, ...(vendorId ? { vendorAllocation: { vendorId } } : {}) },
      orderBy: { startedAt: 'desc' },
      take: 200,
      select: {
        id: true, status: true, approval: true, isTest: true, startedAt: true, outcomeAt: true, consentAt: true, consentVersion: true, deviceType: true, answers: true,
        project: { select: { projectCode: true, name: true } }, projectCountry: { select: { countryCode: true } }, vendorAllocation: { select: { vendor: { select: { name: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id, status: r.status, approval: r.approval, isTest: r.isTest, startedAt: r.startedAt, outcomeAt: r.outcomeAt, consentAt: r.consentAt, consentVersion: r.consentVersion,
      deviceType: r.deviceType, hasAnswers: r.answers != null, project: r.project, countryCode: r.projectCountry.countryCode, vendor: r.vendorAllocation.vendor.name,
    }));
  }

  /** Erasure request: anonymise these sessions now, whatever the retention settings. */
  @Post('respondents/erase')
  @Roles('ADMIN')
  async erase(@CurrentUser() u: AuthUser, @Body(new ZodPipe(eraseSchema)) b: z.infer<typeof eraseSchema>) {
    const owned = await this.prisma.respondentSession.findMany({ where: { id: { in: b.sessionIds }, organizationId: u.organizationId }, select: { id: true } });
    if (owned.length !== new Set(b.sessionIds).size) throw new NotFoundException('Some sessions were not found');
    const n = await this.privacy.anonymise(u.organizationId, owned.map((o) => o.id));
    if (n) await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'privacy.erase', entityType: 'RespondentSession', entityId: owned[0].id, detail: { sessions: n, reason: b.reason ?? null } });
    return { anonymised: n };
  }
}

@Module({ controllers: [PrivacyController], providers: [PrivacyService], exports: [PrivacyService] })
export class PrivacyModule {}
