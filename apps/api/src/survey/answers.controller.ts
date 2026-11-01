import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AnswerSet, questionsOf } from './questions';
import { REASON_LABELS } from './respondent-checks';

const EXPORT_LIMIT = 20_000;
const SUMMARY_LIMIT = 50_000;

const answersQuery = z.object({
  includeTest: z.enum(['true', 'false']).default('false'),
  status: z.string().regex(/^[A-Z_]{3,20}$/).optional(),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  vendorId: z.string().max(64).optional(),
  /** Answer filter: section, question id and option id (choice questions). */
  section: z.enum(['gate', 'prescreen']).optional(),
  question: z.string().regex(/^[a-z0-9_-]{1,32}$/i).optional(),
  option: z.string().regex(/^[a-z0-9_-]{1,32}$/i).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  export: z.enum(['true', 'false']).default('false'),
});
type AnswersQuery = z.infer<typeof answersQuery>;

/** Gate survey and prescreener answers, per project: table, filters, per-question counts and export. Staff only. */
@Controller('projects/:id/answers')
export class AnswersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query(new ZodPipe(answersQuery)) q: AnswersQuery) {
    const project = await this.prisma.project.findFirst({
      where: { id, organizationId: u.organizationId },
      select: { id: true, gateQuestions: true, prescreen: true, countries: { select: { countryCode: true } } },
    });
    if (!project) throw new NotFoundException('Project not found');
    const questions = [
      ...questionsOf(project.gateQuestions).map((x) => ({ section: 'gate' as const, ...x })),
      ...questionsOf(project.prescreen).map((x) => ({ section: 'prescreen' as const, ...x })),
    ];

    const where: Prisma.RespondentSessionWhereInput = {
      projectId: project.id,
      answers: { not: Prisma.DbNull },
      ...(q.includeTest === 'true' ? {} : { isTest: false }),
      ...(q.status ? { status: q.status as Prisma.EnumRespondentStatusFilter['equals'] } : {}),
      ...(q.country ? { projectCountry: { countryCode: q.country } } : {}),
      ...(q.vendorId ? { vendorAllocation: { vendorId: q.vendorId } } : {}),
    };
    if (q.section && q.question && q.option) {
      const def = questions.find((x) => x.section === q.section && x.id === q.question);
      const path = [q.section, q.question, 'value'];
      where.AND = [def?.type === 'multi' ? { answers: { path, array_contains: [q.option] } } : { answers: { path, equals: q.option } }];
    }

    const exporting = q.export === 'true';
    const [total, rows, all] = await Promise.all([
      this.prisma.respondentSession.count({ where }),
      this.prisma.respondentSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: exporting ? 0 : (q.page - 1) * q.pageSize,
        take: exporting ? EXPORT_LIMIT : q.pageSize,
        select: {
          id: true,
          vendorRespondentId: true,
          status: true,
          statusDetail: true,
          isTest: true,
          startedAt: true,
          deviceType: true,
          answers: true,
          projectCountry: { select: { countryCode: true } },
          vendorAllocation: { select: { vendor: { select: { id: true, name: true } } } },
        },
      }),
      exporting ? Promise.resolve(null) : this.prisma.respondentSession.findMany({ where, take: SUMMARY_LIMIT, select: { answers: true } }),
    ]);

    // Per-question answer counts for choice questions (and number ranges as min / median / max).
    const summary = all
      ? questions.map((x) => {
          const counts: Record<string, number> = {};
          const nums: number[] = [];
          let answered = 0;
          for (const r of all) {
            const a = ((r.answers ?? {}) as Record<string, AnswerSet>)[x.section]?.[x.id];
            if (!a) continue;
            answered++;
            if (x.type === 'number' && typeof a.value === 'number') nums.push(a.value);
            else if (Array.isArray(a.value)) for (const v of a.value) counts[v] = (counts[v] ?? 0) + 1;
            else if (typeof a.value === 'string' && x.type !== 'text') counts[a.value] = (counts[a.value] ?? 0) + 1;
          }
          nums.sort((p, n) => p - n);
          return {
            section: x.section,
            id: x.id,
            answered,
            counts: x.type === 'single' || x.type === 'multi' || x.type === 'dropdown' ? (x.options ?? []).map((o) => ({ id: o.id, label: o.label, count: counts[o.id] ?? 0 })) : undefined,
            number: nums.length ? { min: nums[0], median: nums[Math.floor(nums.length / 2)], max: nums[nums.length - 1] } : undefined,
          };
        })
      : undefined;

    return {
      questions: questions.map((x) => ({ section: x.section, id: x.id, type: x.type, text: x.text, options: x.options?.map((o) => ({ id: o.id, label: o.label })) })),
      countries: project.countries.map((c) => c.countryCode),
      total,
      page: exporting ? 1 : q.page,
      pageSize: exporting ? EXPORT_LIMIT : q.pageSize,
      truncated: exporting && total > EXPORT_LIMIT,
      summary,
      rows: rows.map((r) => ({
        id: r.id,
        vendorRespondentId: r.vendorRespondentId,
        status: r.status,
        statusDetail: r.statusDetail,
        reason: r.statusDetail ? REASON_LABELS[r.statusDetail] ?? null : null,
        isTest: r.isTest,
        startedAt: r.startedAt,
        deviceType: r.deviceType,
        country: r.projectCountry.countryCode,
        vendor: r.vendorAllocation.vendor,
        answers: r.answers,
      })),
    };
  }
}
