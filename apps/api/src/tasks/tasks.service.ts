import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { Prisma, TaskPriority, TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Tasks: work for a person, optionally on a project, with a due date, a reminder and one
 * "blocked by" dependency. Editors create and assign; anyone may update a task assigned to them.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/, 'Use a date like 2026-11-30');
const taskFields = {
  title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).nullable().optional(),
    projectId: z.string().max(64).nullable().optional(),
    assigneeId: z.string().max(64).nullable().optional(),
    priority: z.nativeEnum(TaskPriority).default('MEDIUM'),
    dueAt: day.nullable().optional(),
    remindAt: day.nullable().optional(),
    blockedById: z.string().max(64).nullable().optional(),
};
export const createTaskSchema = z.object(taskFields).strict();
export const updateTaskSchema = z
  .object({ ...taskFields, title: taskFields.title.optional(), priority: z.nativeEnum(TaskPriority).optional(), status: z.nativeEnum(TaskStatus).optional() })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');
export const listTasksSchema = z.object({
  status: z.enum(['open', 'done', 'all']).default('open'),
  assigneeId: z.string().max(64).optional(),
  projectId: z.string().max(64).optional(),
  mine: z.enum(['true', 'false']).optional(),
  overdue: z.enum(['true', 'false']).optional(),
});
export type CreateTask = z.infer<typeof createTaskSchema>;
export type UpdateTask = z.infer<typeof updateTaskSchema>;

const EDIT = ['ADMIN', 'PROJECT_MANAGER'];
const OPEN: TaskStatus[] = ['OPEN', 'IN_PROGRESS'];
/** A bare date means the end of that day (UTC), so "due 30 Nov" is not overdue during 30 Nov. */
const when = (s: string | null | undefined, endOfDay: boolean) => (s == null ? s : new Date(s.length === 10 ? `${s}T${endOfDay ? '23:59:59' : '09:00:00'}Z` : s));

const include = {
  project: { select: { id: true, projectCode: true, name: true } },
  assignee: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true } },
  blockedBy: { select: { id: true, title: true, status: true } },
} satisfies Prisma.TaskInclude;
type Row = Prisma.TaskGetPayload<{ include: typeof include }>;

export function shapeTask(t: Row, now = Date.now()) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    project: t.project,
    assignee: t.assignee,
    createdBy: t.createdBy,
    dueAt: t.dueAt,
    remindAt: t.remindAt,
    blockedBy: t.blockedBy,
    blocked: !!t.blockedBy && OPEN.includes(t.blockedBy.status),
    overdue: OPEN.includes(t.status) && !!t.dueAt && t.dueAt.getTime() < now,
    source: t.source,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async refs(u: AuthUser, b: Partial<CreateTask>, selfId?: string) {
    if (b.projectId && !(await this.prisma.project.count({ where: { id: b.projectId, organizationId: u.organizationId } }))) throw new BadRequestException('Project not found');
    if (b.assigneeId && !(await this.prisma.user.count({ where: { id: b.assigneeId, organizationId: u.organizationId, active: true, role: { in: ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER'] } } }))) throw new BadRequestException('That person is not an active team member');
    if (b.blockedById) {
      if (b.blockedById === selfId) throw new BadRequestException('A task cannot wait for itself');
      const dep = await this.prisma.task.findFirst({ where: { id: b.blockedById, organizationId: u.organizationId }, select: { id: true, blockedById: true } });
      if (!dep) throw new BadRequestException('The task it waits for was not found');
      // Walk the chain so two tasks never wait for each other.
      let cur: string | null = dep.blockedById;
      for (let i = 0; cur && i < 50; i++) {
        if (cur === selfId) throw new BadRequestException('That would make the tasks wait for each other');
        cur = (await this.prisma.task.findUnique({ where: { id: cur }, select: { blockedById: true } }))?.blockedById ?? null;
      }
    }
  }

  async create(u: AuthUser, b: CreateTask, source: 'manual' | 'ai' = 'manual') {
    if (!EDIT.includes(u.role)) throw new ForbiddenException('Only admins and project managers create tasks');
    await this.refs(u, b);
    const t = await this.prisma.task.create({
      data: {
        organizationId: u.organizationId, title: b.title, description: b.description || null, projectId: b.projectId || null, assigneeId: b.assigneeId || null,
        priority: b.priority, dueAt: when(b.dueAt, true) ?? null, remindAt: when(b.remindAt, false) ?? null, blockedById: b.blockedById || null, createdById: u.id, source,
      },
      include,
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: source === 'ai' ? 'task.create.ai' : 'task.create', entityType: 'Task', entityId: t.id, detail: { title: t.title, assignee: t.assignee?.name ?? null } });
    return shapeTask(t);
  }

  async update(u: AuthUser, id: string, b: UpdateTask, source: 'manual' | 'ai' = 'manual') {
    const t = await this.prisma.task.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!t) throw new NotFoundException('Task not found');
    const editor = EDIT.includes(u.role);
    if (!editor) {
      if (t.assigneeId !== u.id) throw new ForbiddenException('You can only update tasks assigned to you');
      const allowed = ['status', 'description'];
      if (Object.keys(b).some((k) => !allowed.includes(k))) throw new ForbiddenException('You can change the status and notes of your own tasks');
    }
    await this.refs(u, b, id);
    const done = b.status === 'DONE';
    const r = await this.prisma.task.update({
      where: { id },
      data: {
        ...(b.title !== undefined ? { title: b.title } : {}),
        ...(b.description !== undefined ? { description: b.description || null } : {}),
        ...(b.projectId !== undefined ? { projectId: b.projectId || null } : {}),
        ...(b.assigneeId !== undefined ? { assigneeId: b.assigneeId || null } : {}),
        ...(b.priority ? { priority: b.priority } : {}),
        ...(b.dueAt !== undefined ? { dueAt: when(b.dueAt, true) } : {}),
        ...(b.remindAt !== undefined ? { remindAt: when(b.remindAt, false), remindPushedAt: null } : {}),
        ...(b.blockedById !== undefined ? { blockedById: b.blockedById || null } : {}),
        ...(b.status ? { status: b.status, completedAt: done ? new Date() : null } : {}),
      },
      include,
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: source === 'ai' ? 'task.update.ai' : 'task.update', entityType: 'Task', entityId: id, detail: b });
    return shapeTask(r);
  }

  async list(u: AuthUser, q: Partial<z.infer<typeof listTasksSchema>> & { search?: string }, take = 200) {
    const now = new Date();
    const where: Prisma.TaskWhereInput = {
      organizationId: u.organizationId,
      ...(q.status === 'done' ? { status: { in: ['DONE', 'CANCELLED'] } } : q.status === 'all' ? {} : { status: { in: OPEN } }),
      ...(q.mine === 'true' ? { assigneeId: u.id } : q.assigneeId ? { assigneeId: q.assigneeId } : {}),
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.overdue === 'true' ? { status: { in: OPEN }, dueAt: { lt: now } } : {}),
      ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const rows = await this.prisma.task.findMany({ where, include, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take });
    const rank: Record<TaskPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return rows.map((t) => shapeTask(t, now.getTime())).sort((a, b) => Number(b.overdue) - Number(a.overdue) || rank[a.priority] - rank[b.priority]);
  }

  async get(u: AuthUser, id: string) {
    const t = await this.prisma.task.findFirst({ where: { id, organizationId: u.organizationId }, include });
    if (!t) throw new NotFoundException('Task not found');
    return shapeTask(t);
  }

  /** Reminders that are due for this person, for the notifications menu. */
  async reminders(u: AuthUser) {
    const now = new Date();
    const rows = await this.prisma.task.findMany({
      where: { organizationId: u.organizationId, assigneeId: u.id, status: { in: OPEN }, OR: [{ remindAt: { lte: now } }, { dueAt: { lt: now } }] },
      include,
      orderBy: { dueAt: 'asc' },
      take: 10,
    });
    return rows.map((t) => shapeTask(t, now.getTime()));
  }
}

@Controller('tasks')
export class TasksController {
  constructor(private readonly svc: TasksService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listTasksSchema)) q: z.infer<typeof listTasksSchema>) {
    return this.svc.list(u, q);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.get(u, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createTaskSchema)) b: CreateTask) {
    return this.svc.create(u, b);
  }

  @Patch(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateTaskSchema)) b: UpdateTask) {
    return this.svc.update(u, id, b);
  }
}

@Module({ controllers: [TasksController], providers: [TasksService], exports: [TasksService] })
export class TasksModule {}
