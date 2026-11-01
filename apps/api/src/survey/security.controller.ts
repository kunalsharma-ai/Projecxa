import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Put, Query, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { CAPTCHA_STYLES, PROVIDER_STYLES, providerKeysOf } from './captcha';
import { questionTemplates } from './questions';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/decorators';
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
