export interface Filters {
  from: string;
  to: string;
  clientId: string;
  vendorId: string;
  projectId: string;
  countryCode: string;
}
export interface SummaryRow {
  key: string; label: string; sublabel: string | null;
  clicks: number; completes: number; terminates: number; quotaFull: number; qualityFail: number; partial: number; inProgress: number;
  approved: number; pending: number; rejected: number;
  revenue: number; payout: number; profit: number; margin: number | null; conversion: number; medianLoiMinutes: number | null;
  currencies: string[];
  money: { currency: string; revenue: number; payout: number; profit: number }[];
}
export interface Options {
  clients: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  projects: { id: string; projectCode: string; name: string; clientId: string }[];
  countries: string[];
}

/** Query string for the filter bar values that are set. */
export function filterQuery(f: Filters, extra: Record<string, string | number | undefined> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== '' && v != null) q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
}

export type MoneyKey = 'revenue' | 'payout' | 'profit';
const amount = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One "CUR 0.00" entry per currency; sums are never mixed across currencies. */
export function moneyLines(r: Pick<SummaryRow, 'money'>, k: MoneyKey): string[] {
  return r.money.length ? r.money.map((m) => `${m.currency} ${amount(m[k])}`) : ['0.00'];
}
