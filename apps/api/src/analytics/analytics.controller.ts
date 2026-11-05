/**
 * Data processing & quality and Reporting & analytics pages (docs/DATA_PROCESSING_AND_ANALYTICS.md).
 *
 * Everything is worked out from data PROJEXA already collects for one project: respondent sessions
 * (status, reason, approval, verification, device, timing), gate and prescreener answers, quota cells,
 * reconciliations, invoices and shared deliverables. Nothing is sample data, and steps PROJEXA does not
 * do (such as weighting or open-end coding inside the client survey) are not shown as if it did.
 */
import { Controller, Get, Module, NotFoundException, Query } from '@nestjs/common';
import { Prisma, RespondentStatus } from '@prisma/client';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AnswerSet, Question, questionsOf } from '../survey/questions';
import { REASON_LABELS } from '../survey/respondent-checks';

const DAY = 86_400_000;
/** Sessions read per project for these pages. Larger projects are summarised from the newest ones (the response says so). */
export const SESSION_LIMIT = 100_000;
const CLEAN_EXPORT_LIMIT = 20_000;

/** Statuses rejected by PROJEXA's own entry and quality checks. */
const CHECK_REJECTS: RespondentStatus[] = ['SECURITY_REJECT', 'DUPLICATE', 'QUALITY_FAIL'];
const STATUS_LABEL: Record<RespondentStatus, string> = {
  STARTED: 'In survey', COMPLETE: 'Complete', TERMINATE: 'Terminate', QUOTA_FULL: 'Quota full', QUALITY_FAIL: 'Quality fail',
  DUPLICATE: 'Duplicate', SECURITY_REJECT: 'Security reject', PARTIAL: 'Partial / drop-out', TECHNICAL_ERROR: 'Technical error',
};
const DEVICE_LABEL: Record<string, string> = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const projectQuery = z.object({ projectId: z.string().max(64).optional() });

const analyticsQuery = z.object({
  projectId: z.string().max(64).optional(),
  /** Who is counted: completes (default), all finished entrants, or every entrant. */
  base: z.enum(['completes', 'finished', 'all']).default('completes'),
  /** Crosstab rows and columns, and the question shown as a donut: status | country | vendor | device | gate:<id> | prescreen:<id>. */
  row: z.string().regex(/^(status|country|vendor|device|(gate|prescreen):[a-z0-9_-]{1,32})$/i).optional(),
  col: z.string().regex(/^(status|country|vendor|device|(gate|prescreen):[a-z0-9_-]{1,32})$/i).optional(),
  focus: z.string().regex(/^(status|country|vendor|device|(gate|prescreen):[a-z0-9_-]{1,32})$/i).optional(),
});
type AnalyticsQuery = z.infer<typeof analyticsQuery>;

type Session = {
  id: string; status: RespondentStatus; statusDetail: string | null; approval: string; outcomeVerified: boolean; invoiceId: string | null;
  deviceType: string | null; startedAt: Date; outcomeAt: Date | null; answers: Prisma.JsonValue; quotaCellIds: string[];
  projectCountry: { countryCode: string }; vendorAllocation: { vendor: { id: string; name: string } };
};
const SESSION_SELECT = {
  id: true, status: true, statusDetail: true, approval: true, outcomeVerified: true, invoiceId: true, deviceType: true, startedAt: true, outcomeAt: true,
  answers: true, quotaCellIds: true, projectCountry: { select: { countryCode: true } }, vendorAllocation: { select: { vendor: { select: { id: true, name: true } } } },
} satisfies Prisma.RespondentSessionSelect;

/** A way to split respondents: a built-in field or a gate/prescreen question. */
interface Dimension { key: string; label: string; kind: 'field' | 'question'; type?: Question['type']; values: (s: Session) => string[]; order?: { id: string; label: string }[] }

/** Numbers (for example age) are put into five ranges between the lowest and highest answer. */
function numberBins(values: number[]) {
  if (!values.length) return [];
  const lo = Math.floor(Math.min(...values));
  const hi = Math.ceil(Math.max(...values));
  if (hi - lo < 5) {
    const out: { id: string; label: string; min: number; max: number }[] = [];
    for (let v = lo; v <= hi; v++) out.push({ id: String(v), label: String(v), min: v, max: v });
    return out;
  }
  const step = Math.ceil((hi - lo + 1) / 5);
  return Array.from({ length: 5 }, (_, i) => {
    const min = lo + i * step;
    const max = i === 4 ? hi : min + step - 1;
    return { id: `${min}-${max}`, label: min === max ? String(min) : `${min}–${max}`, min, max };
  }).filter((b) => b.min <= hi);
}

function dimensionsFor(questions: (Question & { section: 'gate' | 'prescreen' })[], sessions: Session[]): Dimension[] {
  const dims: Dimension[] = [
    { key: 'status', label: 'Outcome', kind: 'field', values: (s) => [STATUS_LABEL[s.status]], order: Object.values(STATUS_LABEL).map((l) => ({ id: l, label: l })) },
    { key: 'country', label: 'Market', kind: 'field', values: (s) => [s.projectCountry.countryCode] },
    { key: 'vendor', label: 'Vendor', kind: 'field', values: (s) => [s.vendorAllocation.vendor.name] },
    { key: 'device', label: 'Device', kind: 'field', values: (s) => [DEVICE_LABEL[s.deviceType ?? ''] ?? 'Unknown'], order: ['Desktop', 'Mobile', 'Tablet', 'Unknown'].map((l) => ({ id: l, label: l })) },
  ];
  for (const q of questions) {
    const get = (s: Session) => ((s.answers ?? {}) as Record<string, AnswerSet>)[q.section]?.[q.id];
    const key = `${q.section}:${q.id}`;
    const label = `${q.section === 'gate' ? 'Gate' : 'Prescreen'}: ${q.text}`;
    if (q.type === 'single' || q.type === 'dropdown' || q.type === 'multi') {
      const opts = (q.options ?? []).map((o) => ({ id: o.id, label: o.label }));
      const byId = new Map(opts.map((o) => [o.id, o.label]));
      dims.push({
        key, label, kind: 'question', type: q.type, order: opts,
        values: (s) => {
          const a = get(s);
          if (!a) return [];
          const ids = Array.isArray(a.value) ? a.value : typeof a.value === 'string' ? [a.value] : [];
          return ids.map((id) => byId.get(String(id)) ?? String(id));
        },
      });
    } else if (q.type === 'number') {
      const nums = sessions.map((s) => get(s)?.value).filter((v): v is number => typeof v === 'number');
      const bins = numberBins(nums);
      dims.push({
        key, label, kind: 'question', type: q.type, order: bins.map((b) => ({ id: b.label, label: b.label })),
        values: (s) => {
          const v = get(s)?.value;
          if (typeof v !== 'number') return [];
          const b = bins.find((x) => v >= x.min && v <= x.max);
          return b ? [b.label] : [];
        },
      });
    }
    // Text and grid answers cannot be split into groups; they stay in the Answers tab and the clean data export.
  }
  return dims;
}

/** Counts per value of one dimension (respondents with no answer are left out; multi answers count once per choice). */
function distribution(dim: Dimension, sessions: Session[]) {
  const counts = new Map<string, number>();
  let answered = 0;
  for (const s of sessions) {
    const vs = dim.values(s);
    if (!vs.length) continue;
    answered++;
    for (const v of new Set(vs)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const order = dim.order?.map((o) => o.label) ?? [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
  const known = new Set(order);
  const labels = [...order.filter((l) => dim.kind === 'question' || counts.has(l)), ...[...counts.keys()].filter((k) => !known.has(k))];
  return { answered, items: labels.map((l) => ({ label: l, count: counts.get(l) ?? 0, percent: pct(counts.get(l) ?? 0, answered) })) };
}

function crosstab(row: Dimension, col: Dimension, sessions: Session[]) {
  const rd = distribution(row, sessions).items.map((i) => i.label);
  const cd = distribution(col, sessions).items.map((i) => i.label);
  const cell = new Map<string, number>();
  const colBase = new Map<string, number>();
  let base = 0;
  for (const s of sessions) {
    const rs = [...new Set(row.values(s))];
    const cs = [...new Set(col.values(s))];
    if (!rs.length || !cs.length) continue;
    base++;
    for (const c of cs) colBase.set(c, (colBase.get(c) ?? 0) + 1);
    for (const r of rs) for (const c of cs) cell.set(`${r}\u0000${c}`, (cell.get(`${r}\u0000${c}`) ?? 0) + 1);
  }
  const rowTotals = new Map<string, number>();
  for (const s of sessions) {
    if (!col.values(s).length) continue;
    for (const r of new Set(row.values(s))) rowTotals.set(r, (rowTotals.get(r) ?? 0) + 1);
  }
  return {
    row: { key: row.key, label: row.label },
    col: { key: col.key, label: col.label },
    base,
    columns: cd.map((c) => ({ label: c, base: colBase.get(c) ?? 0 })),
    rows: rd.map((r) => ({
      label: r,
      total: rowTotals.get(r) ?? 0,
      totalPercent: pct(rowTotals.get(r) ?? 0, base),
      cells: cd.map((c) => { const n = cell.get(`${r}\u0000${c}`) ?? 0; return { count: n, percent: pct(n, colBase.get(c) ?? 0) }; }),
    })),
  };
}

@Controller()
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  /** Projects to choose from (newest activity first) and the one to show by default. */
  private async pick(u: AuthUser, projectId?: string) {
    const projects = await this.prisma.project.findMany({
      where: { organizationId: u.organizationId },
      orderBy: { updatedAt: 'desc' },
      take: 300,
      select: { id: true, projectCode: true, name: true, status: true, _count: { select: { sessions: { where: { isTest: false } } } } },
    });
    const list = projects.map((p) => ({ id: p.id, code: p.projectCode, name: p.name, status: p.status, sessions: p._count.sessions }));
    let id = projectId;
    if (id && !list.some((p) => p.id === id)) throw new NotFoundException('Project not found');
    // Default: the most recently changed live project with traffic, else any project with traffic, else the newest.
    id ??= (list.find((p) => p.status === 'LIVE' && p.sessions > 0) ?? list.find((p) => p.sessions > 0) ?? list[0])?.id;
    return { list, id };
  }

  private async load(u: AuthUser, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, organizationId: u.organizationId },
      select: {
        id: true, projectCode: true, name: true, status: true, gateQuestions: true, prescreen: true, fieldStartAt: true, fieldEndAt: true,
        client: { select: { name: true } },
        countries: { select: { id: true, countryCode: true, targetCompletes: true, completes: true, loiMinutes: true, irPercent: true, quotas: { orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }], select: { id: true, group: true, name: true, target: true, completes: true, isOpen: true } } } },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    const where: Prisma.RespondentSessionWhereInput = { projectId: id, isTest: false };
    const [total, sessions] = await Promise.all([
      this.prisma.respondentSession.count({ where }),
      this.prisma.respondentSession.findMany({ where, orderBy: { startedAt: 'desc' }, take: SESSION_LIMIT, select: SESSION_SELECT }) as Promise<Session[]>,
    ]);
    const questions = [
      ...questionsOf(project.gateQuestions).map((q) => ({ ...q, section: 'gate' as const })),
      ...questionsOf(project.prescreen).map((q) => ({ ...q, section: 'prescreen' as const })),
    ];
    const head = { id: project.id, code: project.projectCode, name: project.name, status: project.status, client: project.client.name };
    return { project, head, sessions, total, truncated: total > sessions.length, questions };
  }

  // ─────────────────────────── Data processing & quality ───────────────────────────

  @Get('data-processing')
  async dataProcessing(@CurrentUser() u: AuthUser, @Query(new ZodPipe(projectQuery)) q: z.infer<typeof projectQuery>) {
    const { list, id } = await this.pick(u, q.projectId);
    if (!id) return { projects: list, project: null };
    const { project, head, sessions, total, truncated } = await this.load(u, id);

    const n = sessions.length;
    const count = (f: (s: Session) => boolean) => sessions.reduce((a, s) => a + (f(s) ? 1 : 0), 0);
    const finished = count((s) => s.status !== 'STARTED');
    const completes = sessions.filter((s) => s.status === 'COMPLETE');
    const verified = completes.filter((s) => s.outcomeVerified).length;
    const checkRejects = count((s) => CHECK_REJECTS.includes(s.status));
    const reviewed = completes.filter((s) => s.approval === 'APPROVED' || s.approval === 'REJECTED').length;
    const approved = completes.filter((s) => s.approval === 'APPROVED');
    const rejected = completes.filter((s) => s.approval === 'REJECTED').length;
    const billed = approved.filter((s) => s.invoiceId).length;

    const cells = project.countries.flatMap((c) => c.quotas.map((x) => ({ ...x, market: c.countryCode })));
    const quotaBase = cells.length ? cells : project.countries.map((c) => ({ id: c.id, group: 'Market', name: c.countryCode, target: c.targetCompletes, completes: c.completes, isOpen: true, market: c.countryCode }));
    const quotaTarget = quotaBase.reduce((a, c) => a + c.target, 0);
    const quotaFilled = quotaBase.reduce((a, c) => a + Math.min(c.completes, c.target), 0);

    const [reconciliations, lastRecon] = await Promise.all([
      this.prisma.reconciliation.count({ where: { projectId: id } }),
      this.prisma.reconciliation.findFirst({ where: { projectId: id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, submitted: true, matched: true, approved: true, rejected: true, unknown: true, mode: true } }),
    ]);

    /** The steps in order. `percent` is how far the step has got; null when it does not apply yet. */
    const stages = [
      { id: 'intake', label: 'Data intake', done: finished, total: n, percent: pct(finished, n), detail: `${n.toLocaleString('en')} entrants received; ${(n - finished).toLocaleString('en')} still in the survey`, hint: 'Entrants whose outcome is recorded (complete, terminate, quota full, rejected …) out of everyone who entered.' },
      { id: 'validation', label: 'Data validation', done: verified, total: completes.length, percent: pct(verified, completes.length), detail: `${verified} of ${completes.length} completes confirmed server-to-server by the survey platform`, hint: 'Completes whose outcome the client survey platform confirmed with a signed server callback, not only a browser redirect.' },
      { id: 'quality', label: 'Quality checks', done: n - checkRejects, total: n, percent: pct(n - checkRejects, n), detail: `${checkRejects} removed by security, duplicate and quality checks`, hint: 'Entrants who passed PROJEXA’s entry checks (bot check, duplicates, device, location, gate answers). Lower means more were caught.' },
      { id: 'review', label: 'Review & reconciliation', done: reviewed, total: completes.length, percent: pct(reviewed, completes.length), detail: `${approved.length} approved, ${rejected} rejected, ${completes.length - reviewed} waiting · ${reconciliations} reconciliation${reconciliations === 1 ? '' : 's'}`, hint: 'Completes that were approved or rejected, by hand, by the client in the portal or by a client ID list (Reconcile & invoice tab).' },
      { id: 'quota', label: 'Quota balance', done: quotaFilled, total: quotaTarget, percent: pct(quotaFilled, quotaTarget), detail: cells.length ? `${cells.length} quota cells, ${cells.filter((c) => c.completes >= c.target).length} full` : 'No quota cells; market targets are used', hint: 'Completes counted towards each quota cell (capped at its target) out of all cell targets. PROJEXA balances the sample with quotas while in field; it does not weight data afterwards.' },
      { id: 'billing', label: 'Final delivery & billing', done: billed, total: approved.length, percent: pct(billed, approved.length), detail: `${billed} of ${approved.length} approved completes are on a client invoice`, hint: 'Approved completes that are on a client invoice. Download the clean data file below to deliver the respondent list.' },
    ];
    const measured = stages.filter((s) => s.id !== 'quality' && s.percent != null);
    const overall = measured.length ? Math.round(measured.reduce((a, s) => a + (s.percent ?? 0), 0) / measured.length) : null;

    // Outcome funnel and the reasons behind removals.
    const byStatus = (Object.keys(STATUS_LABEL) as RespondentStatus[]).map((st) => ({ status: st, label: STATUS_LABEL[st], count: count((s) => s.status === st) })).filter((x) => x.count > 0);
    const reasonCounts = new Map<string, { status: RespondentStatus; count: number }>();
    for (const s of sessions) {
      if (!s.statusDetail || !REASON_LABELS[s.statusDetail]) continue;
      const r = reasonCounts.get(s.statusDetail) ?? { status: s.status, count: 0 };
      r.count++;
      reasonCounts.set(s.statusDetail, r);
    }
    const reasons = [...reasonCounts.entries()].map(([code, r]) => ({ code, label: REASON_LABELS[code], status: r.status, count: r.count, percent: pct(r.count, n) })).sort((a, b) => b.count - a.count);

    // Quality by vendor.
    const vendors = new Map<string, { id: string; name: string; entrants: number; completes: number; terminates: number; checkRejects: number; duplicates: number; security: number; qualityFails: number; rejectedCompletes: number; approved: number; lengths: number[] }>();
    for (const s of sessions) {
      const v = s.vendorAllocation.vendor;
      const r = vendors.get(v.id) ?? { id: v.id, name: v.name, entrants: 0, completes: 0, terminates: 0, checkRejects: 0, duplicates: 0, security: 0, qualityFails: 0, rejectedCompletes: 0, approved: 0, lengths: [] };
      r.entrants++;
      if (s.status === 'COMPLETE') {
        r.completes++;
        if (s.approval === 'REJECTED') r.rejectedCompletes++;
        if (s.approval === 'APPROVED') r.approved++;
        if (s.outcomeAt) r.lengths.push((s.outcomeAt.getTime() - s.startedAt.getTime()) / 60_000);
      }
      if (s.status === 'TERMINATE') r.terminates++;
      if (CHECK_REJECTS.includes(s.status)) r.checkRejects++;
      if (s.status === 'DUPLICATE') r.duplicates++;
      if (s.status === 'SECURITY_REJECT') r.security++;
      if (s.status === 'QUALITY_FAIL') r.qualityFails++;
      vendors.set(v.id, r);
    }
    const vendorQuality = [...vendors.values()].map(({ lengths, ...v }) => {
      // Share of entrants that were not caught by checks, minus completes the client rejected.
      const bad = v.checkRejects + v.rejectedCompletes;
      return { ...v, rejectRate: pct(v.checkRejects, v.entrants), clientRejectRate: pct(v.rejectedCompletes, v.completes), medianMinutes: lengths.length ? Math.round((median(lengths) ?? 0) * 10) / 10 : null, qualityScore: v.entrants ? Math.max(0, Math.round(100 - (bad / v.entrants) * 100)) : null };
    }).sort((a, b) => b.entrants - a.entrants);

    // Speeders: completes far faster than the planned length (a third of the LOI), a common cleaning rule.
    const loiByMarket = new Map(project.countries.map((c) => [c.countryCode, c.loiMinutes]));
    const speeders = completes.filter((s) => {
      const loi = loiByMarket.get(s.projectCountry.countryCode) ?? 0;
      return s.outcomeAt && loi > 0 && (s.outcomeAt.getTime() - s.startedAt.getTime()) / 60_000 < loi / 3;
    });

    // Removed or rejected respondents, newest first, for follow-up.
    const flagged = sessions
      .filter((s) => CHECK_REJECTS.includes(s.status) || (s.status === 'COMPLETE' && s.approval === 'REJECTED'))
      .slice(0, 25)
      .map((s) => ({
        id: s.id, status: s.status, statusLabel: STATUS_LABEL[s.status], reason: s.status === 'COMPLETE' ? 'Rejected by review or reconciliation' : s.statusDetail ? REASON_LABELS[s.statusDetail] ?? s.statusDetail : s.status === 'QUALITY_FAIL' ? 'Marked quality fail by the survey platform' : null,
        vendor: s.vendorAllocation.vendor.name, country: s.projectCountry.countryCode, device: s.deviceType, at: s.outcomeAt ?? s.startedAt,
      }));

    const devices = ['desktop', 'mobile', 'tablet'].map((d) => ({ device: d, label: DEVICE_LABEL[d], count: count((s) => s.deviceType === d) }));

    return {
      projects: list,
      project: head,
      total,
      truncated,
      overall,
      stages,
      counts: { entrants: n, finished, completes: completes.length, approved: approved.length, rejected, pendingReview: completes.length - reviewed, verified, checkRejects, billed, speeders: speeders.length },
      byStatus,
      reasons,
      devices,
      vendors: vendorQuality,
      quotas: quotaBase.map((c) => ({ id: c.id, group: c.group, name: c.name, market: c.market, target: c.target, completes: c.completes, isOpen: c.isOpen, percent: pct(Math.min(c.completes, c.target), c.target) })),
      reconciliation: lastRecon,
      flagged,
    };
  }

  /** The cleaned respondent list: completes that were not rejected, with markets, vendors, timing and every gate/prescreen answer. */
  @Get('data-processing/clean')
  async clean(@CurrentUser() u: AuthUser, @Query(new ZodPipe(projectQuery)) q: z.infer<typeof projectQuery>) {
    if (!q.projectId) throw new NotFoundException('Project not found');
    const project = await this.prisma.project.findFirst({ where: { id: q.projectId, organizationId: u.organizationId }, select: { id: true, projectCode: true, gateQuestions: true, prescreen: true } });
    if (!project) throw new NotFoundException('Project not found');
    const where: Prisma.RespondentSessionWhereInput = { projectId: project.id, isTest: false, status: 'COMPLETE', approval: { not: 'REJECTED' } };
    const [total, rows] = await Promise.all([
      this.prisma.respondentSession.count({ where }),
      this.prisma.respondentSession.findMany({
        where, orderBy: { startedAt: 'asc' }, take: CLEAN_EXPORT_LIMIT,
        select: { token: true, vendorRespondentId: true, approval: true, outcomeVerified: true, deviceType: true, startedAt: true, outcomeAt: true, answers: true, projectCountry: { select: { countryCode: true } }, vendorAllocation: { select: { vendor: { select: { name: true } } } } },
      }),
    ]);
    const questions = [
      ...questionsOf(project.gateQuestions).map((x) => ({ ...x, section: 'gate' as const })),
      ...questionsOf(project.prescreen).map((x) => ({ ...x, section: 'prescreen' as const })),
    ];
    return {
      projectCode: project.projectCode,
      total,
      truncated: total > rows.length,
      columns: questions.map((x) => ({ key: `${x.section}:${x.id}`, label: `${x.section === 'gate' ? 'Gate' : 'Prescreen'} ${x.id}: ${x.text}` })),
      rows: rows.map((r) => {
        const a = (r.answers ?? {}) as Record<string, AnswerSet>;
        return {
          sessionToken: r.token,
          vendorRespondentId: r.vendorRespondentId,
          vendor: r.vendorAllocation.vendor.name,
          market: r.projectCountry.countryCode,
          device: r.deviceType,
          approval: r.approval,
          verified: r.outcomeVerified,
          startedAt: r.startedAt,
          completedAt: r.outcomeAt,
          minutes: r.outcomeAt ? Math.round(((r.outcomeAt.getTime() - r.startedAt.getTime()) / 60_000) * 10) / 10 : null,
          answers: Object.fromEntries(questions.map((x) => [`${x.section}:${x.id}`, a[x.section]?.[x.id]?.label ?? ''])),
        };
      }),
    };
  }

  // ─────────────────────────── Reporting & analytics ───────────────────────────

  @Get('analytics')
  async analytics(@CurrentUser() u: AuthUser, @Query(new ZodPipe(analyticsQuery)) q: AnalyticsQuery) {
    const { list, id } = await this.pick(u, q.projectId);
    if (!id) return { projects: list, project: null };
    const { project, head, sessions, total, truncated, questions } = await this.load(u, id);

    const completes = sessions.filter((s) => s.status === 'COMPLETE');
    const base = q.base === 'completes' ? completes : q.base === 'finished' ? sessions.filter((s) => s.status !== 'STARTED') : sessions;
    const dims = dimensionsFor(questions, base);
    const dim = (key: string | undefined, fallback: string) => dims.find((d) => d.key === key) ?? dims.find((d) => d.key === fallback) ?? dims[0];
    const firstQuestion = dims.find((d) => d.kind === 'question');
    const secondQuestion = dims.filter((d) => d.kind === 'question')[1];
    const rowDim = dim(q.row, firstQuestion?.key ?? 'country');
    const colDim = dim(q.col, secondQuestion && secondQuestion.key !== rowDim.key ? secondQuestion.key : rowDim.key === 'device' ? 'country' : 'device');
    const focusDim = dim(q.focus, firstQuestion?.key ?? 'device');

    // KPIs.
    const now = Date.now();
    const inWindow = (s: Session, from: number, to: number) => { const t = (s.outcomeAt ?? s.startedAt).getTime(); return t >= from && t < to; };
    const thisWeek = completes.filter((s) => inWindow(s, now - 7 * DAY, now + 1)).length;
    const lastWeek = completes.filter((s) => inWindow(s, now - 14 * DAY, now - 7 * DAY)).length;
    const lengths = completes.filter((s) => s.outcomeAt).map((s) => (s.outcomeAt!.getTime() - s.startedAt.getTime()) / 60_000);
    const medianLength = median(lengths);
    const plannedLoi = project.countries.length ? Math.round(project.countries.reduce((a, c) => a + c.loiMinutes, 0) / project.countries.length) : null;
    const plannedIr = project.countries.length ? Math.round(project.countries.reduce((a, c) => a + c.irPercent, 0) / project.countries.length) : null;
    const terminates = sessions.filter((s) => s.status === 'TERMINATE').length;
    const qualified = completes.length + terminates;
    const incidence = pct(completes.length, qualified);
    const target = project.countries.reduce((a, c) => a + c.targetCompletes, 0);
    const approved = completes.filter((s) => s.approval === 'APPROVED').length;

    // Completes per day, last 30 days.
    const days: { day: string; completes: number; entrants: number }[] = [];
    const start = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - 29 * DAY;
    for (let i = 0; i < 30; i++) days.push({ day: new Date(start + i * DAY).toISOString().slice(0, 10), completes: 0, entrants: 0 });
    for (const s of sessions) {
      const e = Math.floor((s.startedAt.getTime() - start) / DAY);
      if (e >= 0 && e < 30) days[e].entrants++;
      if (s.status === 'COMPLETE') {
        const c = Math.floor(((s.outcomeAt ?? s.startedAt).getTime() - start) / DAY);
        if (c >= 0 && c < 30) days[c].completes++;
      }
    }

    const focus = { key: focusDim.key, label: focusDim.label, ...distribution(focusDim, base) };
    const table = crosstab(rowDim, colDim, base);

    // Every question's answer counts, for the Analysis tab.
    const analysis = dims.filter((d) => d.kind === 'question').map((d) => ({ key: d.key, label: d.label, type: d.type, ...distribution(d, base) }));

    // Key insights: plain statements worked out from the numbers above, strongest first. Rule-based, no AI.
    const insights: { tone: 'good' | 'warn' | 'info'; text: string }[] = [];
    if (target > 0) {
      const p = pct(completes.length, target)!;
      insights.push({ tone: p >= 100 ? 'good' : 'info', text: `${completes.length.toLocaleString('en')} of ${target.toLocaleString('en')} target completes (${p}%).` });
    }
    if (incidence != null && plannedIr) {
      const diff = incidence - plannedIr;
      if (Math.abs(diff) >= 5) insights.push({ tone: diff < 0 ? 'warn' : 'good', text: `Incidence is ${incidence}% against ${plannedIr}% planned (${diff > 0 ? '+' : ''}${Math.round(diff)} points).` });
    }
    if (medianLength != null && plannedLoi) {
      const m = Math.round(medianLength * 10) / 10;
      if (m > plannedLoi * 1.25) insights.push({ tone: 'warn', text: `Median interview takes ${m} min, longer than the ${plannedLoi} min planned.` });
      else if (m < plannedLoi * 0.5) insights.push({ tone: 'warn', text: `Median interview takes only ${m} min against ${plannedLoi} min planned; check for speeders.` });
      else insights.push({ tone: 'good', text: `Median interview length ${m} min is in line with the ${plannedLoi} min planned.` });
    }
    if (lastWeek > 0 || thisWeek > 0) {
      const ch = lastWeek ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null;
      insights.push({ tone: ch != null && ch < -20 ? 'warn' : 'info', text: ch == null ? `${thisWeek} completes in the last 7 days (none the week before).` : `${thisWeek} completes in the last 7 days, ${ch >= 0 ? '+' : ''}${ch}% on the week before.` });
    }
    const dev = distribution(dims.find((d) => d.key === 'device')!, completes).items.sort((a, b) => b.count - a.count)[0];
    if (dev && dev.count && completes.length >= 10) insights.push({ tone: 'info', text: `${dev.label} makes up ${dev.percent}% of completes.` });
    for (const a of analysis.slice(0, 3)) {
      const top = [...a.items].sort((x, y) => y.count - x.count)[0];
      if (top && a.answered >= 10) insights.push({ tone: 'info', text: `${a.label.replace(/^(Gate|Prescreen): /, '').replace(/[?:.]+$/, '')}: most common answer “${top.label}” (${top.percent}%).` });
    }
    const cellsFull = project.countries.flatMap((c) => c.quotas).filter((c) => c.target > 0 && c.completes >= c.target).length;
    if (cellsFull) insights.push({ tone: 'info', text: `${cellsFull} quota cell${cellsFull === 1 ? ' is' : 's are'} full.` });

    const deliverables = await this.prisma.sharedFile.findMany({
      where: { organizationId: u.organizationId, projectId: id, kind: { in: ['DELIVERABLE', 'QUESTIONNAIRE'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, kind: true, name: true, size: true, createdAt: true, clientId: true, note: true },
    });

    return {
      projects: list,
      project: head,
      total,
      truncated,
      base: q.base,
      baseCount: base.length,
      kpis: {
        completes: completes.length,
        target,
        approved,
        thisWeek,
        lastWeek,
        weekChange: lastWeek ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null,
        medianLength: medianLength == null ? null : Math.round(medianLength * 10) / 10,
        plannedLoi,
        incidence,
        plannedIr,
        insights: insights.length,
      },
      trend: days,
      dimensions: dims.map((d) => ({ key: d.key, label: d.label, kind: d.kind })),
      focus,
      crosstab: table,
      analysis,
      insights,
      deliverables: deliverables.map((f) => ({ ...f, sharedWithClient: !!f.clientId })),
    };
  }
}

@Module({ controllers: [AnalyticsController] })
export class AnalyticsModule {}
