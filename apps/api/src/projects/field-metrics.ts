/**
 * Live fieldwork metrics (docs/FIELD_METRICS.md): actual LOI and IR from the respondent sessions,
 * and the speeder check that turns too-fast completes into quality fails.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

/** Fractions people pick for the speeder check; any n/d with 1 ≤ n < d ≤ 10 is accepted. */
export const SPEEDER_PRESETS = ['1/4', '1/3', '2/4', '2/3', '3/4'] as const;
export const SPEEDER_DETAIL = 'SPEEDER';

export const speederCheckSchema = z
  .object({
    enabled: z.boolean(),
    fraction: z
      .string()
      .regex(/^\d{1,2}\/\d{1,2}$/, 'Use a fraction such as 1/3')
      .refine((f) => {
        const [n, d] = f.split('/').map(Number);
        return n >= 1 && d <= 10 && n < d;
      }, 'Pick a fraction below 1, such as 1/3 or 3/4 (denominator 10 or less)'),
  })
  .strict();
export type SpeederCheck = z.infer<typeof speederCheckSchema>;
export const DEFAULT_SPEEDER: SpeederCheck = { enabled: false, fraction: '1/3' };

export function speederOf(json: unknown): SpeederCheck {
  const r = speederCheckSchema.safeParse(json ?? {});
  return r.success ? r.data : DEFAULT_SPEEDER;
}

export function fractionValue(f: string): number {
  const [n, d] = f.split('/').map(Number);
  return d ? n / d : 0;
}

/** Minimum minutes a complete must take, or null when the check is off. */
export function speederThresholdMinutes(check: SpeederCheck, plannedLoiMinutes: number): number | null {
  if (!check.enabled || plannedLoiMinutes <= 0) return null;
  return Math.round(plannedLoiMinutes * fractionValue(check.fraction) * 100) / 100;
}

/**
 * True when a complete was faster than the threshold. The clock starts when the survey link was
 * released (after the gate page when there is one), so time spent on our own checks never counts.
 */
export function isSpeeder(check: SpeederCheck, plannedLoiMinutes: number, surveyStartedAt: Date, completedAt: Date): boolean {
  const min = speederThresholdMinutes(check, plannedLoiMinutes);
  if (min == null) return false;
  return (completedAt.getTime() - surveyStartedAt.getTime()) / 60_000 < min;
}

export interface FieldMetrics {
  /** Mean minutes from survey start to complete; null before the first complete. */
  avgLoiMinutes: number | null;
  /** Completes ÷ (completes + terminates), in percent; null before anyone qualified or screened out. */
  irPercent: number | null;
  completes: number;
  terminates: number;
  speeders: number;
}

export const emptyFieldMetrics = (): FieldMetrics => ({ avgLoiMinutes: null, irPercent: null, completes: 0, terminates: 0, speeders: 0 });

/** Survey start for LOI: when the gate released the link, or entry when there was no gate. */
export const SURVEY_START_SQL = Prisma.sql`COALESCE(s."gatePassedAt", s."startedAt")`;

/**
 * Live (non-test) metrics per project, or per market when `by` is "country". One query for any
 * number of projects, so the project list can show them for a whole page.
 */
export async function fieldMetrics(prisma: PrismaClient | Prisma.TransactionClient, projectIds: string[], by: 'project' | 'country' = 'project'): Promise<Map<string, FieldMetrics>> {
  const out = new Map<string, FieldMetrics>();
  if (!projectIds.length) return out;
  const col = by === 'project' ? Prisma.sql`s."projectId"` : Prisma.sql`s."projectCountryId"`;
  const rows = await (prisma as PrismaClient).$queryRaw<{ key: string; completes: number; terminates: number; speeders: number; loiSeconds: number | null }[]>`
    SELECT ${col} AS key,
      COUNT(*) FILTER (WHERE s.status = 'COMPLETE')::int AS completes,
      COUNT(*) FILTER (WHERE s.status = 'TERMINATE')::int AS terminates,
      COUNT(*) FILTER (WHERE s.status = 'QUALITY_FAIL' AND s."statusDetail" = ${SPEEDER_DETAIL})::int AS speeders,
      (AVG(EXTRACT(EPOCH FROM (s."outcomeAt" - ${SURVEY_START_SQL})))
        FILTER (WHERE s.status = 'COMPLETE' AND s."outcomeAt" IS NOT NULL))::float8 AS "loiSeconds"
    FROM "RespondentSession" s
    WHERE s."projectId" IN (${Prisma.join(projectIds)}) AND s."isTest" = false
    GROUP BY 1`;
  for (const r of rows) out.set(r.key, toMetrics(r));
  return out;
}

export function toMetrics(r: { completes: number; terminates: number; speeders: number; loiSeconds: number | null }): FieldMetrics {
  const completes = Number(r.completes);
  const terminates = Number(r.terminates);
  return {
    avgLoiMinutes: r.loiSeconds == null ? null : Math.round((Number(r.loiSeconds) / 60) * 10) / 10,
    irPercent: completes + terminates > 0 ? Math.round((completes / (completes + terminates)) * 1000) / 10 : null,
    completes,
    terminates,
    speeders: Number(r.speeders),
  };
}
