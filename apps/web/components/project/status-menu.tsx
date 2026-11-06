'use client';
import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MENU_STATUSES, PROJECT_STATUS_STYLE } from '@/lib/project-status';

/** Statuses that need a second click, because they stop fieldwork or clear the project back to set-up. */
const CONFIRM: Record<string, string> = {
  CLOSED: 'Close the project? Every entry link shows the closed page.',
  DRAFT: 'Move the project back to draft? No links work in draft.',
  INVOICED: 'Mark the project as invoiced? Do this after the client invoice is sent.',
};

/**
 * The project's status as one colourful button in the header. It opens a menu of every status
 * (Draft, Test, Live, Hold, Closed, Invoiced), each in its own colour with a one-line hint.
 */
export function StatusMenu({ status, editable, onChange }: { status: string; editable: boolean; onChange: (s: string) => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const cur = PROJECT_STATUS_STYLE[status] ?? PROJECT_STATUS_STYLE.DRAFT;

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && (setOpen(false), setConfirm(null));
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setConfirm(null);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  async function pick(s: string) {
    if (s === status) return setOpen(false);
    if (CONFIRM[s] && confirm !== s) return setConfirm(s);
    setBusy(true);
    try {
      await onChange(s);
    } finally {
      setBusy(false);
      setOpen(false);
      setConfirm(null);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={btn}
        type="button"
        disabled={!editable || busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Project status: ${cur.label}. Change status`}
        onClick={() => setOpen((o) => !o)}
        className={clsx('inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-sm transition-[filter] hover:brightness-110 disabled:cursor-default disabled:hover:brightness-100', cur.solid)}
      >
        <span className="h-2 w-2 rounded-full bg-white/90" aria-hidden />
        {busy ? 'Saving…' : cur.label}
        {editable && <ChevronDown className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />}
      </button>
      {open && (
        <div role="menu" aria-label="Change project status" className="anim-pop absolute right-0 top-12 z-50 w-72 overflow-hidden rounded-xl border border-line bg-panel p-1.5 shadow-xl">
          {MENU_STATUSES.map((s) => {
            const st = PROJECT_STATUS_STYLE[s];
            const asking = confirm === s;
            return (
              <button
                key={s}
                role="menuitemradio"
                aria-checked={s === status}
                type="button"
                onClick={() => pick(s)}
                className={clsx('flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors', asking ? st.solid : s === status ? st.chip : 'hover:bg-sunken')}
              >
                <span className={clsx('mt-1 h-3 w-3 shrink-0 rounded-full ring-2 ring-white/60', asking ? 'bg-white' : st.dot)} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={clsx('block text-sm font-semibold', !asking && s !== status && 'text-ink')}>{asking ? `Click again: ${st.label}` : st.label}</span>
                  <span className={clsx('block text-xs', asking ? 'text-white/90' : 'text-muted')}>{asking ? CONFIRM[s] : st.hint}</span>
                </span>
                {s === status && <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
