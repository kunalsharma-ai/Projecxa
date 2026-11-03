'use client';
import clsx from 'clsx';
import { HelpCircle } from 'lucide-react';
import { createContext, ReactNode, useContext, useEffect, useId, useRef, useState } from 'react';

/** Ids a control needs to tie itself to its label, help text and error (set by FormField). */
export interface FieldIds { id: string; describedBy?: string; invalid: boolean }
const FieldCtx = createContext<FieldIds | null>(null);
/** Inside a FormField: the ids to put on the control. Outside one: a fresh id. */
export function useFieldIds(): FieldIds {
  const own = useId();
  return useContext(FieldCtx) ?? { id: own, invalid: false };
}
/** Props to spread on a native input/select/textarea. */
export const fieldProps = (f: FieldIds) => ({ id: f.id, 'aria-describedby': f.describedBy, 'aria-invalid': f.invalid || undefined });

/**
 * A labelled field: persistent label (or floating label for short text inputs), optional help tip,
 * hint and error. The error is announced and tied to the control with aria-describedby.
 */
export function FormField({ label, hint, error, help, required, optional, floating, className, children, id: forcedId }: {
  label: ReactNode; hint?: ReactNode; error?: string | null; help?: ReactNode; required?: boolean; optional?: boolean; floating?: boolean; className?: string; children: ReactNode; id?: string;
}) {
  const auto = useId();
  const id = forcedId ?? auto;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const ids: FieldIds = { id, describedBy: [errId, hintId].filter(Boolean).join(' ') || undefined, invalid: !!error };
  return (
    <div className={clsx('min-w-0', floating && 'float-field', className)} data-invalid={error ? '' : undefined}>
      {!floating && (
        <div className="mb-1 flex items-center gap-1">
          <label htmlFor={id} className="text-xs font-medium text-muted">
            {label}
            {required && <span className="ml-0.5 text-bad" aria-hidden>*</span>}
            {optional && <span className="ml-1 font-normal opacity-70">(optional)</span>}
          </label>
          {help && <HelpTip label={typeof label === 'string' ? label : 'Help'}>{help}</HelpTip>}
        </div>
      )}
      <FieldCtx.Provider value={ids}>
        {floating ? (
          <div className="relative">
            {children}
            <label htmlFor={id} className="float-label">{label}{required && <span className="ml-0.5 text-bad" aria-hidden>*</span>}</label>
          </div>
        ) : children}
      </FieldCtx.Provider>
      {error && <p id={errId} className="anim-pop mt-1 text-xs text-bad" role="alert">{error}</p>}
      {hint && <p id={hintId} className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Small "?" button with a tooltip. Opens on hover, focus or tap; Escape closes. */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', down);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', down); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="grid h-4 w-4 place-items-center rounded-full text-muted hover:text-ink" aria-label={`About ${label}`} aria-describedby={open ? id : undefined} onClick={() => setOpen((o) => !o)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span id={id} role="tooltip" className="anim-pop absolute bottom-full left-1/2 z-50 mb-1.5 w-60 -translate-x-1/2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs font-normal normal-case leading-snug text-ink shadow-lg">
          {children}
        </span>
      )}
    </span>
  );
}
