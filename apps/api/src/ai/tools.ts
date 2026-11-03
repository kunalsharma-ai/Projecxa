import { Prisma, Role } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { FinanceService } from '../finance/finance.service';
import { PayablesService } from '../finance/payables.service';
import { MonitorService } from '../monitor/monitor.service';
import { ReallocationService } from '../monitor/reallocation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { ReportsService } from '../reports/reports.service';
import { TasksService } from '../tasks/tasks.service';
import { emptyStats, scoreVendor, VendorScoringService } from '../vendors/vendor-scoring';
import { JsonSchema, ToolSpec } from './provider';

/**
 * What the copilot can look up and do. Every tool runs on the server as the signed-in person, with
 * their organisation and role, through the same services the screens use. Tools that change
 * something never run straight away: they become an action the person confirms on screen.
 */

export interface ToolContext {
  u: AuthUser;
  prisma: PrismaService;
  projects: ProjectsService;
  monitor: MonitorService;
  reallocation: ReallocationService;
  reports: ReportsService;
  finance: FinanceService;
  payables: PayablesService;
  tasks: TasksService;
  vendorScoring: VendorScoringService;
  now: Date;
}

/** Visual blocks for the screen, built from real records only. */
export type Display =
  | { type: 'table'; title: string; columns: { key: string; label: string; align?: 'right' }[]; rows: Record<string, string | number | boolean | null>[]; links?: (string | null)[] }
  | { type: 'bars'; title: string; unit?: string; items: { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' }[] }
  | { type: 'stats'; title: string; items: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }[] };

export interface ToolOutput {
  /** What the model sees. */
  data: unknown;
  display?: Display[];
}

export interface Tool {
  spec: ToolSpec;
  /** read runs at once; action needs the person to confirm. */
  kind: 'read' | 'action';
  /** Roles allowed to use it (ADMIN always). */
  roles: Role[];
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolOutput>;
  /** For actions: check and resolve the arguments now, and describe the change in one sentence. */
  prepare?(ctx: ToolContext, args: Record<string, unknown>): Promise<{ args: Record<string, unknown>; summary: string }>;
}

/** A problem the model should explain or ask about, not a crash. */
export class ToolError extends Error {}

const STAFF: Role[] = ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER'];
const EDITORS: Role[] = ['ADMIN', 'PROJECT_MANAGER'];
const str = (description: string, e?: string[]): JsonSchema => ({ type: 'string', description, ...(e ? { enum: e } : {}) });
const num = (description: string): JsonSchema => ({ type: 'number', description });
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: 'object', properties, required });
const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const isDay = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const LIMIT = 25;

// ───────────── Lookups by what people say ─────────────

export async function findProject(ctx: ToolContext, ref: string) {
  const org = ctx.u.organizationId;
  const exact = await ctx.prisma.project.findFirst({ where: { organizationId: org, OR: [{ id: ref }, { projectCode: { equals: ref, mode: 'insensitive' } }, { workOrderNo: { equals: ref, mode: 'insensitive' } }] }, select: { id: true, projectCode: true, name: true } });
  if (exact) return exact;
  const like = await ctx.prisma.project.findMany({ where: { organizationId: org, name: { contains: ref, mode: 'insensitive' } }, select: { id: true, projectCode: true, name: true }, take: 6 });
  if (like.length === 1) return like[0];
  if (!like.length) throw new ToolError(`No project matches "${ref}".`);
  throw new ToolError(`"${ref}" matches several projects: ${like.map((p) => `${p.projectCode} ${p.name}`).join('; ')}. Ask which one.`);
}

export async function findPerson(ctx: ToolContext, ref: string) {
  if (/^(me|myself|i)$/i.test(ref)) return { id: ctx.u.id, name: ctx.u.name, email: ctx.u.email };
  const where = { organizationId: ctx.u.organizationId, active: true, role: { in: STAFF } };
  const exact = await ctx.prisma.user.findFirst({ where: { ...where, OR: [{ id: ref }, { email: { equals: ref, mode: 'insensitive' } }, { name: { equals: ref, mode: 'insensitive' } }] }, select: { id: true, name: true, email: true } });
  if (exact) return exact;
  const like = await ctx.prisma.user.findMany({ where: { ...where, OR: [{ name: { contains: ref, mode: 'insensitive' } }, { email: { contains: ref, mode: 'insensitive' } }] }, select: { id: true, name: true, email: true }, take: 6 });
  if (like.length === 1) return like[0];
  if (!like.length) throw new ToolError(`No active team member matches "${ref}". There is no team or department grouping, so name a person.`);
  throw new ToolError(`"${ref}" matches several people: ${like.map((p) => `${p.name} (${p.email})`).join('; ')}. Ask which one.`);
}

async function findTask(ctx: ToolContext, ref: string) {
  const org = ctx.u.organizationId;
  const exact = await ctx.prisma.task.findFirst({ where: { organizationId: org, id: ref }, select: { id: true, title: true } });
  if (exact) return exact;
  const like = await ctx.prisma.task.findMany({ where: { organizationId: org, title: { contains: ref, mode: 'insensitive' }, status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { id: true, title: true }, take: 6 });
  if (like.length === 1) return like[0];
  if (!like.length) throw new ToolError(`No open task matches "${ref}".`);
  throw new ToolError(`"${ref}" matches several tasks: ${like.map((t) => t.title).join('; ')}. Ask which one.`);
}

async function findClient(ctx: ToolContext, ref: string) {
  const org = ctx.u.organizationId;
  const rows = await ctx.prisma.client.findMany({ where: { organizationId: org, OR: [{ id: ref }, { code: { equals: ref, mode: 'insensitive' } }, { name: { contains: ref, mode: 'insensitive' } }] }, select: { id: true, name: true, code: true }, take: 6 });
  const exact = rows.find((c) => c.id === ref || c.code.toLowerCase() === ref.toLowerCase() || c.name.toLowerCase() === ref.toLowerCase());
  if (exact) return exact;
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new ToolError(`No client matches "${ref}".`);
  throw new ToolError(`"${ref}" matches several clients: ${rows.map((c) => `${c.name} (${c.code})`).join('; ')}. Ask which one.`);
}

// ───────────── Shared views ─────────────

/** Markets in live fieldwork with their pace, and what is holding each back. */
async function fieldwork(ctx: ToolContext, projectId?: string) {
  const markets = await ctx.monitor.markets(ctx.u.organizationId, projectId, ctx.now);
  const alerts = await ctx.prisma.alert.findMany({ where: { organizationId: ctx.u.organizationId, state: 'OPEN', ...(projectId ? { projectId } : {}) }, select: { title: true, detail: true, severity: true, projectId: true }, take: 30, orderBy: { lastSeenAt: 'desc' } });
  return markets.map((m) => {
    const issues: string[] = [];
    for (const a of m.allocations) {
      if (a.status !== 'ACTIVE') continue;
      if (a.pace.status === 'stalled') issues.push(`${a.vendor.name}: no entries recently`);
      else if (a.pace.status === 'behind') issues.push(`${a.vendor.name}: behind pace (${a.pace.perDay}/day)`);
      if ((a.qualityShare24h ?? 0) >= 30) issues.push(`${a.vendor.name}: ${a.qualityShare24h}% quality rejects in 24h`);
    }
    if (m.allocations.every((a) => a.status !== 'ACTIVE')) issues.push('no active vendor link');
    const closedCells = m.cells.filter((c) => !c.isOpen && c.completes < c.target).length;
    if (closedCells) issues.push(`${closedCells} quota cells closed before target`);
    return {
      project: `${m.project.projectCode} ${m.project.name}`,
      projectId: m.project.id,
      country: m.country.countryCode,
      marketStatus: m.country.status,
      completes: m.metrics.completes,
      target: m.metrics.target,
      percentDone: pct(m.metrics.completes, m.metrics.target),
      pace: m.pace.status,
      perDay: m.pace.perDay,
      neededPerDay: m.pace.requiredPerDay,
      daysLeft: m.pace.daysLeft,
      fieldEnd: iso(m.project.fieldEndAt),
      incidencePercent: m.ir,
      issues,
      openAlerts: alerts.filter((a) => a.projectId === m.project.id).map((a) => `${a.severity}: ${a.title}`),
    };
  });
}

function paceTone(p: string): 'ok' | 'warn' | 'bad' | undefined {
  return p === 'stalled' || p === 'overdue' ? 'bad' : p === 'behind' ? 'warn' : p === 'on_track' || p === 'done' ? 'ok' : undefined;
}

// ───────────── Tools ─────────────

export const TOOLS: Tool[] = [
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'list_projects',
      description: 'Projects in this organisation with status, client, manager, field dates and completes against target. Use for "show active projects" and similar.',
      parameters: obj({ status: str('Project status', ['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED', 'INVOICED', 'ACTIVE']), search: str('Words in the name, project code or work order'), client: str('Client name or code'), manager: str('Project manager name or email') }),
    },
    async run(ctx, a) {
      const status = s(a.status);
      const client = s(a.client) ? await findClient(ctx, s(a.client)!) : null;
      const manager = s(a.manager) ? await findPerson(ctx, s(a.manager)!) : null;
      const where: Prisma.ProjectWhereInput = {
        organizationId: ctx.u.organizationId,
        ...(status === 'ACTIVE' ? { status: { in: ['TEST', 'LIVE', 'HOLD'] } } : status ? { status: status as never } : {}),
        ...(client ? { clientId: client.id } : {}),
        ...(manager ? { projectManagerId: manager.id } : {}),
        ...(s(a.search) ? { OR: [{ name: { contains: s(a.search), mode: 'insensitive' } }, { projectCode: { contains: s(a.search), mode: 'insensitive' } }, { workOrderNo: { contains: s(a.search), mode: 'insensitive' } }] } : {}),
      };
      const [total, rows] = await Promise.all([
        ctx.prisma.project.count({ where }),
        ctx.prisma.project.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 50, include: { client: { select: { name: true } }, projectManager: { select: { name: true } }, countries: { select: { countryCode: true, targetCompletes: true, completes: true } } } }),
      ]);
      const list = rows.map((p) => {
        const target = p.countries.reduce((t, c) => t + c.targetCompletes, 0);
        const done = p.countries.reduce((t, c) => t + c.completes, 0);
        return { code: p.projectCode, name: p.name, status: p.status, client: p.client.name, manager: p.projectManager.name, countries: p.countries.map((c) => c.countryCode).join(' '), completes: done, target, percentDone: pct(done, target), fieldStart: iso(p.fieldStartAt), fieldEnd: iso(p.fieldEndAt), id: p.id };
      });
      return {
        data: { total, shown: Math.min(list.length, LIMIT), projects: list.slice(0, LIMIT).map(({ id: _i, ...r }) => r) },
        display: [{ type: 'table', title: `${total} ${total === 1 ? 'project' : 'projects'}`, columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Project' }, { key: 'status', label: 'Status' }, { key: 'client', label: 'Client' }, { key: 'manager', label: 'Manager' }, { key: 'progress', label: 'Completes', align: 'right' }, { key: 'fieldEnd', label: 'Field end' }], rows: list.map((p) => ({ code: p.code, name: p.name, status: p.status, client: p.client, manager: p.manager, progress: `${p.completes}/${p.target}`, fieldEnd: p.fieldEnd })), links: list.map((p) => `/projects/${p.id}`) }],
      };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'project_details',
      description: 'Everything about one project: status, client, people, dates, each country with target, completes and vendor links, fieldwork pace and issues, open alerts and tasks.',
      parameters: obj({ project: str('Project code (e.g. PRX10001), work order or name') }, ['project']),
    },
    async run(ctx, a) {
      const ref = await findProject(ctx, s(a.project) ?? '');
      const p = await ctx.projects.get(ctx.u, ref.id);
      const [fw, tasks] = await Promise.all([fieldwork(ctx, ref.id), ctx.tasks.list(ctx.u, { status: 'open', projectId: ref.id }, 20)]);
      const pp = p as unknown as { projectCode: string; name: string; status: string; category: string; type: string; description: string | null; client: { name: string }; projectManager: { name: string } | null; salesPerson: { name: string } | null; fieldStartAt: Date | null; fieldEndAt: Date | null; createdAt: Date; countries: { countryCode: string; language: string; status: string; targetCompletes: number; completes: number; cpi: unknown; currency: string; loiMinutes: number; irPercent: number; allocations: { vendor: { name: string }; status: string; targetCompletes: number; completes: number; cpi: unknown }[] }[] };
      const data = {
        code: pp.projectCode, name: pp.name, status: pp.status, category: pp.category, type: pp.type, description: pp.description?.slice(0, 1500) ?? null,
        client: pp.client?.name, manager: pp.projectManager?.name ?? null, salesPerson: pp.salesPerson?.name ?? null,
        fieldStart: iso(pp.fieldStartAt), fieldEnd: iso(pp.fieldEndAt), created: iso(pp.createdAt),
        countries: pp.countries.map((c) => ({ country: c.countryCode, language: c.language, status: c.status, target: c.targetCompletes, completes: c.completes, cpi: Number(c.cpi), currency: c.currency, loiMinutes: c.loiMinutes, incidencePercent: c.irPercent, vendors: c.allocations.map((x) => ({ vendor: x.vendor.name, status: x.status, target: x.targetCompletes, completes: x.completes, cpi: Number(x.cpi) })) })),
        fieldwork: fw.map(({ projectId: _p, project: _n, ...m }) => m),
        openTasks: tasks.map((t) => ({ title: t.title, assignee: t.assignee?.name ?? null, due: iso(t.dueAt), priority: t.priority, overdue: t.overdue })),
      };
      return {
        data,
        display: [{ type: 'bars', title: `${pp.projectCode} completes by country (% of target)`, unit: '%', items: pp.countries.map((c) => ({ label: c.countryCode, value: pct(c.completes, c.targetCompletes), tone: paceTone(fw.find((m) => m.country === c.countryCode)?.pace ?? '') })) }],
      };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'fieldwork_status',
      description: 'Live fieldwork by market: completes against target, delivery pace against what is needed by the field end date, and bottlenecks (stalled or slow vendors, quality rejects, closed quotas, alerts). Use for delays, bottlenecks and progress.',
      parameters: obj({ project: str('Limit to one project (code or name)'), onlyProblems: { type: 'boolean', description: 'Only markets that are behind, stalled, overdue or have issues' } }),
    },
    async run(ctx, a) {
      const p = s(a.project) ? await findProject(ctx, s(a.project)!) : null;
      let rows = await fieldwork(ctx, p?.id);
      if (a.onlyProblems === true) rows = rows.filter((m) => ['behind', 'stalled', 'overdue'].includes(m.pace) || m.issues.length || m.openAlerts.length);
      return {
        data: { markets: rows.slice(0, 40).map(({ projectId: _p, ...m }) => m), count: rows.length, paceMeaning: 'on_track, behind (slower than needed), stalled (no entries), overdue (field end passed), done, not_started, no_deadline' },
        display: rows.length ? [{ type: 'table', title: 'Fieldwork', columns: [{ key: 'project', label: 'Project' }, { key: 'country', label: 'Market' }, { key: 'progress', label: 'Completes', align: 'right' }, { key: 'pace', label: 'Pace' }, { key: 'perDay', label: 'Per day', align: 'right' }, { key: 'needed', label: 'Needed', align: 'right' }, { key: 'issues', label: 'Issues' }], rows: rows.map((m) => ({ project: m.project, country: m.country, progress: `${m.completes}/${m.target}`, pace: m.pace.replace('_', ' '), perDay: m.perDay, needed: m.neededPerDay, issues: m.issues.join('; ') || null })), links: rows.map((m) => `/projects/${m.projectId}`) }] : undefined,
      };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'delayed_projects',
      description: 'Projects that are delayed: a market behind or stalled, field end date passed without reaching target, or overdue tasks. Use for "which projects are delayed".',
      parameters: obj({}),
    },
    async run(ctx) {
      const fw = await fieldwork(ctx);
      const late = await ctx.prisma.project.findMany({ where: { organizationId: ctx.u.organizationId, status: { in: ['TEST', 'LIVE', 'HOLD'] }, fieldEndAt: { lt: ctx.now } }, select: { id: true, projectCode: true, name: true, fieldEndAt: true, countries: { select: { completes: true, targetCompletes: true } } } });
      const overdueTasks = await ctx.prisma.task.groupBy({ by: ['projectId'], where: { organizationId: ctx.u.organizationId, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lt: ctx.now }, projectId: { not: null } }, _count: true });
      const map = new Map<string, { project: string; id: string; reasons: string[] }>();
      const add = (id: string, project: string, reason: string) => { const r = map.get(id) ?? { project, id, reasons: [] }; r.reasons.push(reason); map.set(id, r); };
      for (const m of fw) if (['behind', 'stalled', 'overdue'].includes(m.pace)) add(m.projectId, m.project, `${m.country} ${m.pace.replace('_', ' ')}: ${m.completes}/${m.target}${m.neededPerDay ? `, needs ${m.neededPerDay}/day, doing ${m.perDay}/day` : ''}`);
      for (const p of late) {
        const done = p.countries.reduce((t, c) => t + c.completes, 0), target = p.countries.reduce((t, c) => t + c.targetCompletes, 0);
        if (done < target) add(p.id, `${p.projectCode} ${p.name}`, `field end ${iso(p.fieldEndAt)} passed at ${done}/${target}`);
      }
      if (overdueTasks.length) {
        const names = await ctx.prisma.project.findMany({ where: { id: { in: overdueTasks.map((t) => t.projectId!) } }, select: { id: true, projectCode: true, name: true } });
        for (const t of overdueTasks) { const p = names.find((x) => x.id === t.projectId); if (p) add(p.id, `${p.projectCode} ${p.name}`, `${t._count} overdue task${t._count === 1 ? '' : 's'}`); }
      }
      const rows = [...map.values()];
      return {
        data: { delayed: rows.map(({ id: _i, ...r }) => r), count: rows.length },
        display: rows.length ? [{ type: 'table', title: `${rows.length} delayed ${rows.length === 1 ? 'project' : 'projects'}`, columns: [{ key: 'project', label: 'Project' }, { key: 'why', label: 'Why' }], rows: rows.map((r) => ({ project: r.project, why: r.reasons.join('; ') })), links: rows.map((r) => `/projects/${r.id}`) }] : undefined,
      };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'list_tasks',
      description: 'Tasks with assignee, project, priority, due date, overdue flag and what they wait for.',
      parameters: obj({ status: str('open (default), done or all', ['open', 'done', 'all']), overdue: { type: 'boolean', description: 'Only overdue tasks' }, assignee: str('Person name or email, or "me"'), project: str('Project code or name'), search: str('Words in the title') }),
    },
    async run(ctx, a) {
      const who = s(a.assignee) ? await findPerson(ctx, s(a.assignee)!) : null;
      const p = s(a.project) ? await findProject(ctx, s(a.project)!) : null;
      const rows = await ctx.tasks.list(ctx.u, { status: (s(a.status) as 'open') ?? 'open', overdue: a.overdue === true ? 'true' : undefined, assigneeId: who?.id, projectId: p?.id, search: s(a.search) }, 100);
      const out = rows.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, assignee: t.assignee?.name ?? 'unassigned', project: t.project ? `${t.project.projectCode} ${t.project.name}` : null, due: iso(t.dueAt), overdue: t.overdue, waitsFor: t.blocked ? t.blockedBy?.title : null }));
      return {
        data: { count: out.length, tasks: out.slice(0, 40) },
        display: out.length ? [{ type: 'table', title: `${out.length} ${out.length === 1 ? 'task' : 'tasks'}`, columns: [{ key: 'title', label: 'Task' }, { key: 'assignee', label: 'Assignee' }, { key: 'priority', label: 'Priority' }, { key: 'due', label: 'Due' }, { key: 'state', label: 'State' }], rows: out.map((t) => ({ title: t.title, assignee: t.assignee, priority: t.priority, due: t.due, state: t.overdue ? 'Overdue' : t.waitsFor ? `Waits for: ${t.waitsFor}` : t.status.replace('_', ' ') })), links: out.map(() => '/tasks') }] : undefined,
      };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'team_workload',
      description: 'Workload per team member: open, overdue and urgent tasks, and live projects they manage. Use for workload, resource conflicts and allocation.',
      parameters: obj({}),
    },
    async run(ctx) {
      const org = ctx.u.organizationId;
      const [people, tasks, projects] = await Promise.all([
        ctx.prisma.user.findMany({ where: { organizationId: org, active: true, role: { in: STAFF } }, select: { id: true, name: true, role: true } }),
        ctx.prisma.task.findMany({ where: { organizationId: org, status: { in: ['OPEN', 'IN_PROGRESS'] } }, select: { assigneeId: true, dueAt: true, priority: true } }),
        ctx.prisma.project.findMany({ where: { organizationId: org, status: { in: ['TEST', 'LIVE', 'HOLD'] } }, select: { projectManagerId: true, fieldEndAt: true } }),
      ]);
      const soon = ctx.now.getTime() + 7 * 86_400_000;
      const rows = people.map((p) => {
        const mine = tasks.filter((t) => t.assigneeId === p.id);
        const proj = projects.filter((x) => x.projectManagerId === p.id);
        return {
          name: p.name, role: p.role,
          openTasks: mine.length,
          overdueTasks: mine.filter((t) => t.dueAt && t.dueAt < ctx.now).length,
          urgentOrHigh: mine.filter((t) => t.priority === 'URGENT' || t.priority === 'HIGH').length,
          dueNext7Days: mine.filter((t) => t.dueAt && t.dueAt >= ctx.now && t.dueAt.getTime() < soon).length,
          activeProjectsManaged: proj.length,
          projectsEndingNext7Days: proj.filter((x) => x.fieldEndAt && x.fieldEndAt >= ctx.now && x.fieldEndAt.getTime() < soon).length,
        };
      }).sort((a, b) => b.openTasks + b.activeProjectsManaged * 2 - (a.openTasks + a.activeProjectsManaged * 2));
      return {
        data: { people: rows, unassignedOpenTasks: tasks.filter((t) => !t.assigneeId).length, note: 'Workload counts tasks and managed projects only; time tracking is not recorded in PROJEXA.' },
        display: [
          { type: 'bars', title: 'Open tasks per person', items: rows.map((r) => ({ label: r.name, value: r.openTasks, tone: r.overdueTasks ? 'bad' : r.urgentOrHigh ? 'warn' : 'ok' })) },
          { type: 'table', title: 'Workload', columns: [{ key: 'name', label: 'Person' }, { key: 'openTasks', label: 'Open', align: 'right' }, { key: 'overdueTasks', label: 'Overdue', align: 'right' }, { key: 'dueNext7Days', label: 'Due in 7 days', align: 'right' }, { key: 'activeProjectsManaged', label: 'Active projects', align: 'right' }], rows: rows.map((r) => ({ ...r })) },
        ],
      };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'activity_summary',
      description: 'What happened in a period (default today): changes people made (from the audit log), respondent entries and completes, projects created, invoices and bills, tasks done.',
      parameters: obj({ from: str('Start day YYYY-MM-DD (default today)'), to: str('End day YYYY-MM-DD, inclusive (default today)') }),
    },
    async run(ctx, a) {
      const today = ctx.now.toISOString().slice(0, 10);
      const from = isDay(s(a.from)) ? s(a.from)! : today, to = isDay(s(a.to)) ? s(a.to)! : today;
      const gte = new Date(`${from}T00:00:00Z`), lt = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000);
      const org = ctx.u.organizationId;
      const [events, sessions, created, done] = await Promise.all([
        ctx.prisma.auditEvent.findMany({ where: { organizationId: org, createdAt: { gte, lt } }, orderBy: { createdAt: 'desc' }, take: 300, select: { action: true, actorId: true, entityType: true, createdAt: true } }),
        ctx.prisma.respondentSession.groupBy({ by: ['status'], where: { organizationId: org, isTest: false, startedAt: { gte, lt } }, _count: true }),
        ctx.prisma.project.findMany({ where: { organizationId: org, createdAt: { gte, lt } }, select: { projectCode: true, name: true } }),
        ctx.prisma.task.count({ where: { organizationId: org, completedAt: { gte, lt } } }),
      ]);
      const actors = await ctx.prisma.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.actorId).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
      const byAction = new Map<string, number>();
      for (const e of events) byAction.set(e.action, (byAction.get(e.action) ?? 0) + 1);
      const byPerson = new Map<string, number>();
      for (const e of events) { const nm = actors.find((x) => x.id === e.actorId)?.name ?? 'System'; byPerson.set(nm, (byPerson.get(nm) ?? 0) + 1); }
      const st = Object.fromEntries(sessions.map((x) => [x.status, x._count]));
      return {
        data: { period: { from, to }, respondentEntries: sessions.reduce((t, x) => t + x._count, 0), completes: st.COMPLETE ?? 0, terminates: st.TERMINATE ?? 0, projectsCreated: created.map((p) => `${p.projectCode} ${p.name}`), tasksCompleted: done, changesByAction: Object.fromEntries([...byAction].sort((x, y) => y[1] - x[1]).slice(0, 25)), changesByPerson: Object.fromEntries(byPerson) },
        display: [{ type: 'stats', title: from === to ? `Activity on ${from}` : `Activity ${from} to ${to}`, items: [{ label: 'Entries', value: String(sessions.reduce((t, x) => t + x._count, 0)) }, { label: 'Completes', value: String(st.COMPLETE ?? 0), tone: 'ok' }, { label: 'Projects created', value: String(created.length) }, { label: 'Tasks done', value: String(done) }, { label: 'Changes made', value: String(events.length) }] }],
      };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'performance_report',
      description: 'Fieldwork performance from respondent sessions: clicks, completes, terminates, quota full, quality fails, conversion, median length, revenue, payout and profit per currency. Optionally grouped by project, client, vendor, country or month.',
      parameters: obj({ from: str('Start day YYYY-MM-DD'), to: str('End day YYYY-MM-DD, inclusive'), project: str('One project (code or name)'), client: str('One client'), groupBy: str('How to split the numbers', ['project', 'client', 'vendor', 'country', 'month', 'week', 'day']) }),
    },
    async run(ctx, a) {
      const p = s(a.project) ? await findProject(ctx, s(a.project)!) : null;
      const c = s(a.client) ? await findClient(ctx, s(a.client)!) : null;
      const f = { ...(isDay(s(a.from)) ? { from: s(a.from) } : {}), ...(isDay(s(a.to)) ? { to: s(a.to) } : {}), ...(p ? { projectId: p.id } : {}), ...(c ? { clientId: c.id } : {}) };
      const g = s(a.groupBy) as never;
      const [total, rows] = await Promise.all([ctx.reports.summary(ctx.u.organizationId, f, null), g ? ctx.reports.summary(ctx.u.organizationId, f, g) : Promise.resolve([])]);
      const slim = (r: (typeof total)[number]) => ({ label: r.label, clicks: r.clicks, completes: r.completes, terminates: r.terminates, quotaFull: r.quotaFull, qualityFail: r.qualityFail, conversionPercent: r.conversion, medianLoiMinutes: r.medianLoiMinutes, money: r.money });
      const sorted = [...rows].sort((x, y) => y.completes - x.completes);
      return {
        data: { filters: { ...f, project: p?.projectCode, client: c?.name }, total: total[0] ? slim(total[0]) : null, groups: sorted.slice(0, 30).map(slim), note: 'Money is per currency; amounts in different currencies are never added together.' },
        display: sorted.length ? [{ type: 'bars', title: `Completes by ${g}`, items: sorted.slice(0, 15).map((r) => ({ label: r.label, value: r.completes })) }] : undefined,
      };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'finance_overview',
      description: 'Verified finance figures: completes waiting for reconciliation, reconciled but not invoiced, invoiced, paid (revenue per currency), overdue client invoices, and vendor payables (unbilled, due, paid). Use for budgets, revenue, money owed and financial risk.',
      parameters: obj({}),
    },
    async run(ctx) {
      const org = ctx.u.organizationId;
      const [tiles, pay, overdue, settings] = await Promise.all([
        ctx.finance.financeTiles(org),
        ctx.payables.summary(org),
        ctx.prisma.invoice.findMany({ where: { organizationId: org, status: 'SENT', dueAt: { lt: ctx.now } }, select: { number: true, total: true, currency: true, dueAt: true, client: { select: { name: true } } }, orderBy: { dueAt: 'asc' }, take: 20 }),
        ctx.payables.settings(org),
      ]);
      const t = (x: { count: number; byCurrency: { currency: string; amount: number }[] }) => ({ completes: x.count, amounts: x.byCurrency });
      const p = (x: { completes: number; byCurrency: { currency: string; amount: number }[] }) => ({ completes: x.completes, amounts: x.byCurrency });
      const fmt = (b: { currency: string; amount: number }[]) => b.map((x) => `${x.currency} ${x.amount.toLocaleString('en', { maximumFractionDigits: 0 })}`).join(' + ') || '0';
      return {
        data: {
          reportingCurrency: settings.baseCurrency,
          revenue: { awaitingReconciliation: t(tiles.pendingReconciliation), reconciledNotInvoiced: t(tiles.invoicePending), invoicedUnpaid: t(tiles.invoiced), paid: t(tiles.paymentReceived) },
          overdueInvoices: overdue.map((i) => ({ number: i.number, client: i.client.name, amount: `${i.currency} ${Number(i.total)}`, dueDate: iso(i.dueAt), daysOverdue: Math.floor((ctx.now.getTime() - i.dueAt!.getTime()) / 86_400_000) })),
          vendorPayables: { unbilled: p(pay.totals.unbilled), draftBills: p(pay.totals.draft), billsDue: p(pay.totals.due), paid: p(pay.totals.paid) },
          note: 'There are no budgets or expense records in PROJEXA beyond client revenue and vendor payouts per complete.',
        },
        display: [{ type: 'stats', title: 'Money', items: [{ label: 'Not yet invoiced', value: fmt(tiles.invoicePending.byCurrency), tone: 'warn' }, { label: 'Invoiced, unpaid', value: fmt(tiles.invoiced.byCurrency) }, { label: 'Paid', value: fmt(tiles.paymentReceived.byCurrency), tone: 'ok' }, { label: 'Overdue invoices', value: String(overdue.length), tone: overdue.length ? 'bad' : 'ok' }, { label: 'Vendor bills due', value: fmt(pay.totals.due.byCurrency) }] }],
      };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'list_invoices',
      description: 'Client invoices with status, amount, dates and overdue flag.',
      parameters: obj({ status: str('Invoice status', ['DRAFT', 'SENT', 'PAID', 'VOID']), overdue: { type: 'boolean', description: 'Only sent invoices past their due date' }, client: str('Client name or code'), project: str('Project code or name') }),
    },
    async run(ctx, a) {
      const c = s(a.client) ? await findClient(ctx, s(a.client)!) : null;
      const p = s(a.project) ? await findProject(ctx, s(a.project)!) : null;
      const rows = await ctx.prisma.invoice.findMany({
        where: { organizationId: ctx.u.organizationId, ...(s(a.status) ? { status: s(a.status) as never } : {}), ...(a.overdue === true ? { status: 'SENT', dueAt: { lt: ctx.now } } : {}), ...(c ? { clientId: c.id } : {}), ...(p ? { projectId: p.id } : {}) },
        select: { id: true, number: true, status: true, currency: true, total: true, issuedAt: true, dueAt: true, paidAt: true, client: { select: { name: true } }, project: { select: { projectCode: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const out = rows.map((i) => ({ number: i.number, client: i.client.name, project: i.project.projectCode, status: i.status, amount: `${i.currency} ${Number(i.total).toFixed(2)}`, issued: iso(i.issuedAt), due: iso(i.dueAt), paid: iso(i.paidAt), overdue: i.status === 'SENT' && !!i.dueAt && i.dueAt < ctx.now }));
      return {
        data: { count: out.length, invoices: out.slice(0, LIMIT) },
        display: out.length ? [{ type: 'table', title: 'Invoices', columns: [{ key: 'number', label: 'Number' }, { key: 'client', label: 'Client' }, { key: 'status', label: 'Status' }, { key: 'amount', label: 'Amount', align: 'right' }, { key: 'due', label: 'Due' }], rows: out.map((i) => ({ ...i, status: i.overdue ? 'OVERDUE' : i.status })), links: rows.map((i) => `/invoices/${i.id}`) }] : undefined,
      };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'list_vendor_bills',
      description: 'Vendor bills (what PROJEXA owes panel vendors) with status, amount and due date.',
      parameters: obj({ status: str('Bill status', ['DRAFT', 'APPROVED', 'PAID', 'VOID']), vendor: str('Vendor name or code') }),
    },
    async run(ctx, a) {
      const v = s(a.vendor);
      const rows = await ctx.prisma.vendorBill.findMany({
        where: { organizationId: ctx.u.organizationId, ...(s(a.status) ? { status: s(a.status) as never } : {}), ...(v ? { vendor: { OR: [{ name: { contains: v, mode: 'insensitive' } }, { code: { equals: v, mode: 'insensitive' } }] } } : {}) },
        select: { id: true, number: true, status: true, currency: true, total: true, dueAt: true, paidAt: true, vendor: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const out = rows.map((b) => ({ number: b.number, vendor: b.vendor.name, status: b.status, amount: `${b.currency} ${Number(b.total).toFixed(2)}`, due: iso(b.dueAt), paid: iso(b.paidAt), overdue: b.status === 'APPROVED' && !!b.dueAt && b.dueAt < ctx.now }));
      return { data: { count: out.length, bills: out.slice(0, LIMIT) }, display: out.length ? [{ type: 'table', title: 'Vendor bills', columns: [{ key: 'number', label: 'Number' }, { key: 'vendor', label: 'Vendor' }, { key: 'status', label: 'Status' }, { key: 'amount', label: 'Amount', align: 'right' }, { key: 'due', label: 'Due' }], rows: out, links: rows.map((b) => `/payables/${b.id}`) }] : undefined };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'reallocation_suggestions',
      description: 'Suggested moves of completes between vendor links in live markets (from paused, stalled, slow or low-quality vendors to ones with room), with reasons and CPI change.',
      parameters: obj({ project: str('Limit to one project (code or name)') }),
    },
    async run(ctx, a) {
      const p = s(a.project) ? await findProject(ctx, s(a.project)!) : null;
      const r = await ctx.reallocation.suggestions(ctx.u.organizationId, p?.id, ctx.now);
      return { data: r.map((m) => ({ project: `${m.project.projectCode} ${m.project.name}`, market: m.country.countryCode, moves: m.moves.map((x) => ({ from: x.fromName, to: x.toName, completes: x.completes, why: x.reasonLabel, because: x.because, cpiChange: x.cpiDelta })), stillAtRisk: m.uncovered })) };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: {
      name: 'vendor_scores',
      description: 'Vendor scorecards (0-100, grade A-D) from delivery history: quality rejects, client rejections, delivery against target, incidence and drop-outs, with the reasons. Optionally for one market. Use to compare or pick vendors.',
      parameters: obj({ countryCode: str('ISO country code, e.g. DE, to score vendors in that market only'), days: { type: 'number', description: 'Look-back in days (default 180)' } }),
    },
    async run(ctx, a) {
      const days = Math.min(730, Math.max(7, Number(a.days) || 180));
      const cc = s(a.countryCode)?.toUpperCase();
      const { vendors, markets } = await ctx.vendorScoring.stats(ctx.u.organizationId, days);
      const list = await ctx.prisma.vendor.findMany({ where: { organizationId: ctx.u.organizationId, status: 'ACTIVE' }, select: { id: true, name: true, code: true } });
      const rows = list
        .map((v) => {
          const st = (cc ? markets.get(`${v.id}|${cc}`) : vendors.get(v.id)) ?? emptyStats();
          const sc = scoreVendor(st);
          return { vendor: `${v.name} (${v.code})`, score: sc.score, grade: sc.grade, clicks: st.clicks, completes: st.completes, notes: sc.notes };
        })
        .filter((r) => r.clicks > 0)
        .sort((x, y) => (y.score ?? -1) - (x.score ?? -1));
      return {
        data: { days, market: cc ?? 'all', vendors: rows },
        display: [{ type: 'table', title: `Vendor scores${cc ? ` in ${cc}` : ''}, last ${days} days`, columns: [{ key: 'vendor', label: 'Vendor' }, { key: 'grade', label: 'Grade' }, { key: 'score', label: 'Score', align: 'right' }, { key: 'completes', label: 'Completes', align: 'right' }, { key: 'note', label: 'Main point' }], rows: rows.map((r) => ({ vendor: r.vendor, grade: r.grade ?? '–', score: r.score, completes: r.completes, note: r.notes[0] })) }],
      };
    },
  },
  {
    kind: 'read',
    roles: STAFF,
    spec: { name: 'list_people', description: 'Active team members with their role, for assigning tasks.', parameters: obj({}) },
    async run(ctx) {
      const rows = await ctx.prisma.user.findMany({ where: { organizationId: ctx.u.organizationId, active: true, role: { in: STAFF } }, select: { name: true, email: true, role: true }, orderBy: { name: 'asc' } });
      return { data: { people: rows, note: 'PROJEXA has roles but no teams or departments.' } };
    },
  },

  // ───────────── Actions (confirmed by the person first) ─────────────
  {
    kind: 'action',
    roles: EDITORS,
    spec: {
      name: 'create_task',
      description: 'Create a task. It is shown to the person to confirm before it is saved. Use one call per task (for example once per action item from meeting notes).',
      parameters: obj({ title: str('Short task title'), description: str('Details'), assignee: str('Person name or email, or "me"'), project: str('Project code or name'), priority: str('Priority', ['LOW', 'MEDIUM', 'HIGH', 'URGENT']), dueDate: str('Due day YYYY-MM-DD'), remindDate: str('Reminder day YYYY-MM-DD (the assignee sees it in notifications from 09:00 UTC)'), waitsFor: str('Title of an open task this one waits for') }, ['title']),
    },
    async prepare(ctx, a) {
      const title = s(a.title);
      if (!title) throw new ToolError('A task needs a title.');
      const who = s(a.assignee) ? await findPerson(ctx, s(a.assignee)!) : null;
      const p = s(a.project) ? await findProject(ctx, s(a.project)!) : null;
      const dep = s(a.waitsFor) ? await findTask(ctx, s(a.waitsFor)!) : null;
      for (const k of ['dueDate', 'remindDate']) if (s(a[k]) && !isDay(s(a[k]))) throw new ToolError(`${k} must be a day like 2026-11-30.`);
      const priority = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(String(a.priority)) ? String(a.priority) : 'MEDIUM';
      const args = { title: title.slice(0, 200), description: s(a.description)?.slice(0, 5000) ?? null, assigneeId: who?.id ?? null, projectId: p?.id ?? null, priority, dueAt: s(a.dueDate) ?? null, remindAt: s(a.remindDate) ?? null, blockedById: dep?.id ?? null };
      const where = [who && `for ${who.name}`, p && `on ${p.projectCode}`].filter(Boolean).join(' ');
      const bits = [where, s(a.dueDate) && `due ${s(a.dueDate)}`, priority !== 'MEDIUM' && `${priority.toLowerCase()} priority`, s(a.remindDate) && `reminder ${s(a.remindDate)}`, dep && `after "${dep.title}"`].filter(Boolean);
      return { args, summary: `Create task "${args.title}"${bits.length ? ` ${bits.join(', ')}` : ''}` };
    },
    async run(ctx, a) {
      const t = await ctx.tasks.create(ctx.u, a as never, 'ai');
      return { data: { created: { id: t.id, title: t.title, assignee: t.assignee?.name ?? null, due: iso(t.dueAt) } } };
    },
  },
  {
    kind: 'action',
    roles: STAFF,
    spec: {
      name: 'update_task',
      description: 'Change a task: status, priority, assignee, due date or reminder. Shown to the person to confirm first. Viewers can only change the status of their own tasks.',
      parameters: obj({ task: str('Task title (or id)'), status: str('New status', ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']), priority: str('New priority', ['LOW', 'MEDIUM', 'HIGH', 'URGENT']), assignee: str('New assignee name or email'), dueDate: str('New due day YYYY-MM-DD'), remindDate: str('New reminder day YYYY-MM-DD') }, ['task']),
    },
    async prepare(ctx, a) {
      const t = await findTask(ctx, s(a.task) ?? '');
      const who = s(a.assignee) ? await findPerson(ctx, s(a.assignee)!) : null;
      const args: Record<string, unknown> = { id: t.id };
      const bits: string[] = [];
      if (s(a.status)) { args.status = s(a.status); bits.push(`status ${s(a.status)!.toLowerCase().replace('_', ' ')}`); }
      if (s(a.priority)) { args.priority = s(a.priority); bits.push(`priority ${s(a.priority)!.toLowerCase()}`); }
      if (who) { args.assigneeId = who.id; bits.push(`assign to ${who.name}`); }
      for (const [k, to, label] of [['dueDate', 'dueAt', 'due'], ['remindDate', 'remindAt', 'reminder']] as const) {
        if (!s(a[k])) continue;
        if (!isDay(s(a[k]))) throw new ToolError(`${k} must be a day like 2026-11-30.`);
        args[to] = s(a[k]);
        bits.push(`${label} ${s(a[k])}`);
      }
      if (!bits.length) throw new ToolError('Say what to change on the task.');
      return { args, summary: `Update task "${t.title}": ${bits.join(', ')}` };
    },
    async run(ctx, a) {
      const { id, ...rest } = a as { id: string };
      const t = await ctx.tasks.update(ctx.u, id, rest as never, 'ai');
      return { data: { updated: { title: t.title, status: t.status, assignee: t.assignee?.name ?? null, due: iso(t.dueAt) } } };
    },
  },
  {
    kind: 'action',
    roles: EDITORS,
    spec: {
      name: 'create_project',
      description: 'Create a project as a draft. Shown to the person to confirm first. Needs the client, a category and at least one country with target completes, CPI, LOI and incidence. Ask for anything missing rather than guessing.',
      parameters: obj({
        name: str('Project name'),
        client: str('Client name or code'),
        category: str('Category, e.g. B2C, B2B, Healthcare'),
        description: str('Brief or notes'),
        manager: str('Project manager name or email (default: the person asking)'),
        loiMinutes: num('Interview length in minutes'),
        irPercent: num('Incidence rate in percent'),
        cpi: num('Client price per complete'),
        currency: str('Currency code, e.g. USD'),
        language: str('Survey language code, e.g. en'),
        liveSurveyUrl: str('Client survey link (optional)'),
        countries: { type: 'array', description: 'Countries with their target completes', items: obj({ countryCode: str('ISO country code, e.g. US'), targetCompletes: num('Target completes') }, ['countryCode', 'targetCompletes']) },
      }, ['name', 'client', 'category', 'countries']),
    },
    async prepare(ctx, a) {
      const client = await findClient(ctx, s(a.client) ?? '');
      const manager = s(a.manager) ? await findPerson(ctx, s(a.manager)!) : null;
      const countries = (Array.isArray(a.countries) ? a.countries : []).map((c: Record<string, unknown>) => ({ countryCode: String(c.countryCode ?? '').toUpperCase(), targetCompletes: n(c.targetCompletes) }));
      if (!countries.length || countries.some((c) => !/^[A-Z]{2}$/.test(c.countryCode) || !c.targetCompletes)) throw new ToolError('Each country needs a two-letter code and a target number of completes.');
      const missing = (['loiMinutes', 'irPercent', 'cpi'] as const).filter((k) => n(a[k]) === undefined);
      if (missing.length) throw new ToolError(`Ask for the ${missing.map((k) => ({ loiMinutes: 'interview length (LOI)', irPercent: 'incidence rate', cpi: 'CPI' })[k]).join(', ')} before creating the project.`);
      const args = {
        name: s(a.name)!.slice(0, 300), clientId: client.id, category: s(a.category)!.slice(0, 100), description: s(a.description)?.slice(0, 20000), projectManagerId: manager?.id,
        defaults: { loiMinutes: Math.round(n(a.loiMinutes)!), irPercent: Math.round(n(a.irPercent)!), cpi: n(a.cpi)!, currency: (s(a.currency) ?? 'USD').toUpperCase(), language: s(a.language) ?? 'en', ...(s(a.liveSurveyUrl) ? { liveSurveyUrl: s(a.liveSurveyUrl) } : {}) },
        countries: countries.map((c) => ({ countryCode: c.countryCode, targetCompletes: Math.round(c.targetCompletes!) })),
      };
      return { args, summary: `Create draft project "${args.name}" for ${client.name} (${args.category}) in ${countries.map((c) => `${c.countryCode} ×${c.targetCompletes}`).join(', ')}, LOI ${args.defaults.loiMinutes} min, IR ${args.defaults.irPercent}%, CPI ${args.defaults.currency} ${args.defaults.cpi}` };
    },
    async run(ctx, a) {
      const { createProjectSchema } = await import('../projects/projects.schemas');
      const input = createProjectSchema.parse(a);
      const p = (await ctx.projects.create(ctx.u, input)) as { id: string; projectCode: string; name: string };
      return { data: { created: { code: p.projectCode, name: p.name, link: `/projects/${p.id}` } } };
    },
  },
  {
    kind: 'action',
    roles: EDITORS,
    spec: {
      name: 'set_project_status',
      description: 'Change a project status (for example put it on hold, set it live, close it). Shown to the person to confirm first.',
      parameters: obj({ project: str('Project code or name'), status: str('New status', ['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED']) }, ['project', 'status']),
    },
    async prepare(ctx, a) {
      const p = await findProject(ctx, s(a.project) ?? '');
      const st = s(a.status);
      if (!st || !['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED'].includes(st)) throw new ToolError('Status must be DRAFT, TEST, LIVE, HOLD or CLOSED.');
      return { args: { id: p.id, status: st }, summary: `Set ${p.projectCode} ${p.name} to ${st}` };
    },
    async run(ctx, a) {
      const r = (await ctx.projects.update(ctx.u, String(a.id), { status: a.status } as never)) as { projectCode?: string; status?: string };
      return { data: { updated: { project: r.projectCode, status: r.status } } };
    },
  },
  {
    kind: 'action',
    roles: EDITORS,
    spec: {
      name: 'set_vendor_link_status',
      description: 'Pause, resume or close one vendor link in a project market. Shown to the person to confirm first.',
      parameters: obj({ project: str('Project code or name'), country: str('Country code, e.g. US'), vendor: str('Vendor name or code'), status: str('New status', ['ACTIVE', 'PAUSED', 'CLOSED']) }, ['project', 'country', 'vendor', 'status']),
    },
    async prepare(ctx, a) {
      const p = await findProject(ctx, s(a.project) ?? '');
      const v = s(a.vendor) ?? '';
      const country = await ctx.prisma.projectCountry.findFirst({ where: { projectId: p.id, countryCode: (s(a.country) ?? '').toUpperCase() }, include: { allocations: { include: { vendor: { select: { name: true, code: true } } } } } });
      if (!country) throw new ToolError(`${p.projectCode} has no market ${s(a.country)}.`);
      const links = country.allocations.filter((x) => x.vendor.code.toLowerCase() === v.toLowerCase() || x.vendor.name.toLowerCase().includes(v.toLowerCase()));
      if (links.length !== 1) throw new ToolError(links.length ? `Several vendors match "${v}": ${links.map((x) => x.vendor.name).join(', ')}.` : `No vendor "${v}" in ${p.projectCode} ${country.countryCode}. Vendors there: ${country.allocations.map((x) => x.vendor.name).join(', ') || 'none'}.`);
      const st = s(a.status);
      if (!st || !['ACTIVE', 'PAUSED', 'CLOSED'].includes(st)) throw new ToolError('Status must be ACTIVE, PAUSED or CLOSED.');
      return { args: { projectId: p.id, countryId: country.id, allocationId: links[0].id, status: st }, summary: `${st === 'ACTIVE' ? 'Resume' : st === 'PAUSED' ? 'Pause' : 'Close'} ${links[0].vendor.name} in ${p.projectCode} ${country.countryCode}` };
    },
    async run(ctx, a) {
      await ctx.projects.updateAllocation(ctx.u, String(a.projectId), String(a.countryId), String(a.allocationId), { status: a.status } as never);
      return { data: { done: true, status: a.status } };
    },
  },
  {
    kind: 'action',
    roles: EDITORS,
    spec: {
      name: 'run_fieldwork_check',
      description: 'Run the fieldwork monitor now: recheck pace, quality and quotas in every live market and raise or clear alerts (autopilot rules apply). Shown to the person to confirm first.',
      parameters: obj({}),
    },
    async prepare() {
      return { args: {}, summary: 'Run the fieldwork monitor check now (alerts and autopilot rules apply)' };
    },
    async run(ctx) {
      const r = await ctx.monitor.evaluate(ctx.u.organizationId, new Date());
      return { data: { done: true, result: r } };
    },
  },
];

export const toolByName = new Map(TOOLS.map((t) => [t.spec.name, t]));

/** Tools this person may use, given the organisation's settings. */
export function toolsFor(role: Role, opts: { actions: boolean }) {
  return TOOLS.filter((t) => (role === 'ADMIN' || t.roles.includes(role)) && (opts.actions || t.kind === 'read'));
}
