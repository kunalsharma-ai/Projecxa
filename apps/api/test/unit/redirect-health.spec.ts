import { healthOf, isPrivateAddress, reasonKey, redactQuery } from '../../src/redirect-health/redirect-health';

const base = { entries: 100, redirects: 100, fallbacks: 0, p95Ms: 120, expired: 0, callbacksDead: 0, callbacksRetrying: 0 };

describe('redirect health rules', () => {
  it('labels healthy, watch, failing and idle', () => {
    expect(healthOf(base)).toEqual({ health: 'healthy', reasons: [] });
    expect(healthOf({ ...base, fallbacks: 6 }).health).toBe('watch');
    expect(healthOf({ ...base, fallbacks: 25 })).toEqual({ health: 'failing', reasons: ['25% of redirects fell back'] });
    expect(healthOf({ ...base, p95Ms: 900 }).health).toBe('watch');
    expect(healthOf({ ...base, p95Ms: 2500 }).health).toBe('failing');
    expect(healthOf({ ...base, callbacksRetrying: 2 }).reasons).toEqual(['2 vendor callbacks retrying']);
    expect(healthOf({ ...base, callbacksDead: 1 }).reasons).toEqual(['1 vendor callback gave up']);
    expect(healthOf({ ...base, expired: 60 }).health).toBe('watch');
    expect(healthOf({ entries: 0, redirects: 0, fallbacks: 0, p95Ms: null, expired: 0, callbacksDead: 0, callbacksRetrying: 0 }).health).toBe('idle');
  });

  it('needs enough traffic before a fallback share counts', () => {
    expect(healthOf({ ...base, redirects: 4, fallbacks: 4 }).health).toBe('healthy');
    expect(healthOf({ ...base, entries: 15, expired: 9 }).health).toBe('healthy');
  });

  it('lists failing reasons before watch reasons', () => {
    expect(healthOf({ ...base, fallbacks: 30, callbacksRetrying: 1 }).reasons).toEqual(['30% of redirects fell back', '1 vendor callback retrying']);
  });

  it('groups blocked reasons that differ only in details', () => {
    expect(reasonKey('Domain evil.example is not on the allowlist')).toBe(reasonKey('Domain other.example is not on the allowlist'));
    expect(reasonKey('API destination: timed out after 1500 ms; extra')).toBe('API destination: timed out after N ms');
    expect(reasonKey('Bad https://a.example/x?y=1 link')).toBe('Bad <url> link');
  });

  it('spots private and special addresses', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['93.184.216.34', '172.32.0.1', '8.8.8.8', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('hides callback query strings', () => {
    expect(redactQuery('https://vendor.example.com/cb?uid=R1&secret=x')).toBe('https://vendor.example.com/cb?…');
    expect(redactQuery('https://vendor.example.com/cb')).toBe('https://vendor.example.com/cb');
    expect(redactQuery('nope')).toBe('(invalid URL)');
  });
});
