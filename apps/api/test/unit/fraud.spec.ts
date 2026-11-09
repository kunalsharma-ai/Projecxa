import { blockListOf, checkAutomation, fraudRulesOf, inList, parseCidrList, riskBand, riskOf, signalsOf } from '../../src/survey/fraud';
import { listEntry } from '../../src/survey/ip-reputation';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const clean = { webdriver: false, automation: false, plugins: 5, languages: 2, touch: 0, platform: 'Win32', chrome: true, outer: 1280, renderer: 'ANGLE (NVIDIA GeForce RTX 3060)' };

describe('automated browser check', () => {
  it('passes a normal browser', () => {
    expect(checkAutomation(clean, CHROME_WIN)).toMatchObject({ ok: true });
    expect(checkAutomation({ ...clean, platform: 'iPhone', touch: 5, plugins: 0, chrome: false }, IPHONE)).toMatchObject({ ok: true });
  });

  it('fails on any hard sign', () => {
    expect(checkAutomation({ ...clean, webdriver: true }, CHROME_WIN)).toMatchObject({ ok: false, reason: 'AUTOMATED_BROWSER', note: 'webdriver' });
    expect(checkAutomation({ ...clean, automation: true }, CHROME_WIN)).toMatchObject({ ok: false, note: 'automation-globals' });
    expect(checkAutomation(clean, CHROME_WIN.replace('Chrome/', 'HeadlessChrome/'))).toMatchObject({ ok: false, note: 'headless' });
    expect(checkAutomation(null, 'python-requests/2.31')).toMatchObject({ ok: false, reason: 'AUTOMATED_BROWSER' });
  });

  it('one soft sign adds risk, two fail', () => {
    const one = checkAutomation({ ...clean, renderer: 'Google SwiftShader' }, CHROME_WIN);
    expect(one).toMatchObject({ ok: true, risk: 15, signals: ['software-gpu'] });
    expect(checkAutomation({ ...clean, renderer: 'llvmpipe', platform: 'Linux x86_64' }, CHROME_WIN)).toMatchObject({ ok: false, note: 'software-gpu,platform-mismatch' });
    expect(checkAutomation({ ...clean, platform: 'iPhone', touch: 0, renderer: 'SwiftShader' }, IPHONE)).toMatchObject({ ok: false });
  });

  it('cleans up what the browser sent', () => {
    expect(signalsOf({ webdriver: 'yes', plugins: 1e9, platform: 'x'.repeat(100) })).toMatchObject({ webdriver: undefined, plugins: 10_000, platform: 'x'.repeat(40) });
    expect(signalsOf('nope')).toBeNull();
  });
});

describe('risk score', () => {
  it('adds weights of fraud failures and soft signals, not screen-outs, capped at 100', () => {
    expect(riskOf([{ check: 'ip', ok: false, reason: 'DATACENTER_IP' }, { check: 'automation', ok: true, risk: 15, signals: ['software-gpu'] }])).toEqual({ score: 60, signals: ['DATACENTER_IP', 'software-gpu'] });
    expect(riskOf([{ check: 'gate', ok: false, reason: 'GATE_SCREENOUT' }]).score).toBe(0);
    expect(riskOf([{ check: 'a', ok: false, reason: 'AUTOMATED_BROWSER' }, { check: 'b', ok: false, reason: 'TOR_EXIT' }]).score).toBe(100);
    expect([riskBand(10), riskBand(35), riskBand(70), riskBand(null)]).toEqual(['low', 'medium', 'high', null]);
  });
});

describe('IP lists', () => {
  it('reads list lines and drops private and reserved ranges', () => {
    expect(listEntry('1.2.3.0/24')).toBe('1.2.3.0/24');
    expect(listEntry('5.6.7.8 # comment')).toBe('5.6.7.8/32');
    expect(listEntry('10.0.0.0/8')).toBeNull();
    expect(listEntry('192.168.0.0/16')).toBeNull();
    expect(listEntry('224.0.0.0/3')).toBeNull();
    expect(listEntry('1.0.0.0/4')).toBeNull();
    expect(listEntry('# header')).toBeNull();
    expect(listEntry('not-an-ip')).toBeNull();
  });

  it('parses and matches the allow / block lists', () => {
    expect(parseCidrList('203.0.113.7, 198.51.100.0/24 2001:db8::/32; nope, 1.2.3.4/40')).toEqual({ entries: ['203.0.113.7/32', '198.51.100.0/24', '2001:db8::/32'], bad: ['nope', '1.2.3.4/40'] });
    const b = blockListOf('198.51.100.0/24, 2001:db8::/32');
    expect(inList(b, '198.51.100.9')).toBe(true);
    expect(inList(b, '::ffff:198.51.100.9')).toBe(true);
    expect(inList(b, '2001:db8::1')).toBe(true);
    expect(inList(b, '198.51.101.1')).toBe(false);
    expect(inList(blockListOf(''), '198.51.100.9')).toBe(false);
  });
});

describe('fraud rules', () => {
  it('defaults and falls back on bad input', () => {
    expect(fraudRulesOf(null)).toEqual({ crossProject: { scope: 'all', projectIds: [], days: 90, outcomes: 'any' }, riskThreshold: null });
    expect(fraudRulesOf({ crossProject: { scope: 'client', days: 30 }, riskThreshold: 70 })).toMatchObject({ crossProject: { scope: 'client', days: 30 }, riskThreshold: 70 });
    expect(fraudRulesOf({ riskThreshold: 5 }).riskThreshold).toBeNull();
  });
});
