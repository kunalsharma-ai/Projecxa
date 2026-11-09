import { marketKey } from './markets';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

/** Country settings kept in each version, keyed by "US/en". */
export interface CountrySnapshot {
  countryCode: string;
  language: string;
  targetGroup: string | null;
  loiMinutes: number;
  irPercent: number;
  cpi: number;
  currency: string;
  targetCompletes: number;
  liveSurveyUrl: string | null;
  testSurveyUrl: string | null;
  sessionTtlMinutes: number | null;
  status: string;
}

/** Everything a version remembers about a project's settings. */
export interface SettingsSnapshot {
  name: string;
  category: string;
  description: string | null;
  status: string;
  clientContactId: string | null;
  salesPersonId: string | null;
  projectManagerId: string;
  devices: Record<string, boolean>;
  security: Record<string, boolean>;
  captchaStyle: string;
  gateQuestions: unknown[] | null;
  prescreen: unknown[] | null;
  pageDesign: Record<string, unknown> | null;
  fieldStartAt: string | null;
  fieldEndAt: string | null;
  autopilot: Record<string, unknown> | null;
  speederCheck: Record<string, unknown> | null;
  fraudRules?: Record<string, unknown> | null;
  countries: Record<string, CountrySnapshot>;
}

export interface Change {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
}

const LABELS: Record<string, string> = {
  name: 'Name',
  category: 'Category',
  description: 'Description',
  status: 'Status',
  clientContactId: 'Client contact',
  salesPersonId: 'Sales person',
  projectManagerId: 'Project manager',
  captchaStyle: 'Human check style',
  gateQuestions: 'Gate survey questions',
  prescreen: 'Prescreener questions',
  pageDesign: 'Respondent page design',
  fieldStartAt: 'Field start',
  fieldEndAt: 'Field end',
  autopilot: 'Autopilot',
  speederCheck: 'Speeder check',
  fraudRules: 'Fraud rules',
  loiMinutes: 'LOI (min)',
  irPercent: 'IR %',
  cpi: 'CPI',
  currency: 'Currency',
  targetCompletes: 'Target completes',
  targetGroup: 'Target group',
  liveSurveyUrl: 'Live survey link',
  testSurveyUrl: 'Test survey link',
  sessionTtlMinutes: 'Session lifetime (min)',
  language: 'Language',
};

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const list = (v: unknown) => (Array.isArray(v) && v.length ? v : null);
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Fields a restore puts back. Status stays as it is: going live or closing is not a settings change. */
export const RESTORABLE = ['name', 'category', 'description', 'clientContactId', 'salesPersonId', 'projectManagerId', 'devices', 'security', 'captchaStyle', 'gateQuestions', 'prescreen', 'pageDesign', 'fieldStartAt', 'fieldEndAt', 'autopilot', 'speederCheck', 'fraudRules'] as const;
export const COUNTRY_RESTORABLE = ['targetGroup', 'loiMinutes', 'irPercent', 'cpi', 'currency', 'targetCompletes', 'liveSurveyUrl', 'testSurveyUrl', 'sessionTtlMinutes'] as const;

function show(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (Array.isArray(v)) return `${v.length} question${v.length === 1 ? '' : 's'}`;
  if (typeof v === 'object') return 'Custom';
  const s = String(v);
  return s.length > 200 ? `${s.slice(0, 197)}…` : s;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Lists what differs between two snapshots, field by field, in words. */
export function diff(before: SettingsSnapshot, after: SettingsSnapshot, names: Map<string, string>): Change[] {
  const out: Change[] = [];
  const who = (id: unknown) => (id ? names.get(String(id)) ?? 'Removed user' : null);
  for (const k of ['name', 'category', 'status', 'description', 'clientContactId', 'salesPersonId', 'projectManagerId', 'captchaStyle', 'fieldStartAt', 'fieldEndAt'] as const) {
    if (same(before[k], after[k])) continue;
    const person = k === 'salesPersonId' || k === 'projectManagerId' || k === 'clientContactId';
    out.push({ field: k, label: LABELS[k], before: person ? who(before[k]) : show(before[k]), after: person ? who(after[k]) : show(after[k]) });
  }
  for (const group of ['devices', 'security'] as const) {
    const keys = new Set([...Object.keys(before[group] ?? {}), ...Object.keys(after[group] ?? {})]);
    for (const k of keys) {
      const a = !!before[group]?.[k];
      const b = !!after[group]?.[k];
      if (a !== b) out.push({ field: `${group}.${k}`, label: `${group === 'devices' ? 'Device' : 'Security'}: ${k}`, before: show(a), after: show(b) });
    }
  }
  for (const k of ['gateQuestions', 'prescreen', 'pageDesign', 'autopilot', 'speederCheck', 'fraudRules'] as const) {
    if (same(before[k], after[k])) continue;
    const b = show(before[k]);
    const a = show(after[k]);
    out.push({ field: k, label: LABELS[k], before: b, after: a === b && a ? 'Edited' : a });
  }
  const keys = new Set([...Object.keys(before.countries), ...Object.keys(after.countries)]);
  for (const key of [...keys].sort()) {
    const a = before.countries[key];
    const b = after.countries[key];
    if (!a) out.push({ field: `countries.${key}`, label: `${key}: market`, before: null, after: 'Added' });
    else if (!b) out.push({ field: `countries.${key}`, label: `${key}: market`, before: 'Present', after: 'Removed' });
    else
      for (const f of [...COUNTRY_RESTORABLE, 'status'] as const) {
        if (!same(a[f], b[f])) out.push({ field: `countries.${key}.${f}`, label: `${key}: ${LABELS[f] ?? 'Status'}`, before: show(a[f]), after: show(b[f]) });
      }
  }
  return out;
}

@Injectable()
export class ProjectHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(projectId: string, db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<SettingsSnapshot> {
    const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { countries: { orderBy: [{ countryCode: 'asc' }, { language: 'asc' }, { createdAt: 'asc' }] } } });
    return {
      name: p.name,
      category: p.category,
      description: p.description,
      status: p.status,
      clientContactId: p.clientContactId,
      salesPersonId: p.salesPersonId,
      projectManagerId: p.projectManagerId,
      devices: (obj(p.devices) ?? {}) as Record<string, boolean>,
      security: (obj(p.security) ?? {}) as Record<string, boolean>,
      captchaStyle: p.captchaStyle,
      gateQuestions: list(p.gateQuestions),
      prescreen: list(p.prescreen),
      pageDesign: obj(p.pageDesign),
      fieldStartAt: day(p.fieldStartAt),
      fieldEndAt: day(p.fieldEndAt),
      autopilot: obj(p.autopilot),
      speederCheck: obj(p.speederCheck),
      fraudRules: obj(p.fraudRules),
      countries: Object.fromEntries(
        p.countries.map((c) => [
          marketKey(c),
          {
            countryCode: c.countryCode,
            language: c.language,
            targetGroup: c.targetGroup,
            loiMinutes: c.loiMinutes,
            irPercent: c.irPercent,
            cpi: Number(c.cpi),
            currency: c.currency,
            targetCompletes: c.targetCompletes,
            liveSurveyUrl: c.liveSurveyUrl,
            testSurveyUrl: c.testSurveyUrl,
            sessionTtlMinutes: c.sessionTtlMinutes,
            status: c.status,
          },
        ]),
      ),
    };
  }

  /**
   * Writes a version when the settings differ from `before`. Projects made before history was
   * kept get a baseline version first, so the earliest change can still be undone.
   */
  async record(u: Pick<AuthUser, 'id'> | null, projectId: string, before: SettingsSnapshot | null, reason?: string): Promise<number | null> {
    const after = await this.snapshot(projectId);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const last = await tx.projectSettingsVersion.findFirst({ where: { projectId }, orderBy: { version: 'desc' }, select: { version: true, snapshot: true } });
          let version = last?.version ?? 0;
          const prev = (last?.snapshot as unknown as SettingsSnapshot | undefined) ?? before;
          if (!last && before) {
            version = 1;
            await tx.projectSettingsVersion.create({ data: { projectId, version, snapshot: before as unknown as Prisma.InputJsonValue, reason: 'Settings before history was kept' } });
          }
          const changes = prev ? diff(prev, after, await this.names(tx, projectId, [prev, after])) : [];
          if (prev && !changes.length) return null;
          version += 1;
          await tx.projectSettingsVersion.create({
            data: { projectId, version, snapshot: after as unknown as Prisma.InputJsonValue, changes: changes as unknown as Prisma.InputJsonValue, reason: reason ?? null, actorId: u?.id ?? null },
          });
          return version;
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }
    return null;
  }

  /** Display names for the people and client contacts a diff mentions. */
  private async names(db: Prisma.TransactionClient, projectId: string, snaps: SettingsSnapshot[]) {
    const ids = [...new Set(snaps.flatMap((s) => [s.projectManagerId, s.salesPersonId, s.clientContactId]).filter((x): x is string => !!x))];
    const [users, contacts] = await Promise.all([
      db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      db.clientContact.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    ]);
    return new Map([...users, ...contacts].map((x) => [x.id, x.name]));
  }
}
