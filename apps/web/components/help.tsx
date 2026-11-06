'use client';
import clsx from 'clsx';
import { Info, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { ReactNode, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { findHelp, helpForField, helpForPage, helpForSection, type HelpEntry } from '@/lib/help';

/**
 * The small "i" icon next to pages, sections, tabs and fields (docs/HELP_ICONS.md).
 *
 * All the words live in lib/help.ts. Pass `id` for an exact entry, or `entry` directly. When no
 * entry is found nothing is rendered, so it is safe to drop next to anything.
 *
 * The card opens on click or Enter/Space (not on hover, so it works the same on phones), closes on
 * Escape, an outside click or the close button, and is drawn in a portal so cards and tables with
 * overflow never clip it.
 */
export function InfoTip({ id, entry, label, className, size = 'sm' }: { id?: string; entry?: HelpEntry | null; label?: string; className?: string; size?: 'sm' | 'md' }) {
  const help = entry ?? (id ? findHelp(id) : null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const cardId = useId();

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const width = Math.min(320, window.innerWidth - 24);
    const h = card.current?.offsetHeight ?? 220;
    const left = Math.max(12, Math.min(b.left + b.width / 2 - width / 2, window.innerWidth - width - 12));
    const above = b.bottom + 8 + h > window.innerHeight && b.top - 8 - h > 0;
    setPos({ top: above ? b.top - 8 - h : b.bottom + 8, left, above });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!card.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  if (!help) return null;
  const name = label ?? help.title;
  return (
    <>
      <button
        ref={btn}
        type="button"
        data-help
        aria-label={name ? `About ${name}` : 'About this'}
        aria-expanded={open}
        aria-controls={open ? cardId : undefined}
        onClick={(e) => {
          // Inside a <label> or a clickable row the icon must not also focus the input or toggle the row.
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={clsx(
          'inline-grid shrink-0 place-items-center rounded-full align-middle text-muted transition-colors duration-[var(--dur)] hover:bg-brand/10 hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
          size === 'md' ? 'h-6 w-6' : 'h-[18px] w-[18px]',
          open && 'bg-brand/10 text-brand',
          className,
        )}
      >
        <Info className={size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} aria-hidden />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={card}
          id={cardId}
          role="dialog"
          aria-label={name ? `About ${name}` : 'About this'}
          onClick={(e) => e.stopPropagation()}
          className="anim-pop fixed z-[200] rounded-xl border border-line bg-panel p-4 text-left text-sm font-normal normal-case tracking-normal text-ink shadow-xl"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: 'min(320px, calc(100vw - 24px))', visibility: pos ? 'visible' : 'hidden' }}
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 font-semibold"><Info className="h-4 w-4 shrink-0 text-brand" aria-hidden />{name ?? 'About this'}</div>
            <button type="button" aria-label="Close" onClick={() => { setOpen(false); btn.current?.focus(); }} className="-mr-1 -mt-1 grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <dl className="space-y-2">
            <HelpLine term="What it is for" text={help.what} />
            {help.how && <HelpLine term="How to use it" text={help.how} />}
            {help.where && <HelpLine term="Where it applies" text={help.where} />}
          </dl>
        </div>,
        document.body,
      )}
    </>
  );
}

function HelpLine({ term, text }: { term: string; text: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{term}</dt>
      <dd className="mt-0.5 leading-snug">{text}</dd>
    </div>
  );
}

/** Icon for the current page, found from the URL. */
export function PageHelp({ id }: { id?: string }) {
  const path = usePathname();
  const entry = id ? findHelp(id) : helpForPage(path ?? '/');
  return <InfoTip entry={entry} size="md" />;
}

/** Icon for a section title: an explicit id wins, otherwise a plain-text title is looked up. */
export function SectionHelp({ id, title }: { id?: string; title: ReactNode }) {
  const path = usePathname();
  const entry = id ? findHelp(id) : typeof title === 'string' ? helpForSection(title, path ?? '/') : null;
  return <InfoTip entry={entry} label={typeof title === 'string' ? title : undefined} />;
}

/** Icon for a field label. */
export function FieldHelp({ id, label }: { id?: string; label?: ReactNode }) {
  const path = usePathname();
  const entry = id ? findHelp(id) : typeof label === 'string' ? helpForField(label, path ?? '/') : null;
  return <InfoTip entry={entry} label={typeof label === 'string' ? label.replace(/\s*\*$/, '') : undefined} />;
}

/** Drop-in for `<span className="label">…</span>` that adds the field's icon when there is one. */
export function Label({ children, help, className }: { children: ReactNode; help?: string; className?: string }) {
  return (
    <span className={clsx('label', className)}>
      <span className="inline-flex items-center gap-1">{children}<FieldHelp id={help} label={typeof children === 'string' ? children : undefined} /></span>
    </span>
  );
}
