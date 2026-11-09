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
import { IpReputationService } from './ip-reputation';
import { riskBand } from './fraud';

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
    private readonly ipRep: IpReputationService,
  ) {}

  @Get('security/status')
  async status(@CurrentUser() u: AuthUser) {
    const rep = await this.ipRep.settings(u.organizationId);
    return {
      geolocation: { configured: !!config.geoCountryHeader, header: config.geoCountryHeader },
      tor: await this.tor.status(),
      ipReputation: { lists: rep.lists, proxycheck: !!rep.proxycheckKey, allowList: !!rep.allow, blockList: !!rep.block, sources: await this.ipRep.status() },
    };
  }

  /** Downloads the free public IP lists now (they also refresh every 12 hours). */
  @Post('security/ip-lists/sync')
  @Roles('ADMIN')
  @HttpCode(200)
  async syncIpLists(@CurrentUser() u: AuthUser) {
    const r = await this.ipRep.syncAll();
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'security.ip-lists-sync', entityType: 'Organization', entityId: u.organizationId, detail: { lists: r } });
    if (r.every((x) => x.error)) throw new ServiceUnavailableException(`Could not download the IP lists: ${r[0]?.error}`);
    return { lists: r, sources: await this.ipRep.status() };
  }

  /**
   * Repeat people: respondents of this project whose device, fingerprint or browser cookie also
   * entered another project of the organisation or this project through another vendor
   * (docs/FRAUD_CHECKS.md). Live traffic only, newest first, at most 50 groups.
   */
  @Get('projects/:id/fraud/linked')
  async linked(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, organizationId: u.organizationId }, select: { id: true } });
    if (!p) throw new NotFoundException('Project not found');
    const select = {
      id: true, projectId: true, vendorRespondentId: true, status: true, statusDetail: true, startedAt: true, riskScore: true,
      fingerprintHash: true, deviceHash: true, browserIdHash: true,
      project: { select: { projectCode: true, name: true } },
      vendorAllocation: { select: { vendorId: true, vendor: { select: { name: true, code: true } } } },
    } as const;
    const here = await this.prisma.respondentSession.findMany({
      where: { projectId: p.id, isTest: false, OR: [{ fingerprintHash: { not: null } }, { deviceHash: { not: null } }, { browserIdHash: { not: null } }] },
      select, orderBy: { startedAt: 'desc' }, take: 2000,
    });
    const keys = { fingerprintHash: new Set<string>(), deviceHash: new Set<string>(), browserIdHash: new Set<string>() };
    for (const s of here) for (const k of Object.keys(keys) as (keyof typeof keys)[]) if (s[k]) keys[k].add(s[k]!);
    const or = (Object.keys(keys) as (keyof typeof keys)[]).filter((k) => keys[k].size).map((k) => ({ [k]: { in: [...keys[k]] } }));
    const others = or.length
      ? await this.prisma.respondentSession.findMany({ where: { organizationId: u.organizationId, isTest: false, id: { notIn: here.map((s) => s.id) }, OR: or }, select, orderBy: { startedAt: 'desc' }, take: 1000 })
      : [];
    const all = [...here, ...others];
    // Group sessions that share any identifier (union-find over the three hashes).
    const parent = new Map(all.map((s) => [s.id, s.id]));
    const find = (x: string) => {
      while (parent.get(x) !== x) x = parent.get(x)!;
      return x;
    };
    const union = (a: string, b: string) => parent.set(find(a), find(b));
    const byKey = new Map<string, string>();
    for (const s of all) {
      for (const k of Object.keys(keys) as (keyof typeof keys)[]) {
        const v = s[k];
        if (!v) continue;
        const tag = `${k}:${v}`;
        if (byKey.has(tag)) union(s.id, byKey.get(tag)!);
        else byKey.set(tag, s.id);
      }
    }
    const groups = new Map<string, typeof all>();
    for (const s of all) groups.set(find(s.id), [...(groups.get(find(s.id)) ?? []), s]);
    const out = [...groups.values()]
      .filter((g) => g.some((s) => s.projectId === p.id))
      .map((g) => {
        const vendors = new Set(g.map((s) => s.vendorAllocation.vendorId));
        const projects = new Set(g.map((s) => s.projectId));
        // Which identifiers tie at least two of these sessions together.
        const by = (['fingerprintHash', 'deviceHash', 'browserIdHash'] as const).filter((k) => {
          const vals = g.map((s) => s[k]).filter(Boolean);
          return new Set(vals).size < vals.length;
        });
        return {
          projects: projects.size,
          vendors: vendors.size,
          matchedBy: by.map((k) => (k === 'fingerprintHash' ? 'fingerprint' : k === 'deviceHash' ? 'device' : 'browser cookie')),
          sessions: g
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
            .slice(0, 20)
            .map((s) => ({
              id: s.id, here: s.projectId === p.id, projectId: s.projectId, projectCode: s.project.projectCode, projectName: s.project.name,
              vendor: s.vendorAllocation.vendor.name, vendorCode: s.vendorAllocation.vendor.code, respondentId: s.vendorRespondentId,
              status: s.status, statusDetail: s.statusDetail, outcome: (s.statusDetail && REASON_LABELS[s.statusDetail]) || s.status.replace(/_/g, ' ').toLowerCase(), startedAt: s.startedAt, riskScore: s.riskScore,
            })),
        };
      })
      .filter((g) => g.projects > 1 || g.vendors > 1)
      .sort((a, b) => b.sessions[0].startedAt.getTime() - a.sessions[0].startedAt.getTime())
      .slice(0, 50);
    return { groups: out };
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
    const [byReason, entries, gated, passed, risks] = await Promise.all([
      this.prisma.respondentSession.groupBy({
        by: ['status', 'statusDetail'],
        where: { ...where, statusDetail: { in: Object.keys(REASON_LABELS) } },
        _count: { _all: true },
      }),
      this.prisma.respondentSession.count({ where }),
      this.prisma.respondentSession.count({ where: { ...where, gateRequired: true } }),
      this.prisma.respondentSession.count({ where: { ...where, gateRequired: true, gatePassedAt: { not: null } } }),
      this.prisma.respondentSession.groupBy({ by: ['riskScore'], where: { ...where, riskScore: { not: null } }, _count: { _all: true } }),
    ]);
    const risk = { low: 0, medium: 0, high: 0 };
    for (const r of risks) risk[riskBand(r.riskScore)!] += r._count._all;
    // Rejected unsigned entry links never create a session; they are logged against the project.
    const badSig = await this.prisma.auditEvent.count({ where: { organizationId: u.organizationId, action: 'respondent.bad-signature', entityType: 'Project', entityId: p.id } });
    const reasons = byReason.map((g) => ({ reason: g.statusDetail!, label: REASON_LABELS[g.statusDetail!], status: g.status, count: g._count._all }));
    if (badSig) reasons.push({ reason: 'BAD_SIGNATURE', label: REASON_LABELS.BAD_SIGNATURE, status: 'SECURITY_REJECT', count: badSig });
    reasons.sort((a, b) => b.count - a.count);
    return { entries, gate: { required: gated, passed }, reasons, risk };
  }
}
