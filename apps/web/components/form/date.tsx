'use client';
import clsx from 'clsx';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useFieldIds } from './field';

import { addDays, addMonths, fmt, isoDay, parseDay, readDay } from '@/lib/form-rules';

export { isoDay, parseDay, readDay };

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }));

/** Month grid. Arrow keys move a day/week, PageUp/PageDown a month, Home/End the week, Enter picks. */
export function Calendar({ value, onPick, range, min, max, initial }: {
  value?: string | null; onPick: (day: string) => void; range?: { from: string | null; to: string | null; hover?: string | null; onHover?: (d: string | null) => void }; min?: string; max?: string; initial?: string | null;
}) {
  const start = parseDay(initial ?? value ?? range?.from) ?? new Date();
  const [focus, setFocus] = useState<Date>(start);
  const [month, setMonth] = useState<Date>(new Date(start.getFullYear(), start.getMonth(), 1));
  const grid = useRef<HTMLDivElement>(null);
  const today = isoDay(new Date());
  useEffect(() => { grid.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus({ preventScroll: true }); }, [focus]);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7; // weeks start on Monday
    return Array.from({ length: 42 }, (_, i) => addDays(first, i - lead));
  }, [month]);
  const out = (d: string) => (min && d < min) || (max && d > max);
  const move = (d: Date) => { setFocus(d); if (d.getMonth() !== month.getMonth() || d.getFullYear() !== month.getFullYear()) setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); };
  function key(e: KeyboardEvent) {
    const k: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focus, -1), ArrowRight: () => addDays(focus, 1), ArrowUp: () => addDays(focus, -7), ArrowDown: () => addDays(focus, 7),
      PageUp: () => new Date(focus.getFullYear(), focus.getMonth() - 1, Math.min(focus.getDate(), 28)), PageDown: () => new Date(focus.getFullYear(), focus.getMonth() + 1, Math.min(focus.getDate(), 28)),
      Home: () => addDays(focus, -((focus.getDay() + 6) % 7)), End: () => addDays(focus, 6 - ((focus.getDay() + 6) % 7)),
    };
    if (k[e.key]) { e.preventDefault(); move(k[e.key]()); }
  }
  const lo = range ? [range.from, range.to ?? range.hover].filter(Boolean).sort()[0] : null;
  const hi = range ? [range.from, range.to ?? range.hover].filter(Boolean).sort()[1] ?? null : null;
  return (
    <div className="w-[17rem] select-none p-2" onKeyDown={key}>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="rounded-md p-1.5 hover:bg-sunken" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft className="h-4 w-4" /></button>
        <div className="text-sm font-semibold" aria-live="polite">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
        <button type="button" className="rounded-md p-1.5 hover:bg-sunken" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div ref={grid} role="grid" className="grid grid-cols-7 gap-y-0.5 text-center text-sm">
        {WEEKDAYS.slice(0).map((w, i) => <div key={i} role="columnheader" className="pb-1 text-[11px] font-medium text-muted">{w}</div>)}
        {days.map((d) => {
          const s = isoDay(d);
          const inMonth = d.getMonth() === month.getMonth();
          const sel = s === value || s === range?.from || s === range?.to;
          const between = lo && hi && s > lo && s < hi;
          const disabled = !!out(s);
          return (
            <button
              key={s}
              type="button"
              role="gridcell"
              tabIndex={s === isoDay(focus) ? 0 : -1}
              aria-selected={sel}
              aria-label={d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              aria-current={s === today ? 'date' : undefined}
              disabled={disabled}
              onClick={() => { setFocus(d); onPick(s); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!disabled) onPick(s); } }}
              onMouseEnter={() => range?.onHover?.(s)}
              className={clsx(
                'mx-auto grid h-8 w-8 place-items-center rounded-md tabular-nums transition-colors',
                !inMonth && 'text-muted/60',
                disabled && 'cursor-not-allowed opacity-30',
                between && 'rounded-none bg-brand/10',
                sel ? 'bg-brand font-semibold text-brand-ink' : !disabled && 'hover:bg-sunken',
                s === today && !sel && 'ring-1 ring-inset ring-brand/50',
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  return { open, setOpen, ref };
}

/** Text box that understands typed dates ("tomorrow", "+7", "30/11/2026"), with a calendar. */
export function DatePicker({ value, onChange, min, max, placeholder = 'Pick a date or type “+7”', disabled }: {
  value: string | null; onChange: (v: string | null) => void; min?: string; max?: string; placeholder?: string; disabled?: boolean;
}) {
  const f = useFieldIds();
  const { open, setOpen, ref } = usePopover();
  const [text, setText] = useState(fmt(value));
  const [bad, setBad] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(fmt(value)); setBad(false); }, [value]);
  const commit = () => {
    if (!text.trim()) { setBad(false); if (value) onChange(null); return; }
    const d = readDay(text);
    if (d && !((min && d < min) || (max && d > max))) { setBad(false); onChange(d); setText(fmt(d)); } else setBad(true);
  };
  return (
    <div ref={ref} className="relative" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); input.current?.focus(); } }}>
      <input
        ref={input}
        id={f.id}
        aria-describedby={f.describedBy}
        aria-invalid={f.invalid || bad || undefined}
        className={clsx('input pr-16', (f.invalid || bad) && 'border-bad')}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'ArrowDown' && e.altKey) setOpen(true); }}
      />
      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
        {value && !disabled && <button type="button" className="rounded p-1 text-muted hover:text-ink" aria-label="Clear date" onClick={() => onChange(null)}><X className="h-3.5 w-3.5" /></button>}
        <button type="button" disabled={disabled} className="rounded p-1 text-muted hover:text-ink" aria-label="Open calendar" aria-expanded={open} onClick={() => setOpen(!open)}><CalendarDays className="h-4 w-4" /></button>
      </div>
      {bad && <p className="mt-1 text-xs text-bad" role="alert">That date was not understood{min || max ? ' or is out of range' : ''}.</p>}
      {open && (
        <div className="anim-pop absolute right-0 top-full z-50 mt-1 rounded-lg border border-line bg-panel shadow-xl" role="dialog" aria-label="Choose a date">
          <Calendar value={value} min={min} max={max} onPick={(d) => { onChange(d); setOpen(false); input.current?.focus(); }} />
        </div>
      )}
    </div>
  );
}

export type { DayRange } from '@/lib/form-rules';
import type { DayRange } from '@/lib/form-rules';
const PRESETS: [string, (t: Date) => DayRange][] = [
  ['Today', (t) => ({ from: isoDay(t), to: isoDay(t) })],
  ['Last 7 days', (t) => ({ from: isoDay(addDays(t, -6)), to: isoDay(t) })],
  ['Last 30 days', (t) => ({ from: isoDay(addDays(t, -29)), to: isoDay(t) })],
  ['This month', (t) => ({ from: isoDay(new Date(t.getFullYear(), t.getMonth(), 1)), to: isoDay(t) })],
  ['Last month', (t) => ({ from: isoDay(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: isoDay(new Date(t.getFullYear(), t.getMonth(), 0)) })],
  ['Next 30 days', (t) => ({ from: isoDay(t), to: isoDay(addDays(t, 29)) })],
];

/** Range picker: presets plus a calendar where the first click sets the start and the second the end. */
export function DateRangePicker({ value, onChange, presets = true, placeholder = 'Choose dates', disabled }: {
  value: DayRange; onChange: (v: DayRange) => void; presets?: boolean; placeholder?: string; disabled?: boolean;
}) {
  const f = useFieldIds();
  const { open, setOpen, ref } = usePopover();
  const [draft, setDraft] = useState<DayRange>(value);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);
  const label = value.from ? `${fmt(value.from)} – ${value.to ? fmt(value.to) : '…'}` : '';
  const days = value.from && value.to ? Math.round((parseDay(value.to)!.getTime() - parseDay(value.from)!.getTime()) / 86_400_000) + 1 : 0;
  function pick(d: string) {
    if (!draft.from || draft.to) setDraft({ from: d, to: null });
    else {
      const r = d < draft.from ? { from: d, to: draft.from } : { from: draft.from, to: d };
      setDraft(r);
      onChange(r);
      setOpen(false);
    }
  }
  return (
    <div ref={ref} className="relative" onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" id={f.id} aria-describedby={f.describedBy} aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)} className={clsx('input flex items-center gap-2 text-left', f.invalid && 'border-bad')}>
        <CalendarDays className="h-4 w-4 shrink-0 text-muted" />
        <span className={clsx('min-w-0 flex-1 truncate', !label && 'text-muted')}>{label || placeholder}</span>
        {days > 0 && <span className="shrink-0 text-xs text-muted">{days} {days === 1 ? 'day' : 'days'}</span>}
      </button>
      {open && (
        <div className="anim-pop absolute left-0 top-full z-50 mt-1 flex max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-line bg-panel shadow-xl sm:flex-row" role="dialog" aria-label="Choose a date range">
          {presets && (
            <div className="flex flex-wrap gap-1 border-b border-line p-2 sm:w-36 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
              {PRESETS.map(([name, fn]) => (
                <button key={name} type="button" className="rounded-md px-2 py-1 text-left text-xs hover:bg-sunken sm:text-sm" onClick={() => { const r = fn(new Date()); onChange(r); setOpen(false); }}>{name}</button>
              ))}
              {(value.from || value.to) && <button type="button" className="rounded-md px-2 py-1 text-left text-xs text-muted hover:bg-sunken sm:text-sm" onClick={() => { onChange({ from: null, to: null }); setOpen(false); }}>Clear</button>}
            </div>
          )}
          <div>
            <Calendar initial={draft.from} onPick={pick} range={{ from: draft.from, to: draft.to, hover: draft.from && !draft.to ? hover : null, onHover: setHover }} />
            <p className="px-3 pb-2 text-xs text-muted" aria-live="polite">{draft.from && !draft.to ? 'Now pick the end date.' : 'Pick the start date.'}</p>
          </div>
        </div>
      )}
    </div>
  );
}
