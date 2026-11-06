import { ApiError } from '@/lib/api';

/**
 * Runs a vendor allocation save. When the payout is above the client CPI, the server refuses with
 * PAYOUT_ABOVE_CPI; the person is asked once, and on yes the save is repeated with allowAboveCpi.
 */
export async function withPayoutCheck<T>(save: (allowAboveCpi: boolean) => Promise<T>): Promise<T | null> {
  try {
    return await save(false);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'PAYOUT_ABOVE_CPI') {
      if (!confirm(`${e.message}.\n\nSave it anyway? This market will lose money on every complete from this vendor.`)) return null;
      return save(true);
    }
    throw e;
  }
}
