import { EntitlementsService } from '../super-admin/entitlements';
import { VendorInsightsController } from './vendor-insights.controller';
import { VendorScoringService } from './vendor-scoring';
import { Body, ConflictException, Controller, Get, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { codeField, codeFromName, emailField, optional, phoneField, websiteField } from '../common/contact-fields';
import { config as appConfig } from '../common/config';
import { randomToken } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LOGO_SELECT, withLogoUrl } from '../parties/logos';
import { isKnownMacro, macrosIn } from '../redirects/redirect-resolver';
import { OUTCOME_STATUSES, parseVendorRedirectUrls, VendorRedirectUrls } from '../redirects/redirect.types';

const domain = z.string().regex(/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$|^localhost$/i, 'Use a hostname like example.com or *.example.com');
/** Callback macros: {uid} {status} {vendor_id} {country_code} {project_code} (see fillCallbackTemplate). */
const CALLBACK_MACROS = new Set(['uid', 'respondent_uid', 'status', 'vendor_id', 'country_code', 'project_code']);

/** A vendor redirect: an absolute https URL that may use the redirect macros, e.g. {respondent_uid}. */
const redirectUrl = z
  .string()
  .trim()
  .max(2048)
  .superRefine((s, ctx) => {
    for (const m of macrosIn(s)) if (!isKnownMacro(m)) ctx.addIssue({ code: 'custom', message: `Unknown macro {${m}}. Use {respondent_uid}, {vendor_id}, {country_code}, {project_code} or {status}` });
    let url: URL;
    try {
      url = new URL(s.replace(/\{[a-z_]+\}/g, 'x'));
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Use a full address starting with https://' });
      return;
    }
    if (url.protocol !== 'https:' && !(appConfig.allowHttpRedirects && url.protocol === 'http:')) ctx.addIssue({ code: 'custom', message: 'Use an https:// address' });
  });
const redirectUrlsSchema = z
  .object(Object.fromEntries(OUTCOME_STATUSES.map((s) => [s, optional(redirectUrl)])) as Record<(typeof OUTCOME_STATUSES)[number], ReturnType<typeof optional<typeof redirectUrl>>>)
  .partial();
const callbackUrl = z
  .string()
  .trim()
  .max(2048)
  .superRefine((s, ctx) => {
    for (const m of macrosIn(s)) if (!CALLBACK_MACROS.has(m)) ctx.addIssue({ code: 'custom', message: `Unknown macro {${m}}. Use {uid}, {status}, {vendor_id}, {country_code} or {project_code}` });
    try {
      const u = new URL(s.replace(/\{[a-z_]+\}/g, 'x'));
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Use a full address starting with https://' });
    }
  });

const fields = {
  name: z.string().trim().min(1).max(200),
  website: optional(websiteField),
  contactName: optional(z.string().trim().max(200)),
  contactEmail: optional(emailField),
  contactPhone: optional(phoneField),
  redirectAllowedDomains: z.array(domain).max(100).default([]),
  callbackUrlTemplate: optional(callbackUrl),
  redirectUrls: redirectUrlsSchema.optional(),
};
const createSchema = z.object({ ...fields, code: codeField });
const updateSchema = z.object({
  ...fields,
  name: fields.name.optional(),
  redirectAllowedDomains: z.array(domain).max(100).optional(),
  code: codeField.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const importRowSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  code: optional(codeField),
  website: optional(websiteField),
  contact_name: optional(z.string().trim().max(200)),
  contact_email: optional(emailField),
  contact_phone: optional(phoneField),
  callback_url: optional(callbackUrl),
  complete_url: optional(redirectUrl),
  terminate_url: optional(redirectUrl),
  quota_full_url: optional(redirectUrl),
  security_url: optional(redirectUrl),
  redirect_domains: optional(z.string().max(2000)),
});
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });
const importSchema = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000), dryRun: z.boolean().default(false) });

const PUBLIC_FIELDS = {
  id: true, name: true, code: true, status: true, website: true, contactName: true, contactEmail: true, contactPhone: true,
  redirectAllowedDomains: true, callbackUrlTemplate: true, redirectUrls: true, createdAt: true, ...LOGO_SELECT,
} as const;

function cleanUrls(raw: Record<string, string | null | undefined> | undefined): VendorRedirectUrls {
  return parseVendorRedirectUrls(Object.fromEntries(Object.entries(raw ?? {}).filter(([, v]) => !!v)));
}

/** The vendor's own redirect hosts are always allowed for that vendor, so saving a URL is enough. */
function withRedirectHosts(domains: string[], urls: VendorRedirectUrls): string[] {
  const out = [...domains];
  for (const u of Object.values(urls)) {
    try {
      const h = new URL(u!.replace(/\{[a-z_]+\}/g, 'x')).hostname.toLowerCase();
      if (h && !out.includes(h)) out.push(h);
    } catch {
      /* checked by the schema */
    }
  }
  return out;
}

@Controller('vendors')
export class VendorsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly entitlements: EntitlementsService) {}

  /** ?status=ACTIVE lists only active vendors (what project forms offer). */
  @Get()
  async list(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    const rows = await this.prisma.vendor.findMany({
      where: { organizationId: u.organizationId, ...(status === 'ACTIVE' || status === 'INACTIVE' ? { status } : {}) },
      orderBy: { name: 'asc' },
      select: { ...PUBLIC_FIELDS, _count: { select: { allocations: true } } },
    });
    return rows.map((r) => withLogoUrl('vendor', r));
  }

  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const v = await this.prisma.vendor.findFirst({ where: { id, organizationId: u.organizationId }, select: PUBLIC_FIELDS });
    if (!v) throw new NotFoundException();
    return withLogoUrl('vendor', v);
  }

  /** Quick Active / Inactive switch from the list. Inactive vendors cannot be added to projects. */
  @Patch(':id/status')
  @Roles(...EDITORS)
  async setStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(statusSchema)) body: z.infer<typeof statusSchema>) {
    const r = await this.prisma.vendor.updateMany({ where: { id, organizationId: u.organizationId }, data: { status: body.status } });
    if (!r.count) throw new NotFoundException();
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'vendor.status', entityType: 'Vendor', entityId: id, detail: body });
    return { id, status: body.status };
  }

  @Post()
  @Roles(...EDITORS)
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    await this.assertCodeFree(u.organizationId, body.code);
    await this.entitlements.assertLimit(u.organizationId, 'vendors');
    const urls = cleanUrls(body.redirectUrls);
    const v = await this.prisma.vendor.create({
      data: {
        organizationId: u.organizationId,
        ...body,
        redirectUrls: Object.keys(urls).length ? urls : Prisma.DbNull,
        redirectAllowedDomains: withRedirectHosts(body.redirectAllowedDomains, urls),
        callbackSecret: randomToken(32),
      },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'vendor.create', entityType: 'Vendor', entityId: v.id });
    return withLogoUrl('vendor', v);
  }

  /** Bulk add from the CSV template on the Vendors page. Each row is checked on its own; dryRun only reports. */
  @Post('import')
  @Roles(...EDITORS)
  async import(@CurrentUser() u: AuthUser, @Body(new ZodPipe(importSchema)) body: z.infer<typeof importSchema>) {
    const existing = await this.prisma.vendor.findMany({ where: { organizationId: u.organizationId }, select: { code: true, name: true } });
    const taken = new Set(existing.map((c) => c.code));
    const names = new Set(existing.map((c) => c.name.trim().toLowerCase()));
    const results: { row: number; ok: boolean; name?: string; code?: string; errors?: string[]; id?: string }[] = [];
    // Plan limit (docs/PLAN_LIMITS.md): rows past it are reported, not added.
    let room = await this.entitlements.room(u.organizationId, 'vendors');
    for (const [i, raw] of body.rows.entries()) {
      const p = importRowSchema.safeParse(raw);
      if (!p.success) {
        results.push({ row: i + 1, ok: false, name: String(raw.name ?? ''), errors: p.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`) });
        continue;
      }
      const r = p.data;
      const errors: string[] = [];
      if (r.code && taken.has(r.code)) errors.push(`code: ${r.code} is already used`);
      if (names.has(r.name.toLowerCase())) errors.push(`name: a vendor called ${r.name} already exists`);
      const domains = (r.redirect_domains ?? '').split(/[\s,;]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
      const bad = domains.filter((d) => !domain.safeParse(d).success);
      if (bad.length) errors.push(`redirect_domains: ${bad.join(', ')} is not a hostname like example.com`);
      if (errors.length) {
        results.push({ row: i + 1, ok: false, name: r.name, errors });
        continue;
      }
      if (room !== null && room <= 0) {
        results.push({ row: i + 1, ok: false, name: r.name, errors: ['Your plan’s vendor limit is reached. Ask your SampTrek provider for more.'] });
        continue;
      }
      if (room !== null) room -= 1;
      const code = r.code ?? codeFromName(r.name, taken);
      taken.add(code);
      names.add(r.name.toLowerCase());
      const urls = cleanUrls({ COMPLETE: r.complete_url, TERMINATE: r.terminate_url, QUOTA_FULL: r.quota_full_url, SECURITY_REJECT: r.security_url });
      let id: string | undefined;
      if (!body.dryRun) {
        const v = await this.prisma.vendor.create({
          data: {
            organizationId: u.organizationId, name: r.name, code, website: r.website ?? null,
            contactName: r.contact_name ?? null, contactEmail: r.contact_email ?? null, contactPhone: r.contact_phone ?? null,
            callbackUrlTemplate: r.callback_url ?? null, redirectUrls: Object.keys(urls).length ? urls : Prisma.DbNull,
            redirectAllowedDomains: withRedirectHosts(domains, urls), callbackSecret: randomToken(32),
          },
          select: { id: true },
        });
        id = v.id;
      }
      results.push({ row: i + 1, ok: true, name: r.name, code, id });
    }
    const added = results.filter((r) => r.ok).length;
    if (!body.dryRun && added) await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'vendor.import', entityType: 'Vendor', entityId: 'bulk', detail: { added, failed: results.length - added } });
    return { dryRun: body.dryRun, added: body.dryRun ? 0 : added, valid: added, failed: results.length - added, results };
  }

  @Patch(':id')
  @Roles(...EDITORS)
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    const found = await this.prisma.vendor.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!found) throw new NotFoundException();
    if (body.code && body.code !== found.code) await this.assertCodeFree(u.organizationId, body.code);
    const { redirectUrls, redirectAllowedDomains, ...rest } = body;
    const urls = redirectUrls !== undefined ? cleanUrls(redirectUrls) : parseVendorRedirectUrls(found.redirectUrls);
    await this.prisma.vendor.update({
      where: { id },
      data: {
        ...rest,
        ...(redirectUrls !== undefined ? { redirectUrls: Object.keys(urls).length ? urls : Prisma.DbNull } : {}),
        ...(redirectAllowedDomains !== undefined || redirectUrls !== undefined
          ? { redirectAllowedDomains: withRedirectHosts(redirectAllowedDomains ?? found.redirectAllowedDomains, urls) }
          : {}),
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'vendor.update', entityType: 'Vendor', entityId: id, detail: body });
    return this.get(u, id);
  }

  private async assertCodeFree(organizationId: string, code: string) {
    const clash = await this.prisma.vendor.findFirst({ where: { organizationId, code }, select: { id: true } });
    if (clash) throw new ConflictException(`Another vendor already uses the code ${code}`);
  }

  @Get(':id/callback-secret')
  @Roles('ADMIN')
  async secret(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const v = await this.prisma.vendor.findFirst({ where: { id, organizationId: u.organizationId }, select: { callbackSecret: true } });
    if (!v) throw new NotFoundException();
    return v;
  }
}

@Module({ controllers: [VendorInsightsController, VendorsController], providers: [VendorScoringService], exports: [VendorScoringService] })
export class VendorsModule {}
