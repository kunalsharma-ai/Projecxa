/**
 * The single redirect computation used by live respondent traffic and by the QA studio.
 * It has no I/O: callers load the configuration and persist the result.
 */
import {
  buildDestination,
  checkDestination,
  effectiveRuleType,
  resolveParamMappings,
  resolveRule,
} from './redirect-resolver';
import { OutcomeStatus, RedirectConfig, RedirectModeT, RuleSource, RuleType } from './redirect.types';

export interface EngineInput {
  status: OutcomeStatus;
  countryCode: string;
  vendor: { id: string; code: string; redirectAllowedDomains: string[] };
  projectCode: string;
  vendorRespondentId?: string;
  sessionToken?: string;
  mode: RedirectModeT;
  config: RedirectConfig;
  clientTemplate?: RedirectConfig | null;
  organizationDefault?: RedirectConfig | null;
  organizationDomains: string[];
  organizationFallbackUrl?: string | null;
  publicBaseUrl: string;
  allowHttp: boolean;
}

export interface EngineStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface EngineResult {
  destination: string;
  usedFallback: boolean;
  ruleSource?: RuleSource;
  ruleType?: RuleType;
  callbackRequired: boolean;
  params: Record<string, string>;
  blockedReason?: string;
  steps: EngineStep[];
}

export function internalEndPage(publicBaseUrl: string, status: OutcomeStatus) {
  return `${publicBaseUrl}/end/${status.toLowerCase()}`;
}

export function computeRedirect(input: EngineInput): EngineResult {
  const steps: EngineStep[] = [];
  const selfHost = new URL(input.publicBaseUrl).host;
  const allowed = [...input.organizationDomains, ...input.vendor.redirectAllowedDomains];

  const fallback = (reason: string, partial: Partial<EngineResult> = {}): EngineResult => {
    let destination = internalEndPage(input.publicBaseUrl, input.status);
    if (input.organizationFallbackUrl) {
      const chk = checkDestination(input.organizationFallbackUrl, {
        allowedDomains: input.organizationDomains,
        allowHttp: input.allowHttp,
        selfHost,
      });
      if (chk.ok) destination = input.organizationFallbackUrl;
      steps.push({ step: 'fallback', ok: chk.ok, detail: chk.ok ? 'Organization fallback URL' : `Organization fallback rejected: ${chk.reason}` });
    } else {
      steps.push({ step: 'fallback', ok: true, detail: 'PROJEXA end page (no organization fallback configured)' });
    }
    return { destination, usedFallback: true, callbackRequired: false, params: {}, blockedReason: reason, steps, ...partial };
  };

  const resolved = resolveRule(
    { status: input.status, countryCode: input.countryCode, vendorId: input.vendor.id },
    { project: input.config, clientTemplate: input.clientTemplate, organizationDefault: input.organizationDefault },
  );
  if (!resolved.ok) {
    const msg =
      resolved.reason === 'NO_RULE'
        ? `No ${input.status} rule at any level`
        : resolved.reason === 'DISABLED'
          ? `${input.status} is disabled at ${resolved.source}`
          : `Conflicting rules: ${resolved.detail}`;
    steps.push({ step: 'resolve-rule', ok: false, detail: msg });
    return fallback(msg);
  }
  const type = effectiveRuleType(input.mode, resolved.rule);
  steps.push({ step: 'resolve-rule', ok: true, detail: `${resolved.source} → ${type} rule` });

  const mappings = type === 'DYNAMIC' ? resolveParamMappings(input.config.params, { countryCode: input.countryCode, vendorId: input.vendor.id }) : [];
  const built = buildDestination(
    resolved.rule,
    type,
    {
      respondent_uid: input.vendorRespondentId,
      vendor_id: input.vendor.code,
      country_code: input.countryCode,
      project_code: input.projectCode,
      status: input.status.toLowerCase(),
      session_token: input.sessionToken,
    },
    mappings,
  );
  if (!built.ok) {
    steps.push({ step: 'build-url', ok: false, detail: built.reason });
    return fallback(built.reason, { ruleSource: resolved.source, ruleType: type });
  }
  steps.push({
    step: 'build-url',
    ok: true,
    detail: type === 'DYNAMIC' ? `Parameters: ${Object.keys(built.params).join(', ') || 'macros only'}` : 'Fixed URL',
  });

  const check = checkDestination(built.url, { allowedDomains: allowed, allowHttp: input.allowHttp, selfHost });
  if (!check.ok) {
    steps.push({ step: 'security-policy', ok: false, detail: check.reason });
    return fallback(check.reason, { ruleSource: resolved.source, ruleType: type });
  }
  steps.push({ step: 'security-policy', ok: true, detail: 'Destination passed the allowlist and protocol checks' });

  return {
    destination: built.url,
    usedFallback: false,
    ruleSource: resolved.source,
    ruleType: type,
    callbackRequired: resolved.rule.callbackRequired,
    params: built.params,
    steps,
  };
}
