'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { patch, post } from '@/lib/api';
import { applyPreferences, cachedPreferences, DEFAULTS, resolve, type Preferences } from '@/lib/theme';

interface ThemeCtx {
  prefs: Preferences;
  /** Apply now, save to the user profile shortly after (debounced). */
  update: (p: Partial<Preferences>) => void;
  reset: () => Promise<void>;
  /** Load the signed-in user's saved preferences. */
  hydrate: (server: Partial<Preferences> | undefined) => void;
  /** Readability corrections the engine made to user-picked colours. */
  adjusted: string[];
  saving: boolean;
}

const Ctx = createContext<ThemeCtx | null>(null);
export const useTheme = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('ThemeProvider missing');
  return c;
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const signedIn = useRef(false);
  const pending = useRef<Partial<Preferences>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start from the cached copy (the boot script has already painted it).
  useEffect(() => {
    const c = cachedPreferences();
    if (c) setPrefs(c);
  }, []);

  useEffect(() => {
    applyPreferences(prefs);
    if (prefs.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyPreferences(prefs);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [prefs]);

  const flush = useCallback(async () => {
    const body = pending.current;
    pending.current = {};
    if (!signedIn.current || Object.keys(body).length === 0) return;
    setSaving(true);
    try {
      await patch('/auth/me/preferences', body);
    } catch {
      // Keep the local change; the next update retries with the full set of changed keys.
      pending.current = { ...body, ...pending.current };
    } finally {
      setSaving(false);
    }
  }, []);

  const update = useCallback(
    (p: Partial<Preferences>) => {
      setPrefs((cur) => ({ ...cur, ...p }));
      pending.current = { ...pending.current, ...p };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [flush],
  );

  const hydrate = useCallback((server: Partial<Preferences> | undefined) => {
    signedIn.current = true;
    setPrefs({ ...DEFAULTS, ...(server ?? {}) });
  }, []);

  const reset = useCallback(async () => {
    pending.current = {};
    if (timer.current) clearTimeout(timer.current);
    setPrefs({ ...DEFAULTS });
    if (signedIn.current) await post('/auth/me/preferences/reset');
  }, []);

  const adjusted = useMemo(() => {
    const dark = typeof window !== 'undefined' && (prefs.mode === 'dark' || (prefs.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
    return resolve(prefs, dark).adjusted;
  }, [prefs]);

  return <Ctx.Provider value={{ prefs, update, reset, hydrate, adjusted, saving }}>{children}</Ctx.Provider>;
}
