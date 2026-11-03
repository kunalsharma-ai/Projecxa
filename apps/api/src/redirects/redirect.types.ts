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
