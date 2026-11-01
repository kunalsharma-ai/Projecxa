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
export type RedirectMode = 'STATIC' | 'DYNAMIC' | 'HYBRID';
export type RuleType = 'STATIC' | 'DYNAMIC';

export const STATUS_LABEL: Record<string, string> = {
  STARTED: 'In progress',
  COMPLETE: 'Complete',
  TERMINATE: 'Terminate',
  QUOTA_FULL: 'Quota full',
  QUALITY_FAIL: 'Quality fail',
  DUPLICATE: 'Duplicate',
  SECURITY_REJECT: 'Security reject',
  PARTIAL: 'Partial',
  TECHNICAL_ERROR: 'Technical error',
};

export interface Scope { countryCode?: string; vendorId?: string }
export interface RedirectRule { status: OutcomeStatus; type: RuleType; url: string; enabled: boolean; callbackRequired: boolean; scope?: Scope }
export interface ParamMapping { canonical: string; alias: string; required: boolean; scope?: Scope }
export interface RedirectConfig { rules: RedirectRule[]; params: ParamMapping[] }

export interface Me { user: { id: string; name: string; email: string; role: string }; organization: { id: string; name: string; slug: string } }
export interface Option { id: string; name: string; code?: string }

export const SECURITY_LABELS: Record<string, string> = {
  gateSurvey: 'Gate survey',
  prescreening: 'Prescreening',
  urlProtection: 'URL protection',
  geolocation: 'Geolocation',
  browserFingerprinting: 'Browser fingerprinting',
  captcha: 'Captcha',
  duplicateDetection: 'Duplicate detection',
  browserLanguage: 'Browser language',
  timezoneTracking: 'Timezone tracking',
  torDetection: 'TOR detection',
  cookieValidation: 'Cookie validation',
};

export const CATEGORIES = ['B2B', 'B2C', 'B2C-B2B', 'Consumer', 'Healthcare-Professional', 'Healthcare-Consumer', 'Teens-And-Parents'];
