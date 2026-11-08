import { z } from 'zod';

/** One market line of a won bid, as SampBidx sends it (bid_country_lines + the quoted CPI). */
export const bidCountrySchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  sampleSize: z.number().int().min(1).max(10_000_000),
  loiMinutes: z.number().min(0.5).max(600),
  incidencePct: z.number().min(0.01).max(100),
  cpi: z.number().min(0).max(1_000_000).optional(),
  language: z.string().min(2).max(10).optional(),
  notes: z.string().max(2000).optional(),
});

/** Contract for POST /api/v1/integrations/sampbidx/events (old path /integrations/bidzo/events still works; see docs/SAMPBIDX_INTEGRATION.md). */
export const sampbidxEventSchema = z.object({
  event: z.literal('bid.won'),
  eventId: z.string().min(1).max(200),
  occurredAt: z.string().datetime({ offset: true }),
  bid: z.object({
    id: z.string().min(1).max(100),
    bidNumber: z.string().min(1).max(100),
    version: z.number().int().min(1).optional(),
    projectName: z.string().min(1).max(300),
    projectDescription: z.string().max(20000).optional(),
    projectType: z.string().max(100).optional(),
    projectCategory: z.string().max(100).optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    totalAmount: z.number().min(0).optional(),
    client: z.object({ id: z.string().max(100).optional(), name: z.string().min(1).max(300) }),
    contact: z.object({ name: z.string().max(200).optional(), email: z.string().email().optional() }).optional(),
    biddingPerson: z.object({ name: z.string().max(200).optional(), email: z.string().email().optional() }).optional(),
    countries: z.array(bidCountrySchema).min(1).max(200),
  }),
});
export type SampBidxEvent = z.infer<typeof sampbidxEventSchema>;
export type BidCountry = z.infer<typeof bidCountrySchema>;

export const dismissSchema = z.object({ reason: z.string().max(500).optional() });
export const listSchema = z.object({ status: z.enum(['NEW', 'PROJECT_CREATED', 'DISMISSED']).optional() });
