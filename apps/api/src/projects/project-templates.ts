import { marketKey } from './markets';
import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { randomToken } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { RedirectConfig } from '../redirects/redirect.types';
import { CountrySettings } from './projects.schemas';

/** What the Create project form is filled with. */
export interface TemplateForm {
  type: string;
  category: string;
  clientId: string | null;
  description: string | null;
  devices: Record<string, boolean>;
  security: Record<string, boolean>;
  redirectMode: string;
  /** Values shared by every market of the source project. */
  defaults: CountrySettings;
  /** Each market with only the values that differ from `defaults`. */
  countries: (CountrySettings & { countryCode: string; language: string; currency: string })[];
}

interface TemplateQuota { group: string; name: string; conditions: unknown; target: number; isOpen: boolean; sortOrder: number }
interface TemplateVendor { vendorId: string; vendorName: string; cpi: number; targetCompletes: number; uidParam: string; callbackUrlTemplate: string | null }

/** What is copied into a project created from the template, beyond the form. */
export interface TemplateExtras {
  include: { client: boolean; surveyLinks: boolean; quotas: boolean; vendors: boolean };
  captchaStyle: string;
  gateQuestions: unknown[] | null;
  prescreen: unknown[] | null;
  pageDesign: unknown | null;
  autopilot: unknown | null;
  redirectConfig: RedirectConfig | null;
  /** Keyed by "US/en". */
  quotas: Record<string, TemplateQuota[]>;
  vendors: Record<string, TemplateVendor[]>;
}

const SHARED_KEYS = ['loiMinutes', 'irPercent', 'cpi', 'targetCompletes', 'targetGroup', 'liveSurveyUrl', 'testSurveyUrl', 'sessionTtlMinutes'] as const;
const LINK_KEYS = new Set(['liveSurveyUrl', 'testSurveyUrl']);

export const saveTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  include: z
    .object({ client: z.boolean().default(false), surveyLinks: z.boolean().default(false), quotas: z.boolean().default(true), vendors: z.boolean().default(true) })
    .default({ client: false, surveyLinks: false, quotas: true, vendors: true }),
});
const updateTemplateSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().trim().max(2000).nullable().optional() });

const draftSchema = z.object({
  title: z.string().trim().max(300).optional(),
  data: z.record(z.string(), z.unknown()).refine((d) => JSON.stringify(d).length <= 90_000, 'Draft is too large'),
});
const MAX_DRAFTS = 20;

/** Builds a template from an existing project. Survey links and the client stay out unless asked for. */
export async function templateFromProject(prisma: PrismaService, organizationId: string, projectId: string, include: TemplateExtras['include']) {
  const p = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    include: {
      activeRedirectVersion: true,
      countries: { orderBy: [{ countryCode: 'asc' }, { language: 'asc' }], include: { quotas: { orderBy: { sortOrder: 'asc' } }, allocations: { include: { vendor: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } } },
    },
  });
  if (!p) throw new NotFoundException('Project not found');
  const rows = p.countries.map((c) => ({
    countryCode: c.countryCode,
    language: c.language,
    currency: c.currency,
    loiMinutes: c.loiMinutes,
    irPercent: c.irPercent,
    cpi: Number(c.cpi),
    targetCompletes: c.targetCompletes,
    targetGroup: c.targetGroup ?? undefined,
    liveSurveyUrl: c.liveSurveyUrl ?? undefined,
    testSurveyUrl: c.testSurveyUrl ?? undefined,
    sessionTtlMinutes: c.sessionTtlMinutes ?? undefined,
  }));
  // A value every market shares becomes a shared setting; the rest stay on their market.
  const defaults: Record<string, unknown> = {};
  for (const k of SHARED_KEYS) {
    if (LINK_KEYS.has(k) && !include.surveyLinks) continue;
    const vals = new Set(rows.map((r) => JSON.stringify(r[k] ?? null)));
    if (vals.size === 1 && rows[0][k] !== undefined) defaults[k] = rows[0][k];
  }
  const countries = rows.map((r) => {
    const out: Record<string, unknown> = { countryCode: r.countryCode, language: r.language, currency: r.currency };
    for (const k of SHARED_KEYS) {
      if (LINK_KEYS.has(k) && !include.surveyLinks) continue;
      if (r[k] !== undefined && defaults[k] === undefined) out[k] = r[k];
    }
    return out as TemplateForm['countries'][number];
  });
  const form: TemplateForm = {
    type: p.type,
    category: p.category,
    clientId: include.client ? p.clientId : null,
    description: p.description,
    devices: p.devices as Record<string, boolean>,
    security: p.security as Record<string, boolean>,
    redirectMode: p.redirectMode,
    defaults: defaults as CountrySettings,
    countries,
  };
  const key = marketKey;
  const extras: TemplateExtras = {
    include,
    captchaStyle: p.captchaStyle,
    gateQuestions: Array.isArray(p.gateQuestions) && p.gateQuestions.length ? (p.gateQuestions as unknown[]) : null,
    prescreen: Array.isArray(p.prescreen) && p.prescreen.length ? (p.prescreen as unknown[]) : null,
    pageDesign: p.pageDesign ?? null,
    autopilot: p.autopilot ?? null,
    redirectConfig: (p.activeRedirectVersion?.config as unknown as RedirectConfig) ?? null,
    quotas: include.quotas ? Object.fromEntries(p.countries.filter((c) => c.quotas.length).map((c) => [key(c), c.quotas.map((q) => ({ group: q.group, name: q.name, conditions: q.conditions, target: q.target, isOpen: q.isOpen, sortOrder: q.sortOrder }))])) : {},
    vendors: include.vendors
      ? Object.fromEntries(
          p.countries
            .filter((c) => c.allocations.length)
            .map((c) => [key(c), c.allocations.map((a) => ({ vendorId: a.vendorId, vendorName: a.vendor.name, cpi: Number(a.cpi), targetCompletes: a.targetCompletes, uidParam: a.uidParam, callbackUrlTemplate: a.callbackUrlTemplate }))]),
        )
      : {},
  };
  return { project: p, form, extras };
}

/**
 * Copies a template's extras into a project created from it, inside the creating transaction.
 * Vendors no longer active in the organisation, and redirect rules for them, are left out and listed.
 */
export async function applyTemplateExtras(tx: Prisma.TransactionClient, organizationId: string, projectId: string, extras: TemplateExtras) {
  const skipped: string[] = [];
  const vendorIds = [...new Set(Object.values(extras.vendors).flatMap((v) => v.map((a) => a.vendorId)))];
  const ruleVendorIds = (extras.redirectConfig?.rules ?? []).concat().map((r) => r.scope?.vendorId).filter((x): x is string => !!x);
  const active = new Set(
    (await tx.vendor.findMany({ where: { organizationId, id: { in: [...vendorIds, ...ruleVendorIds] }, status: 'ACTIVE' }, select: { id: true } })).map((v) => v.id),
  );
  const countries = await tx.projectCountry.findMany({ where: { projectId }, select: { id: true, countryCode: true, language: true, targetGroup: true } });
  for (const c of countries) {
    const key = marketKey(c);
    const quotas = extras.quotas[key] ?? [];
    if (quotas.length) await tx.quotaCell.createMany({ data: quotas.map((q) => ({ projectCountryId: c.id, group: q.group, name: q.name, conditions: (q.conditions ?? []) as Prisma.InputJsonValue, target: q.target, isOpen: q.isOpen, sortOrder: q.sortOrder })) });
    for (const a of extras.vendors[key] ?? []) {
      if (!active.has(a.vendorId)) {
        skipped.push(`${key}: vendor ${a.vendorName} is no longer active`);
        continue;
      }
      await tx.vendorAllocation.create({
        data: { projectCountryId: c.id, vendorId: a.vendorId, cpi: new Prisma.Decimal(a.cpi), targetCompletes: a.targetCompletes, uidParam: a.uidParam, callbackUrlTemplate: a.callbackUrlTemplate, entryCode: randomToken(12), testEntryCode: randomToken(12) },
      });
    }
  }
  return { skipped: [...new Set(skipped)], activeVendors: active };
}

/** Redirect rules and parameter mappings from a template, without scopes for inactive vendors. */
export function templateRedirects(extras: TemplateExtras, activeVendors: Set<string>): RedirectConfig | undefined {
  const cfg = extras.redirectConfig;
  if (!cfg) return undefined;
  const keep = <T extends { scope?: { vendorId?: string } }>(x: T) => !x.scope?.vendorId || activeVendors.has(x.scope.vendorId);
  return { ...cfg, rules: (cfg.rules ?? []).filter(keep), params: (cfg.params ?? []).filter(keep) };
}

function summary(t: { id: string; name: string; description: string | null; form: unknown; extras: unknown; useCount: number; lastUsedAt: Date | null; createdAt: Date; updatedAt: Date; createdById: string | null; createdBy: { name: string } | null }) {
  const form = t.form as TemplateForm;
  const extras = t.extras as TemplateExtras;
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    type: form.type,
    category: form.category,
    clientId: form.clientId,
    countries: form.countries.map((c) => c.countryCode),
    include: extras.include,
    gateQuestions: extras.gateQuestions?.length ?? 0,
    prescreen: extras.prescreen?.length ?? 0,
    quotaCells: Object.values(extras.quotas).reduce((a, q) => a + q.length, 0),
    vendorLinks: Object.values(extras.vendors).reduce((a, v) => a + v.length, 0),
    redirectRules: extras.redirectConfig?.rules?.length ?? 0,
    useCount: t.useCount,
    lastUsedAt: t.lastUsedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    createdById: t.createdById,
    createdBy: t.createdBy?.name ?? null,
  };
}

@Controller()
export class ProjectTemplatesController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get('project-templates')
  async list(@CurrentUser() u: AuthUser) {
    const rows = await this.prisma.projectTemplate.findMany({ where: { organizationId: u.organizationId }, orderBy: [{ lastUsedAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }], include: { createdBy: { select: { name: true } } } });
    return rows.map(summary);
  }

  @Get('project-templates/:id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const t = await this.prisma.projectTemplate.findFirst({ where: { id, organizationId: u.organizationId }, include: { createdBy: { select: { name: true } } } });
    if (!t) throw new NotFoundException('Template not found');
    const form = t.form as unknown as TemplateForm;
    // A client that was removed or deactivated since is not prefilled.
    if (form.clientId && !(await this.prisma.client.count({ where: { id: form.clientId, organizationId: u.organizationId, status: 'ACTIVE' } }))) form.clientId = null;
    return { ...summary(t), form };
  }

  @Post('projects/:id/template')
  @Roles(...EDITORS)
  async save(@CurrentUser() u: AuthUser, @Param('id') projectId: string, @Body(new ZodPipe(saveTemplateSchema)) body: z.infer<typeof saveTemplateSchema>) {
    const { project, form, extras } = await templateFromProject(this.prisma, u.organizationId, projectId, body.include);
    try {
      const t = await this.prisma.projectTemplate.create({
        data: { organizationId: u.organizationId, name: body.name, description: body.description || null, createdById: u.id, sourceProjectId: project.id, form: form as unknown as Prisma.InputJsonValue, extras: extras as unknown as Prisma.InputJsonValue },
        include: { createdBy: { select: { name: true } } },
      });
      await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'project-template.create', entityType: 'ProjectTemplate', entityId: t.id, detail: { name: t.name, from: project.projectCode, include: body.include } });
      return summary(t);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A template with this name already exists');
      throw e;
    }
  }

  @Patch('project-templates/:id')
  @Roles(...EDITORS)
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateTemplateSchema)) body: z.infer<typeof updateTemplateSchema>) {
    await this.owned(u, id);
    try {
      const t = await this.prisma.projectTemplate.update({ where: { id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.description !== undefined ? { description: body.description || null } : {}) }, include: { createdBy: { select: { name: true } } } });
      return summary(t);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A template with this name already exists');
      throw e;
    }
  }

  @Delete('project-templates/:id')
  @Roles(...EDITORS)
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const t = await this.owned(u, id);
    await this.prisma.projectTemplate.delete({ where: { id } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'project-template.delete', entityType: 'ProjectTemplate', entityId: id, detail: { name: t.name } });
    return { ok: true };
  }

  /** Anyone who can edit projects uses templates; the person who made one or an admin changes it. */
  private async owned(u: AuthUser, id: string) {
    const t = await this.prisma.projectTemplate.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!t) throw new NotFoundException('Template not found');
    if (t.createdById !== u.id && u.role !== 'ADMIN') throw new ForbiddenException('Only the person who made this template or an admin can change it');
    return t;
  }
}

@Controller('project-drafts')
@Roles(...EDITORS)
export class ProjectDraftsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.projectDraft.findMany({ where: { organizationId: u.organizationId, ownerId: u.id }, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, createdAt: true, updatedAt: true } });
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.mine(u, id);
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(draftSchema)) body: z.infer<typeof draftSchema>) {
    const n = await this.prisma.projectDraft.count({ where: { organizationId: u.organizationId, ownerId: u.id } });
    if (n >= MAX_DRAFTS) throw new BadRequestException(`You can keep up to ${MAX_DRAFTS} drafts. Delete one first.`);
    return this.prisma.projectDraft.create({
      data: { organizationId: u.organizationId, ownerId: u.id, title: body.title || 'Untitled project', data: body.data as Prisma.InputJsonValue },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  @Put(':id')
  async save(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(draftSchema)) body: z.infer<typeof draftSchema>) {
    await this.mine(u, id);
    return this.prisma.projectDraft.update({ where: { id }, data: { title: body.title || 'Untitled project', data: body.data as Prisma.InputJsonValue }, select: { id: true, title: true, createdAt: true, updatedAt: true } });
  }

  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.mine(u, id);
    await this.prisma.projectDraft.delete({ where: { id } });
    return { ok: true };
  }

  private async mine(u: AuthUser, id: string) {
    const d = await this.prisma.projectDraft.findFirst({ where: { id, organizationId: u.organizationId, ownerId: u.id } });
    if (!d) throw new NotFoundException('Draft not found');
    return d;
  }
}
