'use client';
import clsx from 'clsx';
import { useState } from 'react';
import { patch } from '@/lib/api';

/**
 * One-click Active / Inactive for a client or vendor. Inactive ones stay in reports and old
 * projects but cannot be chosen for new projects or allocations.
 */
export function StatusSwitch({ kind, id, name, status, editable, onChange, onError }: { kind: 'client' | 'vendor'; id: string; name: string; status: string; editable: boolean; onChange: (s: string) => void; onError?: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const active = status === 'ACTIVE';
  async function flip() {
    setBusy(true);
    try {
      const next = active ? 'INACTIVE' : 'ACTIVE';
      await patch(`/${kind}s/${id}/status`, { status: next });
      onChange(next);
    } catch (e) {
      onError?.(e);
    } finally {
      setBusy(false);
    }
  }
  const label = active ? 'Active' : 'Inactive';
  if (!editable) return <span className={clsx('chip', active ? 'bg-ok/15 text-ok' : 'bg-sunken text-muted')}>{label}</span>;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={`${name}: ${label}. Click to make ${active ? 'inactive' : 'active'}`}
      title={active ? 'Active: can be chosen for new projects. Click to make inactive.' : 'Inactive: hidden on Create project. Click to make active.'}
      disabled={busy}
      onClick={flip}
      className={clsx('inline-flex items-center gap-2 rounded-full border px-1 py-0.5 pr-2.5 text-xs font-medium transition-colors', active ? 'border-ok/40 bg-ok/10 text-ok' : 'border-line bg-sunken text-muted', busy && 'opacity-60')}
    >
      <span className={clsx('relative h-4 w-7 rounded-full transition-colors', active ? 'bg-ok' : 'bg-line')}>
        <span className={clsx('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all', active ? 'left-3.5' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}
