'use client';
import clsx from 'clsx';
import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/** Puts text on the clipboard. Falls back to a hidden textarea where the Clipboard API is blocked (plain http, old browsers). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand('copy');
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Small copy icon: one click copies `text`, and the icon turns into a tick for a moment. */
export function CopyIcon({ text, label = 'value', className }: { text: string | null | undefined; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  if (!text) return null;
  return (
    <button
      type="button"
      className={clsx('relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md align-middle text-muted transition-colors hover:bg-sunken hover:text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand', className)}
      title={state === 'done' ? 'Copied' : state === 'failed' ? 'Could not copy' : `Copy ${label}`}
      aria-label={`Copy ${label}`}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setState((await copyText(text)) ? 'done' : 'failed');
        setTimeout(() => setState('idle'), 1500);
      }}
    >
      {state === 'done' ? <Check className="h-3.5 w-3.5 text-ok" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      <span className="sr-only" aria-live="polite">{state === 'done' ? 'Copied' : ''}</span>
    </button>
  );
}

/** A value with a copy icon after it. Shows `children` (or the text itself) and copies `text`. */
export function Copyable({ text, label, children, mono, className }: { text: string | null | undefined; label?: string; children?: ReactNode; mono?: boolean; className?: string }) {
  if (!text) return <>{children ?? null}</>;
  return (
    <span className={clsx('inline-flex min-w-0 max-w-full items-center gap-1', className)}>
      <span className={clsx('min-w-0 truncate', mono && 'font-mono')}>{children ?? text}</span>
      <CopyIcon text={text} label={label} />
    </span>
  );
}
