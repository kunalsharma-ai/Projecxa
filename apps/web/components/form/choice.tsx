'use client';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { KeyboardEvent, ReactNode, useRef } from 'react';
import { useFieldIds } from './field';

export interface Choice { value: string; label: string; description?: string; icon?: ReactNode; disabled?: boolean }

/** Arrow keys move between radio items and select them (WAI-ARIA radio group). */
function arrowNav(e: KeyboardEvent<HTMLElement>, items: Choice[], value: string | null, set: (v: string) => void, root: HTMLElement | null) {
  const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(e.key in keys)) return;
  e.preventDefault();
  const enabled = items.filter((i) => !i.disabled);
  const at = Math.max(0, enabled.findIndex((i) => i.value === value));
  const next = enabled[(at + keys[e.key] + enabled.length) % enabled.length];
  set(next.value);
  root?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus();
}

/** Large selectable cards (one choice), with an optional icon and description. */
export function RadioCards({ items, value, onChange, columns = 3 }: { items: Choice[]; value: string | null; onChange: (v: string) => void; columns?: 2 | 3 | 4 }) {
  const f = useFieldIds();
  const root = useRef<HTMLDivElement>(null);
  const focusable = value && items.some((i) => i.value === value) ? value : items.find((i) => !i.disabled)?.value;
  return (
    <div ref={root} role="radiogroup" aria-labelledby={undefined} aria-describedby={f.describedBy} id={f.id}
      className={clsx('grid gap-2', columns === 2 ? 'sm:grid-cols-2' : columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3')}
      onKeyDown={(e) => arrowNav(e, items, value, onChange, root.current)}>
      {items.map((i) => {
        const on = i.value === value;
        return (
          <button key={i.value} type="button" role="radio" aria-checked={on} data-value={i.value} disabled={i.disabled} tabIndex={i.value === focusable ? 0 : -1} onClick={() => onChange(i.value)}
            className={clsx('relative flex items-start gap-3 rounded-lg border p-3 text-left transition-[border-color,box-shadow,background-color] duration-[var(--dur)]',
              on ? 'border-brand bg-brand/5 shadow-[0_0_0_1px_rgb(var(--brand))]' : 'border-line bg-panel hover:border-muted/60', i.disabled && 'cursor-not-allowed opacity-50')}>
            {i.icon && <span className={clsx('mt-0.5 shrink-0', on ? 'text-brand' : 'text-muted')}>{i.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{i.label}</span>
              {i.description && <span className="mt-0.5 block text-xs text-muted">{i.description}</span>}
            </span>
            <span className={clsx('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border', on ? 'border-brand bg-brand text-brand-ink' : 'border-line')} aria-hidden>
              {on && <span className="h-1.5 w-1.5 rounded-full bg-brand-ink" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Several checkboxes, with "Select all" when there are many. */
export function CheckboxGroup({ items, value, onChange, columns = 2, selectAll }: { items: Choice[]; value: string[]; onChange: (v: string[]) => void; columns?: 1 | 2 | 3; selectAll?: boolean }) {
  const f = useFieldIds();
  const enabled = items.filter((i) => !i.disabled).map((i) => i.value);
  const all = enabled.every((v) => value.includes(v));
  return (
    <div role="group" id={f.id} aria-describedby={f.describedBy}>
      {selectAll && items.length > 3 && (
        <button type="button" className="mb-1.5 text-xs font-medium text-brand hover:underline" onClick={() => onChange(all ? value.filter((v) => !enabled.includes(v)) : [...new Set([...value, ...enabled])])}>{all ? 'Clear all' : 'Select all'}</button>
      )}
      <div className={clsx('grid gap-1.5', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-3')}>
        {items.map((i) => {
          const on = value.includes(i.value);
          return (
            <label key={i.value} className={clsx('flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-sunken/70', i.disabled && 'cursor-not-allowed opacity-50')}>
              <input type="checkbox" className="peer sr-only" checked={on} disabled={i.disabled} onChange={() => onChange(on ? value.filter((v) => v !== i.value) : [...value, i.value])} />
              <span className={clsx('mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-1', on ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-panel')} aria-hidden>
                {on && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0 text-sm">{i.label}{i.description && <span className="block text-xs text-muted">{i.description}</span>}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/** Segmented control: a compact one-of-few choice. */
export function Segmented({ items, value, onChange, size = 'md', full }: { items: Choice[]; value: string; onChange: (v: string) => void; size?: 'sm' | 'md'; full?: boolean }) {
  const f = useFieldIds();
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} role="radiogroup" id={f.id} aria-describedby={f.describedBy} className={clsx('inline-flex max-w-full rounded-lg border border-line bg-sunken/60 p-0.5', full && 'flex w-full')}
      onKeyDown={(e) => arrowNav(e, items, value, onChange, root.current)}>
      {items.map((i) => {
        const on = i.value === value;
        return (
          <button key={i.value} type="button" role="radio" aria-checked={on} data-value={i.value} tabIndex={on ? 0 : -1} disabled={i.disabled} onClick={() => onChange(i.value)}
            className={clsx('inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md font-medium transition-[background-color,color,box-shadow] duration-[var(--dur)]', full && 'flex-1',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm', on ? 'bg-panel text-ink shadow-sm' : 'text-muted hover:text-ink')}>
            {i.icon}<span className="truncate">{i.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** On/off switch with its label on the same row. */
export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const f = useFieldIds();
  return (
    <label className={clsx('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-60')}>
      <button type="button" role="switch" id={f.id} aria-checked={checked} aria-describedby={f.describedBy} disabled={disabled} onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--dur)]', checked ? 'bg-brand' : 'bg-line')}>
        <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] duration-[var(--dur)]', checked ? 'left-[1.125rem]' : 'left-0.5')} />
      </button>
      <span className="min-w-0 text-sm">{label}{description && <span className="block text-xs text-muted">{description}</span>}</span>
    </label>
  );
}
