import { Injectable, Logger } from '@nestjs/common';
import { EventSource, Prisma, RespondentStatus } from '@prisma/client';
import { config as appConfig } from '../common/config';
import { hmacSha256, randomToken, safeEqualHex, sha256 } from '../common/crypto';
import { WebhooksService } from '../webhooks/webhooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { computeRedirect, internalEndPage } from '../redirects/redirect-engine';
import { OutcomeStatus } from '../redirects/redirect.types';
import { fillCallbackTemplate, parseConfig } from '../redirects/redirects.service';
import {
  CheckResult,
  checkDevice,
  checkEntrySignature,
  checkGeo,
  checkLanguage,
  checkPow,
  checkTimezone,
  POW_BITS,
  powChallenge,
  REASON_LABELS,
} from './respondent-checks';
import { captchaSvg, CaptchaStyle, CAPTCHA_STYLES, HUMAN_MAX_ATTEMPTS, humanChallenge, normaliseAnswer, ProviderStyle, providerKeysOf, verifyProvider } from './captcha';
import { DEFAULT_DESIGN, designOf, END_STATUSES, EndStatus, PageDesign } from './page-design';
import { evaluate, Question, questionsOf } from './questions';
import { TorService } from './tor.service';
import { matchCells, Respondent } from '../quotas/quota.rules';

/** Toggles that need the respondent's browser, so they run on the gate page before the survey. */
const GATE_KEYS = ['gateSurvey', 'captcha', 'browserFingerprinting', 'browserLanguage', 'timezoneTracking', 'cookieValidation'] as const;

export interface GateSubmission {
  nonce?: unknown;
  languages?: unknown;
  timezone?: unknown;
  fingerprint?: unknown;
  answers?: unknown;
}

export interface GateView {
  token: string;
  /** Visible human check still to answer (null when off, invisible, or already passed). */
  human: {
    style: CaptchaStyle;
    kind: 'input' | 'choice' | 'image' | 'widget';
    question: string;
    options?: string[];
    /** widget styles */
    siteKey?: string;
    attemptsLeft: number;
  } | null;
  captcha: { challenge: string; bits: number } | null;
  collect: { languages: boolean; timezone: boolean; fingerprint: boolean };
  gateQuestions: Question[];
  prescreen: Question[];
  design: PageDesign;
  /** Public base URL, for image links. */
  base: string;
  /** Builder preview: renders the page but never submits. */
  preview?: boolean;
}

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
  /** Value of the configured geolocation header, if any. */
  geoCountry?: string;
}

@Injectable()
export class SurveyService {
  private readonly log = new Logger(SurveyService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly tor: TorService,
    private readonly webhooks: WebhooksService,
  ) {}

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
        projectCountry: { include: { project: { include: { organization: true, client: true } }, quotas: true } },
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
    const checks: CheckResult[] = [];

    // URL protection runs before anything is stored: an unsigned link must not be able to claim
    // (and so block) a real respondent's ID.
    if (security.urlProtection) {
      const r = checkEntrySignature(allocation.vendor.callbackSecret, uid, req.query.sig);
      checks.push(r);
      if (!r.ok && !isTest) {
        // Tenant-scoped record (no session exists); counted in the project's security summary.
        await this.prisma.auditEvent.create({
          data: { organizationId: project.organizationId, action: 'respondent.bad-signature', entityType: 'Project', entityId: project.id, detail: { vendor: allocation.vendor.code, country: country.countryCode } },
        });
        return { location: internalEndPage(appConfig.publicBaseUrl, 'SECURITY_REJECT') };
      }
    }

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
    }
    // Server-side checks. Test links run them too, but only log the result.
    const device = checkDevice(project.devices as Record<string, boolean>, req.userAgent);
    checks.push(device);
    if (security.torDetection) {
      const exit = await this.tor.isExitNode(req.ip);
      checks.push(exit === null ? { check: 'tor', ok: true, note: 'exit list not loaded' } : exit ? { check: 'tor', ok: false, reason: 'TOR_EXIT', status: 'SECURITY_REJECT' } : { check: 'tor', ok: true });
    }
    if (security.geolocation) {
      checks.push(appConfig.geoCountryHeader ? checkGeo(req.geoCountry, country.countryCode) : { check: 'geolocation', ok: true, note: 'not configured' });
    }
    if (security.duplicateDetection && ipHash) {
      const sameDevice = await this.prisma.respondentSession.findFirst({
        where: { projectId: project.id, isTest: false, ipHash, userAgent: req.userAgent ?? null },
        select: { id: true },
      });
      checks.push(sameDevice ? { check: 'duplicate', ok: false, reason: 'SAME_DEVICE', status: 'DUPLICATE' } : { check: 'duplicate', ok: true });
    }
    const failed = checks.find((c) => !c.ok);
    if (!initial && !isTest && failed) initial = { status: failed.status!, detail: failed.reason };
    // Quota cells known at entry (device). Answer-based cells are judged after the gate page.
    const cells = matchCells(country.quotas, { device: device.note ?? null, answers: null });
    if (!initial && !isTest && cells.full) initial = { status: 'QUOTA_FULL', detail: 'CELL_FULL' };
    const surveyUrl = isTest ? country.testSurveyUrl ?? country.liveSurveyUrl : country.liveSurveyUrl;
    if (!initial && !surveyUrl) initial = { status: 'TECHNICAL_ERROR', detail: 'NO_SURVEY_LINK' };

    const gateRequired = !initial && gateNeeded(security);
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
          deviceType: device.note,
          geoCountry: appConfig.geoCountryHeader && /^[A-Z]{2}$/i.test(req.geoCountry ?? '') ? req.geoCountry!.toUpperCase() : null,
          gateRequired,
          quotaCellIds: cells.matched.map((c) => c.id),
          expiresAt: new Date(Date.now() + ttl * 60_000),
          events: {
            create: [
              {
                type: 'ENTRY',
                status: initial?.status ?? null,
                source: 'ENTRY',
                idempotencyKey: `entry:${token}`,
                detail: initial ? { reason: initial.detail } : undefined,
              },
              ...(checks.length
                ? [{ type: 'SECURITY_CHECK', status: null, source: 'ENTRY' as const, idempotencyKey: `checks:entry:${token}`, detail: { stage: 'entry', enforced: !isTest, checks } as unknown as Prisma.InputJsonValue }]
                : []),
            ],
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
    if (gateRequired) return { location: `${appConfig.publicBaseUrl}/g/${encodeURIComponent(token)}` };
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
    // The survey link is only released after the gate; an outcome before that means the gate was bypassed.
    const skipped = session.gateRequired && !session.gatePassedAt && session.status === 'STARTED';
    const outcome = skipped ? await this.recordOutcome(session, 'SECURITY_REJECT', 'BROWSER', 'GATE_SKIPPED') : await this.recordOutcome(session, status, 'BROWSER');
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
    reason?: string,
  ): Promise<{ effectiveStatus: OutcomeStatus; conflict: boolean; changed: boolean }> {
    let status: RespondentStatus = requested;
    let detail: string | undefined = reason;

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
        // Atomic quota control: only count the complete if every quota cell the respondent qualified
        // for, the country and the vendor target still have room. Anything taken is given back otherwise.
        const ids = session.quotaCellIds ?? [];
        const cellIds = ids.length ? (await tx.quotaCell.findMany({ where: { id: { in: ids }, projectCountryId: session.projectCountryId }, select: { id: true } })).map((x) => x.id) : [];
        const taken: string[] = [];
        for (const id of cellIds) {
          const ok = await tx.$executeRaw`UPDATE "QuotaCell" SET completes = completes + 1 WHERE id = ${id} AND "isOpen" AND completes < target`;
          if (!ok) break;
          taken.push(id);
        }
        const cellsOk = taken.length === cellIds.length;
        const c = cellsOk ? await tx.$executeRaw`UPDATE "ProjectCountry" SET completes = completes + 1 WHERE id = ${session.projectCountryId} AND completes < "targetCompletes"` : 0;
        const a = c
          ? await tx.$executeRaw`UPDATE "VendorAllocation" SET completes = completes + 1 WHERE id = ${session.vendorAllocationId} AND completes < "targetCompletes"`
          : 0;
        if (c && !a) await tx.$executeRaw`UPDATE "ProjectCountry" SET completes = completes - 1 WHERE id = ${session.projectCountryId}`;
        if (!a) for (const id of taken) await tx.$executeRaw`UPDATE "QuotaCell" SET completes = completes - 1 WHERE id = ${id}`;
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
      return this.recordOutcome(current, requested, source, reason);
    }
    if (status === 'COMPLETE' && !session.isTest) {
      await this.webhooks.emit(session.organizationId, 'session.completed', {
        session: { id: session.id, status, verified: source === 'S2S', vendorRespondentId: session.vendorRespondentId, deviceType: session.deviceType, quotaCellIds: session.quotaCellIds ?? [], startedAt: session.startedAt, outcomeAt: new Date() },
        project: { id: session.project.id, projectCode: session.project.projectCode, name: session.project.name },
        market: { countryCode: session.projectCountry.countryCode, currency: session.projectCountry.currency, targetCompletes: session.projectCountry.targetCompletes },
        vendor: { code: session.vendorAllocation.vendor.code, name: session.vendorAllocation.vendor.name },
      });
    }
    return { effectiveStatus: status as OutcomeStatus, conflict: false, changed: true };
  }

  // ───────────── Respondent gate (browser checks before the survey) ─────────────

  /** What the gate page needs, or where to send the respondent instead. */
  async gateView(token: string): Promise<{ view: GateView } | { location: string }> {
    const session = await this.prisma.respondentSession.findUnique({ where: { token }, include: SESSION_INCLUDE });
    if (!session) return { location: internalEndPage(appConfig.publicBaseUrl, 'SECURITY_REJECT') };
    if (session.status !== 'STARTED') return { location: await this.redirectFor(session, session.status as OutcomeStatus) };
    if (!session.gateRequired || session.gatePassedAt) return { location: this.surveyLink(session) };
    const security = (session.project.security ?? {}) as Record<string, boolean>;
    return {
      view: {
        token,
        human: this.humanView(session),
        captcha: powRequired(security, captchaStyleOf(session)) ? { challenge: powChallenge(appConfig.jwtSecret, token), bits: powBits(session.isTest) } : null,
        collect: { languages: !!security.browserLanguage, timezone: !!security.timezoneTracking, fingerprint: !!security.browserFingerprinting },
        gateQuestions: security.gateSurvey ? questionsOf(session.project.gateQuestions) : [],
        prescreen: security.prescreening ? questionsOf(session.project.prescreen) : [],
        design: designOf(session.project.pageDesign),
        base: appConfig.publicBaseUrl,
      },
    };
  }

  private humanView(session: SessionWithContext): GateView['human'] {
    const security = (session.project.security ?? {}) as Record<string, boolean>;
    const style = captchaStyleOf(session);
    if (!humanRequired(security, style) || session.humanPassedAt) return null;
    const c = humanChallenge(style, appConfig.jwtSecret, session.token, session.humanAttempts);
    if (c.kind === 'none') return null;
    const keys = providerKeysOf(session.project.organization.captchaProviders);
    return {
      style,
      kind: c.kind,
      question: c.text,
      options: c.options,
      siteKey: style === 'turnstile' || style === 'hcaptcha' ? keys[style]?.siteKey : undefined,
      attemptsLeft: HUMAN_MAX_ATTEMPTS - session.humanAttempts,
    };
  }

  /** The text_image picture for the respondent's current attempt. */
  async captchaImage(token: string): Promise<string | null> {
    const session = await this.prisma.respondentSession.findUnique({ where: { token }, include: SESSION_INCLUDE });
    if (!session || session.status !== 'STARTED' || captchaStyleOf(session) !== 'text_image') return null;
    const c = humanChallenge('text_image', appConfig.jwtSecret, token, session.humanAttempts);
    return captchaSvg(c.answer!, hmacSha256(appConfig.jwtSecret, `img:${token}:${session.humanAttempts}`));
  }

  /**
   * Visible human check, answered before the questions. Up to three tries, each with a new
   * challenge; the third wrong answer ends the session (live links) as HUMAN_CHECK_FAILED.
   */
  async humanCheck(token: string, answer: unknown, ip?: string): Promise<{ ok: true } | { ok: false; human: GateView['human'] } | { location: string }> {
    const session = await this.prisma.respondentSession.findUnique({ where: { token }, include: SESSION_INCLUDE });
    if (!session) return { location: internalEndPage(appConfig.publicBaseUrl, 'SECURITY_REJECT') };
    if (session.status !== 'STARTED') return { location: await this.redirectFor(session, session.status as OutcomeStatus) };
    const style = captchaStyleOf(session);
    if (session.humanPassedAt || !humanRequired((session.project.security ?? {}) as Record<string, boolean>, style)) return { ok: true };
    const attempt = session.humanAttempts;
    if (attempt >= HUMAN_MAX_ATTEMPTS) return this.fail(session, 'SECURITY_REJECT', 'HUMAN_CHECK_FAILED');

    let correct: boolean;
    let detail: Record<string, unknown> = {};
    if (style === 'turnstile' || style === 'hcaptcha') {
      const v = await verifyProvider(style, providerKeysOf(session.project.organization.captchaProviders)[style]!.secret, typeof answer === 'string' ? answer : '', ip);
      correct = v.ok;
      detail = { provider: style, unverified: v.unverified ?? false, codes: v.codes };
    } else {
      correct = normaliseAnswer(answer) === humanChallenge(style, appConfig.jwtSecret, token, attempt).answer;
    }
    // Guarded on the attempt number so parallel guesses cannot reuse one challenge.
    const claimed = await this.prisma.respondentSession.updateMany({
      where: { id: session.id, humanAttempts: attempt, humanPassedAt: null },
      data: correct ? { humanAttempts: { increment: 1 }, humanPassedAt: new Date() } : { humanAttempts: { increment: 1 } },
    });
    if (!claimed.count) return this.humanCheck(token, answer, ip);
    await this.event(session.id, 'HUMAN_CHECK', null, 'ENTRY', `human:${session.id}:${attempt}`, { style, ok: correct, attempt: attempt + 1, ...detail });
    if (correct) return { ok: true };
    if (attempt + 1 >= HUMAN_MAX_ATTEMPTS) {
      if (session.isTest) {
        await this.prisma.respondentSession.update({ where: { id: session.id }, data: { humanPassedAt: new Date() } });
        return { ok: true };
      }
      return this.fail(session, 'SECURITY_REJECT', 'HUMAN_CHECK_FAILED');
    }
    const fresh = await this.prisma.respondentSession.findUniqueOrThrow({ where: { id: session.id }, include: SESSION_INCLUDE });
    return { ok: false, human: this.humanView(fresh) };
  }

  /** Expected value of the per-session gate cookie (proves the browser keeps cookies). */
  gateCookieValue(token: string) {
    return hmacSha256(appConfig.jwtSecret, `gate:${token}`).slice(0, 32);
  }

  async gateSubmit(token: string, body: GateSubmission, cookies: { gate?: string; browserId?: string }): Promise<{ location: string }> {
    const session = await this.prisma.respondentSession.findUnique({ where: { token }, include: SESSION_INCLUDE });
    if (!session) return { location: internalEndPage(appConfig.publicBaseUrl, 'SECURITY_REJECT') };
    if (session.status !== 'STARTED') return { location: await this.redirectFor(session, session.status as OutcomeStatus) };
    if (!session.gateRequired || session.gatePassedAt) return { location: this.surveyLink(session) };
    if (session.expiresAt < new Date()) return this.fail(session, 'SECURITY_REJECT', 'EXPIRED');

    const security = (session.project.security ?? {}) as Record<string, boolean>;
    const orgId = session.organizationId;
    const fingerprint = typeof body.fingerprint === 'string' && /^[0-9a-f]{64}$/i.test(body.fingerprint) ? sha256(`${orgId}:${body.fingerprint.toLowerCase()}`) : null;
    const browserId = cookies.browserId && cookies.browserId.length <= 100 ? sha256(`${orgId}:${cookies.browserId}`) : null;
    const checks: CheckResult[] = [];

    // Order of precedence when several things fail: bot checks, then fraud/duplicate checks,
    // then the answers (a duplicate that would also screen out is reported as a duplicate).
    const style = captchaStyleOf(session);
    if (humanRequired(security, style)) {
      checks.push(session.humanPassedAt ? { check: 'human', ok: true } : { check: 'human', ok: false, reason: 'HUMAN_CHECK_FAILED', status: 'SECURITY_REJECT' });
    }
    if (powRequired(security, style)) checks.push(checkPow(powChallenge(appConfig.jwtSecret, token), body.nonce, powBits(session.isTest)));
    if (security.cookieValidation) {
      checks.push(cookies.gate === this.gateCookieValue(token) ? { check: 'cookies', ok: true } : { check: 'cookies', ok: false, reason: 'COOKIES_BLOCKED', status: 'SECURITY_REJECT' });
    }
    if (security.browserLanguage) {
      const langs = Array.isArray(body.languages) ? body.languages.filter((l): l is string => typeof l === 'string').slice(0, 20) : undefined;
      checks.push(checkLanguage(langs, session.projectCountry.language));
    }
    if (security.timezoneTracking) checks.push(checkTimezone(typeof body.timezone === 'string' ? body.timezone.slice(0, 64) : undefined, session.projectCountry.countryCode));
    if (security.browserFingerprinting) {
      if (!fingerprint) checks.push({ check: 'fingerprint', ok: true, note: 'not reported' });
      else {
        const same = await this.prisma.respondentSession.findFirst({ where: { projectId: session.projectId, isTest: false, fingerprintHash: fingerprint, id: { not: session.id } }, select: { id: true } });
        checks.push(same ? { check: 'fingerprint', ok: false, reason: 'SAME_FINGERPRINT', status: 'DUPLICATE' } : { check: 'fingerprint', ok: true });
      }
    }
    if (security.cookieValidation && browserId) {
      const same = await this.prisma.respondentSession.findFirst({ where: { projectId: session.projectId, isTest: false, browserIdHash: browserId, id: { not: session.id } }, select: { id: true } });
      checks.push(same ? { check: 'browser', ok: false, reason: 'SAME_BROWSER', status: 'DUPLICATE' } : { check: 'browser', ok: true });
    }
    const raw = (body.answers && typeof body.answers === 'object' ? body.answers : {}) as { gate?: unknown; prescreen?: unknown };
    const gate = security.gateSurvey ? evaluate(questionsOf(session.project.gateQuestions), raw.gate) : null;
    const pre = security.prescreening ? evaluate(questionsOf(session.project.prescreen), raw.prescreen) : null;
    if (gate || pre) {
      const invalid = gate?.invalid ?? pre?.invalid;
      checks.push(invalid ? { check: 'answers', ok: false, reason: 'GATE_INCOMPLETE', status: 'SECURITY_REJECT', note: invalid } : { check: 'answers', ok: true });
    }
    if (gate) checks.push(gate.screenedOut ? { check: 'gateSurvey', ok: false, reason: 'GATE_SCREENOUT', status: 'TERMINATE', note: gate.screenedOut } : { check: 'gateSurvey', ok: true });
    if (pre) checks.push(pre.screenedOut ? { check: 'prescreening', ok: false, reason: 'PRESCREEN', status: 'TERMINATE', note: pre.screenedOut } : { check: 'prescreening', ok: true });

    // Quota cells, now that the answers are known. Checked last: a screen-out stays a terminate.
    const cellAnswers = { ...(gate ? { gate: gate.answers } : {}), ...(pre ? { prescreen: pre.answers } : {}) } as Respondent['answers'];
    const quotaCells = await this.prisma.quotaCell.findMany({ where: { projectCountryId: session.projectCountryId } });
    const cells = matchCells(quotaCells, { device: session.deviceType, answers: cellAnswers });
    if (quotaCells.length) {
      checks.push(cells.full ? { check: 'quota', ok: false, reason: 'CELL_FULL', status: 'QUOTA_FULL', note: cells.full.name } : { check: 'quota', ok: true, note: cells.matched.map((c) => c.name).join(', ') || 'no cell' });
    }

    const enforced = !session.isTest;
    const answers = gate || pre ? ({ ...(gate ? { gate: gate.answers } : {}), ...(pre ? { prescreen: pre.answers } : {}) } as Prisma.InputJsonValue) : undefined;
    await this.prisma.respondentSession.update({ where: { id: session.id }, data: { fingerprintHash: fingerprint, browserIdHash: browserId, answers, quotaCellIds: cells.matched.map((c) => c.id) } });
    await this.event(session.id, 'SECURITY_CHECK', null, 'ENTRY', `checks:gate:${session.id}:${randomToken(4)}`, { stage: 'gate', enforced, checks });

    const failed = checks.find((c) => !c.ok);
    if (failed && enforced) return this.fail(session, failed.status!, failed.reason!);

    // Guarded so two submits cannot both release the link with different results.
    await this.prisma.respondentSession.updateMany({ where: { id: session.id, gatePassedAt: null }, data: { gatePassedAt: new Date() } });
    return { location: this.surveyLink(session) };
  }

  private async fail(session: SessionWithContext, status: OutcomeStatus, reason: string) {
    const r = await this.recordOutcome(session, status, 'ENTRY', reason);
    const fresh = await this.prisma.respondentSession.findUniqueOrThrow({ where: { id: session.id }, include: SESSION_INCLUDE });
    return { location: await this.redirectFor(fresh, r.effectiveStatus) };
  }

  private surveyLink(session: SessionWithContext) {
    const c = session.projectCountry;
    const url = session.isTest ? c.testSurveyUrl ?? c.liveSurveyUrl : c.liveSurveyUrl;
    if (!url) return internalEndPage(appConfig.publicBaseUrl, 'TECHNICAL_ERROR');
    return buildSurveyLink(url, { token: session.token, countryCode: c.countryCode, projectCode: session.project.projectCode });
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
    return this.respondentFacing(session, status, result.destination);
  }

  /**
   * Where the browser actually goes. Our own end page gets the token so it can show the
   * project's design; with the interstitial on, external destinations go through the
   * designed end page first, which counts down and then continues to the recorded destination.
   */
  private respondentFacing(session: SessionWithContext, status: OutcomeStatus, destination: string): string {
    const endBase = `${appConfig.publicBaseUrl}/end/`;
    const t = encodeURIComponent(session.token);
    if (destination.startsWith(endBase) && !destination.includes('?')) return `${destination}?t=${t}`;
    const design = designOf(session.project.pageDesign);
    if (design.interstitial.enabled && !destination.startsWith(endBase)) return `${endBase}${status.toLowerCase()}?t=${t}`;
    return destination;
  }

  /** Data for a designed end page. Status comes from the recorded redirect, not the URL, when a token is known. */
  async endView(slug: string, token: string | undefined): Promise<{ design: PageDesign; status: EndStatus; continueUrl?: string; seconds?: number }> {
    const fallback = (END_STATUSES as readonly string[]).includes(slug) ? (slug as EndStatus) : 'technical_error';
    if (!token || token.length > 200) return { design: DEFAULT_DESIGN, status: fallback };
    const session = await this.prisma.respondentSession.findUnique({ where: { token }, select: { id: true, project: { select: { pageDesign: true } } } });
    if (!session) return { design: DEFAULT_DESIGN, status: fallback };
    const design = designOf(session.project.pageDesign);
    const last = await this.prisma.redirectExecution.findFirst({ where: { sessionId: session.id }, orderBy: { createdAt: 'desc' }, select: { status: true, destination: true } });
    if (!last) return { design, status: fallback };
    const status = (END_STATUSES as readonly string[]).includes(last.status.toLowerCase()) ? (last.status.toLowerCase() as EndStatus) : fallback;
    const external = !last.destination.startsWith(`${appConfig.publicBaseUrl}/end/`);
    if (design.interstitial.enabled && external) return { design, status, continueUrl: last.destination, seconds: design.interstitial.seconds };
    return { design, status };
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

/** Test links use an easier challenge so QA runs stay quick; live links use the full one. */
function powBits(isTest: boolean) {
  return isTest ? 12 : POW_BITS;
}

/** Captcha style for a session; a third-party style without keys falls back to the built-in math check. */
function captchaStyleOf(session: { project: { captchaStyle: string; organization: { captchaProviders: Prisma.JsonValue } } }): CaptchaStyle {
  const style = (CAPTCHA_STYLES as readonly string[]).includes(session.project.captchaStyle) ? (session.project.captchaStyle as CaptchaStyle) : 'math';
  if ((style === 'turnstile' || style === 'hcaptcha') && !providerKeysOf(session.project.organization.captchaProviders)[style as ProviderStyle]) return 'math';
  return style;
}

/** The gate survey always starts with a human check; the captcha toggle adds one too. "invisible" has no visible step. */
function humanRequired(security: Record<string, boolean>, style: CaptchaStyle) {
  return !!(security.gateSurvey || security.captcha) && style !== 'invisible';
}

/** The background proof-of-work runs with the captcha toggle, and replaces the visible step for "invisible". */
function powRequired(security: Record<string, boolean>, style: CaptchaStyle) {
  return !!security.captcha || (!!security.gateSurvey && style === 'invisible');
}

export function gateNeeded(security: Record<string, boolean>): boolean {
  return GATE_KEYS.some((k) => security[k]) || !!security.prescreening;
}

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
