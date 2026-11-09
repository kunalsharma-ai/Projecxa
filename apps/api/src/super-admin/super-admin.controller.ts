import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ObserveTokens } from './observe';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimiter } from '../public-api/api-key.guard';
import { checkChallenge, newChallenge } from '../vendor-signup/vendor-signup';
import { AutomationService, ruleSchema } from './automation';
import { FEATURE_KEYS } from './features';
import { LIMIT_KEYS } from './limits';
import { SuperAdminService } from './super-admin.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const SUB_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED'] as const;
const date = z.coerce.date().nullable().optional();
const limit = z.number().int().min(0).max(1_000_000).nullable().optional();
/** Usage limits (src/super-admin/limits.ts): a number, or null = no limit; trafficAction = what reaching clicks/completes does. */
const limitsJson = z.object({ ...Object.fromEntries(LIMIT_KEYS.filter((k) => k !== 'users' && k !== 'projects').map((k) => [k, z.number().int().min(0).max(1_000_000_000).nullable().optional()])), trafficAction: z.enum(['stop', 'warn']).optional() }).strict();
const email = z.string().trim().email().max(200).transform((s) => s.toLowerCase());
const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, 'Use 3–40 lowercase letters, digits or -');
const feature = z.string().refine((k) => FEATURE_KEYS.includes(k), 'Unknown feature');

const orgCreate = z.object({ name: z.string().trim().min(2).max(160), slug: slug.optional(), adminName: z.string().trim().min(1).max(120), adminEmail: email, planCode: z.string().max(40).nullable().optional(), trialDays: z.number().int().min(0).max(365).nullable().optional() }).strict();
const orgUpdate = z.object({ name: z.string().trim().min(2).max(160).optional(), status: z.enum(['ACTIVE', 'SUSPENDED']).optional() }).strict();
const approve = z.object({ planCode: z.string().max(40).nullable().optional(), trialDays: z.number().int().min(0).max(365).nullable().optional() }).strict();
const subscription = z.object({
  planCode: z.string().min(1).max(40), status: z.enum(SUB_STATUSES), startsAt: date, endsAt: date, trialEndsAt: date,
  maxUsers: limit, maxProjects: limit, limits: limitsJson.nullable().optional(), mobileEnabled: z.boolean().optional(), notes: z.string().max(2000).nullable().optional(),
}).strict();
const features = z.object({ changes: z.array(z.object({ feature, channel: z.enum(['web', 'mobile']), state: z.enum(['plan', 'on', 'off']) }).strict()).min(1).max(200) }).strict();
const userUpdate = z.object({ active: z.boolean().optional(), mobileAccess: z.boolean().optional(), featuresOff: z.array(feature).max(100).optional(), mobileFeaturesOff: z.array(feature).max(100).optional(), superAdmin: z.boolean().optional() }).strict();
const planBase = {
  name: z.string().trim().min(1).max(80), description: z.string().max(500).nullable().optional(), priceLabel: z.string().max(80).nullable().optional(),
  features: z.array(feature).max(200), mobileFeatures: z.array(feature).max(200), mobileEnabled: z.boolean().optional(),
  maxUsers: limit, maxProjects: limit, limits: limitsJson.optional(), sortOrder: z.number().int().min(0).max(1000).optional(),
  priceMonthly: z.number().min(0).max(100_000_000).nullable().optional(), priceYearly: z.number().min(0).max(100_000_000).nullable().optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code').optional(),
};
const planCreate = z.object({ code: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,40}$/, 'Use 2–40 lowercase letters, digits, - or _'), ...planBase }).strict();
const planUpdate = z.object({ ...planBase, active: z.boolean() }).partial().strict();
const settings = z.object({ registrationOpen: z.boolean().optional(), defaultPlanCode: z.string().max(40).nullable().optional(), trialDays: z.number().int().min(0).max(365).optional() }).strict();
const activityQuery = z.object({ organizationId: z.string().max(40).optional(), userId: z.string().max(40).optional(), action: z.string().max(80).optional(), before: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(200).optional() });

/** Everything here needs the Super Admin (checked in auth.guard.ts for every super-admin/ route). */
@Controller('super-admin')
@Roles('ADMIN')
export class SuperAdminController {
  constructor(private readonly svc: SuperAdminService, private readonly automation: AutomationService, private readonly observe: ObserveTokens) {}

  @Get('overview') overview() { return this.svc.overview(); }
  @Get('catalog') catalog() { return { ...this.svc.catalog(), automation: this.automation.catalog() }; }

  @Get('settings') settings() { return this.svc.settings(); }
  @Put('settings') saveSettings(@CurrentUser() u: AuthUser, @Body(new ZodPipe(settings)) b: z.infer<typeof settings>) { return this.svc.saveSettings(u, b); }

  @Get('plans') plans() { return this.svc.plans(); }
  @Post('plans') createPlan(@CurrentUser() u: AuthUser, @Body(new ZodPipe(planCreate)) b: z.infer<typeof planCreate>) { return this.svc.createPlan(u, b); }
  @Patch('plans/:id') updatePlan(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(planUpdate)) b: z.infer<typeof planUpdate>) { return this.svc.updatePlan(u, id, b); }
  @Delete('plans/:id') deletePlan(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.deletePlan(u, id); }

  @Get('organizations') orgs(@Query('q') q?: string, @Query('status') status?: string) {
    return this.svc.organizations({ q: q?.slice(0, 100) || undefined, status: ['PENDING', 'ACTIVE', 'SUSPENDED'].includes(status ?? '') ? (status as 'ACTIVE') : undefined });
  }
  @Post('organizations') createOrg(@CurrentUser() u: AuthUser, @Body(new ZodPipe(orgCreate)) b: z.infer<typeof orgCreate>) { return this.svc.createOrganization(u, b); }
  @Get('organizations/:id') org(@Param('id') id: string) { return this.svc.organization(id); }
  @Patch('organizations/:id') updateOrg(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(orgUpdate)) b: z.infer<typeof orgUpdate>) { return this.svc.updateOrganization(u, id, b); }
  @Post('organizations/:id/approve') @HttpCode(200) approve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(approve)) b: z.infer<typeof approve>) { return this.svc.approve(u, id, b); }
  @Post('organizations/:id/reject') @HttpCode(200) reject(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.reject(u, id); }
  @Put('organizations/:id/subscription') setSub(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(subscription)) b: z.infer<typeof subscription>) { return this.svc.setSubscription(u, id, b); }
  @Delete('organizations/:id/subscription') removeSub(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.removeSubscription(u, id); }
  @Put('organizations/:id/features') setFeatures(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(features)) b: z.infer<typeof features>) { return this.svc.setFeatures(u, id, b.changes); }
  /** Open the organisation read-only as the Super Admin (docs/SUPER_ADMIN_OBSERVE.md). */
  @Post('organizations/:id/observe') @HttpCode(200)
  async startObserve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const org = await this.svc.observeTarget(u, id);
    await this.observe.start(res, u.id, org.id);
    return { ok: true, organization: org, home: '/' };
  }
  @Post('observe/exit') @HttpCode(200)
  stopObserve(@CurrentUser() u: AuthUser, @Res({ passthrough: true }) res: Response) {
    this.observe.stop(res);
    return { ok: true, home: u.observing ? `/super-admin/organizations/${u.observing.organizationId}` : '/super-admin' };
  }
  /** Traffic at a glance: clicks, completes and outcomes per day, top projects and vendors, the domain links run on. */
  @Get('organizations/:id/traffic') traffic(@Param('id') id: string, @Query('days') days?: string) { return this.svc.traffic(id, Math.min(90, Math.max(1, Number(days) || 30))); }
  @Get('organizations/:id/users') users(@Param('id') id: string) { return this.svc.users(id); }
  @Delete('organizations/:id/integrations/:kind') clearIntegration(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('kind') kind: string) { return this.svc.clearIntegration(u, id, kind); }

  @Patch('users/:id') updateUser(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(userUpdate)) b: z.infer<typeof userUpdate>) { return this.svc.updateUser(u, id, b); }
  @Post('users/:id/sign-out') @HttpCode(200) signOut(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.signOutUser(u, id); }

  @Get('activity') activity(@Query(new ZodPipe(activityQuery)) q: z.infer<typeof activityQuery>) { return this.svc.activity(q); }
  @Get('integrations') integrations() { return this.svc.integrationsMatrix(); }

  @Get('automations') rules() { return this.automation.list(); }
  @Post('automations') createRule(@CurrentUser() u: AuthUser, @Body(new ZodPipe(ruleSchema)) b: z.infer<typeof ruleSchema>) { return this.automation.create(u, b); }
  @Post('automations/preview') @HttpCode(200) preview(@Body(new ZodPipe(ruleSchema)) b: z.infer<typeof ruleSchema>) { return this.automation.preview(b); }
  @Post('automations/recipes/:id') addRecipe(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.automation.addRecipe(u, id); }
  @Post('automations/run') @HttpCode(200) runAll() { return this.automation.runAll(); }
  @Get('automations/runs') runs(@Query('ruleId') ruleId?: string) { return this.automation.runs({ ruleId }); }
  @Patch('automations/:id') updateRule(@Param('id') id: string, @Body(new ZodPipe(ruleSchema.partial())) b: Partial<z.infer<typeof ruleSchema>>) { return this.automation.update(id, b); }
  @Delete('automations/:id') deleteRule(@Param('id') id: string) { return this.automation.remove(id); }
  @Post('automations/:id/run') @HttpCode(200) runRule(@Param('id') id: string) { return this.automation.runNow(id); }
}

const registerSchema = z.object({
  companyName: z.string().trim().min(2).max(160),
  contactName: z.string().trim().min(2).max(120),
  email,
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(300).optional(),
  message: z.string().trim().max(3000).optional(),
  plan: z.string().max(40).optional(),
  challenge: z.string().max(300),
  answer: z.string().max(20),
  /** Honeypot: hidden from people, filled by bots. */
  homepage: z.string().max(300).optional(),
}).strict();
export const registerLimiter = new RateLimiter(5, 3_600_000);

/** Public: organisations register themselves when the Super Admin opens registration. */
@Public()
@Controller('public/register')
export class RegistrationController {
  constructor(private readonly svc: SuperAdminService, private readonly prisma: PrismaService) {}

  @Get()
  async form() {
    const s = await this.svc.settings();
    if (!s.registrationOpen) return { open: false };
    const plans = (await this.svc.plans()).filter((p) => p.active).map((p) => ({ code: p.code, name: p.name, description: p.description, priceLabel: p.priceLabel }));
    return { open: true, trialDays: s.trialDays, plans, challenge: newChallenge('platform-register') };
  }

  @Post()
  @HttpCode(200)
  async register(@Body(new ZodPipe(registerSchema)) b: z.infer<typeof registerSchema>, @Req() req: Request) {
    const s = await this.svc.settings();
    if (!s.registrationOpen) throw new NotFoundException('Registration is closed');
    if (!registerLimiter.hit(req.ip ?? '?').ok) throw new HttpException('Too many registrations from your network; try again in an hour', HttpStatus.TOO_MANY_REQUESTS);
    if (b.homepage) return { ok: true };
    const problem = checkChallenge('platform-register', b.challenge, b.answer);
    if (problem) throw new BadRequestException(problem);
    // Same answer whether or not the email is known, so the form does not reveal who uses SampTrek.
    const pending = await this.prisma.user.count({ where: { email: b.email, organization: { status: 'PENDING' } } });
    if (pending) return { ok: true };
    const plan = b.plan && (await this.prisma.plan.findFirst({ where: { code: b.plan, active: true } })) ? b.plan : null;
    await this.svc.createOrganization(null, {
      name: b.companyName, adminName: b.contactName, adminEmail: b.email, status: 'PENDING', planCode: null,
      registration: { contactName: b.contactName, phone: b.phone ?? null, website: b.website ?? null, message: b.message ?? null, requestedPlan: plan, at: new Date().toISOString() },
    });
    return { ok: true };
  }
}
