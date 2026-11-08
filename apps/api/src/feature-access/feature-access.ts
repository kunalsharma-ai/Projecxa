/**
 * Settings → Features & access (docs/FEATURE_ACCESS.md). The Admin decides who in their organisation
 * gets each feature the Super Admin gave the organisation (its plan plus any extras):
 * everyone, admins only, chosen people, or no one. Features outside the plan are shown locked.
 */
import { BadRequestException, Body, Controller, ForbiddenException, Get, Module, Param, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementsService, orgFeatures, readFeatureAccess } from '../super-admin/entitlements';
import { ACCESS_MODES, adminControllable, FEATURES, featureDef } from '../super-admin/features';

const STAFF = ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER'] as const;
const ruleSchema = z.object({
  mode: z.enum(ACCESS_MODES as [string, ...string[]]),
  people: z.array(z.string().min(1).max(64)).max(1000).optional(),
}).strict();

@Controller('feature-access')
@Roles('ADMIN')
export class FeatureAccessController {
  constructor(private readonly prisma: PrismaService, private readonly entitlements: EntitlementsService, private readonly audit: AuditService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const org = await this.entitlements.loadOrg(u.organizationId);
    const o = orgFeatures(org);
    const access = readFeatureAccess(org.featureAccess);
    const planWeb = org.subscription ? new Set(org.subscription.plan.features) : null;
    const people = await this.prisma.user.findMany({
      where: { organizationId: u.organizationId, active: true, role: { in: [...STAFF] } },
      select: { id: true, name: true, email: true, role: true }, orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return {
      plan: o.plan?.name ?? null,
      unrestricted: o.unrestricted,
      people,
      features: FEATURES.filter((f) => !f.key.startsWith('integration.')).map((f) => {
        const available = !o.block && o.web.has(f.key);
        const override = org.featureOverrides.find((x) => x.feature === f.key && x.channel === 'web');
        // Where the feature comes from: the plan, an extra from the Super Admin, or not given.
        const source = available ? (planWeb && !planWeb.has(f.key) && override?.enabled ? 'extra' : 'plan') : override && !override.enabled ? 'taken_away' : 'not_in_plan';
        const rule = access[f.key];
        return {
          key: f.key, label: f.label, group: f.group, summary: f.summary, roles: f.roles, mobile: f.mobile,
          available, source, controllable: adminControllable(f.key),
          mode: rule?.mode ?? null, people: rule?.people ?? [], defaultMode: adminControllable(f.key) ? (f.adminDefault ?? 'everyone') : null,
        };
      }),
    };
  }

  @Put(':feature')
  async set(@CurrentUser() u: AuthUser, @Param('feature') key: string, @Body(new ZodPipe(ruleSchema)) body: z.infer<typeof ruleSchema>) {
    if (!featureDef(key)) throw new BadRequestException(`Unknown feature ${key}`);
    if (!adminControllable(key)) throw new BadRequestException('Who gets this feature cannot be changed here');
    const org = await this.entitlements.loadOrg(u.organizationId);
    const o = orgFeatures(org);
    if (o.block || !o.web.has(key)) {
      throw new ForbiddenException({ statusCode: 403, code: 'FEATURE_NOT_IN_PLAN', feature: key, message: 'This feature is not part of your plan. Ask your SampTrek provider to add it.' });
    }
    let people: string[] = [];
    if (body.mode === 'people') {
      const wanted = [...new Set(body.people ?? [])];
      const found = await this.prisma.user.findMany({ where: { id: { in: wanted }, organizationId: u.organizationId, role: { in: [...STAFF] } }, select: { id: true } });
      if (found.length !== wanted.length) throw new BadRequestException('Choose people from your own team');
      people = wanted;
    }
    const saved = (org.featureAccess && typeof org.featureAccess === 'object' && !Array.isArray(org.featureAccess) ? { ...(org.featureAccess as Record<string, unknown>) } : {});
    saved[key] = { mode: body.mode, people };
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { featureAccess: saved as Prisma.InputJsonValue } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'feature_access.update', entityType: 'Organization', entityId: u.organizationId, detail: { feature: key, mode: body.mode, people: people.length } });
    return { feature: key, mode: body.mode, people };
  }
}

@Module({ controllers: [FeatureAccessController] })
export class FeatureAccessModule {}
