'use client';
import clsx from 'clsx';
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import Link from 'next/link';
import { useTheme } from '@/components/theme';
import { THEMES, type Mode } from '@/lib/theme';
import { Popover } from './popover';

export const MODES: { id: Mode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
];

/** Quick theme and mode switch in the top bar; the full controls live in the Theme Studio. */
export function ThemeMenu({ showStudio = true }: { showStudio?: boolean }) {
  const { prefs, update } = useTheme();
  return (
    <Popover
      label="Theme"
      trigger={<Palette className="h-[18px] w-[18px]" />}
      width="w-72"
    >
      {(close) => (
        <div className="p-3">
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-sunken p-1" role="radiogroup" aria-label="Colour mode">
            {MODES.map((m) => (
              <button key={m.id} role="radio" aria-checked={prefs.mode === m.id} onClick={() => update({ mode: m.id })}
                className={clsx('flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs transition-colors duration-[var(--dur)]', prefs.mode === m.id ? 'bg-panel font-medium text-ink shadow-sm' : 'text-muted hover:text-ink')}>
                <m.icon className="h-3.5 w-3.5" /> {m.label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => {
              const pal = prefs.mode === 'dark' ? t.dark : t.light;
              const on = prefs.theme === t.id;
              return (
                <button key={t.id} role="radio" aria-checked={on} title={`${t.name}: ${t.mood}`} aria-label={t.name} onClick={() => update({ theme: t.id })}
                  className={clsx('relative h-11 overflow-hidden rounded-lg border transition-transform duration-[var(--dur)] hover:scale-105', on ? 'border-ink ring-2 ring-brand/40' : 'border-line')}
                  style={{ background: `linear-gradient(135deg, ${pal.sidebar} 0 40%, ${pal.brand} 40% 70%, ${pal.accent2} 70%)` }}>
                  {on && <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />}
                </button>
              );
            })}
          </div>
          <p className="mt-2 truncate text-xs text-muted">{THEMES.find((t) => t.id === prefs.theme)?.name}</p>
          {showStudio && <Link href="/settings/appearance" onClick={close} className="btn-ghost mt-3 w-full py-1.5 text-xs">Open Theme Studio</Link>}
        </div>
      )}
    </Popover>
  );
}
