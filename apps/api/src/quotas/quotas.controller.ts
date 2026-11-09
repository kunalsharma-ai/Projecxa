import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Patch, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { questionsOf } from '../survey/questions';
import { cellsInputSchema, QUOTABLE_TYPES, validateCells } from './quota.rules';
import { aggregate, numOut } from '../prisma/agg';

const patchSchema = z.object({ isOpen: z.boolean().optional(), target: z.number().int().min(1).max(1_000_000).optional() }).strict();

@Controller('projects/:id')
export class QuotasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async project(u: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, organizationId: u.organizationId }, select: { id: true, security: true, gateQuestions: true, prescreen: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private async country(u: AuthUser, projectId: string, countryId: string) {
    const p = await this.project(u, projectId);
    const c = await this.prisma.projectCountry.findFirst({ where: { id: countryId, projectId }, select: { id: true, countryCode: true, targetCompletes: true } });
    if (!c) throw new NotFoundException('Country not found');
    return { p, c };
  }

  /** Every market's cells with live progress, plus the questions a cell can target. */
  @Get('quotas')
  async list(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.project(u, id);
    const security = (p.security ?? {}) as Record<string, boolean>;
    const quotable = (json: unknown) =>
      questionsOf(json)
        .filter((q) => (QUOTABLE_TYPES as readonly string[]).includes(q.type))
        .map((q) => ({ id: q.id, type: q.type, text: q.text, options: q.options?.map((o) => ({ id: o.id, label: o.label })) ?? [], min: q.validation?.min, max: q.validation?.max }));
    const [countries, inProgress] = await Promise.all([
      this.prisma.projectCountry.findMany({
        where: { projectId: id },
        orderBy: { countryCode: 'asc' },
        select: { id: true, countryCode: true, language: true, status: true, targetCompletes: true, completes: true, quotas: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
      }),
      // Respondents who qualified for a cell and are still in the survey.
      aggregate<{ _id: string; n: number }>(this.prisma.respondentSession, [
        { $match: { projectId: id, status: 'STARTED', isTest: false } },
        { $unwind: '$quotaCellIds' },
        { $group: { _id: '$quotaCellIds', n: { $sum: 1 } } },
      ]).then((rows) => rows.map((r) => ({ id: r._id, n: numOut(r.n) }))),
    ]);
    const live = new Map(inProgress.map((r) => [r.id, r.n]));
    return {
      gateSurvey: !!security.gateSurvey,
      prescreening: !!security.prescreening,
      questions: { gate: quotable(p.gateQuestions), prescreen: quotable(p.prescreen) },
      countries: countries.map((c) => ({
        ...c,
        quotas: c.quotas.map(({ criteria: _legacy, ...q }) => ({ ...q, inProgress: live.get(q.id) ?? 0 })),
      })),
    };
  }

  /** Replaces a market's cells. Cells kept by id keep their counts; cells left out are removed. */
  @Put('countries/:countryId/quotas')
  @Roles(...EDITORS)
  async replace(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('countryId') countryId: string, @Body(new ZodPipe(cellsInputSchema)) body: z.infer<typeof cellsInputSchema>) {
    const { p, c } = await this.country(u, id, countryId);
    const issues = validateCells(body.cells, { gate: questionsOf(p.gateQuestions), prescreen: questionsOf(p.prescreen) });
    const names = new Set<string>();
    for (const cell of body.cells) {
      const key = `${cell.group}\u0000${cell.name}`.toLowerCase();
      if (names.has(key)) issues.push(`${cell.name}: the name is used twice${cell.group ? ` in ${cell.group}` : ''}`);
      names.add(key);
    }
    if (issues.length) throw new BadRequestException({ message: 'Some quota cells need fixing', issues });

    const existing = await this.prisma.quotaCell.findMany({ where: { projectCountryId: countryId }, select: { id: true } });
    const known = new Set(existing.map((e) => e.id));
    const unknown = body.cells.filter((x) => x.id && !known.has(x.id));
    if (unknown.length) throw new BadRequestException('A cell does not belong to this market; reload and try again');
    const keep = new Set(body.cells.map((x) => x.id).filter(Boolean));

    await this.prisma.$transaction(async (tx) => {
      await tx.quotaCell.deleteMany({ where: { projectCountryId: countryId, id: { notIn: [...keep] as string[] } } });
      for (const [i, cell] of body.cells.entries()) {
        const data = { group: cell.group.trim(), name: cell.name, target: cell.target, isOpen: cell.isOpen, conditions: cell.conditions as Prisma.InputJsonValue, sortOrder: i };
        if (cell.id) await tx.quotaCell.update({ where: { id: cell.id }, data });
        else await tx.quotaCell.create({ data: { ...data, projectCountryId: countryId } });
      }
      await this.audit.record(
        { organizationId: u.organizationId, actorId: u.id, action: 'quotas.replace', entityType: 'ProjectCountry', entityId: countryId, detail: { country: c.countryCode, cells: body.cells.length, removed: existing.length - keep.size } },
        tx,
      );
    });
    return this.prisma.quotaCell.findMany({ where: { projectCountryId: countryId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  /** Open or close one cell, or change its target, without editing the whole set. */
  @Patch('countries/:countryId/quotas/:quotaId')
  @Roles(...EDITORS)
  async patch(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('countryId') countryId: string, @Param('quotaId') quotaId: string, @Body(new ZodPipe(patchSchema)) body: z.infer<typeof patchSchema>) {
    await this.country(u, id, countryId);
    const cell = await this.prisma.quotaCell.findFirst({ where: { id: quotaId, projectCountryId: countryId } });
    if (!cell) throw new NotFoundException('Quota cell not found');
    const updated = await this.prisma.quotaCell.update({ where: { id: quotaId }, data: body });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'quotas.update', entityType: 'QuotaCell', entityId: quotaId, detail: body });
    return updated;
  }
}

@Module({ controllers: [QuotasController] })
export class QuotasModule {}
