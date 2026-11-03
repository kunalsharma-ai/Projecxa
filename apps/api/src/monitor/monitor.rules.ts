/**
 * Fieldwork autopilot: pacing and alert rules. Pure functions, so every rule is unit-testable;
 * the monitor service feeds them live metrics and stores what they return.
 */
import { z } from 'zod';

export const alertSettingsSchema = z
  .object({
    /** A live market with no entries for this many hours is stalled. */
    stalledHours: z.number().int().min(1).max(168).default(24),
    /** Alert when the actual incidence is this many percent below the planned IR. */
    irDropPct: z.number().int().min(5).max(90).default(30),
    /** Median LOI below this share of the planned LOI suggests speeders. */
    loiShortPct: z.number().int().min(10).max(90).default(40),
    /** Median LOI above this share of the planned LOI. */
    loiLongPct: z.number().int().min(110).max(400).default(150),
    /** Share of a vendor's last-24h entries rejected for quality, duplicates or security. */
    qualityPct: z.number().int().min(5).max(90).default(25),
    /** Share of a vendor's last-24h entries that dropped out. */
    dropOffPct: z.number().int().min(5).max(90).default(30),
    /** Warn when a market reaches this share of its target. */
    quotaNearPct: z.number().int().min(50).max(99).default(90),
    /** Rates need at least this many respondents before a rule fires. */
    minSample: z.number().int().min(5).max(500).default(20),
  })
  .strict();
export type AlertSettings = z.infer<typeof alertSettingsSchema>;
export const DEFAULT_ALERT_SETTINGS: AlertSettings = alertSettingsSchema.parse({});
export const settingsOf = (json: unknown): AlertSettings => {
  const r = alertSettingsSchema.safeParse(json ?? {});
  return r.success ? r.data : DEFAULT_ALERT_SETTINGS;
};

export const autopilotSchema = z
  .object({
    /** Pause a vendor link when its quality rejects pass the threshold. */
    pauseOnQuality: z.boolean().default(false),
    /** Close a vendor link once it has delivered its target. */
    closeOnTarget: z.boolean().default(false),
  })
  .strict();
export type Autopilot = z.infer<typeof autopilotSchema>;
export const autopilotOf = (json: unknown): Autopilot => {
  const r = autopilotSchema.safeParse(json ?? {});
  return r.success ? r.data : { pauseOnQuality: false, closeOnTarget: false };
};

export const RULES = ['stalled', 'behind_pace', 'low_ir', 'loi_short', 'loi_long', 'quality_spike', 'drop_off', 'quota_near', 'target_reached', 'cell_full', 'callbacks_failed'] as const;
export type Rule = (typeof RULES)[number];
export type Severity = 'info' | 'warn' | 'bad';

/** Raw counts for a market or a vendor link. */
export interface Metrics {
  target: number;
  completes: number;
  terminates: number;
  entries24h: number;
  quality24h: number;
  dropped24h: number;
  /** Completes with an outcome in the last 72 hours. */
  completes72h: number;
  firstEntryAt: Date | null;
  lastEntryAt: Date | null;
  medianLoiMinutes: number | null;
}

export type PaceStatus = 'done' | 'on_track' | 'slightly_behind' | 'behind' | 'overdue' | 'stalled' | 'not_started' | 'no_deadline';
export interface Pace {
  status: PaceStatus;
  /** Completes per day, from the last 72 hours (or since the first entry if younger). */
  perDay: number;
  /** Completes per day needed to reach the target by the field end date. */
  requiredPerDay: number | null;
  remaining: number;
  /** Days to the target at the current rate; null when nothing is coming in. */
  etaDays: number | null;
  daysLeft: number | null;
}

const DAY = 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function pace(m: Metrics, fieldEndAt: Date | null, now: Date, stalledHours: number): Pace {
  const remaining = Math.max(0, m.target - m.completes);
  const ageDays = m.firstEntryAt ? Math.max(1 / 24, (now.getTime() - m.firstEntryAt.getTime()) / DAY) : 0;
  const perDay = m.firstEntryAt ? r1(m.completes72h / Math.min(3, ageDays)) : 0;
  const daysLeft = fieldEndAt ? r1((fieldEndAt.getTime() - now.getTime()) / DAY) : null;
  const requiredPerDay = daysLeft != null && daysLeft > 0 ? r1(remaining / daysLeft) : null;
  const etaDays = remaining === 0 ? 0 : perDay > 0 ? r1(remaining / perDay) : null;
  let status: PaceStatus;
  if (remaining === 0) status = 'done';
  else if (!m.lastEntryAt) status = 'not_started';
  else if (now.getTime() - m.lastEntryAt.getTime() > stalledHours * 3_600_000) status = 'stalled';
  else if (daysLeft != null && daysLeft <= 0) status = 'overdue';
  else if (requiredPerDay == null) status = 'no_deadline';
  else if (perDay >= requiredPerDay) status = 'on_track';
  else if (perDay >= requiredPerDay * 0.8) status = 'slightly_behind';
  else status = 'behind';
  return { status, perDay, requiredPerDay, remaining, etaDays, daysLeft };
}

export interface Candidate {
  dedupeKey: string;
  rule: Rule;
  severity: Severity;
  title: string;
  detail: string;
  metrics?: Record<string, unknown>;
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/** Market rules: pacing, incidence, LOI and quota. `label` is e.g. "PRX10001 US". */
export function marketRules(key: string, label: string, m: Metrics, p: Pace, plan: { irPercent: number; loiMinutes: number }, s: AlertSettings, live: boolean, now: Date): Candidate[] {
  const out: Candidate[] = [];
  if (live && p.status === 'stalled') {
    const hours = m.lastEntryAt ? Math.round((now.getTime() - m.lastEntryAt.getTime()) / 3_600_000) : null;
    out.push({ dedupeKey: `${key}:stalled`, rule: 'stalled', severity: 'warn', title: `${label} has had no entries for ${hours}h`, detail: `${m.completes} of ${m.target} completes. Check the vendor links or add sample.`, metrics: { hours } });
  }
  if (live && (p.status === 'behind' || p.status === 'overdue')) {
    out.push({
      dedupeKey: `${key}:behind_pace`,
      rule: 'behind_pace',
      severity: p.status === 'overdue' ? 'bad' : 'warn',
      title: p.status === 'overdue' ? `${label} is past its field end date with ${p.remaining} completes to go` : `${label} is behind pace`,
      detail: p.status === 'overdue' ? 'Extend the field dates or add sample.' : `${p.perDay} completes a day against ${p.requiredPerDay} needed to finish on time.`,
      metrics: { ...p },
    });
  }
  const decided = m.completes + m.terminates;
  if (decided >= s.minSample) {
    const ir = pct(m.completes, decided);
    if (ir < plan.irPercent * (1 - s.irDropPct / 100)) {
      out.push({ dedupeKey: `${key}:low_ir`, rule: 'low_ir', severity: 'warn', title: `${label} incidence is ${ir}% (planned ${plan.irPercent}%)`, detail: 'Costs per complete will rise. Review targeting or the CPI with the client.', metrics: { ir, planned: plan.irPercent, decided } });
    }
  }
  if (m.medianLoiMinutes != null && m.completes >= Math.max(10, Math.round(s.minSample / 2))) {
    const loi = r1(m.medianLoiMinutes);
    if (loi < (plan.loiMinutes * s.loiShortPct) / 100) {
      out.push({ dedupeKey: `${key}:loi_short`, rule: 'loi_short', severity: 'bad', title: `${label} median LOI is ${loi} min (planned ${plan.loiMinutes})`, detail: 'Very fast completes often mean speeders. Check data quality before approving.', metrics: { loi, planned: plan.loiMinutes } });
    } else if (loi > (plan.loiMinutes * s.loiLongPct) / 100) {
      out.push({ dedupeKey: `${key}:loi_long`, rule: 'loi_long', severity: 'warn', title: `${label} median LOI is ${loi} min (planned ${plan.loiMinutes})`, detail: 'Long interviews raise drop-out and may need a higher incentive.', metrics: { loi, planned: plan.loiMinutes } });
    }
  }
  if (m.target > 0) {
    const share = pct(m.completes, m.target);
    if (m.completes >= m.target) out.push({ dedupeKey: `${key}:target_reached`, rule: 'target_reached', severity: 'info', title: `${label} reached its target`, detail: `${m.completes} of ${m.target} completes. New entries are sent to quota full.`, metrics: { share } });
    else if (share >= s.quotaNearPct) out.push({ dedupeKey: `${key}:quota_near`, rule: 'quota_near', severity: 'info', title: `${label} is at ${Math.floor(share)}% of target`, detail: `${p.remaining} completes to go. Plan to close the market or raise the quota.`, metrics: { share } });
  }
  return out;
}

/** Vendor link rules: quality rejects and drop-outs in the last 24 hours. */
export function allocationRules(key: string, label: string, m: Metrics, s: AlertSettings): Candidate[] {
  const out: Candidate[] = [];
  if (m.entries24h >= s.minSample) {
    const q = pct(m.quality24h, m.entries24h);
    if (q >= s.qualityPct) out.push({ dedupeKey: `${key}:quality_spike`, rule: 'quality_spike', severity: 'bad', title: `${label}: ${q}% of entries rejected for quality in 24h`, detail: `${m.quality24h} of ${m.entries24h} entries failed security, duplicate or quality checks.`, metrics: { share: q, entries: m.entries24h } });
    const d = pct(m.dropped24h, m.entries24h);
    if (d >= s.dropOffPct) out.push({ dedupeKey: `${key}:drop_off`, rule: 'drop_off', severity: 'warn', title: `${label}: ${d}% drop-out in 24h`, detail: 'Check the survey on the devices this vendor sends, or the LOI it was promised.', metrics: { share: d, entries: m.entries24h } });
  }
  return out;
}
