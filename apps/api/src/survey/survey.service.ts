import { Injectable, Logger } from '@nestjs/common';
import { EventSource, Prisma, RespondentStatus } from '@prisma/client';
import { config as appConfig } from '../common/config';
import { hmacSha256, randomToken, safeEqualHex, sha256 } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { computeRedirect, internalEndPage } from '../redirects/redirect-engine';
import { OutcomeStatus } from '../redirects/redirect.types';
import { fillCallbackTemplate, parseConfig } from '../redirects/redirects.service';

/** External status slugs accepted on /r/:status, mapped to canonical statuses. */
const STATUS_ALIASES: Record<string, OutcomeStatus> = {
  complete: 'COMPLETE',
  completed: 'COMPLETE',
  terminate: 'TERMINATE',
  screenout: 'TERMINATE',
  quota_full: 'QUOTA_FULL',
  quotafull: 'QUOTA_FULL',
  overquota: 'QUOTA_FULL',
  quality_fail: 'QUALITY_FAIL',
  qualityfail: 'QUALITY_FAIL',
  quality: 'QUALITY_FAIL',
  duplicate: 'DUPLICATE',
  security_reject: 'SECURITY_REJECT',
  security: 'SECURITY_REJECT',
  partial: 'PARTIAL',
  abandoned: 'PARTIAL',
  technical_error: 'TECHNICAL_ERROR',
  error: 'TECHNICAL_ERROR',
};

export function canonicalStatus(slug: string): OutcomeStatus | null {
  return STATUS_ALIASES[slug.toLowerCase()] ?? null;
}

type SessionWithContext = Prisma.RespondentSessionGetPayload<{
  include: {
    project: { include: { organization: true; client: true } };
    projectCountry: true;
    vendorAllocation: { include: { vendor: true } };
    redirectVersion: true;
  };
}>;

const SESSION_INCLUDE = {
  project: { include: { organization: true, client: true } },
  projectCountry: true,
  vendorAllocation: { include: { vendor: true } },
  redirectVersion: true,
} as const;

export interface EntryRequest {
  code: string;
  query: Record<string, string | undefined>;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class SurveyService {
  private readonly log = new Logger(SurveyService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Vendor entry link: /s/{entryCode}?uid=...
   * Creates the respondent session and sends the respondent to the client survey,
   * or redirects immediately for duplicates, closed projects and full quotas.
   */
  async enter(req: EntryRequest): Promise<{ location: string; httpStatus?: number }> {
    const allocation = await this.prisma.vendorAllocation.findFirst({
      where: { OR: [{ entryCode: req.code }, { testEntryCode: req.code }] },
      include: {
        vendor: true,
        projectCountry: { include: { project: { include: { organization: true, client: true } } } },
      },
    });
    if (!allocation) return { location: internalEndPage(appConfig.publicBaseUrl, 'SECURITY_REJECT') };

    const isTest = allocation.testEntryCode === req.code;
    const country = allocation.projectCountry;
    const project = country.project;
    const uid = (req.query[allocation.uidParam] ?? '').trim();
    if (!uid || uid.length > 200 || uid === '[UID]') {
      // Without a respondent ID there is nothing to attribute; do not create a session.
      return { location: internalEndPage(appConfig.publicBaseUrl, 'SECURITY_REJECT') };
    }

    const ipHash = req.ip ? sha256(`${project.organizationId}:${req.ip}`) : null;
    const security = (project.security ?? {}) as Record<string, boolean>;

    // Same vendor respondent ID entering again → DUPLICATE, existing session untouched.
    const existing = await this.prisma.respondentSession.findUnique({
      where: { vendorAllocationId_vendorRespondentId_isTest: { vendorAllocationId: allocation.id, vendorRespondentId: uid, isTest } },
      include: SESSION_INCLUDE,
    });
    if (existing) {
      await this.event(existing.id, 'DUPLICATE_ENTRY', null, 'ENTRY', `dup-entry:${existing.id}:${randomToken(6)}`, { ipHash });
      return { location: await this.redirectFor(existing, 'DUPLICATE') };
    }

    let initial: { status: RespondentStatus; detail?: string } | null = null;
    const live = project.status === 'LIVE' && country.status === 'LIVE' && allocation.status === 'ACTIVE';
    const testable = ['DRAFT', 'TEST', 'LIVE'].includes(project.status) && allocation.status !== 'CLOSED';
    if (isTest ? !testable : !live) initial = { status: 'QUOTA_FULL', detail: 'NOT_LIVE' };
    else if (!isTest && (country.completes >= country.targetCompletes || allocation.completes >= allocation.targetCompletes)) {
      initial = { status: 'QUOTA_FULL', detail: 'QUOTA_CLOSED' };
    } else if (!isTest && security.duplicateDetection && ipHash) {
      const sameDevice = await this.prisma.respondentSession.findFirst({
        where: { projectId: project.id, isTest: false, ipHash, userAgent: req.userAgent ?? null },
        select: { id: true },
      });
      if (sameDevice) initial = { status: 'DUPLICATE', detail: 'SAME_DEVICE' };
    }
    const surveyUrl = isTest ? country.testSurveyUrl ?? country.liveSurveyUrl : country.liveSurveyUrl;
    if (!initial && !surveyUrl) initial = { status: 'TECHNICAL_ERROR', detail: 'NO_SURVEY_LINK' };

    const ttl = country.sessionTtlMinutes ?? Math.max(60, country.loiMinutes * 4);
    const token = randomToken();
    let session: SessionWithContext;
    try {
      session = await this.prisma.respondentSession.create({
        data: {
          organizationId: project.organizationId,
          projectId: project.id,
          projectCountryId: country.id,
          vendorAllocationId: allocation.id,
          token,
          vendorRespondentId: uid,
          isTest,
          status: initial?.status ?? 'STARTED',
          statusDetail: initial?.detail,
          outcomeAt: initial ? new Date() : null,
          redirectVersionId: project.activeRedirectVersionId,
          ipHash,
          userAgent: req.userAgent?.slice(0, 500),
          expiresAt: new Date(Date.now() + ttl * 60_000),
          events: {
            create: {
              type: 'ENTRY',
              status: initial?.status ?? null,
              source: 'ENTRY',
              idempotencyKey: `entry:${token}`,
              detail: initial ? { reason: initial.detail } : undefined,
            },
          },
        },
        include: SESSION_INCLUDE,
      });
    } catch (e) {
      // Concurrent double-click with the same UID: the unique constraint makes the second one a duplicate.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.respondentSession.findUniqueOrThrow({
          where: { vendorAllocationId_vendorRespondentId_isTest: { vendorAllocationId: allocation.id, vendorRespondentId: uid, isTest } },
          include: SESSION_INCLUDE,
        });
        return { location: await this.redirectFor(again, 'DUPLICATE') };
      }
      throw e;
    }

    if (initial) return { location: await this.redirectFor(session, initial.status as OutcomeStatus) };
    return { location: buildSurveyLink(surveyUrl!, { token, countryCode: country.countryCode, projectCode: project.projectCode }) };
  }

  /** Browser outcome: /r/{status}?token=... (not authoritative for billing). */
  async browserOutcome(statusSlug: string, token: string | undefined): Promise<{ location: string }> {
    const status = canonicalStatus(statusSlug);
    if (!token) return { location: internalEndPage(appConfig.publicBaseUrl, 'SECURITY_REJECT') };
    const session = await this.prisma.respondentSession.findUnique({ where: { token }, include: SESSION_INCLUDE });
    if (!session) {
      await this.prisma.redirectExecution.create({
        data: { status: 'SECURITY_REJECT', destination: 'end-page', usedFallback: true, blockedReason: 'Unknown session token', durationMs: 0 },
      });
      return { location: internalEndPage(appConfig.publicBaseUrl, 'SECURITY_REJECT') };
    }
    if (!status) {
      return { location: await this.redirectFor(session, 'TECHNICAL_ERROR', `Unknown status "${statusSlug.slice(0, 40)}"`) };
    }
    const outcome = await this.recordOutcome(session, status, 'BROWSER');
    const fresh = await this.prisma.respondentSession.findUniqueOrThrow({ where: { id: session.id }, include: SESSION_INCLUDE });
    return { location: await this.redirectFor(fresh, outcome.effectiveStatus) };
  }

  /**
   * Server-to-server outcome from the client survey platform.
   * Signature: hex HMAC-SHA256(client.s2sSecret, `${token}.${status}.${timestamp}`), timestamp in unix seconds.
   */
  async s2sOutcome(body: { token: string; status: string; timestamp: number; signature: string }) {
    if (Math.abs(Date.now() / 1000 - body.timestamp) > 300) return { httpStatus: 401, body: { ok: false, error: 'Timestamp outside the allowed window' } };
    const session = await this.prisma.respondentSession.findUnique({ where: { token: body.token }, include: SESSION_INCLUDE });
    if (!session) return { httpStatus: 404, body: { ok: false, error: 'Unknown session' } };
    const expected = hmacSha256(session.project.client.s2sSecret, `${body.token}.${body.status}.${body.timestamp}`);
    if (!safeEqualHex(expected, body.signature)) return { httpStatus: 401, body: { ok: false, error: 'Invalid signature' } };
    const status = canonicalStatus(body.status);
    if (!status) return { httpStatus: 400, body: { ok: false, error: 'Unknown status' } };
    const r = await this.recordOutcome(session, status, 'S2S');
    if (r.conflict) return { httpStatus: 409, body: { ok: false, error: `Session already recorded as ${r.effectiveStatus}`, status: r.effectiveStatus } };
    return { httpStatus: 200, body: { ok: true, status: r.effectiveStatus, verified: true } };
  }

  /**
   * Apply an outcome once. The first terminal status wins; repeats are idempotent and a
   * different later status is logged as a conflict without changing the session.
   */
  async recordOutcome(
    session: SessionWithContext,
    requested: OutcomeStatus,
    source: EventSource,
  ): Promise<{ effectiveStatus: OutcomeStatus; conflict: boolean; changed: boolean }> {
    let status: RespondentStatus = requested;
    let detail: string | undefined;

    if (session.status !== 'STARTED') {
      const same = session.status === requested || (session.statusDetail === 'OVERQUOTA' && requested === 'COMPLETE');
      if (source === 'S2S' && same && !session.outcomeVerified) {
        await this.prisma.respondentSession.update({ where: { id: session.id }, data: { outcomeVerified: true } });
      }
      await this.event(session.id, same ? 'OUTCOME_REPEAT' : 'OUTCOME_CONFLICT', requested, source, `repeat:${session.id}:${source}:${requested}:${Date.now()}:${randomToken(4)}`, {
        recorded: session.status,
      });
      return { effectiveStatus: session.status as OutcomeStatus, conflict: !same, changed: false };
    }

    if (session.expiresAt < new Date() && source === 'BROWSER') {
      status = 'SECURITY_REJECT';
      detail = 'EXPIRED';
    }

    const changed = await this.prisma.$transaction(async (tx) => {
      let revenue: Prisma.Decimal | null = null;
      let payout: Prisma.Decimal | null = null;
      if (status === 'COMPLETE' && !session.isTest) {
        // Atomic quota control: only count the complete if the country and vendor targets still have room.
        const c = await tx.$executeRaw`UPDATE "ProjectCountry" SET completes = completes + 1 WHERE id = ${session.projectCountryId} AND completes < "targetCompletes"`;
        const a = c
          ? await tx.$executeRaw`UPDATE "VendorAllocation" SET completes = completes + 1 WHERE id = ${session.vendorAllocationId} AND completes < "targetCompletes"`
          : 0;
        if (c && !a) await tx.$executeRaw`UPDATE "ProjectCountry" SET completes = completes - 1 WHERE id = ${session.projectCountryId}`;
        if (!c || !a) {
          status = 'QUOTA_FULL';
          detail = 'OVERQUOTA';
        } else {
          revenue = session.projectCountry.cpi;
          payout = session.vendorAllocation.cpi;
        }
      }
      // Guarded transition: only a STARTED session can take an outcome (handles concurrent callbacks).
      const updated = await tx.respondentSession.updateMany({
        where: { id: session.id, status: 'STARTED' },
        data: {
          status,
          statusDetail: detail ?? null,
          outcomeAt: new Date(),
          outcomeVerified: source === 'S2S',
          approval: status === 'COMPLETE' && !session.isTest ? 'PENDING' : 'NOT_APPLICABLE',
          revenue,
          payout,
        },
      });
      if (updated.count === 0) {
        throw new OutcomeRace();
      }
      await tx.respondentEvent.create({
        data: { sessionId: session.id, type: 'OUTCOME', status, source, idempotencyKey: `outcome:${session.id}`, detail: detail ? { detail, requested } : { requested } },
      });
      return true;
    }).catch(async (e) => {
      if (e instanceof OutcomeRace || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) return false;
      throw e;
    });

    if (!changed) {
      const current = await this.prisma.respondentSession.findUniqueOrThrow({ where: { id: session.id }, include: SESSION_INCLUDE });
      return this.recordOutcome(current, requested, source);
    }
    return { effectiveStatus: status as OutcomeStatus, conflict: false, changed: true };
  }

  /** Resolve, record and return the redirect for a session, using the config version the session started with. */
  async redirectFor(session: SessionWithContext, status: OutcomeStatus, extraReason?: string): Promise<string> {
    const started = Date.now();
    const version = session.redirectVersion;
    const result = computeRedirect({
      status,
      countryCode: session.projectCountry.countryCode,
      vendor: session.vendorAllocation.vendor,
      projectCode: session.project.projectCode,
      vendorRespondentId: session.vendorRespondentId,
      sessionToken: session.token,
      mode: version?.mode ?? session.project.redirectMode,
      config: parseConfig(version?.config),
      clientTemplate: session.project.client.redirectTemplate ? parseConfig(session.project.client.redirectTemplate) : null,
      organizationDefault: session.project.organization.defaultRedirectConfig ? parseConfig(session.project.organization.defaultRedirectConfig) : null,
      organizationDomains: session.project.organization.redirectAllowedDomains,
      organizationFallbackUrl: session.project.organization.fallbackRedirectUrl,
      publicBaseUrl: appConfig.publicBaseUrl,
      allowHttp: appConfig.allowHttpRedirects,
    });
    await this.prisma.redirectExecution.create({
      data: {
        sessionId: session.id,
        status,
        ruleSource: result.ruleSource,
        versionId: version?.id,
        destination: result.destination,
        usedFallback: result.usedFallback,
        blockedReason: [extraReason, result.blockedReason].filter(Boolean).join('; ') || null,
        durationMs: Date.now() - started,
      },
    });
    if (result.callbackRequired && !session.isTest) await this.enqueueVendorCallback(session, status);
    return result.destination;
  }

  private async enqueueVendorCallback(session: SessionWithContext, status: OutcomeStatus) {
    const template = session.vendorAllocation.callbackUrlTemplate ?? session.vendorAllocation.vendor.callbackUrlTemplate;
    if (!template) return;
    const url = fillCallbackTemplate(template, {
      uid: session.vendorRespondentId,
      status,
      vendorCode: session.vendorAllocation.vendor.code,
      countryCode: session.projectCountry.countryCode,
      projectCode: session.project.projectCode,
    });
    try {
      await this.prisma.callbackDelivery.create({
        data: {
          organizationId: session.organizationId,
          sessionId: session.id,
          targetType: 'VENDOR',
          targetId: session.vendorAllocation.vendorId,
          url,
          idempotencyKey: `cb:${session.id}:${status}:vendor`,
        },
      });
    } catch (e) {
      // Already queued for this session + status: retries never create a second callback.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }

  private async event(sessionId: string, type: string, status: RespondentStatus | null, source: EventSource, key: string, detail?: unknown) {
    await this.prisma.respondentEvent.create({
      data: { sessionId, type, status, source, idempotencyKey: key, detail: detail as Prisma.InputJsonValue | undefined },
    });
  }
}

class OutcomeRace extends Error {}

/** Client survey link: substitute macros, and append the session token if the link has no {session_token} macro. */
export function buildSurveyLink(template: string, v: { token: string; countryCode: string; projectCode: string }) {
  const hasToken = template.includes('{session_token}');
  const filled = template
    .replace(/\{session_token\}/g, encodeURIComponent(v.token))
    .replace(/\{country_code\}/g, encodeURIComponent(v.countryCode))
    .replace(/\{project_code\}/g, encodeURIComponent(v.projectCode));
  const url = new URL(filled);
  if (!hasToken) url.searchParams.set('token', v.token);
  return url.toString();
}
