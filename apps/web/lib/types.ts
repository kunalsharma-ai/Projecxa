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
export type RuleType = 'STATIC' | 'DYNAMIC' | 'API';

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
export interface RedirectRule { status: OutcomeStatus; type: RuleType; url: string; enabled: boolean; callbackRequired: boolean; scope?: Scope; fallbackUrl?: string; timeoutMs?: number }
export interface ParamMapping { canonical: string; alias: string; required: boolean; scope?: Scope }
export interface RedirectConfig { rules: RedirectRule[]; params: ParamMapping[] }

export interface Me {
  user: { id: string; name: string; email: string; role: string };
  organization: { id: string; name: string; slug: string };
  client?: { id: string; name: string } | null;
  vendor?: { id: string; name: string } | null;
  preferences?: Partial<import('./theme').Preferences>;
  mfa?: MfaStatus;
  branding?: import('./branding').Brand;
  /** Set in Settings → Integrations. */
  links?: { bidzoUrl: string | null };
}
export interface MfaStatus { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; required: boolean; setupRequired: boolean }

export const isPortalRole = (role: string) => role === 'CLIENT_USER' || role === 'VENDOR_USER';
export const portalHome = (role: string) => (role === 'CLIENT_USER' ? '/portal/client' : role === 'VENDOR_USER' ? '/portal/vendor' : '/');
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

/** A bid won in Bidzo, waiting to become (or linked to) a project. */
export interface BidLine { countryCode: string; sampleSize: number; loiMinutes: number; incidencePct: number; cpi?: number; language?: string; notes?: string }
export interface WonBid {
  id: string; bidNumber: string; bidVersion: number | null; projectName: string; description: string | null; projectType: string | null; projectCategory: string | null;
  clientName: string; contactName: string | null; contactEmail: string | null; bidderName: string | null; currency: string; totalAmount: string | null;
  countries: BidLine[]; wonAt: string; status: 'NEW' | 'PROJECT_CREATED' | 'DISMISSED'; dismissReason: string | null; deliveries: number; receivedAt: string;
  project: { id: string; projectCode: string; status: string } | null;
}

/** Gate survey and prescreener question (mirrors apps/api/src/survey/questions.ts). */
export type QuestionType = 'single' | 'multi' | 'dropdown' | 'number' | 'text' | 'grid';
export type OptionAction = 'accept' | 'qualify' | 'terminate';
export type TextFormat = 'any' | 'letters' | 'digits' | 'alphanumeric' | 'email' | 'postal' | 'phone';
export interface QuestionOption { id: string; label: string; action: OptionAction; exclusive?: boolean }
export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  help?: string;
  required: boolean;
  options?: QuestionOption[];
  rows?: { id: string; label: string }[];
  validation: { min?: number; max?: number; integer?: boolean; minSelect?: number; maxSelect?: number; minLength?: number; maxLength?: number; format?: TextFormat };
  qualify?: { min?: number; max?: number };
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: 'Single choice',
  multi: 'Multiple choice',
  dropdown: 'Dropdown',
  number: 'Number',
  text: 'Text',
  grid: 'Grid',
};

export const TEXT_FORMAT_LABELS: Record<TextFormat, string> = {
  any: 'Any text',
  letters: 'Letters and spaces',
  digits: 'Digits only',
  alphanumeric: 'Letters and digits',
  email: 'Email address',
  postal: 'Postal / ZIP code',
  phone: 'Phone number',
};

export type CaptchaStyle = 'math' | 'logic' | 'text_image' | 'invisible' | 'turnstile' | 'hcaptcha';

/** Why a respondent was stopped (mirrors REASON_LABELS in the API). */
export const REASON_LABELS: Record<string, string> = {
  BAD_SIGNATURE: 'Entry link signature missing or wrong',
  DEVICE_NOT_ALLOWED: 'Device type not allowed',
  TOR_EXIT: 'Connected through TOR',
  GEO_MISMATCH: 'Located outside the survey country',
  CAPTCHA_FAILED: 'Failed the background bot check',
  HUMAN_CHECK_FAILED: 'Failed the human check',
  LANGUAGE_MISMATCH: 'Browser language does not match',
  TIMEZONE_MISMATCH: 'Time zone outside the survey country',
  COOKIES_BLOCKED: 'Cookies blocked',
  SAME_BROWSER: 'Same browser entered before',
  SAME_FINGERPRINT: 'Same device fingerprint entered before',
  SAME_DEVICE: 'Same IP and browser entered before',
  GATE_SCREENOUT: 'Did not qualify on the gate survey',
  GATE_INCOMPLETE: 'Gave missing or invalid gate answers',
  PRESCREEN: 'Did not qualify on the prescreener',
  GATE_SKIPPED: 'Skipped the entry checks',
  EXPIRED: 'Session expired',
};
