/**
 * Personal interface preferences, stored on the user so every person in an organization
 * can keep their own theme and workspace. Partial updates are merged into what is stored.
 */
import { z } from 'zod';

export const THEME_IDS = ['midnight', 'arctic', 'emerald', 'obsidian', 'sapphire', 'aurora', 'graphite', 'solar'] as const;

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb colour');
const pct = z.number().int().min(0).max(100);
const navHref = z.string().max(100).regex(/^\/[a-z0-9/-]*$/);

export const preferencesSchema = z
  .object({
    theme: z.enum(THEME_IDS),
    mode: z.enum(['light', 'dark', 'system']),
    accent: hex.nullable(),
    accent2: hex.nullable(),
    background: hex.nullable(),
    card: hex.nullable(),
    sidebar: z.enum(['theme', 'panel', 'contrast']),
    borderIntensity: pct,
    gradientIntensity: pct,
    glass: pct,
    fontSize: z.enum(['sm', 'md', 'lg', 'xl']),
    density: z.enum(['compact', 'comfortable', 'spacious']),
    radius: z.number().int().min(0).max(24),
    motion: z.enum(['essential', 'refined', 'cinematic']),
    chartPalette: z.enum(['theme', 'ocean', 'vivid', 'mono']),
    sidebarCollapsed: z.boolean(),
    insightsOpen: z.boolean(),
    favorites: z.array(navHref).max(20),
    recentProjects: z.array(z.object({ id: z.string().min(1).max(64), code: z.string().max(40), name: z.string().max(200) })).max(8),
  })
  .partial()
  .strict();
export type Preferences = z.infer<typeof preferencesSchema>;

/** Stored JSON is re-validated on read so a bad row can never break the interface. */
export function readPreferences(raw: unknown): Preferences {
  const r = preferencesSchema.safeParse(raw ?? {});
  return r.success ? r.data : {};
}
