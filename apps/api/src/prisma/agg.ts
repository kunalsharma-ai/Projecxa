/**
 * Helpers for aggregation pipelines through Prisma's `aggregateRaw` (the reports PostgreSQL
 * answered with SQL). Dates go in and come out as MongoDB extended JSON ({ $date }).
 */
import type { Prisma } from '@prisma/client';

/** A date for a pipeline stage. */
export const mdate = (d: Date) => ({ $date: d.toISOString() });

/** A date from a pipeline result (extended JSON), or null. */
export function dateOut(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'string') return new Date(v);
  const d = (v as { $date?: string | { $numberLong: string } }).$date;
  if (typeof d === 'string') return new Date(d);
  if (d && typeof d === 'object') return new Date(Number(d.$numberLong));
  return null;
}

/** A number from a pipeline result ($numberLong, $numberDouble or plain). */
export function numOut(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const o = v as { $numberLong?: string; $numberDouble?: string; $numberInt?: string; $numberDecimal?: string };
  return Number(o.$numberLong ?? o.$numberDouble ?? o.$numberInt ?? o.$numberDecimal ?? v);
}

type Aggregatable = { aggregateRaw(args: { pipeline?: Prisma.InputJsonValue[] }): PromiseLike<Prisma.JsonObject> };

/** Run a pipeline on a model's collection. */
export async function aggregate<T = Record<string, unknown>>(delegate: Aggregatable, pipeline: object[]): Promise<T[]> {
  return (await delegate.aggregateRaw({ pipeline: pipeline as Prisma.InputJsonValue[] })) as unknown as T[];
}

/** Count documents matching `cond` inside a $group: { $sum: { $cond: [cond, 1, 0] } }. */
export const countIf = (cond: object) => ({ $sum: { $cond: [cond, 1, 0] } });

/** Milliseconds between two date expressions, or null when either is missing. */
export const msBetween = (from: unknown, to: unknown) => ({
  $cond: [{ $and: [{ $ne: [{ $ifNull: [from, null] }, null] }, { $ne: [{ $ifNull: [to, null] }, null] }] }, { $subtract: [to, from] }, null],
});

/** Continuous percentile (PostgreSQL's percentile_cont): interpolates between the two nearest values. */
export function percentileCont(values: number[], p: number): number | null {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const at = (v.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return v[lo]! + (v[hi]! - v[lo]!) * (at - lo);
}
