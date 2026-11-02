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
  /** The same money converted into the reporting currency with the manual rates. */
  reporting: { currency: string; revenue: number; payout: number; profit: number; margin: number | null; missing: string[] };
}
/** Reporting currency and the manual rates behind converted figures. */
export interface FxInfo { currency: string; rates: { currency: string; rate: number }[]; updatedAt: string | null }
/** How money is shown: converted into the reporting currency, or per market currency. */
export type MoneyMode = 'reporting' | 'market';
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

/**
 * Market mode: one "CUR 0.00" entry per currency, never mixed. Reporting mode: one converted
 * amount, marked with * when a currency without a rate was left out.
 */
export function moneyLines(r: Pick<SummaryRow, 'money' | 'reporting'>, k: MoneyKey, mode: MoneyMode = 'market'): string[] {
  if (mode === 'reporting' && r.reporting) return [`${r.reporting.currency} ${amount(r.reporting[k])}${r.reporting.missing.length ? ' *' : ''}`];
  return r.money.length ? r.money.map((m) => `${m.currency} ${amount(m[k])}`) : ['0.00'];
}

/** Margin for the chosen mode: converted margins work across currencies; market margins only for one. */
export const marginFor = (r: Pick<SummaryRow, 'margin' | 'reporting'>, mode: MoneyMode) => (mode === 'reporting' ? (r.reporting?.margin ?? null) : r.margin);
