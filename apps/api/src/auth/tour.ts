/**
 * Product tour shown after sign-in (docs/PRODUCT_TOUR.md).
 *
 * Each person sees the tour once. Finishing it or skipping it is remembered on their user,
 * against TOUR_VERSION: raising the version shows the tour again to everyone, for example
 * after a large release. "Remind me later" is not stored here; the browser hides the tour
 * for that sign-in only.
 */
import { z } from 'zod';

export const TOUR_VERSION = 1;

export const tourUpdateSchema = z
  .object({
    /** completed = reached the last step; skipped = chose Skip tour; reset = show it again next time. */
    outcome: z.enum(['completed', 'skipped', 'reset']),
  })
  .strict();
export type TourUpdate = z.infer<typeof tourUpdateSchema>;

export interface TourState {
  version: number;
  /** True when the tour should open on its own after sign-in. */
  show: boolean;
  outcome: 'completed' | 'skipped' | null;
  at: string | null;
}

export function tourState(u: { tourVersion: number | null; tourOutcome: string | null; tourAt: Date | null }): TourState {
  const seen = u.tourVersion != null && u.tourVersion >= TOUR_VERSION;
  return {
    version: TOUR_VERSION,
    show: !seen,
    outcome: seen && (u.tourOutcome === 'completed' || u.tourOutcome === 'skipped') ? u.tourOutcome : null,
    at: seen && u.tourAt ? u.tourAt.toISOString() : null,
  };
}
