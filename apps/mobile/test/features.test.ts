import { computeAccess, featureForRoute, FEATURES, homeRoute, parseSwitches, type FeatureSwitches } from '../src/lib/features';

const on = (keys: string[], enabled = true): FeatureSwitches => ({
  version: 'v1',
  plan: 'Pro',
  web: Object.fromEntries(keys.map((k) => [k, true])),
  mobile: { enabled, features: Object.fromEntries(keys.map((k) => [k, true])) },
});

describe('computeAccess', () => {
  it('uses role rules when the server has no Super Admin switches', () => {
    const pm = computeAccess('PROJECT_MANAGER', null);
    expect(pm.allowed.has('projects')).toBe(true);
    expect(pm.allowed.has('projects.create')).toBe(true);
    expect(pm.allowed.has('team')).toBe(false); // admin only
    expect(pm.allowed.has('portal.client')).toBe(false);
    expect(pm.version).toBeNull();

    const viewer = computeAccess('VIEWER', null);
    expect(viewer.allowed.has('projects.create')).toBe(false);
    expect(computeAccess('ADMIN', null).allowed.has('team')).toBe(true);
    expect(computeAccess('ADMIN', null).allowed.has('portal.vendor')).toBe(false);
  });

  it('shows only what Super Admin switched on for mobile', () => {
    const a = computeAccess('ADMIN', on(['dashboard', 'projects']));
    expect([...a.allowed].sort()).toEqual(['dashboard', 'projects']);
    expect(a.version).toBe('v1');
    expect(a.plan).toBe('Pro');
  });

  it('a feature missing from the switches is off', () => {
    const s = on(['dashboard']);
    s.web.monitor = true; // on for web only
    expect(computeAccess('ADMIN', s).allowed.has('monitor')).toBe(false);
  });

  it('never lets a switch exceed what the role may do', () => {
    const a = computeAccess('VIEWER', on(['projects.create', 'team', 'projects']));
    expect([...a.allowed]).toEqual(['projects']);
  });

  it('turns everything off when the mobile app is off for the person', () => {
    const a = computeAccess('ADMIN', on(['dashboard'], false));
    expect(a.allowed.size).toBe(0);
    expect(a.block).toBe('MOBILE_DISABLED');
  });

  it('turns everything off when the account is suspended', () => {
    const a = computeAccess('ADMIN', on(['dashboard']), 'ORG_SUSPENDED');
    expect(a.allowed.size).toBe(0);
    expect(a.block).toBe('ORG_SUSPENDED');
  });

  it('gives portal users only their portal', () => {
    const v = computeAccess('VENDOR_USER', on(FEATURES.map((f) => f.key)));
    expect([...v.allowed]).toEqual(['portal.vendor']);
  });
});

describe('web-only pages', () => {
  it('follow the web switch, since they open on the web', () => {
    const s = on(['dashboard']);
    s.web.team = true;
    s.web.accounting = false;
    const a = computeAccess('ADMIN', s);
    expect(a.allowed.has('team')).toBe(true);
    expect(a.allowed.has('accounting')).toBe(false);
  });
  it('the server block field blocks everything', () => {
    const a = computeAccess('ADMIN', parseSwitches({ version: '1', block: 'ORG_PENDING', web: {}, mobile: { enabled: true, features: { dashboard: true } } }));
    expect(a.block).toBe('ORG_PENDING');
    expect(a.allowed.size).toBe(0);
  });
});

describe('parseSwitches', () => {
  it('accepts the documented shape and drops non-boolean values', () => {
    const s = parseSwitches({ version: '7', plan: null, web: { a: true, b: 'yes' }, mobile: { enabled: true, features: { projects: true, x: 1 } } });
    expect(s).toEqual({ version: '7', plan: null, web: { a: true }, mobile: { enabled: true, features: { projects: true } } });
  });
  it('rejects anything else', () => {
    expect(parseSwitches(null)).toBeNull();
    expect(parseSwitches({ features: [] })).toBeNull();
    expect(parseSwitches({ version: 1, mobile: {} })).toBeNull();
  });
  it('treats a missing enabled flag as off', () => {
    expect(parseSwitches({ version: '1', mobile: { features: {} } })?.mobile.enabled).toBe(false);
  });
});

describe('routes', () => {
  it('maps screens to their feature', () => {
    expect(featureForRoute('/project/abc')?.key).toBe('projects');
    expect(featureForRoute('/request/abc')?.key).toBe('requests');
    expect(featureForRoute('/portal/vendor')?.key).toBe('portal.vendor');
    expect(featureForRoute('/redirect-health?x=1')?.key).toBe('redirect_health');
    expect(featureForRoute('/account')).toBeUndefined();
  });
  it('opens the first allowed screen', () => {
    expect(homeRoute('ADMIN', computeAccess('ADMIN', null))).toBe('/home');
    expect(homeRoute('ADMIN', computeAccess('ADMIN', on(['monitor'])))).toBe('/monitor');
    expect(homeRoute('ADMIN', computeAccess('ADMIN', on(['clients'])))).toBe('/more');
    expect(homeRoute('CLIENT_USER', computeAccess('CLIENT_USER', on(['portal.client'])))).toBe('/portal/client');
    expect(homeRoute('CLIENT_USER', computeAccess('CLIENT_USER', on([])))).toBe('/blocked');
    expect(homeRoute('ADMIN', computeAccess('ADMIN', on(['dashboard'], false)))).toBe('/blocked');
  });
});
