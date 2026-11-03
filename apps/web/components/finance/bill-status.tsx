'use client';
import clsx from 'clsx';

const amt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function BillStatus({ status, overdue }: { status: string; overdue?: boolean }) {
  const cls = overdue ? 'bg-bad/15 text-bad' : status === 'PAID' ? 'bg-ok/15 text-ok' : status === 'APPROVED' ? 'bg-info/15 text-info' : status === 'VOID' ? 'bg-sunken text-muted line-through' : 'bg-warn/15 text-warn';
  return <span className={clsx('chip', cls)}>{overdue ? 'Overdue' : status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}

export interface Base { currency: string; amount: number; missing: string[] }

/** "USD 1,234.00" in the reporting currency, with a note when a currency has no rate. */
export function BaseAmount({ base, byCurrency }: { base: Base; byCurrency?: { currency: string; amount: number }[] }) {
  const title = byCurrency?.map((m) => `${m.currency} ${amt.format(m.amount)}`).join(' · ');
  return (
    <span title={title}>
      {base.currency} {amt.format(base.amount)}
      {base.missing.length > 0 && <span className="ml-1 text-xs font-normal text-warn">+ {base.missing.join(', ')} without a rate</span>}
    </span>
  );
}
