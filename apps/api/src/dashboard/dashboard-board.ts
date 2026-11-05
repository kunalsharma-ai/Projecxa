/**
 * Data for the Neon command center panels (docs/NEON_DESIGN.md): project timeline (Gantt),
 * Kanban by project stage, project health radar, recent activity, supplier performance and
 * coverage. Everything is read from the organisation's own data; nothing is sample data.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { emptyStats, scoreVendor, VendorScoringService } from '../vendors/vendor-scoring';

const DAY = 86_400_000;

/** Kanban columns, in lifecycle order, and the project statuses each one holds. */
export const BOARD_COLUMNS: { id: string; label: string; statuses: ProjectStatus[] }[] = [
  { id: 'setup', label: 'Setup', statuses: ['DRAFT'] },
  { id: 'testing', label: 'QA testing', statuses: ['TEST'] },
  { id: 'fieldwork', label: 'In field', statuses: ['LIVE', 'HOLD'] },
  { id: 'done', label: 'Closed & invoiced', statuses: ['CLOSED', 'INVOICED'] },
];

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

/** Words for audit actions shown in Recent activity; unknown actions fall back to a tidy version of the key. */
const ACTION_WORDS: Record<string, string> = {
  'project.create': 'Project created',
  'project.update': 'Project settings changed',
  'project.status': 'Project status changed',
  'invoice.create': 'Invoice created',
  'invoice.send': 'Invoice sent',
  'invoice.paid': 'Invoice marked paid',
  'reconciliation.apply': 'Completes reconciled',
  'quota.update': 'Quotas changed',
  'vendor.create': 'Vendor added',
  'client.create': 'Client added',
};
export function describeAction(action: string) {
  if (ACTION_WORDS[action]) return ACTION_WORDS[action];
  const words = action.replace(/[._-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

@Controller('dashboard')
export class DashboardBoardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoring: VendorScoringService,
  ) {}

  @Get('board')
  async board(@CurrentUser() u: AuthUser, @Query('full') fullParam?: string) {
    // The Project board page asks for everything; the command center widgets show a short list.
    const full = fullParam === '1';
    const org = u.organizationId;
    const now = Date.now();
    const since = new Date(now - 30 * DAY);
    const [projects, sessions, events, vendors, { vendors: stats }, clients, markets] = await Promise.all([
      this.prisma.project.findMany({
        where: { organizationId: org },
        orderBy: { updatedAt: 'desc' },
        take: full ? 500 : 200,
        select: {
          id: true, projectCode: true, name: true, status: true, fieldStartAt: true, fieldEndAt: true, createdAt: true, updatedAt: true,
          client: { select: { name: true } },
          countries: { select: { targetCompletes: true, completes: true } },
        },
      }),
      this.prisma.respondentSession.groupBy({ by: ['status'], where: { organizationId: org, isTest: false, startedAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.auditEvent.findMany({ where: { organizationId: org }, orderBy: { createdAt: 'desc' }, take: 8 }),
      this.prisma.vendor.findMany({ where: { organizationId: org }, select: { id: true, name: true, code: true, status: true } }),
      this.scoring.stats(org, 180),
      this.prisma.client.count({ where: { organizationId: org } }),
      this.prisma.projectCountry.findMany({ where: { project: { organizationId: org } }, distinct: ['countryCode'], select: { countryCode: true, status: true } }),
    ]);

    const progress = (p: (typeof projects)[number]) => {
      const target = p.countries.reduce((a, c) => a + c.targetCompletes, 0);
      const done = p.countries.reduce((a, c) => a + c.completes, 0);
      return { target, completes: done, percent: target ? Math.min(100, Math.round((done / target) * 100)) : 0 };
    };

    // Timeline: open projects first (live, test, hold, draft), then the most recently closed.
    const order: ProjectStatus[] = ['LIVE', 'TEST', 'HOLD', 'DRAFT', 'CLOSED', 'INVOICED'];
    const timeline = [...projects]
      .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
      .slice(0, full ? 100 : 8)
      .map((p) => {
        const start = (p.fieldStartAt ?? p.createdAt).toISOString();
        // Without a planned end, show the bar to today (or to the last change for finished projects).
        const end = (p.fieldEndAt ?? (['CLOSED', 'INVOICED'].includes(p.status) ? p.updatedAt : new Date(Math.max(now, Date.parse(start) + DAY)))).toISOString();
        return { id: p.id, code: p.projectCode, name: p.name, client: p.client.name, status: p.status, start, end, planned: !!p.fieldEndAt, ...progress(p) };
      });

    const kanban = BOARD_COLUMNS.map((c) => {
      const list = projects.filter((p) => c.statuses.includes(p.status));
      return { id: c.id, label: c.label, count: list.length, projects: list.slice(0, full ? 100 : 4).map((p) => ({ id: p.id, code: p.projectCode, name: p.name, status: p.status, percent: progress(p).percent })) };
    });

    // Health radar: six scores from 0 to 100, each null when there is nothing to judge yet.
    const by = Object.fromEntries(sessions.map((s) => [s.status, s._count._all])) as Record<string, number>;
    const n = (k: string) => by[k] ?? 0;
    const finished = Object.entries(by).filter(([k]) => k !== 'STARTED').reduce((a, [, v]) => a + v, 0);
    const live = projects.filter((p) => p.status === 'LIVE');
    const liveProgress = live.map(progress);
    const paced = live.filter((p) => p.fieldStartAt && p.fieldEndAt && p.fieldEndAt > p.fieldStartAt);
    const paceScores = paced.map((p) => {
      const span = p.fieldEndAt!.getTime() - p.fieldStartAt!.getTime();
      const expected = Math.min(1, Math.max(0.01, (now - p.fieldStartAt!.getTime()) / span));
      const pr = progress(p);
      return pr.target ? Math.min(1, pr.completes / pr.target / expected) * 100 : null;
    }).filter((x): x is number => x != null);
    const scored = vendors.map((v) => ({ v, s: scoreVendor(stats.get(v.id) ?? emptyStats()) }));
    const withScore = scored.filter((x) => x.s.score != null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const axes = [
      { id: 'completes', label: 'Completes', value: avg(liveProgress.filter((x) => x.target).map((x) => x.percent)), hint: 'Average share of target reached on live projects' },
      { id: 'pace', label: 'Pace', value: avg(paceScores), hint: 'Completes against the time used of each live fieldwork window' },
      { id: 'quality', label: 'Quality', value: finished ? 100 - (pct(n('QUALITY_FAIL') + n('DUPLICATE') + n('SECURITY_REJECT'), finished) ?? 0) * 4 : null, hint: 'Fewer quality, duplicate and security rejects in the last 30 days scores higher' },
      { id: 'incidence', label: 'Incidence', value: n('COMPLETE') + n('TERMINATE') ? pct(n('COMPLETE'), n('COMPLETE') + n('TERMINATE')) : null, hint: 'Completes out of completes and terminates, last 30 days' },
      { id: 'suppliers', label: 'Suppliers', value: avg(withScore.map((x) => x.s.score!)), hint: 'Average vendor score over the last 180 days' },
      { id: 'quota', label: 'Quota', value: finished ? 100 - (pct(n('QUOTA_FULL'), finished) ?? 0) * 2 : null, hint: 'Fewer over-quota respondents in the last 30 days scores higher' },
    ].map((a) => ({ ...a, value: a.value == null ? null : clamp(a.value) }));
    const known = axes.filter((a) => a.value != null).map((a) => a.value!);
    const health = { score: known.length ? clamp(avg(known)!) : null, axes };

    const actorIds = [...new Set(events.map((e) => e.actorId).filter((x): x is string => !!x))];
    const actors = new Map((await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
    const projectIds = events.filter((e) => e.entityType === 'Project').map((e) => e.entityId);
    const named = new Map((await this.prisma.project.findMany({ where: { id: { in: projectIds }, organizationId: org }, select: { id: true, projectCode: true } })).map((p) => [p.id, p.projectCode]));
    const activity = events.map((e) => ({
      id: e.id,
      title: describeAction(e.action),
      action: e.action,
      subject: e.entityType === 'Project' ? named.get(e.entityId) ?? null : null,
      href: e.entityType === 'Project' && named.has(e.entityId) ? `/projects/${e.entityId}` : null,
      actor: e.actorId ? actors.get(e.actorId) ?? null : null,
      at: e.createdAt.toISOString(),
    }));

    const suppliers = scored
      .filter((x) => x.s.score != null)
      .sort((a, b) => b.s.score! - a.s.score!)
      .slice(0, 6)
      .map(({ v, s }) => ({ id: v.id, name: v.name, code: v.code, score: s.score!, grade: s.grade }));

    return {
      timeline,
      kanban,
      health,
      activity,
      suppliers,
      coverage: {
        markets: markets.length,
        liveMarkets: new Set(markets.filter((m) => m.status === 'LIVE').map((m) => m.countryCode)).size,
        countryCodes: markets.map((m) => m.countryCode).sort(),
        vendors: vendors.length,
        activeVendors: vendors.filter((v) => v.status === 'ACTIVE').length,
        clients,
      },
    };
  }
}
