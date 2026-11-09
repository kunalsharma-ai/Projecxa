/**
 * Totals of respondent sessions grouped by their own columns, for the reports that PostgreSQL
 * answered with one SQL join: the database groups the sessions, and the few related rows (country
 * currency, invoice or bill status, vendor) are looked up here. The groups are bounded by the number
 * of countries, allocations, invoices and bills, never by the number of sessions.
 */
import type { Prisma } from '@prisma/client';
import type { PrismaService } from './prisma.service';

type Key = 'approval' | 'invoiceId' | 'vendorBillId' | 'vendorAllocationId' | 'projectCountryId' | 'projectId' | 'status' | 'organizationId';

export interface SessionGroup {
  approval?: string;
  invoiceId?: string | null;
  vendorBillId?: string | null;
  vendorAllocationId?: string | null;
  projectCountryId?: string | null;
  projectId?: string;
  status?: string;
  organizationId?: string;
  n: number;
  revenue: number;
  payout: number;
}

type Db = Pick<PrismaService, 'respondentSession' | 'projectCountry'>;

export async function sessionGroups(db: Db, where: Prisma.RespondentSessionWhereInput, by: Key[]): Promise<SessionGroup[]> {
  const rows = (await db.respondentSession.groupBy({
    by,
    where,
    _count: { _all: true },
    _sum: { revenue: true, payout: true },
  } as never)) as unknown as (Record<string, unknown> & { _count: { _all: number }; _sum: { revenue: number | null; payout: number | null } })[];
  return rows.map(({ _count, _sum, ...keys }) => ({ ...(keys as object), n: _count._all, revenue: Number(_sum.revenue ?? 0), payout: Number(_sum.payout ?? 0) }));
}

/** Currency of each project country. */
export async function currencyOf(db: Db, countryIds: (string | null | undefined)[]): Promise<Map<string, string>> {
  const ids = [...new Set(countryIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const rows = await db.projectCountry.findMany({ where: { id: { in: ids } }, select: { id: true, currency: true } });
  return new Map(rows.map((r) => [r.id, r.currency]));
}
