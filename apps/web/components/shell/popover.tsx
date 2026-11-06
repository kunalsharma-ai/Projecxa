'use client';
import clsx from 'clsx';
import { useEffect, useId, useRef, useState } from 'react';

/** Small accessible popover: button toggles, Escape or an outside click closes, focus returns to the button. */
export function Popover({ label, trigger, children, width = 'w-64', badge, wide, onOpenChange }: {
  label: string; trigger: React.ReactNode; children: (close: () => void) => React.ReactNode; width?: string; badge?: number;
  /** Called when the menu opens or closes (the bell marks notifications read on open). */
  onOpenChange?: (open: boolean) => void;
  /** The trigger holds more than an icon (e.g. the account chip). */
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    onOpenChange?.(open);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button ref={btn} type="button" aria-label={badge ? `${label}, ${badge} new` : label} title={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className={clsx('relative grid h-9 place-items-center rounded-lg text-muted', wide ? 'px-1' : 'w-9', ' transition-colors duration-[var(--dur)] hover:bg-sunken hover:text-ink', open && 'bg-sunken text-ink')}>
        {trigger}
        {!!badge && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-semibold text-panel">{badge > 9 ? '9+' : badge}</span>}
      </button>
      {open && (
        <div id={id} className={clsx('glass anim-pop absolute right-0 top-11 z-50 border border-line shadow-xl', width)} style={{ borderRadius: 'var(--radius)' }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
