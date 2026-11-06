/**
 * SAMPLEON integration (docs/SAMPLEON_INTEGRATION.md; SAMPLEON docs/ECOSYSTEM_ARCHITECTURE.md).
 *
 * SampTrek project → SAMPLEON audience request → SUPPLY360 panelists → ZAPX survey → SAMPLEON → SampTrek.
 *
 * SampTrek owns the project, its targets, budgets and approved changes. It sends an audience request
 * built from the project to SAMPLEON, which owns targeting, feasibility, approval, invitations,
 * routing and live quota counting. SAMPLEON reports progress back with signed events. SampTrek keeps
 * no respondent list and no second quota counter for SAMPLEON respondents: the progress below is
 * SAMPLEON's, shown next to (not added into) the completes SampTrek routed itself.
 */
import {
  BadGatewayException, BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpException, Module, NotFoundException, Param, Post, Put, Req,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, EDITORS, Public, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { hmacSha256, safeEqualHex, sha256 } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { questionsOf } from '../survey/questions';
import { quotaMapSchema, translateCells, type AttributeDef, type QuotaMap, type Translation } from './quota-translate';

const WINDOW_SECONDS = 300;

/** Read on every call so the settings can change without a restart (and in tests). */
export const sampleonConfig = () => ({
  url: (process.env.SAMPLEON_URL ?? '').replace(/\/+$/, ''),
  clientId: process.env.SAMPLEON_CLIENT_ID || 'projexa',
  secret: process.env.SAMPLEON_CLIENT_SECRET ?? '',
  configured: !!(process.env.SAMPLEON_URL && process.env.SAMPLEON_CLIENT_SECRET),
});

/**
 * Sampledge service signature (SAMPLEON §5.0):
 * v1=hex HMAC-SHA256(secret, ts + "." + METHOD + "." + path + "." + sha256hex(body)).
 */
export function sampledgeHeaders(clientId: string, secret: string, method: string, path: string, body: string, nowMs = Date.now()) {
  const ts = String(Math.floor(nowMs / 1000));
  return {
    'X-Sampledge-Client': clientId,
    'X-Sampledge-Timestamp': ts,
    'X-Sampledge-Signature': `v1=${hmacSha256(secret, `${ts}.${method.toUpperCase()}.${path}.${sha256(body)}`)}`,
  };
}

const Country = z.string().regex(/^[A-Z]{2}$/);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const submitSchema = z
  .object({
    /** The client survey at the survey host, e.g. the ZAPX survey id. */
    surveyId: z.string().regex(/^[\w.:\-]{1,120}$/),
    /** The survey host's launch URL with {token}, e.g. ZAPX's GET /api/surveys/{id}/sampleon launchUrl. */
    launchUrl: z.string().url().max(2000),
    /** Which survey-host client at SAMPLEON receives respondents; default zapx. */
    hostId: z.string().max(60).optional(),
    title: z.string().min(1).max(200).optional(),
    targeting: z
      .object({ naturalLanguage: z.string().max(2000).optional(), criteria: z.array(z.record(z.string(), z.unknown())).max(100).default([]) })
      .default({ criteria: [] }),
    /** Quotas in SAMPLEON's format (SUPPLY360 attributes). Left empty, the project's quota cells are translated. */
    quotas: z.array(z.record(z.string(), z.unknown())).max(200).default([]),
    /** Translate the project's quota cells with the saved question map (default true when `quotas` is empty). */
    useProjectQuotas: z.boolean().optional(),
    rewardPoints: z.number().int().min(0).max(1_000_000),
    fieldwork: z.object({ start: IsoDate, end: IsoDate }).optional(),
    allowRouting: z.boolean().default(true),
  })
  .refine((v) => v.targeting.criteria.length > 0 || !!v.targeting.naturalLanguage, { message: 'Describe the audience, or give targeting criteria', path: ['targeting'] });

const envelopeSchema = z.object({
  specVersion: z.literal('1.0'),
  eventId: z.string().uuid(),
  type: z.string().min(1).max(80),
  source: z.literal('SAMPLEON'),
  occurredAt: z.string(),
  correlationId: z.string().regex(/^AR-[0-9A-HJKMNP-TV-Z]{26}$/),
  subject: z.object({ sourcePlatform: z.string(), sourceProjectId: z.string(), surveyId: z.string() }).passthrough(),
  payload: z.record(z.string(), z.unknown()),
});
const counts = z.object({ required: z.number().int(), completes: z.number().int(), remaining: z.number().int() }).passthrough();

const day = (d: Date) => d.toISOString().slice(0, 10);

@Controller()
export class SampleonController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async project(u: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({
      where: { id, organizationId: u.organizationId },
      include: { countries: true, organization: { select: { id: true, name: true } } },
    });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  /** Targets as SAMPLEON needs them: one entry per country (languages of one country add up). */
  private static targets(p: Awaited<ReturnType<SampleonController['project']>>) {
    const byCountry: Record<string, number> = {};
    for (const c of p.countries) byCountry[c.countryCode] = (byCountry[c.countryCode] ?? 0) + c.targetCompletes;
    const required = Object.values(byCountry).reduce((s, n) => s + n, 0);
    return { byCountry, required };
  }

  private static fieldwork(p: { fieldStartAt: Date | null; fieldEndAt: Date | null }, given?: { start: string; end: string }) {
    if (given) return given;
    if (!p.fieldStartAt || !p.fieldEndAt) throw new BadRequestException({ message: 'Set the fieldwork dates on the project first', issues: ['fieldwork'] });
    return { start: day(p.fieldStartAt), end: day(p.fieldEndAt) };
  }

  /** Signed call to SAMPLEON. Its 4xx answers are passed on; anything else is a 502. */
  private async call(method: 'GET' | 'POST' | 'PATCH', path: string, body: unknown, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const cfg = sampleonConfig();
    const text = method === 'GET' ? '' : JSON.stringify(body);
    let res: Response;
    try {
      res = await fetch(cfg.url + path, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
        headers: { ...(method === 'GET' ? {} : { 'content-type': 'application/json' }), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}), ...sampledgeHeaders(cfg.clientId, cfg.secret, method, path, text) },
        ...(method === 'GET' ? {} : { body: text }),
      });
    } catch (e) {
      throw new BadGatewayException(`SAMPLEON could not be reached: ${(e as Error).message}`.slice(0, 300));
    }
    const raw = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { message: raw.slice(0, 300) }; }
    if (res.ok) return parsed;
    if (res.status >= 400 && res.status < 500) throw new HttpException({ message: 'SAMPLEON refused the request', sampleon: parsed }, res.status);
    throw new BadGatewayException({ message: `SAMPLEON answered ${res.status}`, sampleon: parsed });
  }

  /** SUPPLY360's attribute catalogue, read through SAMPLEON. */
  private async catalogue(): Promise<AttributeDef[]> {
    const r = await this.call('GET', '/api/v1/attributes', undefined);
    return Array.isArray(r.attributes) ? (r.attributes as AttributeDef[]) : [];
  }

  /** The project's quota cells translated with the saved map. */
  private async translation(organizationId: string, projectId: string, catalogue?: AttributeDef[]): Promise<Translation & { map: QuotaMap; cells: number }> {
    const p = await this.prisma.project.findFirstOrThrow({
      where: { id: projectId, organizationId },
      select: { gateQuestions: true, prescreen: true, sampleonQuotaMap: true, countries: { select: { countryCode: true, quotas: { orderBy: { sortOrder: 'asc' } } } } },
    });
    const saved = quotaMapSchema.safeParse(p.sampleonQuotaMap ?? {});
    const map = saved.success ? saved.data : {};
    const cells = p.countries.flatMap((c) => c.quotas.map((q) => ({ id: q.id, group: q.group, name: q.name, target: q.target, isOpen: q.isOpen, country: c.countryCode, conditions: q.conditions })));
    if (!cells.length) return { quotas: [], skipped: [], questions: [], map, cells: 0 };
    const t = translateCells({ cells, gate: questionsOf(p.gateQuestions), prescreen: questionsOf(p.prescreen), catalogue: catalogue ?? (await this.catalogue()), map });
    return { ...t, map, cells: cells.length };
  }

  // ───────────── Staff ─────────────

  @Get('projects/:id/sampleon')
  async overview(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.project(u, id);
    const requests = await this.prisma.sampleonAudienceRequest.findMany({ where: { organizationId: u.organizationId, projectId: p.id }, orderBy: { createdAt: 'desc' } });
    return { configured: sampleonConfig().configured, requests };
  }

  /** How the project's quota cells would be sent to SAMPLEON, and the question → attribute map. */
  @Get('projects/:id/sampleon/quotas')
  async quotas(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    if (!sampleonConfig().configured) throw new ServiceUnavailableException('The SAMPLEON integration is not configured');
    const p = await this.project(u, id);
    const attributes = await this.catalogue();
    return { ...(await this.translation(u.organizationId, p.id, attributes)), attributes };
  }

  /** Save the question → attribute map. Answers left out are matched to attribute values by label. */
  @Put('projects/:id/sampleon/quotas')
  @Roles(...EDITORS)
  async saveQuotaMap(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    if (!sampleonConfig().configured) throw new ServiceUnavailableException('The SAMPLEON integration is not configured');
    const input = z.object({ map: quotaMapSchema }).strict().safeParse(body);
    if (!input.success) throw new BadRequestException({ message: 'Invalid map', issues: input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const p = await this.project(u, id);
    const attributes = await this.catalogue();
    const known = new Map(attributes.map((a) => [a.key, a]));
    const issues: string[] = [];
    for (const [key, m] of Object.entries(input.data.map)) {
      const a = known.get(m.attribute);
      if (!a) { issues.push(`${key}: SUPPLY360 has no attribute ${m.attribute}`); continue; }
      for (const [answer, v] of Object.entries(m.values)) {
        const ok = a.type === 'boolean' ? typeof v === 'boolean' : a.type === 'number' ? typeof v === 'number' : a.type === 'enum' ? (a.values ?? []).includes(String(v)) : typeof v === 'string';
        if (!ok) issues.push(`${key}.${answer}: ${JSON.stringify(v)} is not a value of ${a.label}`);
      }
    }
    if (issues.length) throw new BadRequestException({ message: 'The map does not fit the SUPPLY360 attributes', issues });
    await this.prisma.project.update({ where: { id: p.id }, data: { sampleonQuotaMap: input.data.map as Prisma.InputJsonValue } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'sampleon.quota-map.saved', entityType: 'Project', entityId: p.id, detail: { questions: Object.keys(input.data.map) } });
    return { ...(await this.translation(u.organizationId, p.id, attributes)), attributes };
  }

  /** Send the project's approved requirements to SAMPLEON. Invitations wait for approval in SAMPLEON. */
  @Post('projects/:id/sampleon/audience-requests')
  @Roles(...EDITORS)
  async submit(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    if (!sampleonConfig().configured) throw new ServiceUnavailableException('The SAMPLEON integration is not configured');
    const input = submitSchema.safeParse(body);
    if (!input.success) throw new BadRequestException({ message: 'Invalid request', issues: input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const v = input.data;
    const p = await this.project(u, id);
    if (!p.countries.length) throw new BadRequestException({ message: 'Add the project’s countries first', issues: ['countries'] });
    if (p.status === 'CLOSED' || p.status === 'INVOICED') throw new ConflictException(`A ${p.status.toLowerCase()} project cannot request an audience`);
    const { byCountry, required } = SampleonController.targets(p);
    if (required < 1) throw new BadRequestException({ message: 'Set the target completes first', issues: ['targetCompletes'] });
    // Expected incidence: the project's IR weighted by each country's target.
    const useProject = v.useProjectQuotas ?? v.quotas.length === 0;
    if (useProject && v.quotas.length) throw new BadRequestException({ message: 'Send quotas or use the project’s quota cells, not both', issues: ['quotas'] });
    const translated = useProject ? await this.translation(u.organizationId, p.id) : null;
    const ir = p.countries.reduce((s, c) => s + c.irPercent * c.targetCompletes, 0) / Math.max(1, required) / 100;
    const request = {
      source: { platform: 'PROJEXA', projectId: p.projectCode, surveyId: v.surveyId },
      organization: { id: p.organization.id, name: p.organization.name },
      title: v.title ?? p.name,
      countries: Object.keys(byCountry).sort(),
      targeting: v.targeting,
      requiredCompletes: required,
      completesByCountry: byCountry,
      quotas: translated ? translated.quotas : v.quotas,
      expectedIncidence: Math.min(1, Math.max(0.01, ir || 0.5)),
      loiMinutes: Math.max(...p.countries.map((c) => c.loiMinutes)),
      reward: { points: v.rewardPoints },
      fieldwork: SampleonController.fieldwork(p, v.fieldwork),
      survey: { launchUrl: v.launchUrl, language: p.countries[0]!.language, hostId: v.hostId ?? 'zapx' },
      redirects: { allowRouting: v.allowRouting },
    };
    Country.array().parse(request.countries);
    const ar = await this.call('POST', '/api/v1/audience-requests', request, `projexa:${p.id}:${randomBytes(8).toString('hex')}`);
    const audienceRequestId = typeof ar.audienceRequestId === 'string' ? ar.audienceRequestId : null;
    if (!audienceRequestId || !/^AR-[0-9A-HJKMNP-TV-Z]{26}$/.test(audienceRequestId)) throw new BadGatewayException('SAMPLEON did not return an Audience Request ID');
    const row = await this.prisma.sampleonAudienceRequest.create({
      data: {
        organizationId: u.organizationId, projectId: p.id, audienceRequestId, surveyId: v.surveyId,
        status: String(ar.status ?? 'submitted'), requiredCompletes: required, remaining: required, createdById: u.id, usesProjectQuotas: !!translated,
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'sampleon.audience-request.submitted', entityType: 'Project', entityId: p.id, detail: { audienceRequestId: row.audienceRequestId, quotas: translated?.quotas.length ?? v.quotas.length } });
    return { audienceRequest: ar, record: row, quotas: { sent: translated?.quotas ?? v.quotas, skipped: translated?.skipped ?? [] } };
  }

  /** Send approved project changes (targets per country, fieldwork dates) to SAMPLEON. */
  @Post('projects/:id/sampleon/:requestId/sync')
  @Roles(...EDITORS)
  @HttpCode(200)
  async sync(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('requestId') requestId: string) {
    if (!sampleonConfig().configured) throw new ServiceUnavailableException('The SAMPLEON integration is not configured');
    const p = await this.project(u, id);
    const row = await this.prisma.sampleonAudienceRequest.findFirst({ where: { id: requestId, projectId: p.id, organizationId: u.organizationId } });
    if (!row) throw new NotFoundException('Audience request not found');
    const { byCountry, required } = SampleonController.targets(p);
    const translated = row.usesProjectQuotas ? await this.translation(u.organizationId, p.id) : null;
    const change = {
      requiredCompletes: required,
      ...(translated ? { quotas: translated.quotas } : {}),
      completesByCountry: byCountry,
      ...(p.fieldStartAt && p.fieldEndAt ? { fieldwork: { start: day(p.fieldStartAt), end: day(p.fieldEndAt) } } : {}),
    };
    const ar = await this.call('PATCH', `/api/v1/audience-requests/${row.audienceRequestId}`, change);
    const updated = await this.prisma.sampleonAudienceRequest.update({
      where: { id: row.id },
      data: { requiredCompletes: required, remaining: Math.max(0, required - row.completes) },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'sampleon.audience-request.changed', entityType: 'Project', entityId: p.id, detail: { audienceRequestId: row.audienceRequestId, ...change } });
    return { audienceRequest: ar, record: updated, ...(translated ? { quotas: { sent: translated.quotas, skipped: translated.skipped } } : {}) };
  }

  // ───────────── Events from SAMPLEON (public, signed) ─────────────

  @Public()
  @Post('integrations/sampleon/events')
  @HttpCode(200)
  async events(@Req() req: Request & { rawBody?: Buffer }) {
    const cfg = sampleonConfig();
    if (!cfg.configured) throw new ServiceUnavailableException('The SAMPLEON integration is not configured');
    const h = (k: string) => req.header(k) ?? '';
    const ts = h('x-sampledge-timestamp');
    const sig = h('x-sampledge-signature').replace(/^v1=/, '');
    const raw = req.rawBody?.toString('utf8') ?? '';
    const expected = hmacSha256(cfg.secret, `${ts}.POST.${req.originalUrl}.${sha256(raw)}`);
    if (h('x-sampledge-client') !== 'sampleon' || !/^[0-9a-f]{64}$/i.test(sig) || !safeEqualHex(expected, sig)) throw new UnauthorizedException('Invalid signature');
    if (!(Math.abs(Date.now() / 1000 - Number(ts)) <= WINDOW_SECONDS)) throw new UnauthorizedException('Timestamp outside the allowed window');

    const parsed = envelopeSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new BadRequestException({ message: 'Invalid event', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    const e = parsed.data;
    try {
      await this.prisma.sampleonInboundEvent.create({ data: { eventId: e.eventId, type: e.type, audienceRequestId: e.correlationId } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { status: 'duplicate' };
      throw err;
    }
    const row = await this.prisma.sampleonAudienceRequest.findUnique({ where: { audienceRequestId: e.correlationId }, include: { project: { select: { projectCode: true } } } });
    if (!row || row.project.projectCode !== e.subject.sourceProjectId) return { status: 'ignored' };
    const data: Prisma.SampleonAudienceRequestUpdateInput = { lastEventType: e.type, lastEventAt: new Date(e.occurredAt) };
    const p = e.payload;
    switch (e.type) {
      case 'feasibility.calculated':
        if (row.status === 'submitted') data.status = 'feasibility_ready';
        break;
      case 'audience.approved':
        data.status = 'approved';
        break;
      case 'batch.scheduled':
        if (['approved', 'soft_launch', 'paused'].includes(row.status)) data.status = p.mode === 'soft' ? 'soft_launch' : 'live';
        break;
      case 'survey.completed': {
        const c = counts.safeParse(p.progress);
        if (c.success) Object.assign(data, { completes: c.data.completes, remaining: c.data.remaining });
        break;
      }
      case 'project.quota_updated': {
        const seq = Number(p.sequence);
        const c = counts.safeParse(p.progress);
        if (Number.isInteger(seq) && seq > row.progressSequence && c.success) {
          Object.assign(data, {
            progressSequence: seq,
            completes: c.data.completes,
            remaining: c.data.remaining,
            progress: { byCountry: p.byCountry ?? {}, quotas: p.quotas ?? [] } as Prisma.InputJsonValue,
          });
        }
        break;
      }
      case 'project.closed':
        data.status = 'closed';
        break;
      default:
        break;
    }
    await this.prisma.sampleonAudienceRequest.update({ where: { id: row.id }, data });
    if (e.type === 'project.closed') {
      await this.audit.record({ organizationId: row.organizationId, actorId: null, action: 'sampleon.audience-request.closed', entityType: 'Project', entityId: row.projectId, detail: { audienceRequestId: row.audienceRequestId, reason: p.reason ?? null } });
    }
    return { status: 'processed' };
  }
}

@Module({ controllers: [SampleonController] })
export class SampleonModule {}
