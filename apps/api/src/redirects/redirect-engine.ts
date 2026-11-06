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
import { API_TIMEOUT_MS, OutcomeStatus, RedirectConfig, RedirectModeT, RuleSource, RuleType, VENDOR_REDIRECT_MACRO, VendorRedirectUrls, vendorRedirectFor } from './redirect.types';

export interface EngineInput {
  status: OutcomeStatus;
  countryCode: string;
  vendor: { id: string; code: string; name?: string; redirectAllowedDomains: string[]; redirectUrls?: VendorRedirectUrls | null };
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
  /**
   * Set for API destinations: ask `endpoint` for the destination with `payload`. `destination` holds the
   * rule's fallback URL until finishApiRedirect applies the answer.
   */
  api?: { endpoint: string; timeoutMs: number; payload: ApiPayload; allowedDomains: string[] };
  /** True when an API destination failed and the rule's fallback URL was used. */
  apiFallback?: boolean;
}

/** What PROJEXA sends to an API destination endpoint. */
export interface ApiPayload {
  status: string;
  respondent_uid: string | null;
  vendor_id: string;
  country_code: string;
  project_code: string;
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

  // {vendor_redirect}: use the vendor's own saved URL for this status (Vendors → Edit → Redirects).
  let rule = resolved.rule;
  let fromVendor = false;
  if (type !== 'API' && rule.url.trim() === VENDOR_REDIRECT_MACRO) {
    const saved = vendorRedirectFor(input.vendor.redirectUrls, input.status);
    if (!saved) {
      const msg = `${input.vendor.name ?? input.vendor.code} has no saved ${input.status.toLowerCase().replace('_', ' ')} redirect`;
      steps.push({ step: 'vendor-redirect', ok: false, detail: msg });
      return fallback(msg, { ruleSource: resolved.source, ruleType: type });
    }
    rule = { ...rule, url: saved };
    fromVendor = true;
    steps.push({ step: 'vendor-redirect', ok: true, detail: 'Vendor’s saved redirect' });
  }

  const values = {
    respondent_uid: input.vendorRespondentId,
    vendor_id: input.vendor.code,
    country_code: input.countryCode,
    project_code: input.projectCode,
    status: input.status.toLowerCase(),
    session_token: input.sessionToken,
  };

  if (type === 'API') {
    // The fallback is built and checked now, so a failing endpoint always has a safe place to send people.
    const maps = resolveParamMappings(input.config.params, { countryCode: input.countryCode, vendorId: input.vendor.id });
    const fb = buildDestination({ ...resolved.rule, url: resolved.rule.fallbackUrl ?? '' }, 'DYNAMIC', values, maps);
    if (!fb.ok) {
      steps.push({ step: 'build-url', ok: false, detail: `Fallback URL: ${fb.reason}` });
      return fallback(fb.reason, { ruleSource: resolved.source, ruleType: type });
    }
    const fbCheck = checkDestination(fb.url, { allowedDomains: allowed, allowHttp: input.allowHttp, selfHost });
    if (!fbCheck.ok) {
      steps.push({ step: 'security-policy', ok: false, detail: `Fallback URL: ${fbCheck.reason}` });
      return fallback(fbCheck.reason, { ruleSource: resolved.source, ruleType: type });
    }
    steps.push({ step: 'build-url', ok: true, detail: `Destination is asked from ${new URL(resolved.rule.url).host}; fallback ready` });
    return {
      destination: fb.url,
      usedFallback: false,
      ruleSource: resolved.source,
      ruleType: type,
      callbackRequired: resolved.rule.callbackRequired,
      params: fb.params,
      steps,
      api: {
        endpoint: resolved.rule.url,
        timeoutMs: resolved.rule.timeoutMs ?? API_TIMEOUT_MS,
        payload: { status: input.status, respondent_uid: input.vendorRespondentId ?? null, vendor_id: input.vendor.code, country_code: input.countryCode, project_code: input.projectCode },
        allowedDomains: allowed,
      },
    };
  }

  const mappings = type === 'DYNAMIC' ? resolveParamMappings(input.config.params, { countryCode: input.countryCode, vendorId: input.vendor.id }) : [];
  // A vendor's saved URL may carry its own {macros}; static mode fills them but adds nothing else.
  const built = buildDestination(
    rule,
    fromVendor && type === 'STATIC' && /[{}]/.test(rule.url) ? 'DYNAMIC' : type,
    values,
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

/**
 * Applies an API endpoint's answer to an API destination result. The answered URL must pass the same
 * allowlist and protocol checks as any other destination; otherwise the rule's fallback URL stays.
 */
export function finishApiRedirect(result: EngineResult, answer: { url?: string; error?: string; ms: number }, opts: { publicBaseUrl: string; allowHttp: boolean }): EngineResult {
  if (!result.api) return result;
  const steps = [...result.steps];
  const failed = (why: string): EngineResult => {
    steps.push({ step: 'api', ok: false, detail: `${why}; used the fallback URL` });
    return { ...result, steps, apiFallback: true, blockedReason: `API destination: ${why}` };
  };
  if (!answer.url) return failed(answer.error ?? 'No URL in the answer');
  const check = checkDestination(answer.url, { allowedDomains: result.api.allowedDomains, allowHttp: opts.allowHttp, selfHost: new URL(opts.publicBaseUrl).host });
  if (!check.ok) return failed(`answered URL rejected: ${check.reason}`);
  steps.push({ step: 'api', ok: true, detail: `Endpoint answered in ${answer.ms} ms` });
  steps.push({ step: 'security-policy', ok: true, detail: 'Answered URL passed the allowlist and protocol checks' });
  return { ...result, destination: answer.url, params: {}, steps, apiFallback: false };
}
