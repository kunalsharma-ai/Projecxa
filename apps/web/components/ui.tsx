'use client';
import clsx from 'clsx';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { ReactNode } from 'react';
import { STATUS_LABEL } from '@/lib/types';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, children, actions, className, id }: { title: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={clsx('card relative scroll-mt-20 focus-within:z-20', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {actions}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

const PROJECT_TONE: Record<string, string> = {
  LIVE: 'bg-ok/15 text-ok',
  TEST: 'bg-info/15 text-info',
  HOLD: 'bg-warn/15 text-warn',
  CLOSED: 'bg-bad/15 text-bad',
  DRAFT: 'bg-sunken text-muted',
  INVOICED: 'bg-brand/15 text-brand',
  ACTIVE: 'bg-ok/15 text-ok',
  PAUSED: 'bg-warn/15 text-warn',
  INACTIVE: 'bg-sunken text-muted',
  ARCHIVED: 'bg-sunken text-muted',
  SCHEDULED: 'bg-info/15 text-info',
};
export function StatusChip({ status }: { status: string }) {
  return <span className={clsx('chip', PROJECT_TONE[status] ?? 'bg-sunken text-muted')}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>;
}

const OUTCOME_TONE: Record<string, string> = {
  COMPLETE: 'bg-ok/15 text-ok',
  STARTED: 'bg-info/15 text-info',
  TERMINATE: 'bg-sunken text-muted',
  QUOTA_FULL: 'bg-warn/15 text-warn',
  PARTIAL: 'bg-warn/15 text-warn',
  QUALITY_FAIL: 'bg-bad/15 text-bad',
  DUPLICATE: 'bg-bad/15 text-bad',
  SECURITY_REJECT: 'bg-bad/15 text-bad',
  TECHNICAL_ERROR: 'bg-bad/15 text-bad',
};
export function OutcomeChip({ status }: { status: string }) {
  return <span className={clsx('chip', OUTCOME_TONE[status] ?? 'bg-sunken text-muted')}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="min-w-[96px]">
      <div className="mb-1 text-xs tabular-nums text-muted">
        <span className="font-medium text-ink">{value}</span> / {max}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <div
          className={clsx('h-full rounded-full transition-[width] duration-[var(--dur-slow)] ease-[var(--ease)]', pct >= 100 ? 'bg-ok' : 'bg-gradient-to-r from-brand to-accent2')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; issues?: string[] };
  return (
    <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" /> {e.message ?? 'Something went wrong'}
      </div>
      {!!e.issues?.length && (
        <ul className="ml-6 mt-1 list-disc">
          {e.issues.map((i, n) => (
            <li key={n}>{i}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Skeleton placeholder in the shape of a page; the label is announced to screen readers. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="space-y-3 p-2" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <div className="flex items-center gap-2 text-sm text-muted" aria-hidden>
        <Loader2 className="h-4 w-4 animate-spin" /> {label}…
      </div>
      <div className="skeleton h-4 w-1/3" aria-hidden />
      <div className="skeleton h-24 w-full" aria-hidden />
      <div className="skeleton h-4 w-2/3" aria-hidden />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">{children}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line')}
    >
      <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

export function money(v: number | string | null | undefined, currency?: string) {
  const n = Number(v ?? 0);
  return `${currency ? currency + ' ' : ''}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
