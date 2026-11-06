export type Stats = Record<'STARTED' | 'COMPLETE' | 'TERMINATE' | 'QUOTA_FULL' | 'QUALITY_FAIL' | 'DUPLICATE' | 'SECURITY_REJECT' | 'PARTIAL' | 'TECHNICAL_ERROR', number>;

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
  quotas: { id: string; group: string; name: string; target: number; completes: number; isOpen: boolean }[];
}

export interface ProjectDetail {
  id: string;
  projectCode: string;
  workOrderNo: string | null;
  bidReference: string | null;
  name: string;
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
  autopilot: { pauseOnQuality?: boolean; closeOnTarget?: boolean } | null;
  countries: Country[];
  stats: Stats;
  /** Money per CPI currency: client CPI range, value at target, and earned / owed for completes so far. */
  finance?: { currency: string; minCpi: number; maxCpi: number; avgCpi: number; plannedRevenue: number; plannedCost: number; revenue: number; cost: number; margin: number }[];
  /** Only on the response to going live: how many markets opened and which were not ready. */
  launch?: { opened: number; notReady: { id: string; market: string; problems: string[] }[] };
  outcomeEndpoints: { browser: string; s2s: string; statuses: string[] };
}
