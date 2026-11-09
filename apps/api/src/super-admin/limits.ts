/**
 * Usage limits the Super Admin sets per plan and, if needed, per organisation (docs/PLAN_LIMITS.md).
 * `users` and `projects` keep their own columns (Plan.maxUsers / maxProjects); every other limit lives in
 * Plan.limits and Subscription.limits (JSON). In Subscription.limits a key with null means "no limit for
 * this organisation" and a missing key means "follow the plan".
 */
import { Prisma } from '@prisma/client';

export type LimitKey =
  | 'users' | 'projects' | 'projectsPerMonth' | 'clients' | 'vendors' | 'portalUsers'
  | 'clicksPerMonth' | 'completesPerMonth' | 'scheduledReports' | 'apiKeys';

export interface LimitDef {
  key: LimitKey;
  label: string;
  /** What is counted, in plain words. */
  counts: string;
  period: 'total' | 'month';
  /** Respondent traffic: the plan decides whether reaching it stops new entries or only warns. */
  traffic?: boolean;
}

export const LIMITS: LimitDef[] = [
  { key: 'users', label: 'Team members', counts: 'Active staff logins (admins, project managers, sales, viewers)', period: 'total' },
  { key: 'projects', label: 'Projects', counts: 'Projects in the account, of any status', period: 'total' },
  { key: 'projectsPerMonth', label: 'New projects a month', counts: 'Projects created this calendar month', period: 'month' },
  { key: 'clients', label: 'Clients', counts: 'Client accounts added', period: 'total' },
  { key: 'vendors', label: 'Vendors', counts: 'Vendors added, including approved sign-ups', period: 'total' },
  { key: 'portalUsers', label: 'Portal logins', counts: 'Active client and vendor portal logins', period: 'total' },
  { key: 'clicksPerMonth', label: 'Clicks a month', counts: 'Live respondent entries (clicks) this calendar month; test links are free', period: 'month', traffic: true },
  { key: 'completesPerMonth', label: 'Completes a month', counts: 'Live completes this calendar month', period: 'month', traffic: true },
  { key: 'scheduledReports', label: 'Scheduled reports', counts: 'Report emails on a schedule', period: 'total' },
  { key: 'apiKeys', label: 'API keys', counts: 'Public API keys that are not revoked', period: 'total' },
];
export const LIMIT_KEYS = LIMITS.map((l) => l.key);
const JSON_KEYS = LIMIT_KEYS.filter((k) => k !== 'users' && k !== 'projects');

/** What happens when a traffic limit (clicks or completes) is reached. */
export type TrafficAction = 'stop' | 'warn';

export type Limits = Record<LimitKey, number | null>;
export interface LimitSettings { limits: Limits; trafficAction: TrafficAction }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);

export const NO_LIMITS: LimitSettings = { limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, null])) as Limits, trafficAction: 'stop' };

/** The plan's limits with the organisation's overrides on top. */
export function effectiveLimits(
  plan: { maxUsers: number | null; maxProjects: number | null; limits?: Prisma.JsonValue | null },
  sub?: { maxUsers: number | null; maxProjects: number | null; limits?: Prisma.JsonValue | null } | null,
): LimitSettings {
  const p = obj(plan.limits);
  const s = obj(sub?.limits);
  const limits = { users: sub?.maxUsers ?? plan.maxUsers ?? null, projects: sub?.maxProjects ?? plan.maxProjects ?? null } as Limits;
  for (const k of JSON_KEYS) limits[k] = k in s ? (num(s[k]) ?? null) : (num(p[k]) ?? null);
  const action = (s.trafficAction ?? p.trafficAction) === 'warn' ? 'warn' : 'stop';
  return { limits, trafficAction: action };
}

/** Clean what the Super Admin sends for Plan.limits / Subscription.limits. */
export function cleanLimitsJson(input: Record<string, unknown> | null | undefined, keepNulls: boolean): Prisma.InputJsonValue {
  const out: Record<string, number | string | null> = {};
  for (const k of JSON_KEYS) {
    if (!input || !(k in input)) continue;
    const v = input[k];
    if (v === null) { if (keepNulls) out[k] = null; continue; }
    const n = num(v);
    if (n !== undefined) out[k] = n;
  }
  if (input?.trafficAction === 'warn' || input?.trafficAction === 'stop') out.trafficAction = input.trafficAction;
  return out;
}

export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export const LIMIT_MESSAGE: Record<LimitKey, (n: number) => string> = {
  users: (n) => `Your plan allows ${n} active team members. Deactivate someone or ask your SampTrek provider for more.`,
  projects: (n) => `Your plan allows ${n} projects. Ask your SampTrek provider for more.`,
  projectsPerMonth: (n) => `Your plan allows ${n} new projects a month. Wait for next month or ask your SampTrek provider for more.`,
  clients: (n) => `Your plan allows ${n} clients. Ask your SampTrek provider for more.`,
  vendors: (n) => `Your plan allows ${n} vendors. Ask your SampTrek provider for more.`,
  portalUsers: (n) => `Your plan allows ${n} client and vendor portal logins. Remove one or ask your SampTrek provider for more.`,
  clicksPerMonth: (n) => `Your plan allows ${n} clicks a month.`,
  completesPerMonth: (n) => `Your plan allows ${n} completes a month.`,
  scheduledReports: (n) => `Your plan allows ${n} scheduled reports. Delete one or ask your SampTrek provider for more.`,
  apiKeys: (n) => `Your plan allows ${n} API keys. Revoke one or ask your SampTrek provider for more.`,
};
