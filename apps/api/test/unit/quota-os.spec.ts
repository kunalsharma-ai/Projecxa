import { cellMatches, conditionSchema } from '../../src/quotas/quota.rules';
import { checkDevice, deviceOs } from '../../src/survey/respondent-checks';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36';
const WINPHONE = 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1) Mobile Edge/15';

describe('Android / iOS', () => {
  it('detects the phone system', () => {
    expect(deviceOs(IPHONE)).toBe('ios');
    expect(deviceOs(ANDROID)).toBe('android');
    expect(deviceOs('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('other');
  });

  it('allows every phone when both are on, and only the chosen system otherwise', () => {
    expect(checkDevice({ mobile: true }, IPHONE).ok).toBe(true);
    expect(checkDevice({ mobile: true, android: true, ios: false }, IPHONE)).toMatchObject({ ok: false, reason: 'MOBILE_OS_NOT_ALLOWED' });
    expect(checkDevice({ mobile: true, android: true, ios: false }, ANDROID).ok).toBe(true);
    expect(checkDevice({ mobile: true, android: false, ios: true }, ANDROID).ok).toBe(false);
    expect(checkDevice({ mobile: true, android: false, ios: true }, 'Mozilla/5.0 (BlackBerry; Mobile)').ok).toBe(false);
    expect(deviceOs(WINPHONE)).toBe('android');
  });

  it('matches quota cells on the system as well as the device type', () => {
    expect(conditionSchema.safeParse({ source: 'device', values: ['ios'] }).success).toBe(true);
    expect(conditionSchema.safeParse({ source: 'device', values: ['symbian'] }).success).toBe(false);
    const ios = { conditions: [{ source: 'device', values: ['ios'] }] };
    const mobile = { conditions: [{ source: 'device', values: ['mobile'] }] };
    expect(cellMatches(ios, { device: 'mobile', os: 'ios', answers: null })).toBe(true);
    expect(cellMatches(ios, { device: 'mobile', os: 'android', answers: null })).toBe(false);
    expect(cellMatches(mobile, { device: 'mobile', os: 'android', answers: null })).toBe(true);
  });
});
