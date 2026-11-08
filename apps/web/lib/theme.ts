/**
 * SampTrek theme engine.
 *
 * A theme is a pair of palettes (light and dark). Personal preferences adjust it: accent
 * colours, surfaces, border and gradient intensity, glass, font size, density, radius,
 * motion and chart palette. Everything resolves to CSS variables on <html>, so every
 * screen restyles without code changes. Text colours are corrected for WCAG AA contrast
 * whenever a user-picked colour would fall below it.
 */

export const THEME_IDS = ['neon', 'midnight', 'arctic', 'emerald', 'obsidian', 'sapphire', 'aurora', 'graphite', 'solar'] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export type Mode = 'light' | 'dark' | 'system';

export interface Preferences {
  theme: ThemeId;
  mode: Mode;
  accent: string | null;
  accent2: string | null;
  background: string | null;
  card: string | null;
  sidebar: 'theme' | 'panel' | 'contrast';
  borderIntensity: number;
  gradientIntensity: number;
  glass: number;
  fontSize: 'sm' | 'md' | 'lg' | 'xl';
  density: 'compact' | 'comfortable' | 'spacious';
  radius: number;
  motion: 'essential' | 'refined' | 'cinematic';
  chartPalette: 'theme' | 'ocean' | 'vivid' | 'mono';
  sidebarCollapsed: boolean;
  insightsOpen: boolean;
  favorites: string[];
  /** Interface language (lib/i18n.ts); English when unset. */
  language: 'en' | 'hi' | 'es';
  recentProjects: { id: string; code: string; name: string }[];
}

export const DEFAULTS: Preferences = {
  theme: 'neon',
  mode: 'system',
  accent: null,
  accent2: null,
  background: null,
  card: null,
  sidebar: 'theme',
  borderIntensity: 50,
  gradientIntensity: 40,
  glass: 30,
  fontSize: 'md',
  density: 'comfortable',
  radius: 16,
  motion: 'refined',
  chartPalette: 'theme',
  sidebarCollapsed: false,
  insightsOpen: false,
  favorites: [],
  language: 'en',
  recentProjects: [],
};

interface Palette { bg: string; panel: string; sunken: string; ink: string; muted: string; brand: string; accent2: string; sidebar: string }
interface Theme { id: ThemeId; name: string; mood: string; light: Palette; dark: Palette }

export const THEMES: Theme[] = [
  {
    // The default look (2026-11 redesign): violet and electric blue on frosted glass, deep indigo navigation.
    id: 'neon', name: 'Neon Command', mood: 'Violet, electric blue and glass',
    light: { bg: '#f1f0fd', panel: '#ffffff', sunken: '#efedfc', ink: '#17133a', muted: '#5d5a80', brand: '#6c3cf0', accent2: '#2f6bff', sidebar: '#120d3d' },
    dark: { bg: '#080721', panel: '#13113a', sunken: '#1b1848', ink: '#ecebff', muted: '#a4a1cf', brand: '#a98bff', accent2: '#4da3ff', sidebar: '#07061c' },
  },
  {
    id: 'midnight', name: 'Midnight Intelligence', mood: 'Navy, violet and cyan',
    light: { bg: '#f4f5fb', panel: '#ffffff', sunken: '#eceef8', ink: '#141a33', muted: '#5b6385', brand: '#5b45e0', accent2: '#0e7490', sidebar: '#141a33' },
    dark: { bg: '#0a0f1f', panel: '#111833', sunken: '#182042', ink: '#e6e9f5', muted: '#9aa3c2', brand: '#9d90ff', accent2: '#22d3ee', sidebar: '#070b17' },
  },
  {
    id: 'arctic', name: 'Arctic Executive', mood: 'White, sapphire and slate',
    light: { bg: '#f5f7fb', panel: '#ffffff', sunken: '#eef1f7', ink: '#0f172a', muted: '#5b6678', brand: '#1d4ed8', accent2: '#475569', sidebar: '#ffffff' },
    dark: { bg: '#0b1120', panel: '#121a2c', sunken: '#1a2338', ink: '#e5e9f2', muted: '#95a0b5', brand: '#7aa5ff', accent2: '#94a3b8', sidebar: '#0b1120' },
  },
  {
    id: 'emerald', name: 'Emerald Matrix', mood: 'Deep emerald and teal',
    light: { bg: '#f3f8f6', panel: '#ffffff', sunken: '#e8f2ee', ink: '#0d1f1a', muted: '#4f6660', brand: '#047857', accent2: '#0f766e', sidebar: '#06372c' },
    dark: { bg: '#06140f', panel: '#0c1f19', sunken: '#122a22', ink: '#e0efe9', muted: '#8fb0a5', brand: '#34d399', accent2: '#2dd4bf', sidebar: '#041009' },
  },
  {
    id: 'obsidian', name: 'Obsidian Gold', mood: 'Graphite and champagne gold',
    light: { bg: '#f7f6f3', panel: '#ffffff', sunken: '#efede7', ink: '#1c1b18', muted: '#625e55', brand: '#7d5f17', accent2: '#3f3d38', sidebar: '#1f1e1b' },
    dark: { bg: '#0f0f10', panel: '#18181a', sunken: '#222225', ink: '#ece8df', muted: '#a39e92', brand: '#d9b766', accent2: '#8f8a7e', sidebar: '#0a0a0b' },
  },
  {
    id: 'sapphire', name: 'Royal Sapphire', mood: 'Blue and electric cyan',
    light: { bg: '#f2f6fd', panel: '#ffffff', sunken: '#e7eefb', ink: '#0b1733', muted: '#50608a', brand: '#1a4fd6', accent2: '#0e7490', sidebar: '#0b2a6b' },
    dark: { bg: '#050d24', panel: '#0b1735', sunken: '#11214a', ink: '#e3eaff', muted: '#93a3cc', brand: '#6f9bff', accent2: '#22d3ee', sidebar: '#040a1c' },
  },
  {
    id: 'aurora', name: 'Aurora Rose', mood: 'Plum, rose and lavender',
    light: { bg: '#faf6f9', panel: '#ffffff', sunken: '#f3eaf1', ink: '#2a1029', muted: '#6e5570', brand: '#b0285f', accent2: '#6d4fc0', sidebar: '#3b1238' },
    dark: { bg: '#150a17', panel: '#1f1222', sunken: '#2a1a2e', ink: '#f3e6f1', muted: '#b59ab3', brand: '#f472b6', accent2: '#c4b5fd', sidebar: '#0f0611' },
  },
  {
    id: 'graphite', name: 'Graphite Minimal', mood: 'Charcoal and monochrome',
    light: { bg: '#f5f5f5', panel: '#ffffff', sunken: '#ededed', ink: '#171717', muted: '#5c5c5c', brand: '#262626', accent2: '#737373', sidebar: '#fafafa' },
    dark: { bg: '#0d0d0d', panel: '#171717', sunken: '#212121', ink: '#ededed', muted: '#a3a3a3', brand: '#e5e5e5', accent2: '#a3a3a3', sidebar: '#0a0a0a' },
  },
  {
    id: 'solar', name: 'Solar Executive', mood: 'Warm ivory and amber',
    light: { bg: '#fbf8f1', panel: '#fffdf8', sunken: '#f4eedf', ink: '#2a2114', muted: '#6b5d45', brand: '#9a5700', accent2: '#b45309', sidebar: '#f6efdf' },
    dark: { bg: '#14100a', panel: '#1d1810', sunken: '#282115', ink: '#f3eadb', muted: '#b3a58c', brand: '#f5b544', accent2: '#fb923c', sidebar: '#0f0c07' },
  },
];

/** Status colours are reserved for state and shared by every theme. */
const STATUS = {
  light: { ok: '#15803d', warn: '#b45309', bad: '#b91c1c', info: '#0e7490' },
  dark: { ok: '#4ade80', warn: '#fbbf24', bad: '#f87171', info: '#22d3ee' },
};

const CHARTS: Record<Exclude<Preferences['chartPalette'], 'theme'>, { light: string[]; dark: string[] }> = {
  ocean: { light: ['#1d4ed8', '#0e7490', '#4338ca', '#0f766e'], dark: ['#60a5fa', '#22d3ee', '#a5b4fc', '#5eead4'] },
  vivid: { light: ['#6d28d9', '#c2410c', '#047857', '#be185d'], dark: ['#a78bfa', '#fb923c', '#34d399', '#f472b6'] },
  mono: { light: ['#334155', '#64748b', '#1e293b', '#94a3b8'], dark: ['#cbd5e1', '#94a3b8', '#e2e8f0', '#64748b'] },
};

// ─── colour maths ───
type RGB = [number, number, number];
export function hexToRgb(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c: RGB) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function luminance([r, g, b]: RGB) {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(a: string | RGB, b: string | RGB) {
  const la = luminance(typeof a === 'string' ? hexToRgb(a) : a);
  const lb = luminance(typeof b === 'string' ? hexToRgb(b) : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Moves `fg` toward black or white until it reaches `min` contrast on `bg`. */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  if (contrast(fg, bg) >= min) return fg;
  const target: RGB = luminance(hexToRgb(bg)) > 0.4 ? [0, 0, 0] : [255, 255, 255];
  const start = hexToRgb(fg);
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mix(start, target, t);
    if (contrast(c, bg) >= min) return toHex(c);
  }
  return toHex(target);
}
const onColor = (bg: string) => (contrast('#ffffff', bg) >= contrast('#0b0d12', bg) ? '#ffffff' : '#0b0d12');
const triplet = (h: string) => hexToRgb(h).join(' ');

export interface Resolved { vars: Record<string, string>; attrs: Record<string, string>; adjusted: string[] }

/** Resolves preferences into CSS variables for one mode. `adjusted` lists colours changed for readability. */
export function resolve(p: Preferences, dark: boolean): Resolved {
  const theme = THEMES.find((t) => t.id === p.theme) ?? THEMES[0];
  const base = dark ? theme.dark : theme.light;
  const status = dark ? STATUS.dark : STATUS.light;
  const adjusted: string[] = [];
  const bg = p.background ?? base.bg;
  const panel = p.card ?? base.panel;
  // Surfaces chosen by the user keep the theme's ink and muted text, corrected if needed.
  const ink = ensureContrast(base.ink, panel, 7);
  const muted = ensureContrast(base.muted, panel, 4.5);
  if (ink !== base.ink || muted !== base.muted) adjusted.push('Text colours were adjusted to stay readable on your card colour.');
  const sunken = p.card ? toHex(mix(hexToRgb(panel), hexToRgb(ink), 0.05)) : base.sunken;
  const rawBrand = p.accent ?? base.brand;
  // Brand is used for text (links, active tabs), so it must read on cards and on the sunken surface.
  const brand = ensureContrast(ensureContrast(rawBrand, panel, 4.5), sunken, 4.5);
  if (brand.toLowerCase() !== rawBrand.toLowerCase()) adjusted.push('Your primary accent was darkened or lightened slightly so text in that colour stays readable.');
  const accent2 = ensureContrast(p.accent2 ?? base.accent2, panel, 3);
  const line = toHex(mix(hexToRgb(panel), hexToRgb(ink), 0.04 + p.borderIntensity * 0.0016));
  const sidebar = p.sidebar === 'panel' ? panel : p.sidebar === 'contrast' ? (dark ? '#05070c' : '#111827') : base.sidebar;
  const sidebarInk = onColor(sidebar);
  const sidebarMuted = ensureContrast(toHex(mix(hexToRgb(sidebar), hexToRgb(sidebarInk), 0.62)), sidebar, 4.5);
  const sidebarActive = ensureContrast(brand, sidebar, 4.5);
  const chart = p.chartPalette === 'theme' ? [brand, accent2, status.info, status.ok] : CHARTS[p.chartPalette][dark ? 'dark' : 'light'];

  const vars: Record<string, string> = {
    '--bg': triplet(bg),
    '--panel': triplet(panel),
    '--sunken': triplet(sunken),
    '--ink': triplet(ink),
    '--muted': triplet(muted),
    '--line': triplet(line),
    '--brand': triplet(brand),
    '--brand-ink': triplet(onColor(brand)),
    '--accent2': triplet(accent2),
    '--ok': triplet(ensureContrast(status.ok, panel)),
    '--warn': triplet(ensureContrast(status.warn, panel)),
    '--bad': triplet(ensureContrast(status.bad, panel)),
    '--info': triplet(ensureContrast(status.info, panel)),
    '--sidebar': triplet(sidebar),
    '--sidebar-ink': triplet(sidebarInk),
    '--sidebar-muted': triplet(sidebarMuted),
    '--sidebar-active': triplet(sidebarActive),
    '--chart-1': triplet(chart[0]),
    '--chart-2': triplet(chart[1]),
    '--chart-3': triplet(chart[2]),
    '--chart-4': triplet(chart[3]),
    '--grad': String(p.gradientIntensity / 100),
    '--glass': String(p.glass / 100),
    '--radius': `${p.radius}px`,
    '--font-scale': { sm: '93.75%', md: '100%', lg: '106.25%', xl: '112.5%' }[p.fontSize],
  };
  return {
    vars,
    attrs: { 'data-mode': dark ? 'dark' : 'light', 'data-sidebar-tone': sidebarInk === '#ffffff' ? 'dark' : 'light', 'data-density': p.density, 'data-motion': p.motion, 'data-theme': theme.id },
    adjusted,
  };
}

export const STORAGE_KEY = 'projexa.theme.v1';

/** Applies preferences to <html> and caches both modes so the next page load paints correctly at once. */
export function applyPreferences(p: Preferences) {
  if (typeof document === 'undefined') return;
  const light = resolve(p, false);
  const dark = resolve(p, true);
  const sysDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const useDark = p.mode === 'dark' || (p.mode === 'system' && sysDark);
  const r = useDark ? dark : light;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(r.vars)) root.style.setProperty(k, v);
  for (const [k, v] of Object.entries(r.attrs)) root.setAttribute(k, v);
  root.style.colorScheme = useDark ? 'dark' : 'light';
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: p.mode, light, dark, prefs: p }));
  } catch {
    /* storage can be unavailable; the theme still applies for this page */
  }
}

export function cachedPreferences(): Preferences | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw).prefs } : null;
  } catch {
    return null;
  }
}

/** Inline boot script for <head>: paints the cached theme before React loads (no flash). */
export const BOOT_SCRIPT = `(function(){try{var c=JSON.parse(localStorage.getItem('${STORAGE_KEY}')||'null');if(!c)return;var d=c.mode==='dark'||(c.mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var r=d?c.dark:c.light,e=document.documentElement;for(var k in r.vars)e.style.setProperty(k,r.vars[k]);for(var a in r.attrs)e.setAttribute(a,r.attrs[a]);e.style.colorScheme=d?'dark':'light';}catch(_){}})();`;
