/**
 * Auto-pause checkpoint (docs/FIELDWORK_MONITOR.md, "Auto-pause"). Runs right after every live
 * complete and on each monitor run. Plain functions over Prisma, so the survey engine can call it
 * without depending on the monitor module.
 */
import { Prisma } from '@prisma/client';
import { PrismaClient } from '../prisma/client';
import { autoPauseDecision, autoPauseStateOf, autopilotOf, AutoPauseState } from './monitor.rules';

type Db = PrismaClient;

export interface AutoPauseResult {
  /** Human-readable actions, e.g. "Paused US at the 10% checkpoint (10 of 100 completes)". */
  actions: string[];
  /** True when this run switched the checkpoint off because every market or link was done. */
  switchedOff: boolean;
}

export async function runAutoPause(prisma: Db, projectId: string, now = new Date()): Promise<AutoPauseResult> {
  const p = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true, organizationId: true, status: true, autopilot: true, autopilotState: true,
      countries: {
        select: {
          id: true, countryCode: true, targetGroup: true, status: true, targetCompletes: true, completes: true,
          allocations: { select: { id: true, status: true, targetCompletes: true, completes: true, vendor: { select: { name: true } } } },
        },
      },
    },
  });
  const none = { actions: [], switchedOff: false };
  if (!p || p.status !== 'LIVE') return none;
  const ap = autopilotOf(p.autopilot);
  const a = ap.autoPause;
  if (!a.enabled) return none;
  const state: AutoPauseState = autoPauseStateOf(p.autopilotState, a);
  const label = (c: { countryCode: string; targetGroup: string | null }) => (c.targetGroup ? `${c.countryCode} (${c.targetGroup})` : c.countryCode);
  const checkpoint = a.by === 'percent' ? `${a.value}% checkpoint` : `${a.value}-complete checkpoint`;

  type Item = { key: string; name: string; completes: number; target: number; open: boolean; pause: () => Promise<boolean> };
  const items: Item[] = [];
  for (const c of p.countries) {
    if (c.status === 'CLOSED' || c.status === 'DRAFT') continue;
    if (a.scope === 'market') {
      items.push({
        key: `m:${c.id}`, name: label(c), completes: c.completes, target: c.targetCompletes, open: c.status === 'LIVE',
        pause: async () => (await prisma.projectCountry.updateMany({ where: { id: c.id, status: 'LIVE' }, data: { status: 'HOLD' } })).count > 0,
      });
    } else {
      for (const al of c.allocations) {
        if (al.status === 'CLOSED') continue;
        items.push({
          key: `a:${al.id}`, name: `${al.vendor.name} in ${label(c)}`, completes: al.completes, target: al.targetCompletes, open: al.status === 'ACTIVE',
          pause: async () => (await prisma.vendorAllocation.updateMany({ where: { id: al.id, status: 'ACTIVE' }, data: { status: 'PAUSED' } })).count > 0,
        });
      }
    }
  }

  const actions: string[] = [];
  let changed = false;
  for (const it of items) {
    const d = autoPauseDecision(a, state, it.key, it.completes, it.target, it.open);
    if (!d) continue;
    changed = true;
    if (d.action === 'target') {
      state.done[it.key] = { reason: 'target', at: now.toISOString(), completes: d.completes, target: d.target };
      continue;
    }
    const paused = await it.pause();
    state.done[it.key] = { reason: 'paused', at: now.toISOString(), completes: d.completes, target: d.target };
    if (!paused) continue;
    const text = `Paused ${it.name} at the ${checkpoint} (${d.completes} of ${d.target} completes)`;
    actions.push(text);
    await prisma.auditEvent.create({
      data: { organizationId: p.organizationId, actorId: null, action: a.scope === 'market' ? 'autopilot.pause_market' : 'autopilot.pause_link', entityType: 'Project', entityId: p.id, detail: { key: it.key, text } },
    });
  }

  // Every market or link has had its checkpoint (or is full): the autopilot switches it off.
  const switchedOff = items.length > 0 && items.every((it) => state.done[it.key]);
  if (switchedOff) state.switchedOffAt = now.toISOString();
  if (!changed && !switchedOff) return none;
  const autopilotState = { ...((p.autopilotState ?? {}) as Record<string, unknown>), autoPause: state } as unknown as Prisma.InputJsonValue;
  await prisma.project.update({
    where: { id: p.id },
    data: {
      autopilotState,
      ...(switchedOff ? { autopilot: { ...ap, autoPause: { ...a, enabled: false } } as unknown as Prisma.InputJsonValue } : {}),
    },
  });
  if (switchedOff) {
    await prisma.auditEvent.create({
      data: { organizationId: p.organizationId, actorId: null, action: 'autopilot.auto_pause_off', entityType: 'Project', entityId: p.id, detail: { text: 'Auto-pause switched off: every market or link has been paused once or reached its target' } },
    });
  }
  return { actions, switchedOff };
}
