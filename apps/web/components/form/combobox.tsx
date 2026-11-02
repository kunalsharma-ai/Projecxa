'use client';
import clsx from 'clsx';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { COUNTRIES, flag } from '@/lib/countries';
import { useFieldIds } from './field';

export interface Option { value: string; label: string; hint?: string; icon?: ReactNode; group?: string; keywords?: string }

type Common = {
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  /** Called (debounced) as the person types, for options that come from the server (auto-complete). */
  onSearch?: (q: string) => Promise<Option[]>;
  /** Lets the person add what they typed when nothing matches. */
  creatable?: boolean;
  emptyText?: string;
  className?: string;
};
type Single = Common & { multiple?: false; value: string | null; onChange: (v: string | null) => void; clearable?: boolean; max?: never };
type Multi = Common & { multiple: true; value: string[]; onChange: (v: string[]) => void; clearable?: never; max?: number };

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export const matches = (o: Option, q: string) => !q || norm(`${o.label} ${o.value} ${o.hint ?? ''} ${o.keywords ?? ''}`).includes(norm(q));

/**
 * Searchable select (single) or multi-select with chips. ARIA 1.2 combobox: type to filter,
 * ↑/↓ to move, Enter to pick, Escape to close, Backspace on an empty search removes the last chip.
 */
export function Combobox(props: Single | Multi) {
  const { options, placeholder, disabled, onSearch, creatable, emptyText = 'No matches', className } = props;
  const f = useFieldIds();
  const listId = `${f.id}-list`;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<Option[] | null>(null);
  const [loading, setLoading] = useState(false);
  const known = useRef(new Map<string, Option>());
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  for (const o of [...options, ...(remote ?? [])]) known.current.set(o.value, o);
  const selected = props.multiple ? props.value : props.value ? [props.value] : [];
  const labelOf = (v: string) => known.current.get(v)?.label ?? v;

  useEffect(() => {
    if (!onSearch || !open) return;
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      onSearch(q).then((r) => live && setRemote(r)).catch(() => live && setRemote([])).finally(() => live && setLoading(false));
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, open, onSearch]);

  const shown = useMemo(() => {
    const base = onSearch && remote ? remote : options.filter((o) => matches(o, q));
    const out = [...base];
    if (creatable && q.trim() && !out.some((o) => norm(o.label) === norm(q.trim()) || norm(o.value) === norm(q.trim()))) out.push({ value: q.trim(), label: `Add “${q.trim()}”`, keywords: '__create' });
    return out;
  }, [options, remote, q, onSearch, creatable]);

  useEffect(() => { setActive(0); }, [q, open]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  useEffect(() => { list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);

  function pick(o: Option) {
    const value = o.value;
    if (o.keywords === '__create') known.current.set(value, { value, label: value });
    if (props.multiple) {
      const has = props.value.includes(value);
      if (!has && props.max && props.value.length >= props.max) return;
      props.onChange(has ? props.value.filter((v) => v !== value) : [...props.value, value]);
      setQ('');
      input.current?.focus();
    } else {
      props.onChange(value);
      setQ('');
      setOpen(false);
    }
  }
  function key(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Home' && open) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && open) { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === 'Enter') { if (open && shown[active]) { e.preventDefault(); pick(shown[active]); } }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQ(''); } }
    else if (e.key === 'Backspace' && !q && props.multiple && props.value.length) props.onChange(props.value.slice(0, -1));
    else if (e.key === 'Tab') setOpen(false);
  }

  const singleLabel = !props.multiple && props.value ? known.current.get(props.value) : null;
  const atMax = props.multiple && props.max ? props.value.length >= props.max : false;
  let lastGroup: string | undefined;
  return (
    <div ref={box} className={clsx('relative', className)}>
      <div
        className={clsx('input flex min-h-[2.375rem] cursor-text flex-wrap items-center gap-1 pr-8', disabled && 'cursor-not-allowed opacity-60', open && 'border-brand shadow-[0_0_0_3px_rgb(var(--brand)/0.2)]', f.invalid && 'border-bad')}
        onMouseDown={(e) => { if (disabled) return; if (e.target === e.currentTarget) e.preventDefault(); input.current?.focus(); setOpen(true); }}
      >
        {props.multiple && props.value.map((v) => (
          <span key={v} className="chip max-w-full bg-brand/10 text-brand">
            {known.current.get(v)?.icon}<span className="truncate">{labelOf(v)}</span>
            {!disabled && <button type="button" className="-mr-0.5 rounded-full hover:bg-brand/20" aria-label={`Remove ${labelOf(v)}`} onClick={(e) => { e.stopPropagation(); props.onChange(props.value.filter((x) => x !== v)); }}><X className="h-3 w-3" /></button>}
          </span>
        ))}
        {singleLabel?.icon && !q && <span className="shrink-0">{singleLabel.icon}</span>}
        <input
          ref={input}
          id={f.id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
          aria-describedby={f.describedBy}
          aria-invalid={f.invalid || undefined}
          disabled={disabled}
          className="min-w-[4rem] flex-1 border-0 bg-transparent p-0 text-sm text-ink outline-none placeholder:text-muted focus:ring-0 focus-visible:outline-none"
          placeholder={props.multiple ? (props.value.length ? '' : placeholder) : singleLabel ? singleLabel.label : placeholder}
          value={!props.multiple && !open && singleLabel ? singleLabel.label : q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={key}
          autoComplete="off"
        />
      </div>
      <span className="pointer-events-none absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1 text-muted">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronDown className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} />}
      </span>
      {!props.multiple && props.clearable && props.value && !disabled && (
        <button type="button" className="absolute right-7 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink" aria-label="Clear" onClick={() => props.onChange(null)}><X className="h-3.5 w-3.5" /></button>
      )}
      {open && !disabled && (
        <ul ref={list} id={listId} role="listbox" aria-multiselectable={props.multiple || undefined} className="anim-pop absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-lg border border-line bg-panel p-1 shadow-xl">
          {atMax && <li className="px-2.5 py-1.5 text-xs text-muted">You can choose up to {props.max}.</li>}
          {shown.length === 0 && <li className="px-2.5 py-2 text-sm text-muted">{loading ? 'Searching…' : emptyText}</li>}
          {shown.map((o, i) => {
            const head = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            const isSel = selected.includes(o.value);
            return (
              <li key={`${o.value}-${i}`} role="presentation">
                {head && <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{head}</div>}
                <div
                  id={`${listId}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={isSel}
                  className={clsx('flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm', i === active ? 'bg-sunken text-ink' : 'text-ink/90')}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                >
                  {o.icon && <span className="shrink-0">{o.icon}</span>}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="shrink-0 text-xs text-muted">{o.hint}</span>}
                  {isSel && <Check className="h-4 w-4 shrink-0 text-brand" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export const COUNTRY_OPTIONS: Option[] = COUNTRIES.map((c) => ({ value: c.code, label: c.name, hint: c.code, icon: <span aria-hidden>{flag(c.code)}</span>, keywords: c.currency }));

/** Country picker with flags (one or several). */
export function CountrySelect(p: Omit<Single, 'options'> | Omit<Multi, 'options'>) {
  return <Combobox {...(p as Single)} options={COUNTRY_OPTIONS} placeholder={p.placeholder ?? (p.multiple ? 'Add markets…' : 'Choose a country…')} />;
}

const CURRENCY_NAMES: Record<string, string> = {
  USD: 'US dollar', EUR: 'Euro', GBP: 'British pound', INR: 'Indian rupee', CAD: 'Canadian dollar', AUD: 'Australian dollar', JPY: 'Japanese yen', CNY: 'Chinese yuan',
  CHF: 'Swiss franc', SEK: 'Swedish krona', NOK: 'Norwegian krone', DKK: 'Danish krone', PLN: 'Polish złoty', SGD: 'Singapore dollar', AED: 'UAE dirham', SAR: 'Saudi riyal',
  ZAR: 'South African rand', BRL: 'Brazilian real', MXN: 'Mexican peso', KRW: 'South Korean won', NZD: 'New Zealand dollar', TRY: 'Turkish lira', MYR: 'Malaysian ringgit',
  IDR: 'Indonesian rupiah', PHP: 'Philippine peso', THB: 'Thai baht', VND: 'Vietnamese dong', ARS: 'Argentine peso', CLP: 'Chilean peso', COP: 'Colombian peso',
};
const COMMON = ['USD', 'EUR', 'GBP', 'INR'];
export const CURRENCY_OPTIONS: Option[] = [...COMMON, ...Object.keys(CURRENCY_NAMES).filter((c) => !COMMON.includes(c)).sort()].map((c) => {
  let symbol = '';
  try { symbol = new Intl.NumberFormat('en', { style: 'currency', currency: c, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? ''; } catch { /* unknown */ }
  return { value: c, label: `${c} · ${CURRENCY_NAMES[c]}`, hint: symbol !== c ? symbol : undefined, group: COMMON.includes(c) ? 'Common' : 'All currencies', keywords: COUNTRIES.filter((x) => x.currency === c).map((x) => x.name).join(' ') };
});

/** Currency picker: common ones first, searchable by code, name or country. */
export function CurrencySelect(p: Omit<Single, 'options'>) {
  return <Combobox {...p} options={CURRENCY_OPTIONS} placeholder={p.placeholder ?? 'Choose a currency…'} />;
}
