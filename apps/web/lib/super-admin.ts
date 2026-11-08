/** Types and helpers for the Super Admin console (docs/SUPER_ADMIN.md). */
export type OrgStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED';
export type SubStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELLED';
export interface FeatureDef { key: string; label: string; group: string; summary: string; roles: string[]; mobile: boolean }
export interface Plan {
  id: string; code: string; name: string; description: string | null; priceLabel: string | null;
  features: string[]; mobileFeatures: string[]; mobileEnabled: boolean; maxUsers: number | null; maxProjects: number | null;
  active: boolean; sortOrder: number; organizations: number;
  priceMonthly: number | string | null; priceYearly: number | string | null; currency: string;
}
export interface OrgSummary {
  id: string; name: string; slug: string; status: OrgStatus; platformOwner: boolean; createdAt: string; customDomain: string | null;
  registration: { contactName?: string; phone?: string | null; website?: string | null; message?: string | null; requestedPlan?: string | null; at?: string } | null;
  block: string | null;
  subscription: { plan: { id: string; code: string; name: string }; status: SubStatus; startsAt: string; endsAt: string | null; trialEndsAt: string | null; live: boolean; mobileEnabled: boolean } | null;
  limits: { maxUsers: number | null; maxProjects: number | null };
  users: number; projects: number; integrations: number; overrides: number; lastActiveAt: string | null;
  features: { web: number; mobile: number; total: number };
}
export interface FeatureRow {
  key: string; label: string; group: string; summary: string; mobile: boolean;
  /** Who the organisation's Admin gives it to (Settings → Features & access); null = not the Admin's choice. */
  adminAccess: { mode: 'everyone' | 'admins' | 'people' | 'off'; people: number } | null;
  web: { plan: boolean; override: boolean | null; effective: boolean };
  app: { plan: boolean; override: boolean | null; effective: boolean } | null;
}
export interface OrgDetail extends Omit<OrgSummary, 'features'> {
  subscriptionDetail: { status: SubStatus; startsAt: string; endsAt: string | null; trialEndsAt: string | null; maxUsers: number | null; maxProjects: number | null; mobileEnabled: boolean; notes: string | null } | null;
  features: FeatureRow[];
}
export interface OrgUser {
  id: string; name: string; email: string; role: string; active: boolean; superAdmin: boolean; mobileAccess: boolean; featuresOff: string[]; mobileFeaturesOff: string[];
  lastLoginAt: string | null; lastSeenAt: string | null; mfaEnabled: boolean; invited: boolean; createdAt: string; partner: string | null;
  webFeatures: number; mobileFeatures: number; mobileEnabled: boolean;
}
export interface ActivityItem {
  id: string; at: string; action: string; entityType: string; entityId: string; detail: Record<string, unknown> | null;
  organization: { id: string; name: string };
  actor: { id: string; name: string; email: string | null; role: string | null; superAdmin?: boolean } | null;
}
export interface Rule {
  id: string; name: string; enabled: boolean; trigger: string; triggerConfig: { days?: number }; conditions: { plans?: string[]; statuses?: SubStatus[] };
  actions: Action[]; recipe: string | null; lastRunAt: string | null; runCount: number; createdAt: string;
}
export type Action = { type: string; [k: string]: unknown };
export interface AutomationCatalog {
  triggers: { type: string; label: string; detail: string; kind: 'event' | 'time'; days: { label: string; default: number } | null }[];
  actions: { type: string; label: string; fields: string[] }[];
  recipes: { id: string; name: string; summary: string; trigger: string }[];
}
export interface Catalog { features: FeatureDef[]; groups: string[]; automation: AutomationCatalog }

export const SUB_STATUS: Record<SubStatus, [string, string]> = {
  TRIAL: ['Trial', 'bg-info/15 text-info'], ACTIVE: ['Active', 'bg-ok/15 text-ok'], PAST_DUE: ['Past due', 'bg-warn/15 text-warn'],
  EXPIRED: ['Expired', 'bg-bad/15 text-bad'], CANCELLED: ['Cancelled', 'bg-sunken text-muted'],
};
export const ORG_STATUS: Record<OrgStatus, [string, string]> = {
  PENDING: ['Waiting for approval', 'bg-warn/15 text-warn'], ACTIVE: ['Active', 'bg-ok/15 text-ok'], SUSPENDED: ['Paused', 'bg-bad/15 text-bad'],
};
export const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', PROJECT_MANAGER: 'Project manager', SALES: 'Sales', VIEWER: 'Viewer', CLIENT_USER: 'Client portal', VENDOR_USER: 'Vendor portal' };

export const day = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const ago = (d: string | null | undefined) => {
  if (!d) return 'Never';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return day(d);
};
/** Days until a date (negative = past). */
export const daysUntil = (d: string | null | undefined) => (d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000) : null);
export const endOf = (s: OrgSummary['subscription']) => (s ? (s.status === 'TRIAL' ? s.trialEndsAt : s.endsAt) : null);

const ACTION_LABEL: Record<string, string> = {
  'superadmin.subscription': 'Changed the subscription', 'superadmin.subscription_remove': 'Removed the subscription', 'superadmin.features': 'Switched features',
  'superadmin.org_create': 'Created the organisation', 'superadmin.org_approve': 'Approved the registration', 'superadmin.org_reject': 'Turned down a registration',
  'superadmin.org_suspend': 'Paused the organisation', 'superadmin.org_activate': 'Reactivated the organisation', 'superadmin.org_update': 'Edited the organisation',
  'superadmin.user_update': 'Changed a person’s access', 'superadmin.user_sign_out': 'Signed a person out', 'superadmin.plan_create': 'Created a plan',
  'superadmin.plan_update': 'Edited a plan', 'superadmin.plan_delete': 'Deleted a plan', 'superadmin.settings': 'Changed platform settings',
  'superadmin.integration_clear': 'Removed integration settings', 'billing.paid': 'Paid for the plan', 'billing.offline_submitted': 'Sent an offline payment', 'billing.offline_rejected': 'Offline payment turned down', 'billing.cancelled': 'Invoice cancelled', 'superadmin.billing_settings': 'Changed billing settings', 'org.registered': 'Registered', 'auth.sign_in': 'Signed in',
  'user.invite': 'Invited a team member', 'user.deactivate': 'Deactivated a team member', 'user.reactivate': 'Reactivated a team member', 'user.update': 'Changed a team member',
  'integration.saved': 'Saved an integration', 'integration.removed': 'Removed an integration', 'password.invite_accepted': 'Accepted an invitation', 'password.reset': 'Reset a password',
  'project.create': 'Created a project', 'project.update': 'Edited a project',
};
export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// ───────────── Billing (docs/SUBSCRIPTION_PAYMENTS.md) ─────────────
export type InvoiceStatus = 'OPEN' | 'PENDING_REVIEW' | 'PAID' | 'REJECTED' | 'CANCELLED';
export interface BillingInvoice {
  id: string; number: string; status: InvoiceStatus; plan: { code: string; name: string }; interval: 'MONTHLY' | 'YEARLY'; currency: string;
  amount: number; taxName: string | null; taxPercent: number; taxAmount: number; total: number; method: string | null; reference: string | null;
  paidOn: string | null; paidAt: string | null; note: string | null; reviewNote: string | null; hasProof: boolean; proofName: string | null;
  periodStart: string | null; periodEnd: string | null; createdAt: string; organization?: { id: string; name: string };
}
export const INVOICE_STATUS: Record<InvoiceStatus, [string, string]> = {
  OPEN: ['Not paid', 'bg-sunken text-muted'], PENDING_REVIEW: ['Being checked', 'bg-warn/15 text-warn'], PAID: ['Paid', 'bg-ok/15 text-ok'],
  REJECTED: ['Not found', 'bg-bad/15 text-bad'], CANCELLED: ['Cancelled', 'bg-sunken text-muted'],
};
export const METHOD_LABEL: Record<string, string> = {
  razorpay: 'Razorpay', stripe: 'Card (Stripe)', bank_transfer: 'Bank transfer', upi: 'UPI', cheque: 'Cheque', cash: 'Cash', other: 'Other',
};
export const fmtMoney = (currency: string, n: number | string | null | undefined) =>
  n == null || n === '' ? '—' : `${currency} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** How the organisation's Admin shares a feature (docs/FEATURE_ACCESS.md). */
export const ACCESS_LABEL: Record<'everyone' | 'admins' | 'people' | 'off', string> = { everyone: 'Everyone', admins: 'Admins only', people: 'Chosen people', off: 'No one' };
