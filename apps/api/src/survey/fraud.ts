import { BlockList, isIP } from 'net';
import { z } from 'zod';
import type { CheckResult } from './respondent-checks';

/**
 * Stronger fraud checks (docs/FRAUD_CHECKS.md): automated-browser signals, the fraud risk score,
 * cross-project rules and the admin's own IP allow / block lists. Pure functions, no database.
 */

// ───────────── Project fraud rules ─────────────

export const CROSS_PROJECT_SCOPES = ['all', 'client', 'listed'] as const;

export const fraudRulesSchema = z
  .object({
    /** Used when security.crossProjectDuplicates is on. */
    crossProject: z
      .object({
        /** all = every other project of the organisation, client = this client's projects, listed = the projects picked below. */
        scope: z.enum(CROSS_PROJECT_SCOPES).default('all'),
        projectIds: z.array(z.string().min(1).max(40)).max(50).default([]),
        /** Only respondents seen in the last N days count. */
        days: z.number().int().min(1).max(365).default(90),
        /** any = anyone who entered, completes = only people who completed there. */
        outcomes: z.enum(['any', 'completes']).default('any'),
      })
      .strict()
      .default({ scope: 'all', projectIds: [], days: 90, outcomes: 'any' }),
    /** Reject a respondent whose risk score reaches this (null = only record the score). */
    riskThreshold: z.number().int().min(10).max(100).nullable().default(null),
  })
  .strict();
export type FraudRules = z.infer<typeof fraudRulesSchema>;

export function fraudRulesOf(json: unknown): FraudRules {
  const r = fraudRulesSchema.safeParse(json ?? {});
  return r.success ? r.data : fraudRulesSchema.parse({});
}

// ───────────── Automated browsers ─────────────

/** What the gate page reports about the browser (all optional, all untrusted). */
export interface BrowserSignals {
  webdriver?: boolean;
  /** Automation globals found on window/document (Selenium, PhantomJS, Nightmare, Puppeteer helpers). */
  automation?: boolean;
  plugins?: number;
  languages?: number;
  touch?: number;
  platform?: string;
  chrome?: boolean;
  outer?: number;
  renderer?: string;
}

export function signalsOf(raw: unknown): BrowserSignals | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(10_000, Math.round(v))) : undefined);
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  return {
    webdriver: bool(r.webdriver),
    automation: bool(r.automation),
    plugins: num(r.plugins),
    languages: num(r.languages),
    touch: num(r.touch),
    platform: str(r.platform, 40),
    chrome: bool(r.chrome),
    outer: num(r.outer),
    renderer: str(r.renderer, 160),
  };
}

const HEADLESS_UA = /HeadlessChrome|PhantomJS|SlimerJS|Electron\/|puppeteer|playwright|selenium|python-requests|curl\/|wget\//i;
const SOFTWARE_GPU = /SwiftShader|llvmpipe|softpipe|Mesa OffScreen|Microsoft Basic Render/i;

/**
 * Automated or faked browsers. A hard sign (webdriver flag, headless user agent, automation
 * globals) fails on its own; softer signs (software graphics, a phone without touch, a user agent
 * that does not match the platform…) fail when two or more come together, and each adds risk.
 */
export function checkAutomation(signals: BrowserSignals | null, ua: string | undefined): CheckResult {
  const u = ua ?? '';
  const hard: string[] = [];
  if (HEADLESS_UA.test(u)) hard.push('headless');
  if (!signals) {
    return hard.length ? { check: 'automation', ok: false, reason: 'AUTOMATED_BROWSER', status: 'SECURITY_REJECT', note: hard.join(',') } : { check: 'automation', ok: true, note: 'not reported' };
  }
  if (signals.webdriver) hard.push('webdriver');
  if (signals.automation) hard.push('automation-globals');
  const soft: string[] = [];
  const mobileUa = /Mobi|iPhone|iPod|Android/i.test(u);
  const plat = (signals.platform ?? '').toLowerCase();
  if (signals.renderer && SOFTWARE_GPU.test(signals.renderer)) soft.push('software-gpu');
  if (mobileUa && signals.touch === 0) soft.push('phone-without-touch');
  if (plat) {
    if (/Windows NT/.test(u) && !plat.startsWith('win')) soft.push('platform-mismatch');
    else if (/Macintosh|Mac OS X/.test(u) && !/iPhone|iPad|iPod/.test(u) && !plat.startsWith('mac')) soft.push('platform-mismatch');
    else if (/iPhone|iPad|iPod/.test(u) && !/^(iphone|ipad|ipod|mac)/.test(plat)) soft.push('platform-mismatch');
    else if (/Android/.test(u) && /^(win|mac)/.test(plat)) soft.push('platform-mismatch');
  }
  if (/Chrome\//.test(u) && !/Edg\/|OPR\/|SamsungBrowser|CriOS|Android/.test(u) && signals.chrome === false) soft.push('chrome-object-missing');
  if (signals.languages === 0) soft.push('no-languages');
  if (signals.outer === 0) soft.push('no-window');
  if (!mobileUa && /Chrome\//.test(u) && signals.plugins === 0) soft.push('no-plugins');
  const flags = [...hard, ...soft];
  if (hard.length || soft.length >= 2) return { check: 'automation', ok: false, reason: 'AUTOMATED_BROWSER', status: 'SECURITY_REJECT', note: flags.join(',') };
  return { check: 'automation', ok: true, note: soft.join(',') || undefined, risk: soft.length * 15, signals: soft };
}

// ───────────── Risk score ─────────────

/** Points a failed check adds to the risk score. Unlisted reasons add 30. */
export const RISK_WEIGHTS: Record<string, number> = {
  AUTOMATED_BROWSER: 70,
  TOR_EXIT: 60,
  IP_ABUSE: 60,
  IP_BLOCKED: 80,
  PROXY_VPN: 45,
  DATACENTER_IP: 45,
  CROSS_VENDOR: 50,
  SEEN_IN_OTHER_PROJECT: 35,
  SAME_FINGERPRINT: 50,
  SAME_BROWSER: 50,
  SAME_DEVICE: 40,
  GEO_MISMATCH: 35,
  TIMEZONE_MISMATCH: 25,
  LANGUAGE_MISMATCH: 15,
  CAPTCHA_FAILED: 50,
  HUMAN_CHECK_FAILED: 50,
  COOKIES_BLOCKED: 15,
  BAD_SIGNATURE: 60,
};
/** Screen-outs, quotas and consent are not fraud. */
const NOT_RISK = new Set(['GATE_SCREENOUT', 'PRESCREEN', 'GATE_INCOMPLETE', 'CONSENT_DECLINED', 'CELL_FULL', 'DEVICE_NOT_ALLOWED', 'MOBILE_OS_NOT_ALLOWED', 'EXPIRED', 'HIGH_RISK']);

/** 0-100 from every check that ran, plus the signals behind it (reason codes and soft flags). */
export function riskOf(checks: CheckResult[]): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];
  for (const c of checks) {
    if (!c.ok && c.reason && !NOT_RISK.has(c.reason)) {
      score += RISK_WEIGHTS[c.reason] ?? 30;
      signals.push(c.reason);
    }
    if (c.ok && c.risk) {
      score += c.risk;
      signals.push(...(c.signals ?? []));
    }
  }
  return { score: Math.min(100, score), signals: [...new Set(signals)].slice(0, 20) };
}

export const riskBand = (score: number | null | undefined): 'low' | 'medium' | 'high' | null => (score == null ? null : score >= 70 ? 'high' : score >= 35 ? 'medium' : 'low');

// ───────────── The admin's own IP allow / block lists ─────────────

/** Parses "203.0.113.7, 198.51.100.0/24, 2001:db8::/32". Returns the bad entries too. */
export function parseCidrList(text: string | undefined | null): { entries: string[]; bad: string[] } {
  const entries: string[] = [];
  const bad: string[] = [];
  for (const raw of (text ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)) {
    const [ip, bits, extra] = raw.split('/');
    const v = isIP(ip);
    const n = bits === undefined ? (v === 4 ? 32 : 128) : /^\d{1,3}$/.test(bits) ? Number(bits) : NaN;
    if (!v || extra !== undefined || !(n >= (v === 4 ? 8 : 16) && n <= (v === 4 ? 32 : 128))) bad.push(raw);
    else entries.push(`${ip}/${n}`);
  }
  return { entries: [...new Set(entries)], bad };
}

export function blockListOf(text: string | undefined | null): BlockList | null {
  const { entries } = parseCidrList(text);
  if (!entries.length) return null;
  const b = new BlockList();
  for (const e of entries) {
    const [ip, bits] = e.split('/');
    const type = isIP(ip) === 4 ? 'ipv4' : 'ipv6';
    b.addSubnet(ip, Number(bits), type);
  }
  return b;
}

export function inList(list: BlockList | null, ip: string | undefined): boolean {
  if (!list || !ip) return false;
  const plain = ip.replace(/^::ffff:/, '');
  const v = isIP(plain);
  return !!v && list.check(plain, v === 4 ? 'ipv4' : 'ipv6');
}

