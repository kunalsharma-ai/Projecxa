'use client';
import { Wand2 } from 'lucide-react';
import { useState } from 'react';

export interface FillField { key: string; label: string; type?: 'number' | 'text' | 'url'; step?: string; width?: string; placeholder?: string; list?: string }

/**
 * "Apply to all": type a value once and put it into every selected row (or every row when none are
 * selected). Only the fields that were filled in are applied.
 */
export function BulkFill({ fields, selected, total, onApply, extra }: { fields: FillField[]; selected: number; total: number; onApply: (values: Record<string, string>) => void | Promise<void>; extra?: React.ReactNode }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const filled = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''));
  const n = selected || total;
  return (
    <div className="mb-3 rounded-lg border border-dashed border-brand/40 bg-brand/5 p-3" role="group" aria-label="Apply to all">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <Wand2 className="h-3.5 w-3.5 text-brand" aria-hidden />
        <span className="font-semibold">Apply to {selected ? `${selected} selected` : `all ${total}`}</span>
        <span className="text-muted">Fill in only what should change, then apply. Tick rows to change just those.</span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-0.5 block text-[11px] font-medium text-muted">{f.label}</span>
            <input
              className={`input px-2 py-1 text-sm ${f.width ?? 'w-24'}`}
              type={f.type === 'number' ? 'number' : 'text'}
              step={f.step}
              list={f.list}
              placeholder={f.placeholder}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              aria-label={`${f.label} for ${selected ? 'selected' : 'all'} rows`}
            />
          </label>
        ))}
        {extra}
        <button
          type="button"
          className="btn-primary px-3 py-1.5 text-xs"
          disabled={busy || !Object.keys(filled).length || !n}
          onClick={async () => {
            setBusy(true);
            try {
              await onApply(filled);
              setValues({});
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Applying…' : `Apply to ${n} ${n === 1 ? 'row' : 'rows'}`}
        </button>
      </div>
    </div>
  );
}
