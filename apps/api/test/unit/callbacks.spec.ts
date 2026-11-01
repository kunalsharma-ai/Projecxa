import { backoffMs, isPermanentFailure } from '../../src/callbacks/callbacks.service';
import { buildSurveyLink, canonicalStatus } from '../../src/survey/survey.service';
import { mergeCountrySettings } from '../../src/projects/projects.service';

describe('callback retry policy', () => {
  it('backs off exponentially with jitter and caps at one hour', () => {
    expect(backoffMs(1, () => 1)).toBe(30_000);
    expect(backoffMs(2, () => 1)).toBe(60_000);
    expect(backoffMs(3, () => 0)).toBe(60_000);
    expect(backoffMs(20, () => 1)).toBe(3_600_000);
  });
  it('treats 4xx as permanent except 408 and 429', () => {
    expect(isPermanentFailure(400)).toBe(true);
    expect(isPermanentFailure(401)).toBe(true);
    expect(isPermanentFailure(408)).toBe(false);
    expect(isPermanentFailure(429)).toBe(false);
    expect(isPermanentFailure(503)).toBe(false);
  });
});

describe('survey helpers', () => {
  it('maps external status slugs', () => {
    expect(canonicalStatus('complete')).toBe('COMPLETE');
    expect(canonicalStatus('SCREENOUT')).toBe('TERMINATE');
    expect(canonicalStatus('overquota')).toBe('QUOTA_FULL');
    expect(canonicalStatus('nope')).toBeNull();
  });
  it('builds client survey links with the opaque token', () => {
    expect(buildSurveyLink('https://s.example.com/x?rid={session_token}&c={country_code}', { token: 'a b', countryCode: 'DE', projectCode: 'P1' })).toBe(
      'https://s.example.com/x?rid=a%20b&c=DE',
    );
    expect(buildSurveyLink('https://s.example.com/x', { token: 'abc', countryCode: 'DE', projectCode: 'P1' })).toBe('https://s.example.com/x?token=abc');
  });
});

describe('multi-country settings', () => {
  it('country overrides win over shared defaults, undefined does not erase', () => {
    expect(mergeCountrySettings({ loiMinutes: 15, irPercent: 30, cpi: 5 }, { irPercent: 20, cpi: undefined })).toEqual({ loiMinutes: 15, irPercent: 20, cpi: 5 });
  });
});
