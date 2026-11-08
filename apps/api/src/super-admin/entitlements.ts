/**
 * What each person may use, from their organisation's subscription (docs/SUPER_ADMIN.md, docs/FEATURE_ACCESS.md):
 *   1. the plan the organisation bought,
 *   2. ± the Super Admin's switches for the organisation (extra features, or features taken away),
 *   3. − what the organisation's Admin did not give this person (Settings → Features & access),
 *   4. − the Super Admin's switches for the person, limited by role.
 * The Admin can only hand out what layers 1–2 give the organisation.
 * The web app and the Android/iOS app read it from GET /auth/me/features; the API enforces it on
 * every request (auth.guard.ts), so taking a feature away works at once everywhere.
 */
import { ForbiddenException, Global, Injectable, Module } from '@nestjs/common';
import { FeatureOverride, Organization, Plan, Role, Subscription, User } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccessMode, ACCESS_MODES, adminControllable, FEATURES, featureDef, MOBILE_FEATURE_KEYS } from './features';

export type Block = 'ORG_PENDING' | 'ORG_SUSPENDED' | 'SUBSCRIPTION_INACTIVE' | null;
export const BLOCK_MESSAGE: Record<Exclude<Block, null>, string> = {
  ORG_PENDING: 'Your organisation is waiting for approval. You will get an email when it is ready.',
  ORG_SUSPENDED: 'Your organisation’s access is paused. Contact your SampTrek provider.',
  SUBSCRIPTION_INACTIVE: 'Your organisation’s subscription has ended. Contact your SampTrek provider to renew.',
};

export type OrgForFeatures = Pick<Organization, 'id' | 'status' | 'platformOwner'> & {
  subscription: (Subscription & { plan: Plan }) | null;
  featureOverrides: Pick<FeatureOverride, 'feature' | 'channel' | 'enabled'>[];
  /** The Admin's choices (Settings → Features & access); see readFeatureAccess. */
  featureAccess?: Organization['featureAccess'];
};
export type UserForFeatures = Pick<User, 'role' | 'superAdmin' | 'mobileAccess' | 'featuresOff' | 'mobileFeaturesOff'> & { id?: string };

export interface FeatureAccessRule { mode: AccessMode; people: string[] }

/** The Admin's choice for every feature, filling in each feature's default. Bad or unknown entries are ignored. */
export function readFeatureAccess(raw: unknown): Record<string, FeatureAccessRule> {
  const saved = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, FeatureAccessRule> = {};
  for (const f of FEATURES) {
    if (!adminControllable(f.key)) continue;
    const r = saved[f.key] as { mode?: unknown; people?: unknown } | undefined;
    const mode = r && ACCESS_MODES.includes(r.mode as AccessMode) ? (r.mode as AccessMode) : (f.adminDefault ?? 'everyone');
    const people = r && Array.isArray(r.people) ? r.people.filter((x): x is string => typeof x === 'string') : [];
    out[f.key] = { mode, people };
  }
  return out;
}

/** Does the Admin's rule give this feature to this person? Admins always keep it unless it is off for everyone. */
export function accessAllows(rule: FeatureAccessRule | undefined, user: Pick<UserForFeatures, 'id' | 'role'>): boolean {
  if (!rule) return true;
  switch (rule.mode) {
    case 'everyone': return true;
    case 'off': return false;
    case 'admins': return user.role === 'ADMIN';
    case 'people': return user.role === 'ADMIN' || (!!user.id && rule.people.includes(user.id));
  }
}

export interface OrgFeatures {
  block: Block;
  plan: { code: string; name: string } | null;
  /** No subscription (or the server owner): everything is on. */
  unrestricted: boolean;
  web: Set<string>;
  mobileEnabled: boolean;
  mobile: Set<string>;
  limits: { maxUsers: number | null; maxProjects: number | null };
}

export interface Features {
  version: string;
  plan: string | null;
  block: Block;
  superAdmin: boolean;
  web: Record<string, boolean>;
  mobile: { enabled: boolean; features: Record<string, boolean> };
}

/** Is the subscription in force at `now`? PAST_DUE keeps working (grace); TRIAL until its trial end. */
export function subscriptionLive(s: Pick<Subscription, 'status' | 'endsAt' | 'trialEndsAt'>, now = new Date()): boolean {
  if (s.status === 'EXPIRED' || s.status === 'CANCELLED') return false;
  if (s.status === 'TRIAL') return !s.trialEndsAt || s.trialEndsAt > now;
  if (s.status === 'PAST_DUE') return true;
  return !s.endsAt || s.endsAt > now;
}

function apply(base: Iterable<string>, overrides: OrgForFeatures['featureOverrides'], channel: 'web' | 'mobile') {
  const set = new Set(base);
  for (const o of overrides) {
    if (o.channel !== channel) continue;
    if (o.enabled) set.add(o.feature);
    else set.delete(o.feature);
  }
  return set;
}

export function orgFeatures(org: OrgForFeatures, now = new Date()): OrgFeatures {
  const all = FEATURES.map((f) => f.key);
  if (org.platformOwner) {
    return { block: null, plan: null, unrestricted: true, web: new Set(all), mobileEnabled: true, mobile: new Set(MOBILE_FEATURE_KEYS), limits: { maxUsers: null, maxProjects: null } };
  }
  const block: Block = org.status === 'PENDING' ? 'ORG_PENDING' : org.status === 'SUSPENDED' ? 'ORG_SUSPENDED' : org.subscription && !subscriptionLive(org.subscription, now) ? 'SUBSCRIPTION_INACTIVE' : null;
  const s = org.subscription;
  if (!s) {
    // Organisations from before subscriptions: everything, minus any switch the Super Admin turned off.
    return {
      block, plan: null, unrestricted: org.featureOverrides.length === 0,
      web: apply(all, org.featureOverrides, 'web'), mobileEnabled: true, mobile: apply(MOBILE_FEATURE_KEYS, org.featureOverrides, 'mobile'),
      limits: { maxUsers: null, maxProjects: null },
    };
  }
  return {
    block,
    plan: { code: s.plan.code, name: s.plan.name },
    unrestricted: false,
    web: apply(s.plan.features, org.featureOverrides, 'web'),
    mobileEnabled: s.plan.mobileEnabled && s.mobileEnabled,
    mobile: apply(s.plan.mobileFeatures, org.featureOverrides, 'mobile'),
    limits: { maxUsers: s.maxUsers ?? s.plan.maxUsers, maxProjects: s.maxProjects ?? s.plan.maxProjects },
  };
}

/** What the person may use, ignoring role (the API's @Roles already checks roles). */
export function userGrants(org: OrgForFeatures, user: UserForFeatures, now = new Date()) {
  const o = orgFeatures(org, now);
  const access = readFeatureAccess(org.featureAccess);
  const off = new Set(user.featuresOff ?? []);
  for (const [key, rule] of Object.entries(access)) if (!accessAllows(rule, user)) off.add(key);
  const mobileOff = new Set([...off, ...(user.mobileFeaturesOff ?? [])]);
  const web = new Set([...o.web].filter((k) => !off.has(k)));
  const mobile = new Set([...o.mobile].filter((k) => !mobileOff.has(k)));
  const mobileEnabled = !o.block && o.mobileEnabled && user.mobileAccess !== false;
  return { org: o, block: o.block, web, mobile, mobileEnabled };
}

export function userFeatures(org: OrgForFeatures, user: UserForFeatures, now = new Date()): Features {
  const g = userGrants(org, user, now);
  const superAdmin = !!user.superAdmin && org.platformOwner;
  const can = (key: string, set: Set<string>) => !g.block && featureDef(key)!.roles.includes(user.role) && set.has(key);
  const web: Record<string, boolean> = {};
  const mob: Record<string, boolean> = {};
  for (const f of FEATURES) {
    web[f.key] = can(f.key, g.web);
    if (f.mobile) mob[f.key] = g.mobileEnabled && can(f.key, g.mobile);
  }
  const body = { plan: g.org.plan?.name ?? null, block: g.block, superAdmin, web, mobile: { enabled: g.mobileEnabled, features: mob } };
  const version = createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { version, ...body };
}

export const ORG_FEATURES_INCLUDE = {
  subscription: { include: { plan: true } },
  featureOverrides: { select: { feature: true, channel: true, enabled: true } },
  featureAccess: true,
} as const;

@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async loadOrg(orgId: string): Promise<OrgForFeatures> {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, status: true, platformOwner: true, ...ORG_FEATURES_INCLUDE } });
  }

  async forOrg(orgId: string) {
    return orgFeatures(await this.loadOrg(orgId));
  }

  async forUser(userId: string): Promise<Features> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, role: true, superAdmin: true, mobileAccess: true, featuresOff: true, mobileFeaturesOff: true, organizationId: true } });
    return userFeatures(await this.loadOrg(u.organizationId), u);
  }

  /** Organisation-level check (no personal switches), e.g. for integrations and API keys. */
  async orgAllows(orgId: string, feature: string): Promise<boolean> {
    const o = await this.forOrg(orgId);
    return !o.block && o.web.has(feature);
  }

  /** Before adding or reactivating a staff member. */
  async assertSeat(orgId: string, adding = 1) {
    const o = await this.forOrg(orgId);
    if (o.limits.maxUsers == null) return;
    const used = await this.prisma.user.count({ where: { organizationId: orgId, active: true, role: { in: ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER'] as Role[] } } });
    if (used + adding > o.limits.maxUsers) {
      throw new ForbiddenException({ statusCode: 403, code: 'PLAN_LIMIT', limit: 'users', message: `Your plan allows ${o.limits.maxUsers} active team members. Deactivate someone or ask your SampTrek provider for more.` });
    }
  }

  /** Before creating a project. */
  async assertProjectRoom(orgId: string) {
    const o = await this.forOrg(orgId);
    if (o.limits.maxProjects == null) return;
    const used = await this.prisma.project.count({ where: { organizationId: orgId } });
    if (used >= o.limits.maxProjects) {
      throw new ForbiddenException({ statusCode: 403, code: 'PLAN_LIMIT', limit: 'projects', message: `Your plan allows ${o.limits.maxProjects} projects. Ask your SampTrek provider for more.` });
    }
  }
}

@Global()
@Module({ providers: [EntitlementsService], exports: [EntitlementsService] })
export class EntitlementsModule {}
