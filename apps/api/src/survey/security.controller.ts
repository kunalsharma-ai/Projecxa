import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Put, Query, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { CAPTCHA_STYLES, PROVIDER_STYLES, providerKeysOf } from './captcha';
import { questionListSchema, questionsOf, questionTemplates } from './questions';
import { AUDIENCES, builtInQuestionSets } from './question-sets';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { config } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';
import { REASON_LABELS } from './respondent-checks';
import { TorService } from './tor.service';

/** What the respondent security settings can actually check in this installation, and what they caught. */
const captchaKeysSchema = z
  .object(
    Object.fromEntries(
      PROVIDER_STYLES.map((p) => [p, z.object({ siteKey: z.string().min(10).max(200), secret: z.string().min(10).max(200).optional() }).nullable().optional()]),
    ) as Record<(typeof PROVIDER_STYLES)[number], z.ZodOptional<z.ZodNullable<z.ZodObject<{ siteKey: z.ZodString; secret: z.ZodOptional<z.ZodString> }>>>>,
  )
  .strict();

const questionSetSchema = z
  .object({
    name: z.string().trim().min(2, 'Use at least 2 characters').max(80),
    description: z.string().trim().max(300).nullable().optional(),
    questions: questionListSchema.refine((qs) => qs.length > 0, 'Add at least one question'),
  })
  .strict();
const SET_KEY = /^(b2b|b2c|parents|teens|hc_consumer|hc_patient|hc_caregiver|custom-[a-z0-9]{6,32})$/;

@Controller()
export class SecurityController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tor: TorService,
    private readonly audit: AuditService,
  ) {}

  @Get('security/status')
  async status() {
    return {
      geolocation: { configured: !!config.geoCountryHeader, header: config.geoCountryHeader },
      tor: await this.tor.status(),
    };
  }

  /** Ready-made gate survey questions (demographics, financial, education) for the question builder. */
  @Get('question-templates')
  templates(@Query('currency') currency?: string) {
    return questionTemplates(/^[A-Z]{3}$/.test(currency ?? '') ? currency : 'USD');
  }

  /**
   * Gate survey question sets per audience (B2B, B2C, parents, teens, healthcare consumers, patients
   * and caregivers), with this organisation's edited versions and its own sets (docs/GATE_QUESTION_SETS.md).
   */
  @Get('question-templates/sets')
  async questionSets(@CurrentUser() u: AuthUser, @Query('currency') currency?: string) {
    const builtIn = builtInQuestionSets(/^[A-Z]{3}$/.test(currency ?? '') ? currency : 'USD');
    const saved = await this.prisma.questionSet.findMany({ where: { organizationId: u.organizationId }, orderBy: { createdAt: 'asc' } });
    const users = await this.prisma.user.findMany({ where: { id: { in: saved.map((s) => s.updatedById).filter((x): x is string => !!x) }, organizationId: u.organizationId }, select: { id: true, name: true } });
    const by = (id: string | null) => users.find((x) => x.id === id)?.name ?? null;
    const own = (k: string) => saved.find((s) => s.key === k);
    return [
      ...builtIn.map((b) => {
        const s = own(b.key);
        return s
          ? { key: b.key, name: s.name, description: s.description ?? b.description, questions: questionsOf(s.questions), builtIn: true, edited: true, updatedAt: s.updatedAt, updatedBy: by(s.updatedById) }
          : { ...b, builtIn: true, edited: false, updatedAt: null, updatedBy: null };
      }),
      ...saved
        .filter((s) => s.key.startsWith('custom-'))
        .map((s) => ({ key: s.key, name: s.name, description: s.description ?? '', questions: questionsOf(s.questions), builtIn: false, edited: true, updatedAt: s.updatedAt, updatedBy: by(s.updatedById) })),
    ];
  }

  /** Saves a question set: a built-in key stores this organisation's version; "new" makes a custom set. */
  @Put('question-templates/sets/:key')
  @Roles(...EDITORS)
  async saveQuestionSet(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body(new ZodPipe(questionSetSchema)) body: z.infer<typeof questionSetSchema>) {
    if (key === 'new') key = `custom-${randomBytes(6).toString('hex')}`;
    if (!SET_KEY.test(key)) throw new BadRequestException('Unknown question set');
    if (key.startsWith('custom-') && !(await this.prisma.questionSet.findFirst({ where: { organizationId: u.organizationId, key } })) && (await this.prisma.questionSet.count({ where: { organizationId: u.organizationId, key: { startsWith: 'custom-' } } })) >= 50) {
      throw new BadRequestException('You can keep up to 50 of your own question sets');
    }
    const data = { name: body.name, description: body.description ?? null, questions: body.questions as unknown as Prisma.InputJsonValue, updatedById: u.id };
    await this.prisma.questionSet.upsert({ where: { organizationId_key: { organizationId: u.organizationId, key } }, create: { organizationId: u.organizationId, key, ...data }, update: data });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'question-set.save', entityType: 'QuestionSet', entityId: key, detail: { name: body.name, questions: body.questions.length } });
    return { key };
  }

  /** Built-in set: back to the standard version. Own set: deleted. */
  @Delete('question-templates/sets/:key')
  @Roles(...EDITORS)
  async deleteQuestionSet(@CurrentUser() u: AuthUser, @Param('key') key: string) {
    if (!SET_KEY.test(key)) throw new BadRequestException('Unknown question set');
    const r = await this.prisma.questionSet.deleteMany({ where: { organizationId: u.organizationId, key } });
    if (!r.count && !(AUDIENCES as readonly string[]).includes(key)) throw new NotFoundException('Question set not found');
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: (AUDIENCES as readonly string[]).includes(key) ? 'question-set.reset' : 'question-set.delete', entityType: 'QuestionSet', entityId: key });
    return { ok: true };
  }

  /** Captcha styles and which free providers have keys. Secrets are never returned. */
  @Get('security/captcha')
  async captcha(@CurrentUser() u: AuthUser) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { captchaProviders: true } });
    const keys = providerKeysOf(org.captchaProviders);
    return {
      styles: CAPTCHA_STYLES,
      providers: Object.fromEntries(PROVIDER_STYLES.map((p) => [p, { configured: !!keys[p], siteKey: keys[p]?.siteKey ?? null }])),
    };
  }

  /** Sets or removes free captcha provider keys (null removes; omit the secret to keep the current one). */
  @Put('security/captcha')
  @Roles('ADMIN')
  async setCaptcha(@CurrentUser() u: AuthUser, @Body(new ZodPipe(captchaKeysSchema)) body: z.infer<typeof captchaKeysSchema>) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, select: { captchaProviders: true } });
    const keys = providerKeysOf(org.captchaProviders);
    for (const p of PROVIDER_STYLES) {
      const v = body[p];
      if (v === null) delete keys[p];
      else if (v) {
        const secret = v.secret ?? keys[p]?.secret;
        if (!secret) throw new BadRequestException(`Add the ${p} secret key`);
        keys[p] = { siteKey: v.siteKey, secret };
      }
    }
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { captchaProviders: Object.keys(keys).length ? (keys as Prisma.InputJsonValue) : Prisma.DbNull } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'security.captcha-keys', entityType: 'Organization', entityId: u.organizationId, detail: { configured: Object.keys(keys) } });
    return this.captcha(u);
  }

  @Post('security/tor/sync')
  @Roles('ADMIN')
  @HttpCode(200)
  async syncTor(@CurrentUser() u: AuthUser) {
    try {
      const r = await this.tor.sync();
      await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'security.tor-sync', entityType: 'Organization', entityId: u.organizationId, detail: r });
      return { ...r, ...(await this.tor.status()) };
    } catch (e) {
      throw new ServiceUnavailableException(`Could not download the TOR exit list: ${(e as Error).message}`);
    }
  }

  /** Live (non-test) sessions stopped by each check, plus how many passed the gate. */
  @Get('projects/:id/security-summary')
  async summary(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, organizationId: u.organizationId }, select: { id: true } });
    if (!p) throw new NotFoundException('Project not found');
    const where = { projectId: p.id, isTest: false };
    const [byReason, entries, gated, passed] = await Promise.all([
      this.prisma.respondentSession.groupBy({
        by: ['status', 'statusDetail'],
        where: { ...where, statusDetail: { in: Object.keys(REASON_LABELS) } },
        _count: { _all: true },
      }),
      this.prisma.respondentSession.count({ where }),
      this.prisma.respondentSession.count({ where: { ...where, gateRequired: true } }),
      this.prisma.respondentSession.count({ where: { ...where, gateRequired: true, gatePassedAt: { not: null } } }),
    ]);
    // Rejected unsigned entry links never create a session; they are logged against the project.
    const badSig = await this.prisma.auditEvent.count({ where: { organizationId: u.organizationId, action: 'respondent.bad-signature', entityType: 'Project', entityId: p.id } });
    const reasons = byReason.map((g) => ({ reason: g.statusDetail!, label: REASON_LABELS[g.statusDetail!], status: g.status, count: g._count._all }));
    if (badSig) reasons.push({ reason: 'BAD_SIGNATURE', label: REASON_LABELS.BAD_SIGNATURE, status: 'SECURITY_REJECT', count: badSig });
    reasons.sort((a, b) => b.count - a.count);
    return { entries, gate: { required: gated, passed }, reasons };
  }
}
