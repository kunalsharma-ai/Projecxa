import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

export type TargetChange = { id: string; vendor: string; from: number; to: number };
type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * Moves completes between vendor links of one market in one transaction. Each target change is
 * checked against the value that was read, so two people (or a person and the autopilot) applying
 * at once cannot both succeed. Used by manual reallocation and by auto-routing; `extra` runs inside
 * the same transaction (auto-routing records its run there).
 */
export async function applyMoves(
  prisma: PrismaService,
  audit: AuditService,
  o: { organizationId: string; actorId: string | null; projectId: string; countryId: string; moves: { from: string | null; to: string; completes: number }[]; action: string; detail?: Record<string, unknown>; extra?: (tx: Tx, changed: TargetChange[]) => Promise<unknown> },
): Promise<{ changed: TargetChange[] }> {
  const country = await prisma.projectCountry.findFirst({
    where: { id: o.countryId, projectId: o.projectId, project: { organizationId: o.organizationId } },
    include: { allocations: { include: { vendor: { select: { name: true } } } } },
  });
  if (!country) throw new NotFoundException('Market not found');
  const links = new Map(country.allocations.map((a) => [a.id, a]));
  const next = new Map(country.allocations.map((a) => [a.id, a.targetCompletes]));
  let fromUnassigned = 0;
  for (const m of o.moves) {
    const to = links.get(m.to);
    if (!to || (m.from && !links.has(m.from))) throw new BadRequestException('A vendor link is not in this market');
    if (to.status !== 'ACTIVE') throw new BadRequestException(`${to.vendor.name} is ${to.status.toLowerCase()}. Reactivate it before giving it more completes.`);
    next.set(m.to, next.get(m.to)! + m.completes);
    if (m.from) next.set(m.from, next.get(m.from)! - m.completes);
    else fromUnassigned += m.completes;
  }
  for (const [id, t] of next) {
    const a = links.get(id)!;
    if (t < a.completes) throw new BadRequestException(`${a.vendor.name} already has ${a.completes} completes; its target cannot go below that`);
  }
  const assigned = country.allocations.reduce((t, a) => t + Math.max(a.targetCompletes, a.completes), 0);
  if (fromUnassigned > Math.max(0, country.targetCompletes - assigned)) throw new BadRequestException('That is more than the unassigned part of the market target');

  const changed = [...next].filter(([id, t]) => t !== links.get(id)!.targetCompletes).map(([id, t]) => ({ id, vendor: links.get(id)!.vendor.name, from: links.get(id)!.targetCompletes, to: t }));
  await prisma.$transaction(async (tx) => {
    for (const c of changed) {
      const r = await tx.vendorAllocation.updateMany({ where: { id: c.id, targetCompletes: c.from, completes: { lte: c.to } }, data: { targetCompletes: c.to } });
      if (r.count !== 1) throw new ConflictException('Targets changed while you were looking. Refresh the suggestions and try again.');
    }
    await audit.record(
      { organizationId: o.organizationId, actorId: o.actorId, action: o.action, entityType: 'ProjectCountry', entityId: o.countryId, detail: { moves: o.moves, targets: changed, ...(o.detail ?? {}) } },
      tx,
    );
    if (o.extra) await o.extra(tx, changed);
  });
  return { changed };
}
