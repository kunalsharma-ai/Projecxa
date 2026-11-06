import { z } from 'zod';

/** The eight respondent outcome statuses supported by the redirect engine. */
export const OUTCOME_STATUSES = [
  'COMPLETE',
  'TERMINATE',
  'QUOTA_FULL',
  'QUALITY_FAIL',
  'DUPLICATE',
  'SECURITY_REJECT',
  'PARTIAL',
  'TECHNICAL_ERROR',
] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export const REDIRECT_MODES = ['STATIC', 'DYNAMIC', 'HYBRID'] as const;
export type RedirectModeT = (typeof REDIRECT_MODES)[number];

/** API: the destination is asked from an HTTPS endpoint at outcome time; fallbackUrl is used if it fails. */
export const RULE_TYPES = ['STATIC', 'DYNAMIC', 'API'] as const;
export type RuleType = (typeof RULE_TYPES)[number];

/**
 * Canonical dynamic parameters. The first three are the ones enabled by default
 * (UID, Vendor ID, Country Code); the others can be added per project.
 */
export const CANONICAL_PARAMS = [
  'respondent_uid',
  'vendor_id',
  'country_code',
  'project_code',
  'status',
  'session_token',
] as const;
export type CanonicalParam = (typeof CANONICAL_PARAMS)[number];

export const DEFAULT_PARAM_ALIASES: Record<'respondent_uid' | 'vendor_id' | 'country_code', string> = {
  respondent_uid: 'uid',
  vendor_id: 'vid',
  country_code: 'country',
};

const countryCode = z
  .string()
  .regex(/^[A-Z]{2}$/, 'Use an ISO 3166-1 alpha-2 country code, e.g. US');

export const scopeSchema = z
  .object({
    countryCode: countryCode.optional(),
    vendorId: z.string().min(1).optional(),
  })
  .strict();
export type RuleScope = z.infer<typeof scopeSchema>;

export const redirectRuleSchema = z
  .object({
    status: z.enum(OUTCOME_STATUSES),
    type: z.enum(RULE_TYPES),
    url: z.string().min(1).max(2048),
    enabled: z.boolean().default(true),
    callbackRequired: z.boolean().default(false),
    scope: scopeSchema.optional(),
    /** API rules: where to send the respondent when the endpoint fails. May use {macros}. */
    fallbackUrl: z.string().min(1).max(2048).optional(),
    /** API rules: how long to wait for the endpoint, in milliseconds. */
    timeoutMs: z.number().int().min(200).max(5000).optional(),
  })
  .strict();
export const API_TIMEOUT_MS = 1500;
export type RedirectRule = z.infer<typeof redirectRuleSchema>;

export const paramMappingSchema = z
  .object({
    canonical: z.enum(CANONICAL_PARAMS),
    /** The query parameter name the receiver expects, e.g. "uid" or "respondent_id". */
    alias: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, 'Parameter names may use letters, digits, _ . and -'),
    required: z.boolean().default(true),
    scope: scopeSchema.optional(),
  })
  .strict();
export type ParamMapping = z.infer<typeof paramMappingSchema>;

export const redirectConfigSchema = z
  .object({
    rules: z.array(redirectRuleSchema).max(2000).default([]),
    params: z.array(paramMappingSchema).max(200).default([]),
  })
  .strict();
export type RedirectConfig = z.infer<typeof redirectConfigSchema>;

/** Precedence levels, most specific first. Security policy is applied separately and always wins. */
export const RULE_SOURCES = [
  'project:vendor+country',
  'project:vendor',
  'project:country',
  'project',
  'client-template',
  'organization-default',
] as const;
export type RuleSource = (typeof RULE_SOURCES)[number];

export function defaultParamMappings(): ParamMapping[] {
  return (Object.keys(DEFAULT_PARAM_ALIASES) as (keyof typeof DEFAULT_PARAM_ALIASES)[]).map((canonical) => ({
    canonical,
    alias: DEFAULT_PARAM_ALIASES[canonical],
    required: true,
  }));
}

/**
 * Macro that stands for "this vendor's own saved redirect for the status" (Vendor.redirectUrls).
 * It must be the whole URL of a rule. Prebuilt redirects use it so nothing has to be typed per project.
 */
export const VENDOR_REDIRECT_MACRO = '{vendor_redirect}';

/** The four redirects every vendor gives; the other statuses reuse one of them unless set. */
export const VENDOR_MAIN_STATUSES = ['COMPLETE', 'TERMINATE', 'QUOTA_FULL', 'SECURITY_REJECT'] as const;
export const VENDOR_REDIRECT_FALLBACK: Partial<Record<OutcomeStatus, OutcomeStatus>> = {
  QUALITY_FAIL: 'SECURITY_REJECT',
  DUPLICATE: 'SECURITY_REJECT',
  PARTIAL: 'TERMINATE',
  TECHNICAL_ERROR: 'TERMINATE',
};
export type VendorRedirectUrls = Partial<Record<OutcomeStatus, string>>;

/** The vendor's URL for a status, falling back to its main redirect for related statuses. */
export function vendorRedirectFor(urls: VendorRedirectUrls | null | undefined, status: OutcomeStatus): string | null {
  if (!urls) return null;
  const own = urls[status]?.trim();
  if (own) return own;
  const fb = VENDOR_REDIRECT_FALLBACK[status];
  return (fb && urls[fb]?.trim()) || null;
}

export function parseVendorRedirectUrls(raw: unknown): VendorRedirectUrls {
  if (!raw || typeof raw !== 'object') return {};
  const out: VendorRedirectUrls = {};
  for (const s of OUTCOME_STATUSES) {
    const v = (raw as Record<string, unknown>)[s];
    if (typeof v === 'string' && v.trim()) out[s] = v.trim();
  }
  return out;
}

/** Ready-made status matrices for each mode, so a project starts with working redirects. */
export function prebuiltRules(mode: RedirectModeT): RedirectRule[] {
  // Hybrid: the statuses a vendor pays or counts get UID, vendor ID and country added; the rest go to the
  // vendor's fixed security / terminate page as saved.
  const dynamicInHybrid = new Set<OutcomeStatus>(['COMPLETE', 'TERMINATE', 'QUOTA_FULL']);
  return OUTCOME_STATUSES.map((status) => ({
    status,
    type: mode === 'HYBRID' ? (dynamicInHybrid.has(status) ? 'DYNAMIC' : 'STATIC') : mode,
    url: VENDOR_REDIRECT_MACRO,
    enabled: true,
    callbackRequired: status === 'COMPLETE',
  }));
}
