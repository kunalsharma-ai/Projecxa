'use client';
import clsx from 'clsx';
import { ArrowLeft, ArrowRight, Check, Compass, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { placeCard, tourStepsFor } from '@/lib/tour';

type Box = { top: number; left: number; width: number; height: number };
const PAD = 6;

/** Visible box of the step's target, or null when it is missing, hidden or off screen. */
function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(target)}"]`))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth) return el;
  }
  return null;
}
const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

/**
 * Guided tour over the real screen: a spotlight on each feature with a short card beside it.
 * Skip (or Esc) and Finish are remembered for the person; "Remind me later" only hides it for now.
 */
export function ProductTour({ role, appName, firstName, onFinish, onLater, onStep }: {
  role: string;
  appName: string;
  firstName: string;
  onFinish: (outcome: 'completed' | 'skipped') => void;
  onLater: () => void;
  /** Lets the shell open the mobile menu when a step points into the sidebar. */
  onStep?: (target: string | undefined) => void;
}) {
  const steps = useMemo(() => tourStepsFor(role), [role]);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardSize, setCardSize] = useState({ width: 360, height: 220 });
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const step = steps[i];
  const last = i === steps.length - 1;
  const fill = (s: string) => s.replace('{app}', appName);

  useEffect(() => onStep?.(step.target), [step.target, onStep]);

  // Follow the target while it moves (sidebar sliding in, scrolling, resizing).
  useEffect(() => {
    let raf = 0;
    let scrolled = false;
    const measure = () => {
      const el = findTarget(step.target);
      if (el && !scrolled) {
        scrolled = true;
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      const r = el?.getBoundingClientRect();
      const next = r ? { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 } : null;
      setBox((b) => (sameBox(b, next) ? b : next));
    };
    measure();
    const t = setInterval(measure, 150);
    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => { clearInterval(t); cancelAnimationFrame(raf); window.removeEventListener('resize', onMove); window.removeEventListener('scroll', onMove, true); };
  }, [step.target]);

  useLayoutEffect(() => {
    if (!card.current) return;
    const r = card.current.getBoundingClientRect();
    setCardSize((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
  }, [i, box]);

  useEffect(() => primary.current?.focus(), [i]);

  const next = useCallback(() => (last ? onFinish('completed') : setI((n) => n + 1)), [last, onFinish]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  // Keyboard: arrows move, Esc skips, Tab stays inside the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onFinish('skipped'); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.key === 'Tab' && card.current) {
        const f = Array.from(card.current.querySelectorAll<HTMLElement>('button'));
        const at = f.indexOf(document.activeElement as HTMLElement);
        if (at === -1 || (e.shiftKey && at === 0) || (!e.shiftKey && at === f.length - 1)) {
          e.preventDefault();
          (e.shiftKey ? f[f.length - 1] : f[0])?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, back, onFinish]);

  const welcome = i === 0;
  const view = typeof window === 'undefined' ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight };
  const pos = placeCard(box, cardSize, view);

  return (
    <div className="fixed inset-0 z-[60]" aria-live="polite">
      {/* Dim everything except the highlighted feature; clicks on the dim layer do nothing. */}
      {box ? (
        <div
          className="pointer-events-none fixed rounded-xl outline outline-2 outline-offset-0 outline-brand transition-all duration-[var(--dur-slow)] ease-[var(--ease)]"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)' }}
          aria-hidden
        />
      ) : (
        <div className="fixed inset-0 bg-black/55" aria-hidden />
      )}
      <div className="fixed inset-0" aria-hidden />

      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className={clsx('glass anim-pop fixed border', welcome ? 'w-[min(420px,calc(100vw-24px))]' : 'w-[min(360px,calc(100vw-24px))]', ' border-line p-5 shadow-2xl transition-[top,left] duration-[var(--dur-slow)] ease-[var(--ease)]')}
        style={{ top: pos.top, left: pos.left, borderRadius: 'var(--radius)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-brand">
            <Compass className="h-4 w-4" aria-hidden />
            {welcome ? 'Product tour' : `Step ${i} of ${steps.length - 1}`}
          </div>
          <button onClick={() => onFinish('skipped')} className="-m-1 grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-sunken hover:text-ink" aria-label="Skip tour" title="Skip tour (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>
        <h2 id="tour-title" className="mt-2 text-base font-semibold text-ink">
          {welcome && firstName ? `Hi ${firstName}, welcome to ${appName}` : fill(step.title)}
        </h2>
        <div id="tour-body">
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{fill(step.body)}</p>
          {step.points && (
            <ul className="mt-2.5 space-y-1 text-sm text-ink/90">
              {step.points.map((p) => (
                <li key={p} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />{p}</li>
              ))}
            </ul>
          )}
        </div>

        {!welcome && (
          <div className="mt-4 h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
            <div className="h-full rounded-full bg-brand transition-[width] duration-[var(--dur)]" style={{ width: `${(i / (steps.length - 1)) * 100}%` }} />
          </div>
        )}

        {welcome ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button ref={primary} onClick={next} className="btn-primary">Start tour <ArrowRight className="h-4 w-4" /></button>
            <button onClick={onLater} className="btn-ghost">Remind me later</button>
            <button onClick={() => onFinish('skipped')} className="ml-auto text-sm text-muted underline-offset-2 hover:text-ink hover:underline">Skip tour</button>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2">
            <button onClick={() => onFinish('skipped')} className={clsx('text-sm text-muted underline-offset-2 hover:text-ink hover:underline', last && 'invisible')}>Skip tour</button>
            <div className="ml-auto flex gap-2">
              <button onClick={back} className="btn-ghost px-3" aria-label="Previous step"><ArrowLeft className="h-4 w-4" /></button>
              <button ref={primary} onClick={next} className="btn-primary">
                {last ? <>Finish <Check className="h-4 w-4" /></> : <>Next <ArrowRight className="h-4 w-4" /></>}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
