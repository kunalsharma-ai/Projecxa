/** SPEEDER counts quality fails from the speeder check; QUALITY_FAIL leaves them out. */
export type Stats = Record<'STARTED' | 'COMPLETE' | 'TERMINATE' | 'QUOTA_FULL' | 'QUALITY_FAIL' | 'DUPLICATE' | 'SECURITY_REJECT' | 'PARTIAL' | 'TECHNICAL_ERROR' | 'SPEEDER', number>;

/** Actual figures from live sessions (docs/FIELD_METRICS.md). */
export interface FieldMetrics { avgLoiMinutes: number | null; irPercent: number | null; completes: number; terminates: number; speeders: number }

export interface AutoPause { enabled: boolean; by: 'percent' | 'completes'; value: number; scope: 'market' | 'vendor' }
export interface AutoPauseState { config: string; done: Record<string, { reason: 'paused' | 'target'; at: string; completes: number; target: number }>; switchedOffAt?: string }

export interface Allocation {
  id: string;
  vendorId: string;
  vendor: { id: string; name: string; code: string };
  status: string;
  cpi: string;
  targetCompletes: number;
  completes: number;
  uidParam: string;
  entryLink: string;
  testEntryLink: string;
  callbackUrlTemplate: string | null;
  /** Shared live link closed; respondents enter only with one-time unique links. */
  uniqueLinksOnly?: boolean;
  stats: Stats;
}

export interface Country {
  id: string;
  countryCode: string;
  language: string;
  targetGroup: string | null;
  status: string;
  loiMinutes: number;
  irPercent: number;
  cpi: string;
  currency: string;
  targetCompletes: number;
  completes: number;
  liveSurveyUrl: string | null;
  testSurveyUrl: string | null;
  allocations: Allocation[];
  metrics?: FieldMetrics;
  quotas: { id: string; group: string; name: string; target: number; completes: number; isOpen: boolean }[];
}

export interface ProjectDetail {
  id: string;
  projectCode: string;
  workOrderNo: string | null;
  bidReference: string | null;
  name: string;
  /** What vendors see instead of the name; null = "Survey <code>". */
  vendorTitle?: string | null;
  status: string;
  category: string;
  description: string | null;
  redirectMode: 'STATIC' | 'DYNAMIC' | 'HYBRID';
  client: { id: string; name: string };
  projectManager: { name: string };
  salesPerson: { name: string } | null;
  devices: Record<string, boolean>;
  security: Record<string, boolean>;
  captchaStyle: import('@/lib/types').CaptchaStyle;
  gateQuestions: import('@/lib/types').Question[] | null;
  prescreen: import('@/lib/types').Question[] | null;
  activeRedirectVersion: { id: string; version: number; mode: string } | null;
  fieldStartAt: string | null;
  fieldEndAt: string | null;
  autopilot: { pauseOnQuality?: boolean; closeOnTarget?: boolean; autoPause?: AutoPause } | null;
  autopilotState?: { autoPause?: AutoPauseState } | null;
  /** Speeder check: completes faster than fraction × planned LOI become speeders. */
  speederCheck?: { enabled: boolean; fraction: string } | null;
  metrics?: FieldMetrics;
  countries: Country[];
  stats: Stats;
  /** Money per CPI currency: client CPI range, value at target, and earned / owed for completes so far. */
  finance?: { currency: string; minCpi: number; maxCpi: number; avgCpi: number; plannedRevenue: number; plannedCost: number; revenue: number; cost: number; margin: number }[];
  /** Only on the response to going live: how many markets opened and which were not ready. */
  launch?: { opened: number; notReady: { id: string; market: string; problems: string[] }[] };
  outcomeEndpoints: { browser: string; s2s: string; statuses: string[] };
}
