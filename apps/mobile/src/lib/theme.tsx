import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { KEYS, storage } from './storage';

/**
 * The two looks from Kunal's mockups: "Neon" (deep indigo with glowing violet, magenta and cyan,
 * the Neon Project Management Suite) and "Aurora" (bright lavender glass, the Research Command Centre).
 */
export interface Palette {
  name: 'neon' | 'aurora';
  dark: boolean;
  /** Background gradient, top to bottom. */
  bg: [string, string, string];
  glow: [string, string];
  card: string;
  cardStrong: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  /** Primary action gradient. */
  accent: [string, string];
  accentText: string;
  primary: string;
  cyan: string;
  magenta: string;
  good: string;
  warn: string;
  bad: string;
  info: string;
  tabBar: string;
  input: string;
  /** Chart series, in order. */
  series: string[];
}

export const NEON: Palette = {
  name: 'neon',
  dark: true,
  bg: ['#0B0820', '#140E3A', '#1D1150'],
  glow: ['rgba(124,58,237,0.45)', 'rgba(34,211,238,0.25)'],
  card: 'rgba(255,255,255,0.06)',
  cardStrong: 'rgba(255,255,255,0.10)',
  border: 'rgba(167,139,250,0.28)',
  text: '#F5F3FF',
  muted: '#B9B3E6',
  faint: '#7C76B0',
  accent: ['#7C3AED', '#DB2777'],
  accentText: '#FFFFFF',
  primary: '#A78BFA',
  cyan: '#22D3EE',
  magenta: '#F472B6',
  good: '#34D399',
  warn: '#FBBF24',
  bad: '#F87171',
  info: '#60A5FA',
  tabBar: 'rgba(16,10,44,0.96)',
  input: 'rgba(255,255,255,0.08)',
  series: ['#A78BFA', '#22D3EE', '#F472B6', '#34D399', '#FBBF24', '#60A5FA'],
};

export const AURORA: Palette = {
  name: 'aurora',
  dark: false,
  bg: ['#F4F1FF', '#ECE8FF', '#E3F2FF'],
  glow: ['rgba(167,139,250,0.35)', 'rgba(56,189,248,0.25)'],
  card: 'rgba(255,255,255,0.78)',
  cardStrong: '#FFFFFF',
  border: 'rgba(124,58,237,0.16)',
  text: '#1E1B4B',
  muted: '#5B5890',
  faint: '#9491C0',
  accent: ['#6D28D9', '#C026D3'],
  accentText: '#FFFFFF',
  primary: '#6D28D9',
  cyan: '#0891B2',
  magenta: '#C026D3',
  good: '#059669',
  warn: '#D97706',
  bad: '#DC2626',
  info: '#2563EB',
  tabBar: 'rgba(255,255,255,0.97)',
  input: 'rgba(109,40,217,0.06)',
  series: ['#7C3AED', '#0EA5E9', '#DB2777', '#10B981', '#F59E0B', '#3B82F6'],
};

export type ThemeChoice = 'system' | 'neon' | 'aurora';

const Ctx = createContext<{ c: Palette; choice: ThemeChoice; setChoice: (t: ThemeChoice) => void }>({ c: NEON, choice: 'system', setChoice: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [choice, setChoiceState] = useState<ThemeChoice>('system');
  useEffect(() => {
    storage.get(KEYS.theme).then((t) => t && ['system', 'neon', 'aurora'].includes(t) && setChoiceState(t as ThemeChoice));
  }, []);
  const value = useMemo(() => {
    const c = choice === 'neon' ? NEON : choice === 'aurora' ? AURORA : scheme === 'light' ? AURORA : NEON;
    return {
      c,
      choice,
      setChoice: (t: ThemeChoice) => {
        setChoiceState(t);
        storage.set(KEYS.theme, t);
      },
    };
  }, [choice, scheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 };
export const space = (n: number) => n * 4;
