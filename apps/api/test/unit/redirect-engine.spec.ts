import { diffConfigs } from '../../src/redirects/redirect-diff';
import { computeRedirect, EngineInput, finishApiRedirect } from '../../src/redirects/redirect-engine';
import { checkDestination, hostAllowed, resolveRule, validateConfig } from '../../src/redirects/redirect-resolver';
import { OUTCOME_STATUSES, OutcomeStatus, RedirectConfig, RedirectRule } from '../../src/redirects/redirect.types';

const BASE = 'https://api.projexa.test';
const vendorA = { id: 'vA', code: 'VA', redirectAllowedDomains: ['va.example.com'] };
const vendorB = { id: 'vB', code: 'VB', redirectAllowedDomains: [] };

const params: RedirectConfig['params'] = [
  { canonical: 'respondent_uid', alias: 'uid', required: true },
  { canonical: 'vendor_id', alias: 'vid', required: true },
  { canonical: 'country_code', alias: 'country', required: true },
];

function rule(status: OutcomeStatus, type: 'STATIC' | 'DYNAMIC' | 'API', url: string, extra: Partial<RedirectRule> = {}): RedirectRule {
  return { status, type, url, enabled: true, callbackRequired: false, ...extra };
}

function input(over: Partial<EngineInput>): EngineInput {
  return {
    status: 'COMPLETE',
    countryCode: 'US',
    vendor: vendorA,
    projectCode: 'PRX1',
    vendorRespondentId: 'R 1&x',
    sessionToken: 'tok',
    mode: 'HYBRID',
    config: { rules: [], params },
    organizationDomains: ['client.example.com', '*.ends.example.com'],
    publicBaseUrl: BASE,
    allowHttp: false,
    ...over,
  };
}

describe('static mode', () => {
  it('uses fixed URLs for all eight statuses', () => {
    const rules = OUTCOME_STATUSES.map((s) => rule(s, 'STATIC', `https://client.example.com/end/${s.toLowerCase()}`));
    for (const status of OUTCOME_STATUSES) {
      const r = computeRedirect(input({ status, mode: 'STATIC', config: { rules, params } }));
      expect(r.usedFallback).toBe(false);
      expect(r.destination).toBe(`https://client.example.com/end/${status.toLowerCase()}`);
      expect(r.params).toEqual({});
    }
  });
});

describe('dynamic mode', () => {
  it('maps UID, Vendor ID and Country Code with URL encoding', () => {
    const r = computeRedirect(input({ mode: 'DYNAMIC', config: { rules: [rule('COMPLETE', 'DYNAMIC', 'https://va.example.com/c?x=1')], params } }));
    const url = new URL(r.destination);
    expect(url.searchParams.get('uid')).toBe('R 1&x');
    expect(url.searchParams.get('vid')).toBe('VA');
    expect(url.searchParams.get('country')).toBe('US');
    expect(url.searchParams.get('x')).toBe('1');
    expect(r.destination).not.toContain('R 1&x'); // encoded, no injection
  });

  it('substitutes macros and uses vendor-specific aliases', () => {
    const cfg: RedirectConfig = {
      rules: [rule('TERMINATE', 'DYNAMIC', 'https://va.example.com/t/{country_code}?ref={respondent_uid}')],
      params: [...params, { canonical: 'respondent_uid', alias: 'respondent_id', required: true, scope: { vendorId: 'vA' } }],
    };
    const r = computeRedirect(input({ status: 'TERMINATE', config: cfg }));
    const url = new URL(r.destination);
    expect(url.pathname).toBe('/t/US');
    expect(url.searchParams.get('ref')).toBe('R 1&x');
    expect(url.searchParams.get('respondent_id')).toBe('R 1&x');
    expect(url.searchParams.get('uid')).toBeNull();
  });

  it('falls back when a required parameter is missing', () => {
    const r = computeRedirect(input({ vendorRespondentId: undefined, config: { rules: [rule('COMPLETE', 'DYNAMIC', 'https://va.example.com/c')], params } }));
    expect(r.usedFallback).toBe(true);
    expect(r.blockedReason).toMatch(/respondent_uid/);
    expect(r.destination).toBe(`${BASE}/end/complete`);
  });
});

describe('hybrid mode', () => {
  it('lets each status use a different redirect type', () => {
    const cfg: RedirectConfig = {
      rules: [
        rule('COMPLETE', 'DYNAMIC', 'https://va.example.com/c'),
        rule('QUOTA_FULL', 'STATIC', 'https://client.example.com/qf'),
      ],
      params,
    };
    const c = computeRedirect(input({ config: cfg }));
    const q = computeRedirect(input({ status: 'QUOTA_FULL', config: cfg }));
    expect(c.ruleType).toBe('DYNAMIC');
    expect(new URL(c.destination).searchParams.get('uid')).toBe('R 1&x');
    expect(q.ruleType).toBe('STATIC');
    expect(q.destination).toBe('https://client.example.com/qf');
  });
});

describe('precedence', () => {
  const cfg: RedirectConfig = {
    rules: [
      rule('COMPLETE', 'STATIC', 'https://client.example.com/project'),
      rule('COMPLETE', 'STATIC', 'https://client.example.com/country-de', { scope: { countryCode: 'DE' } }),
      rule('COMPLETE', 'STATIC', 'https://client.example.com/vendor-a', { scope: { vendorId: 'vA' } }),
      rule('COMPLETE', 'STATIC', 'https://client.example.com/vendor-a-de', { scope: { vendorId: 'vA', countryCode: 'DE' } }),
    ],
    params,
  };
  const dest = (countryCode: string, vendor = vendorA) => computeRedirect(input({ countryCode, vendor, config: cfg }));

  it('vendor+country beats vendor beats country beats project', () => {
    expect(dest('DE').destination).toBe('https://client.example.com/vendor-a-de');
    expect(dest('DE').ruleSource).toBe('project:vendor+country');
    expect(dest('US').destination).toBe('https://client.example.com/vendor-a');
    expect(dest('DE', vendorB).destination).toBe('https://client.example.com/country-de');
    expect(dest('US', vendorB).destination).toBe('https://client.example.com/project');
  });

  it('falls through project → client template → organization default', () => {
    const tpl = { rules: [rule('TERMINATE', 'STATIC', 'https://client.example.com/tpl')], params: [] };
    const org = { rules: [rule('PARTIAL', 'STATIC', 'https://client.example.com/org')], params: [] };
    const t = computeRedirect(input({ status: 'TERMINATE', config: cfg, clientTemplate: tpl, organizationDefault: org }));
    const p = computeRedirect(input({ status: 'PARTIAL', config: cfg, clientTemplate: tpl, organizationDefault: org }));
    expect(t.ruleSource).toBe('client-template');
    expect(p.ruleSource).toBe('organization-default');
  });

  it('refuses to pick between two equally specific rules', () => {
    const conflict = { rules: [rule('COMPLETE', 'STATIC', 'https://client.example.com/a'), rule('COMPLETE', 'STATIC', 'https://client.example.com/b')], params };
    const r = resolveRule({ status: 'COMPLETE', countryCode: 'US', vendorId: 'vA' }, { project: conflict });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('CONFLICT');
    expect(computeRedirect(input({ config: conflict })).usedFallback).toBe(true);
  });

  it('a disabled specific rule disables the status instead of falling through', () => {
    const c = { rules: [rule('COMPLETE', 'STATIC', 'https://client.example.com/a'), rule('COMPLETE', 'STATIC', 'https://client.example.com/x', { enabled: false, scope: { vendorId: 'vA' } })], params };
    expect(computeRedirect(input({ config: c })).usedFallback).toBe(true);
  });
});

describe('security policy', () => {
  it('rejects invalid URLs and non-https', () => {
    expect(checkDestination('not a url', { allowedDomains: ['x.com'] }).ok).toBe(false);
    expect(checkDestination('http://x.com', { allowedDomains: ['x.com'] }).ok).toBe(false);
    expect(checkDestination('javascript:alert(1)', { allowedDomains: ['x.com'] }).ok).toBe(false);
    expect(checkDestination('https://u:p@x.com', { allowedDomains: ['x.com'] }).ok).toBe(false);
  });

  it('blocks domains that are not allowlisted, even from an override', () => {
    const cfg = { rules: [rule('COMPLETE', 'STATIC', 'https://evil.example.org/x', { scope: { vendorId: 'vA', countryCode: 'US' } })], params };
    const r = computeRedirect(input({ config: cfg }));
    expect(r.usedFallback).toBe(true);
    expect(r.blockedReason).toMatch(/allowlist/);
  });

  it('vendor domains only apply to that vendor', () => {
    const cfg = { rules: [rule('COMPLETE', 'STATIC', 'https://va.example.com/x')], params };
    expect(computeRedirect(input({ config: cfg })).usedFallback).toBe(false);
    expect(computeRedirect(input({ config: cfg, vendor: vendorB })).usedFallback).toBe(true);
  });

  it('wildcards match subdomains but not look-alikes', () => {
    expect(hostAllowed('a.ends.example.com', ['*.ends.example.com'])).toBe(true);
    expect(hostAllowed('ends.example.com', ['*.ends.example.com'])).toBe(true);
    expect(hostAllowed('badends.example.com', ['*.ends.example.com'])).toBe(false);
    expect(hostAllowed('ends.example.com.evil.org', ['*.ends.example.com'])).toBe(false);
  });

  it('prevents redirect loops back into SampTrek entry/outcome links', () => {
    const r = checkDestination(`${BASE}/r/complete?token=x`, { allowedDomains: ['api.projexa.test'], selfHost: 'api.projexa.test' });
    expect(r.ok).toBe(false);
  });

  it('technical error with no rule falls back safely to the SampTrek end page', () => {
    const r = computeRedirect(input({ status: 'TECHNICAL_ERROR' }));
    expect(r.usedFallback).toBe(true);
    expect(r.destination).toBe(`${BASE}/end/technical_error`);
  });

  it('uses the organization fallback only if it passes the policy', () => {
    const ok = computeRedirect(input({ status: 'PARTIAL', organizationFallbackUrl: 'https://client.example.com/fallback' }));
    const bad = computeRedirect(input({ status: 'PARTIAL', organizationFallbackUrl: 'https://evil.example.org/fallback' }));
    expect(ok.destination).toBe('https://client.example.com/fallback');
    expect(bad.destination).toBe(`${BASE}/end/partial`);
  });
});

describe('validateConfig', () => {
  const opts = { allowedDomainsFor: () => ['client.example.com'] };
  it('flags static URLs with macros, unknown macros, duplicates and wrong-mode rules', () => {
    const issues = validateConfig(
      {
        rules: [
          rule('COMPLETE', 'STATIC', 'https://client.example.com/{respondent_uid}'),
          rule('TERMINATE', 'DYNAMIC', 'https://client.example.com/?a={password}'),
          rule('PARTIAL', 'STATIC', 'https://client.example.com/p'),
          rule('PARTIAL', 'STATIC', 'https://client.example.com/p2'),
        ],
        params,
      },
      'HYBRID',
      opts,
    );
    const msgs = issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/Static URLs cannot contain/);
    expect(msgs).toMatch(/Unknown macro \{password\}/);
    expect(msgs).toMatch(/2 rules for PARTIAL/);
    const staticMode = validateConfig({ rules: [rule('COMPLETE', 'DYNAMIC', 'https://client.example.com/')], params }, 'STATIC', opts);
    expect(staticMode.some((i) => /STATIC mode only allows/.test(i.message))).toBe(true);
  });
  it('accepts a clean hybrid configuration', () => {
    const issues = validateConfig(
      { rules: [rule('COMPLETE', 'DYNAMIC', 'https://client.example.com/c?u={respondent_uid}'), rule('QUOTA_FULL', 'STATIC', 'https://client.example.com/q')], params },
      'HYBRID',
      opts,
    );
    expect(issues).toEqual([]);
  });
});

describe('API destinations', () => {
  const api = (extra: Partial<RedirectRule> = {}) => rule('COMPLETE', 'API', 'https://router.client.example.com/route', { fallbackUrl: 'https://client.example.com/fb?u={respondent_uid}', ...extra });

  it('prepares the request and a checked fallback, then takes an allowed answer', () => {
    const r = computeRedirect(input({ config: { rules: [api({ timeoutMs: 900 })], params } }));
    expect(r.api).toMatchObject({ endpoint: 'https://router.client.example.com/route', timeoutMs: 900, payload: { status: 'COMPLETE', respondent_uid: 'R 1&x', vendor_id: 'VA', country_code: 'US', project_code: 'PRX1' } });
    expect(r.destination).toBe('https://client.example.com/fb?u=R+1%26x&uid=R+1%26x&vid=VA&country=US');
    const ok = finishApiRedirect(r, { url: 'https://va.example.com/thanks', ms: 12 }, { publicBaseUrl: BASE, allowHttp: false });
    expect(ok).toMatchObject({ destination: 'https://va.example.com/thanks', apiFallback: false });
  });

  it('keeps the fallback when the answer fails or is not allowed', () => {
    const r = computeRedirect(input({ config: { rules: [api()], params } }));
    const none = finishApiRedirect(r, { error: 'no answer within 1500 ms', ms: 1500 }, { publicBaseUrl: BASE, allowHttp: false });
    expect(none).toMatchObject({ destination: r.destination, apiFallback: true, blockedReason: 'API destination: no answer within 1500 ms' });
    for (const url of ['https://evil.example.org/', 'javascript:alert(1)', 'http://client.example.com/x', `${BASE}/s/abc`]) {
      expect(finishApiRedirect(r, { url, ms: 3 }, { publicBaseUrl: BASE, allowHttp: false }).apiFallback).toBe(true);
    }
  });

  it('validation rejects API rules outside hybrid mode or without a fallback', () => {
    const opts = { allowedDomainsFor: () => ['client.example.com', '*.client.example.com'] };
    expect(validateConfig({ rules: [api()], params }, 'HYBRID', opts).filter((i) => i.level === 'error')).toEqual([]);
    expect(validateConfig({ rules: [api()], params }, 'DYNAMIC', opts).some((i) => i.level === 'error')).toBe(true);
    expect(validateConfig({ rules: [api({ fallbackUrl: undefined })], params }, 'HYBRID', opts).some((i) => /fallback/i.test(i.message))).toBe(true);
  });
});

describe('version diff', () => {
  it('reports added, removed and changed rules and a mode change', () => {
    const a = { mode: 'HYBRID' as const, config: { rules: [rule('COMPLETE', 'STATIC', 'https://a/'), rule('TERMINATE', 'STATIC', 'https://t/')], params } };
    const b = { mode: 'STATIC' as const, config: { rules: [rule('COMPLETE', 'STATIC', 'https://b/'), rule('QUOTA_FULL', 'STATIC', 'https://q/', { scope: { countryCode: 'DE' } })], params: params.slice(1) } };
    const d = diffConfigs(a, b);
    expect(d.mode).toEqual({ before: 'HYBRID', after: 'STATIC' });
    expect(d.rules.map((c) => `${c.kind}:${c.status}`).sort()).toEqual(['added:QUOTA_FULL', 'changed:COMPLETE', 'removed:TERMINATE']);
    expect(d.rules.find((c) => c.kind === 'changed')!.fields).toEqual([{ field: 'url', before: 'https://a/', after: 'https://b/' }]);
    expect(d.params).toHaveLength(1);
    expect(diffConfigs(a, a)).toMatchObject({ mode: null, rules: [], params: [], unchangedRules: 2 });
  });
});
