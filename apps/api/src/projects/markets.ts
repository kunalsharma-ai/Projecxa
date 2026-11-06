import { BadRequestException } from '@nestjs/common';

/**
 * A market is one country + language + target group of a project. The same country may be a market
 * more than once (for example Japan for two target groups), so a market is told apart by all three.
 */
export interface MarketLike {
  countryCode: string;
  language: string;
  targetGroup?: string | null;
}

const group = (g?: string | null) => (g ?? '').trim();

/** Stable key used by history snapshots and templates. Markets without a target group keep the old `CC/lang` key. */
export function marketKey(c: MarketLike) {
  const g = group(c.targetGroup);
  return g ? `${c.countryCode}/${c.language}/${g}` : `${c.countryCode}/${c.language}`;
}

/** How a market is named in messages, e.g. "JP (ja) · Gen Z". */
export function marketLabel(c: MarketLike) {
  const g = group(c.targetGroup);
  return `${c.countryCode} (${c.language})${g ? ` · ${g}` : ''}`;
}

/** Two markets are the same when country, language and target group (ignoring case and spaces) match. */
export function sameMarket(a: MarketLike, b: MarketLike) {
  return a.countryCode === b.countryCode && a.language.toLowerCase() === b.language.toLowerCase() && group(a.targetGroup).toLowerCase() === group(b.targetGroup).toLowerCase();
}

/** Why a market cannot take live respondents yet; empty when it can. */
export function launchProblems(c: MarketLike & { liveSurveyUrl: string | null; vendorCount: number }) {
  const out: string[] = [];
  if (!c.liveSurveyUrl) out.push('no live survey link');
  if (c.vendorCount === 0) out.push('no vendor');
  return out;
}

/**
 * A vendor's payout per complete must not be above the client CPI of the market, unless the
 * person confirms it on purpose (allowAboveCpi). The error carries a code the web app recognises.
 */
export function assertPayout(payout: number, clientCpi: number, currency: string, market: MarketLike, vendorName: string, allowAboveCpi?: boolean) {
  if (allowAboveCpi || payout <= clientCpi) return;
  throw new BadRequestException({
    message: `${vendorName}'s payout (${payout} ${currency}) is higher than the client CPI (${clientCpi} ${currency}) for ${marketLabel(market)}`,
    code: 'PAYOUT_ABOVE_CPI',
    issues: ['Lower the vendor payout, or confirm that this market should run at a loss.'],
  });
}
