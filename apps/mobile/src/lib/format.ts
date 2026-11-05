/** Number and date formatting shared by the screens. */

export const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function compact(v: unknown) {
  const n = num(v);
  const a = Math.abs(n);
  if (a >= 1e7) return `${(n / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function money(v: unknown, currency?: string | null) {
  const n = num(v);
  try {
    return currency ? new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n) : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  } catch {
    return `${currency ?? ''} ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`.trim();
  }
}

export const pct = (part: unknown, whole: unknown) => (num(whole) ? Math.round((num(part) / num(whole)) * 100) : 0);

export function trendLabel(t: number | null | undefined) {
  if (t === null || t === undefined) return null;
  return `${t > 0 ? '+' : ''}${t}%`;
}

export function day(v: string | Date | null | undefined) {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ago(v: string | Date | null | undefined, now = Date.now()) {
  if (!v) return '';
  const t = (typeof v === 'string' ? Date.parse(v) : v.getTime());
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** "PROJECT_MANAGER" → "Project manager". */
export const label = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, ' ') : '');

/** Sum of { currency, amount } amounts shown as "₹1,200 + $300". */
export function amounts(list: { currency: string; amount: number }[] | undefined, max = 2) {
  if (!list?.length) return money(0);
  const shown = list.slice(0, max).map((a) => money(a.amount, a.currency)).join(' + ');
  return list.length > max ? `${shown} + ${list.length - max} more` : shown;
}
