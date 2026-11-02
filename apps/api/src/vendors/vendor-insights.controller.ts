import { Body, Controller, Get, NotFoundException, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { DeliveryStats, emptyStats, MIN_CLICKS, scoreVendor, VendorScoringService } from './vendor-scoring';

const daysSchema = z.object({ days: z.coerce.number().int().min(7).max(730).default(180) });
const capacitySchema = z.object({
  rows: z
    .array(
      z.object({
        countryCode: z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 code'),
        completesPerDay: z.number().int().min(1).max(1_000_000).nullable().optional(),
        completesPerMonth: z.number().int().min(1).max(10_000_000).nullable().optional(),
        note: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .max(250)
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      rows.forEach((r, i) => {
        if (seen.has(r.countryCode)) ctx.addIssue({ code: 'custom', path: [i, 'countryCode'], message: `${r.countryCode} is listed twice` });
        seen.add(r.countryCode);
      });
    }),
});

const LIVE = ['LIVE', 'TEST'] as const;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 100) / 100;
};
const view = (s: DeliveryStats) => ({
  ...s,
  conversion: s.clicks ? Math.round((1000 * s.completes) / s.clicks) / 10 : 0,
  qualityRate: s.clicks ? Math.round((1000 * s.quality) / s.clicks) / 10 : 0,
  rejectionRate: s.approved + s.rejected ? Math.round((1000 * s.rejected) / (s.approved + s.rejected)) / 10 : null,
  delivery: s.delivery === null ? null : Math.round(s.delivery * 1000) / 10,
});

/** Scorecards, capacity and vendor suggestions. Registered before VendorsController so /vendors/scores is not read as an id. */
@Controller()
export class VendorInsightsController {
  constructor(private readonly prisma: PrismaService, private readonly scoring: VendorScoringService, private readonly audit: AuditService) {}

  /** Remaining completes each vendor owes on live and test projects, by market. */
  private async committed(organizationId: string, vendorIds?: string[]) {
    const rows = await this.prisma.vendorAllocation.findMany({
      where: { status: 'ACTIVE', ...(vendorIds ? { vendorId: { in: vendorIds } } : {}), projectCountry: { status: { in: [...LIVE, 'DRAFT'] }, project: { organizationId, status: { in: [...LIVE] } } } },
      select: { vendorId: true, targetCompletes: true, completes: true, projectCountry: { select: { countryCode: true } } },
    });
    const out = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.vendorId}|${r.projectCountry.countryCode}`;
      out.set(k, (out.get(k) ?? 0) + Math.max(0, r.targetCompletes - r.completes));
    }
    return out;
  }

  @Get('vendors/scores')
  async scores(@CurrentUser() u: AuthUser, @Query(new ZodPipe(daysSchema)) q: z.infer<typeof daysSchema>) {
    const [vendors, { vendors: stats }, committed] = await Promise.all([
      this.prisma.vendor.findMany({ where: { organizationId: u.organizationId }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, status: true, capacity: { select: { countryCode: true } } } }),
      this.scoring.stats(u.organizationId, q.days),
      this.committed(u.organizationId),
    ]);
    return {
      days: q.days,
      minClicks: MIN_CLICKS,
      vendors: vendors.map((v) => {
        const s = stats.get(v.id) ?? emptyStats();
        const load = [...committed].filter(([k]) => k.startsWith(`${v.id}|`)).reduce((a, [, n]) => a + n, 0);
        return { id: v.id, name: v.name, code: v.code, status: v.status, markets: v.capacity.map((c) => c.countryCode).sort(), committed: load, stats: view(s), ...scoreVendor(s) };
      }),
    };
  }

  @Get('vendors/:id/scorecard')
  async scorecard(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query(new ZodPipe(daysSchema)) q: z.infer<typeof daysSchema>) {
    const v = await this.prisma.vendor.findFirst({ where: { id, organizationId: u.organizationId }, select: { id: true, name: true, code: true, status: true, capacity: { orderBy: { countryCode: 'asc' } } } });
    if (!v) throw new NotFoundException();
    const [{ vendors, markets, allocations, perAlloc, finished }, committed] = await Promise.all([this.scoring.stats(u.organizationId, q.days, id), this.committed(u.organizationId, [id])]);
    const s = vendors.get(id) ?? emptyStats();
    const codes = new Set([...v.capacity.map((c) => c.countryCode), ...[...markets.keys()].map((k) => k.split('|')[1]), ...[...committed.keys()].map((k) => k.split('|')[1])]);
    return {
      id: v.id,
      name: v.name,
      code: v.code,
      status: v.status,
      days: q.days,
      minClicks: MIN_CLICKS,
      stats: view(s),
      ...scoreVendor(s),
      markets: [...codes].sort().map((cc) => {
        const ms = markets.get(`${id}|${cc}`) ?? emptyStats();
        const cap = v.capacity.find((c) => c.countryCode === cc);
        const load = committed.get(`${id}|${cc}`) ?? 0;
        return {
          countryCode: cc,
          stats: view(ms),
          ...scoreVendor(ms),
          capacity: cap ? { completesPerDay: cap.completesPerDay, completesPerMonth: cap.completesPerMonth, note: cap.note } : null,
          committed: load,
          headroom: cap?.completesPerMonth ? cap.completesPerMonth - load : null,
        };
      }),
      links: allocations
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 25)
        .map((a) => {
          const st = perAlloc.get(a.id) ?? emptyStats();
          return {
            id: a.id,
            project: a.projectCountry.project,
            countryCode: a.projectCountry.countryCode,
            currency: a.projectCountry.currency,
            cpi: Number(a.cpi),
            status: a.status,
            target: a.targetCompletes,
            completes: a.completes,
            finished: finished(a),
            clicks: st.clicks,
            qualityRate: view(st).qualityRate,
            rejected: st.rejected,
          };
        }),
    };
  }

  @Put('vendors/:id/capacity')
  @Roles(...EDITORS)
  async capacity(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(capacitySchema)) body: z.infer<typeof capacitySchema>) {
    const v = await this.prisma.vendor.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!v) throw new NotFoundException();
    await this.prisma.$transaction([
      this.prisma.vendorCapacity.deleteMany({ where: { vendorId: id, countryCode: { notIn: body.rows.map((r) => r.countryCode) } } }),
      ...body.rows.map((r) => {
        const data = { completesPerDay: r.completesPerDay ?? null, completesPerMonth: r.completesPerMonth ?? null, note: r.note || null };
        return this.prisma.vendorCapacity.upsert({ where: { vendorId_countryCode: { vendorId: id, countryCode: r.countryCode } }, create: { vendorId: id, countryCode: r.countryCode, ...data }, update: data });
      }),
    ]);
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'vendor.capacity', entityType: 'Vendor', entityId: id, detail: { markets: body.rows.map((r) => r.countryCode) } });
    return this.prisma.vendorCapacity.findMany({ where: { vendorId: id }, orderBy: { countryCode: 'asc' }, select: { countryCode: true, completesPerDay: true, completesPerMonth: true, note: true } });
  }

  /**
   * Ranks active vendors not yet on this market. Score in the market when it has enough clicks, else the
   * overall score (50 when unknown); plus market history and declared coverage; minus thin headroom and
   * a typical CPI that leaves no margin. Every point added or taken away is listed as a reason.
   * Vendors that cover the market or have sent traffic there always rank above those that have not.
   */
  @Get('projects/:id/countries/:countryId/vendor-suggestions')
  async suggest(@CurrentUser() u: AuthUser, @Param('id') projectId: string, @Param('countryId') countryId: string, @Query(new ZodPipe(daysSchema)) q: z.infer<typeof daysSchema>) {
    const c = await this.prisma.projectCountry.findFirst({
      where: { id: countryId, projectId, project: { organizationId: u.organizationId } },
      select: { countryCode: true, currency: true, cpi: true, targetCompletes: true, completes: true, allocations: { select: { vendorId: true, targetCompletes: true } } },
    });
    if (!c) throw new NotFoundException('Market not found');
    const taken = new Set(c.allocations.map((a) => a.vendorId));
    const allocated = c.allocations.reduce((n, a) => n + a.targetCompletes, 0);
    const needed = Math.max(0, c.targetCompletes - allocated);
    const clientCpi = Number(c.cpi);
    const [vendors, { vendors: overall, markets }, committed, history] = await Promise.all([
      this.prisma.vendor.findMany({ where: { organizationId: u.organizationId, status: 'ACTIVE', id: { notIn: [...taken] } }, select: { id: true, name: true, code: true, capacity: { where: { countryCode: c.countryCode } } } }),
      this.scoring.stats(u.organizationId, q.days),
      this.committed(u.organizationId),
      this.prisma.vendorAllocation.findMany({
        where: { projectCountry: { countryCode: c.countryCode, currency: c.currency, project: { organizationId: u.organizationId } } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { vendorId: true, cpi: true },
      }),
    ]);
    const marketCpi = median(history.map((h) => Number(h.cpi)));
    const rows = vendors.map((v) => {
      const reasons: { text: string; points: number }[] = [];
      const ms = markets.get(`${v.id}|${c.countryCode}`) ?? emptyStats();
      const os = overall.get(v.id) ?? emptyStats();
      const mScore = scoreVendor(ms);
      const oScore = scoreVendor(os);
      let base = 50;
      if (mScore.score !== null) {
        base = mScore.score;
        reasons.push({ text: `Score ${mScore.score} (${mScore.grade}) in ${c.countryCode}`, points: 0 });
      } else if (oScore.score !== null) {
        base = oScore.score;
        reasons.push({ text: `Score ${oScore.score} (${oScore.grade}) across all markets`, points: 0 });
      } else reasons.push({ text: 'No score yet, counted as 50', points: 0 });
      let fit = base;
      if (ms.completes > 0) {
        fit += 15;
        reasons.push({ text: `Delivered ${ms.completes} completes in ${c.countryCode} on ${ms.projects} project${ms.projects === 1 ? '' : 's'}`, points: 15 });
      }
      const cap = v.capacity[0];
      if (cap) {
        fit += 10;
        reasons.push({ text: `Covers ${c.countryCode}${cap.completesPerMonth ? ` (${cap.completesPerMonth.toLocaleString('en-US')} completes a month)` : ''}`, points: 10 });
      }
      if (!cap && !ms.clicks) {
        fit -= 20;
        reasons.push({ text: `No history or declared coverage in ${c.countryCode}`, points: -20 });
      }
      const load = committed.get(`${v.id}|${c.countryCode}`) ?? 0;
      const headroom = cap?.completesPerMonth ? cap.completesPerMonth - load : null;
      if (headroom !== null && needed > 0 && headroom < needed) {
        fit -= 20;
        reasons.push({ text: `Only ${Math.max(0, headroom)} completes a month left after ${load} owed on live projects`, points: -20 });
      }
      const own = median(history.filter((h) => h.vendorId === v.id).map((h) => Number(h.cpi)));
      const cpi = own ?? marketCpi;
      if (cpi !== null && cpi >= clientCpi) {
        fit -= 15;
        reasons.push({ text: `Typical CPI ${cpi} ${c.currency} leaves no margin on the client CPI ${clientCpi}`, points: -15 });
      }
      // With the target fully allocated, suggest a 10% backup.
      const want = needed > 0 ? needed : Math.max(1, Math.ceil(c.targetCompletes * 0.1));
      const suggestedTarget = headroom !== null ? Math.max(1, Math.min(want, headroom)) : want;
      return {
        vendorId: v.id,
        name: v.name,
        code: v.code,
        fit: Math.max(0, Math.min(100, Math.round(fit))),
        knownInMarket: !!cap || ms.clicks > 0,
        score: mScore.score ?? oScore.score,
        grade: mScore.grade ?? oScore.grade,
        marketCompletes: ms.completes,
        committed: load,
        headroom,
        typicalCpi: cpi,
        cpiSource: own !== null ? 'vendor' : cpi !== null ? 'market' : null,
        margin: cpi !== null && clientCpi > 0 ? Math.round(((clientCpi - cpi) / clientCpi) * 1000) / 10 : null,
        suggested: { cpi, targetCompletes: suggestedTarget },
        reasons,
        warnings: (scoreVendor(ms).score !== null ? mScore : oScore).notes.filter((n) => n !== 'No problems found' && !n.startsWith('Not enough data')),
      };
    });
    rows.sort((a, b) => Number(b.knownInMarket) - Number(a.knownInMarket) || b.fit - a.fit || b.marketCompletes - a.marketCompletes || a.name.localeCompare(b.name));
    return { countryCode: c.countryCode, currency: c.currency, clientCpi, needed, marketCpi, days: q.days, suggestions: rows };
  }
}
