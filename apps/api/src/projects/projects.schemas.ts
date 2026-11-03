import { autopilotSchema } from '../monitor/monitor.rules';
import { z } from 'zod';
import { redirectConfigSchema, REDIRECT_MODES } from '../redirects/redirect.types';
import { CAPTCHA_STYLES } from '../survey/captcha';
import { questionListSchema } from '../survey/questions';

export const SECURITY_KEYS = [
  'gateSurvey',
  'prescreening',
  'urlProtection',
  'geolocation',
  'browserFingerprinting',
  'captcha',
  'duplicateDetection',
  'browserLanguage',
  'timezoneTracking',
  'torDetection',
  'cookieValidation',
] as const;

export const securitySchema = z
  .object(Object.fromEntries(SECURITY_KEYS.map((k) => [k, z.boolean().default(false)])) as Record<(typeof SECURITY_KEYS)[number], z.ZodDefault<z.ZodBoolean>>)
  .strict();

export const devicesSchema = z
  .object({ desktop: z.boolean().default(true), mobile: z.boolean().default(true), tablet: z.boolean().default(true) })
  .strict()
  .refine((d) => d.desktop || d.mobile || d.tablet, 'Allow at least one device');

const surveyUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//.test(u), 'Survey links must be http(s)')
  .optional();

/** Settings that can be set once for the master project and overridden per country. */
export const countrySettingsSchema = z.object({
  language: z.string().min(2).max(10).optional(),
  targetGroup: z.string().max(200).optional(),
  loiMinutes: z.number().int().min(1).max(240).optional(),
  irPercent: z.number().int().min(1).max(100).optional(),
  cpi: z.number().min(0).max(100000).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  targetCompletes: z.number().int().min(1).max(1_000_000).optional(),
  liveSurveyUrl: surveyUrl,
  testSurveyUrl: surveyUrl,
  sessionTtlMinutes: z.number().int().min(10).max(7 * 24 * 60).optional(),
});
export type CountrySettings = z.infer<typeof countrySettingsSchema>;

export const countryInputSchema = countrySettingsSchema.extend({
  countryCode: z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 code'),
});

export const createProjectSchema = z.object({
  name: z.string().min(1).max(300),
  workOrderNo: z.string().max(50).optional(),
  generateWorkOrder: z.boolean().default(false),
  bidReference: z.string().max(100).optional(),
  /** Set when the project is created from a won bid; links them, at most once. */
  wonBidId: z.string().min(1).max(64).optional(),
  /** Copies the template's questions, page design, autopilot, redirects, quotas and vendors. */
  templateId: z.string().min(1).max(64).optional(),
  /** The saved draft this form came from; it is deleted once the project exists. */
  draftId: z.string().min(1).max(64).optional(),
  type: z.enum(['AD_HOC', 'TRACKER', 'LONGITUDINAL', 'QUALITATIVE']).default('AD_HOC'),
  category: z.string().min(1).max(100),
  clientId: z.string().min(1),
  clientContactId: z.string().optional(),
  salesPersonId: z.string().optional(),
  projectManagerId: z.string().optional(),
  description: z.string().max(20000).optional(),
  devices: devicesSchema.default({ desktop: true, mobile: true, tablet: true }),
  security: securitySchema.default({} as never),
  redirectMode: z.enum(REDIRECT_MODES).default('HYBRID'),
  redirectConfig: redirectConfigSchema.optional(),
  defaults: countrySettingsSchema.default({}),
  countries: z.array(countryInputSchema).min(1, 'Add at least one country').max(100),
  fieldStartAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  fieldEndAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
}).refine((b) => !b.fieldStartAt || !b.fieldEndAt || b.fieldStartAt <= b.fieldEndAt, { message: 'The field end date must be on or after the start date', path: ['fieldEndAt'] });
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  category: z.string().min(1).max(100).optional(),
  description: z.string().max(20000).nullable().optional(),
  clientContactId: z.string().nullable().optional(),
  salesPersonId: z.string().nullable().optional(),
  projectManagerId: z.string().optional(),
  devices: devicesSchema.optional(),
  security: securitySchema.optional(),
  gateQuestions: questionListSchema.nullable().optional(),
  captchaStyle: z.enum(CAPTCHA_STYLES).optional(),
  prescreen: questionListSchema.nullable().optional(),
  status: z.enum(['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED', 'INVOICED']).optional(),
  /** Planned field dates (UTC days). The end date is inclusive: fieldwork runs until 23:59 UTC. */
  fieldStartAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional(),
  fieldEndAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional(),
  autopilot: autopilotSchema.optional(),
}).refine((b) => !b.fieldStartAt || !b.fieldEndAt || b.fieldStartAt <= b.fieldEndAt, { message: 'The field end date must be on or after the start date', path: ['fieldEndAt'] });

export const updateCountrySchema = countrySettingsSchema.extend({
  status: z.enum(['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED']).optional(),
});

export const cloneCountrySchema = z.object({
  fromCountryId: z.string().min(1),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  language: z.string().min(2).max(10).optional(),
  includeVendors: z.boolean().default(true),
});

export const allocationSchema = z.object({
  vendorId: z.string().min(1),
  cpi: z.number().min(0).max(100000),
  targetCompletes: z.number().int().min(1),
  uidParam: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).default('uid'),
  callbackUrlTemplate: z.string().url().optional(),
});

export const updateAllocationSchema = z.object({
  cpi: z.number().min(0).max(100000).optional(),
  targetCompletes: z.number().int().min(1).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']).optional(),
  uidParam: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/).optional(),
  callbackUrlTemplate: z.string().url().nullable().optional(),
});


export const listQuerySchema = z.object({
  status: z.enum(['DRAFT', 'TEST', 'LIVE', 'HOLD', 'CLOSED', 'INVOICED']).optional(),
  category: z.string().optional(),
  clientId: z.string().optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Column to sort by (the data grid's sortable columns); newest first by default. */
  sort: z.enum(['created', 'name', 'code', 'status', 'client', 'manager', 'fieldEnd']).default('created'),
  dir: z.enum(['asc', 'desc']).optional(),
});

export const restoreSchema = z.object({ reason: z.string().trim().max(500).optional() });
