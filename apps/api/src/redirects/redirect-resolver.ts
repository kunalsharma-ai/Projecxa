/**
 * Pure redirect resolution logic (no I/O). Everything here is deterministic so it
 * can be unit tested exhaustively and reused by the live engine and the QA studio.
 */
import {
  CanonicalParam,
  OutcomeStatus,
  ParamMapping,
  RedirectConfig,
  RedirectModeT,
  RedirectRule,
  RuleScope,
  RuleSource,
  RuleType,
} from './redirect.types';

export interface ResolveContext {
  status: OutcomeStatus;
  countryCode: string;
  vendorId: string;
}

export interface ConfigLayers {
  project?: RedirectConfig | null;
  clientTemplate?: RedirectConfig | null;
  organizationDefault?: RedirectConfig | null;
}

export type RuleResolution =
  | { ok: true; rule: RedirectRule; source: RuleSource }
  | { ok: false; reason: 'NO_RULE' | 'CONFLICT' | 'DISABLED'; source?: RuleSource; detail?: string };

function scopeLevel(scope: RuleScope | undefined): 0 | 1 | 2 | 3 {
  // 3 = vendor+country, 2 = vendor, 1 = country, 0 = project-wide
  const v = !!scope?.vendorId;
  const c = !!scope?.countryCode;
  if (v && c) return 3;
  if (v) return 2;
  if (c) return 1;
  return 0;
}

const PROJECT_SOURCES: Record<0 | 1 | 2 | 3, RuleSource> = {
  3: 'project:vendor+country',
  2: 'project:vendor',
  1: 'project:country',
  0: 'project',
};

function scopeMatches(scope: RuleScope | undefined, ctx: Pick<ResolveContext, 'countryCode' | 'vendorId'>): boolean {
  if (scope?.countryCode && scope.countryCode !== ctx.countryCode) return false;
  if (scope?.vendorId && scope.vendorId !== ctx.vendorId) return false;
  return true;
}

function pickFrom(
  rules: RedirectRule[],
  ctx: ResolveContext,
  sourceFor: (level: 0 | 1 | 2 | 3) => RuleSource,
): RuleResolution | null {
  const matching = rules.filter((r) => r.status === ctx.status && scopeMatches(r.scope, ctx));
  for (const level of [3, 2, 1, 0] as const) {
    const atLevel = matching.filter((r) => scopeLevel(r.scope) === level);
    if (atLevel.length === 0) continue;
    const source = sourceFor(level);
    if (atLevel.length > 1) {
      return { ok: false, reason: 'CONFLICT', source, detail: `${atLevel.length} rules for ${ctx.status} at ${source}` };
    }
    const rule = atLevel[0];
    if (!rule.enabled) return { ok: false, reason: 'DISABLED', source };
    return { ok: true, rule, source };
  }
  return null;
}

/**
 * Resolve exactly one effective rule for a session + status, following:
 * project vendor+country → project vendor → project country → project → client template → organization default.
 * Two equally specific rules are a CONFLICT (never pick one arbitrarily).
 */
export function resolveRule(ctx: ResolveContext, layers: ConfigLayers): RuleResolution {
  const fromProject = layers.project ? pickFrom(layers.project.rules, ctx, (l) => PROJECT_SOURCES[l]) : null;
  if (fromProject) return fromProject;
  // Templates are applied as project-wide defaults, but they may carry scoped rules as well.
  const fromClient = layers.clientTemplate ? pickFrom(layers.clientTemplate.rules, ctx, () => 'client-template') : null;
  if (fromClient) return fromClient;
  const fromOrg = layers.organizationDefault
    ? pickFrom(layers.organizationDefault.rules, ctx, () => 'organization-default')
    : null;
  if (fromOrg) return fromOrg;
  return { ok: false, reason: 'NO_RULE' };
}

/** The rule type that actually applies: STATIC/DYNAMIC modes force every rule to that type. */
export function effectiveRuleType(mode: RedirectModeT, rule: RedirectRule): RuleType {
  return mode === 'HYBRID' ? rule.type : mode;
}

/** Most specific parameter mapping per canonical parameter (vendor+country → vendor → country → global). */
export function resolveParamMappings(
  mappings: ParamMapping[],
  ctx: Pick<ResolveContext, 'countryCode' | 'vendorId'>,
): ParamMapping[] {
  const best = new Map<CanonicalParam, { level: number; m: ParamMapping }>();
  for (const m of mappings) {
    if (!scopeMatches(m.scope, ctx)) continue;
    const level = scopeLevel(m.scope);
    const cur = best.get(m.canonical);
    if (!cur || level > cur.level) best.set(m.canonical, { level, m });
  }
  return [...best.values()].map((b) => b.m);
}

export type ParamValues = Partial<Record<CanonicalParam, string>>;

const MACRO_RE = /\{([a-z_]+)\}/g;

export type BuildResult =
  | { ok: true; url: string; params: Record<string, string> }
  | { ok: false; reason: string };

/**
 * Build the destination URL.
 * STATIC: URL is used exactly as configured (it must not contain macros).
 * DYNAMIC: {macro} placeholders are substituted (URL-encoded), then mapped parameters are
 * set on the query string under their configured aliases.
 */
export function buildDestination(
  rule: RedirectRule,
  type: RuleType,
  values: ParamValues,
  mappings: ParamMapping[],
): BuildResult {
  if (type === 'STATIC') {
    if (/[{}]/.test(rule.url)) return { ok: false, reason: 'Static URL contains unresolved macros' };
    return { ok: true, url: rule.url, params: {} };
  }

  let missing: string | null = null;
  let unknown: string | null = null;
  const substituted = rule.url.replace(MACRO_RE, (_m, name: string) => {
    if (!(name in KNOWN_MACROS)) {
      unknown = name;
      return '';
    }
    const v = values[name as CanonicalParam];
    if (v === undefined || v === '') {
      missing = name;
      return '';
    }
    return encodeURIComponent(v);
  });
  if (unknown) return { ok: false, reason: `Unknown macro {${unknown}}` };
  if (missing) return { ok: false, reason: `Missing value for {${missing}}` };
  if (/[{}]/.test(substituted)) return { ok: false, reason: 'Malformed macro in URL' };

  let url: URL;
  try {
    url = new URL(substituted);
  } catch {
    return { ok: false, reason: 'Destination is not a valid absolute URL' };
  }

  const applied: Record<string, string> = {};
  for (const m of mappings) {
    const v = values[m.canonical];
    if (v === undefined || v === '') {
      if (m.required) return { ok: false, reason: `Missing required parameter ${m.canonical}` };
      continue;
    }
    url.searchParams.set(m.alias, v); // URLSearchParams handles encoding; no string concatenation.
    applied[m.alias] = v;
  }
  return { ok: true, url: url.toString(), params: applied };
}

const KNOWN_MACROS: Record<CanonicalParam, true> = {
  respondent_uid: true,
  vendor_id: true,
  country_code: true,
  project_code: true,
  status: true,
  session_token: true,
};

export function macrosIn(url: string): string[] {
  return [...url.matchAll(MACRO_RE)].map((m) => m[1]);
}
export function isKnownMacro(name: string): boolean {
  return name in KNOWN_MACROS;
}

export interface DestinationPolicy {
  /** Hostnames allowed for this session ("example.com" or "*.example.com"). */
  allowedDomains: string[];
  /** Host of this API; redirecting back into our own entry/outcome endpoints would loop. */
  selfHost?: string;
  allowHttp?: boolean;
}

export function hostAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((raw) => {
    const d = raw.trim().toLowerCase();
    if (!d) return false;
    if (d.startsWith('*.')) {
      const base = d.slice(2);
      return h === base || h.endsWith('.' + base);
    }
    return h === d;
  });
}

/** Mandatory security policy. Overrides can never bypass this. */
export function checkDestination(raw: string, policy: DestinationPolicy): { ok: true } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) {
    return { ok: false, reason: `Protocol ${url.protocol} is not allowed` };
  }
  if (url.username || url.password) return { ok: false, reason: 'Credentials in URL are not allowed' };
  if (policy.selfHost && url.host.toLowerCase() === policy.selfHost.toLowerCase()) {
    if (/^\/(s|r)\//.test(url.pathname)) return { ok: false, reason: 'Redirect loop: destination is a SampTrek entry or outcome link' };
  }
  if (!hostAllowed(url.hostname, policy.allowedDomains)) {
    return { ok: false, reason: `Domain ${url.hostname} is not on the allowlist` };
  }
  return { ok: true };
}

export interface ConfigIssue {
  level: 'error' | 'warning';
  message: string;
  status?: OutcomeStatus;
  scope?: RuleScope;
}

/**
 * Validate a project redirect configuration before it can be saved or activated.
 * Checks mode consistency, duplicate rules at the same specificity, macro usage,
 * URL shape and the domain allowlist.
 */
export function validateConfig(
  config: RedirectConfig,
  mode: RedirectModeT,
  opts: { allowedDomainsFor: (vendorId?: string) => string[]; allowHttp?: boolean; selfHost?: string },
): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const seen = new Map<string, number>();
  for (const r of config.rules) {
    const key = `${r.status}|${r.scope?.vendorId ?? ''}|${r.scope?.countryCode ?? ''}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const type = effectiveRuleType(mode, r);
    const allowedDomains = opts.allowedDomainsFor(r.scope?.vendorId);
    if (r.type === 'API') {
      if (mode !== 'HYBRID') issues.push({ level: 'error', status: r.status, scope: r.scope, message: 'API destinations need hybrid mode' });
      if (/[{}]/.test(r.url)) issues.push({ level: 'error', status: r.status, scope: r.scope, message: 'The API endpoint cannot contain {macros}; respondent details are sent in the request body' });
      else {
        const ep = checkDestination(r.url, { allowedDomains, allowHttp: opts.allowHttp, selfHost: opts.selfHost });
        if (!ep.ok) issues.push({ level: 'error', status: r.status, scope: r.scope, message: `API endpoint: ${ep.reason}` });
      }
      if (!r.fallbackUrl?.trim()) issues.push({ level: 'error', status: r.status, scope: r.scope, message: 'API destinations need a fallback URL for when the endpoint fails' });
      else {
        for (const m of macrosIn(r.fallbackUrl)) if (!isKnownMacro(m)) issues.push({ level: 'error', status: r.status, scope: r.scope, message: `Unknown macro {${m}} in fallback URL` });
        const fb = checkDestination(r.fallbackUrl.replace(MACRO_RE, 'x'), { allowedDomains, allowHttp: opts.allowHttp, selfHost: opts.selfHost });
        if (!fb.ok) issues.push({ level: 'error', status: r.status, scope: r.scope, message: `Fallback URL: ${fb.reason}` });
      }
      continue;
    }
    if (r.fallbackUrl || r.timeoutMs) issues.push({ level: 'warning', status: r.status, scope: r.scope, message: 'Fallback URL and timeout only apply to API destinations' });
    if (mode !== 'HYBRID' && r.type !== mode) {
      issues.push({ level: 'error', status: r.status, scope: r.scope, message: `${mode} mode only allows ${mode} rules` });
    }
    const macros = macrosIn(r.url);
    if (type === 'STATIC' && /[{}]/.test(r.url)) {
      issues.push({ level: 'error', status: r.status, scope: r.scope, message: 'Static URLs cannot contain {macros}' });
    }
    for (const m of macros) {
      if (!isKnownMacro(m)) issues.push({ level: 'error', status: r.status, scope: r.scope, message: `Unknown macro {${m}}` });
    }
    // Validate the URL shape with macros replaced by sample values.
    const sample = r.url.replace(MACRO_RE, 'x');
    const check = checkDestination(sample, {
      allowedDomains,
      allowHttp: opts.allowHttp,
      selfHost: opts.selfHost,
    });
    if (!check.ok) issues.push({ level: 'error', status: r.status, scope: r.scope, message: check.reason });
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      const [status, vendorId, countryCode] = key.split('|');
      issues.push({
        level: 'error',
        status: status as OutcomeStatus,
        scope: { vendorId: vendorId || undefined, countryCode: countryCode || undefined },
        message: `${count} rules for ${status} at the same scope; keep one`,
      });
    }
  }
  const paramSeen = new Set<string>();
  for (const p of config.params) {
    const key = `${p.canonical}|${p.scope?.vendorId ?? ''}|${p.scope?.countryCode ?? ''}`;
    if (paramSeen.has(key)) issues.push({ level: 'error', message: `Duplicate mapping for ${p.canonical} at the same scope` });
    paramSeen.add(key);
  }
  return issues;
}
