import { hmacSha256 } from '../common/crypto';

/**
 * Human check styles an executive can pick per survey. Only free options:
 * - Built-in (self-hosted, no limits, no third party): math, logic, text_image, invisible.
 * - Cloudflare Turnstile (free, unlimited checks, up to 20 widgets per Cloudflare account).
 * - hCaptcha Basic (free plan).
 * Google reCAPTCHA is left out on purpose: its free tier stops at 10,000 checks a month, after
 * which it either fails or needs billing.
 */
export const CAPTCHA_STYLES = ['math', 'logic', 'text_image', 'invisible', 'turnstile', 'hcaptcha'] as const;
export type CaptchaStyle = (typeof CAPTCHA_STYLES)[number];
export const PROVIDER_STYLES = ['turnstile', 'hcaptcha'] as const;
export type ProviderStyle = (typeof PROVIDER_STYLES)[number];

export const HUMAN_MAX_ATTEMPTS = 3;

export interface HumanChallenge {
  /** input: type an answer; choice: pick one; image: type the characters in the picture; widget: provider widget; none: invisible. */
  kind: 'input' | 'choice' | 'image' | 'widget' | 'none';
  text: string;
  options?: string[];
  /** Normalised expected answer (built-in styles only; never sent to the browser). */
  answer?: string;
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const LOGIC: { q: string; right: string[]; wrong: string[] }[] = [
  { q: 'Which of these is a colour?', right: ['red', 'blue', 'green', 'yellow', 'purple'], wrong: ['chair', 'river', 'pencil', 'cloud', 'bread', 'window'] },
  { q: 'Which of these is an animal?', right: ['horse', 'rabbit', 'tiger', 'sheep', 'eagle'], wrong: ['table', 'orange', 'hammer', 'blue', 'mountain', 'spoon'] },
  { q: 'Which of these is a fruit?', right: ['apple', 'banana', 'mango', 'cherry', 'grape'], wrong: ['carpet', 'lion', 'bottle', 'shoe', 'cloud', 'paper'] },
  { q: 'Which of these is a day of the week?', right: ['Monday', 'Tuesday', 'Friday', 'Sunday', 'Thursday'], wrong: ['April', 'winter', 'evening', 'garden', 'kettle', 'river'] },
  { q: 'Which of these can you drink?', right: ['water', 'milk', 'tea', 'juice', 'coffee'], wrong: ['stone', 'rope', 'brick', 'sand', 'paper', 'nail'] },
];
/** Characters that do not look alike (no 0/O, 1/I/L, 5/S, 8/B). */
const IMAGE_CHARS = 'ACEFHKMNPRTUVWXY2346789';

/** Deterministic challenge for (token, attempt): nothing stored, a fresh one after each wrong answer. */
export function humanChallenge(style: CaptchaStyle, secret: string, token: string, attempt: number): HumanChallenge {
  const h = hmacSha256(secret, `human:${style}:${token}:${attempt}`);
  const byte = (i: number) => parseInt(h.slice(i * 2, i * 2 + 2), 16);
  switch (style) {
    case 'math': {
      const a = 2 + (byte(0) % 8);
      let b = 1 + (byte(1) % 9);
      if (b === a) b = a === 9 ? 1 : a + 1;
      if (byte(2) % 2) return { kind: 'input', text: `What is ${WORDS[a]} plus ${WORDS[b]}? Type the number.`, answer: String(a + b) };
      return { kind: 'input', text: `What is ${WORDS[Math.max(a, b)]} minus ${WORDS[Math.min(a, b)]}? Type the number.`, answer: String(Math.max(a, b) - Math.min(a, b)) };
    }
    case 'logic': {
      const set = LOGIC[byte(0) % LOGIC.length];
      const right = set.right[byte(1) % set.right.length];
      const wrong = shuffle(set.wrong, byte(2)).slice(0, 3);
      const options = shuffle([right, ...wrong], byte(3));
      return { kind: 'choice', text: set.q, options, answer: right.toUpperCase() };
    }
    case 'text_image': {
      const answer = Array.from({ length: 5 }, (_, i) => IMAGE_CHARS[byte(i) % IMAGE_CHARS.length]).join('');
      return { kind: 'image', text: 'Type the characters you see in the picture.', answer };
    }
    case 'turnstile':
    case 'hcaptcha':
      return { kind: 'widget', text: 'Please complete the check below.' };
    case 'invisible':
      return { kind: 'none', text: '' };
  }
}

export function normaliseAnswer(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v).trim().toUpperCase().replace(/\s+/g, '') : '';
}

function shuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed + 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ───────────── Text image (drawn as strokes, so the characters are not text in the image) ─────────────

/** Stroke font on a 10 × 14 grid: each glyph is a list of polylines. */
const GLYPHS: Record<string, number[][]> = {
  A: [[0, 14, 5, 0, 10, 14], [2, 8, 8, 8]],
  C: [[10, 2, 7, 0, 3, 0, 0, 3, 0, 11, 3, 14, 7, 14, 10, 12]],
  E: [[10, 0, 0, 0, 0, 14, 10, 14], [0, 7, 7, 7]],
  F: [[10, 0, 0, 0, 0, 14], [0, 7, 7, 7]],
  H: [[0, 0, 0, 14], [10, 0, 10, 14], [0, 7, 10, 7]],
  K: [[0, 0, 0, 14], [10, 0, 0, 8], [3, 6, 10, 14]],
  M: [[0, 14, 0, 0, 5, 8, 10, 0, 10, 14]],
  N: [[0, 14, 0, 0, 10, 14, 10, 0]],
  P: [[0, 14, 0, 0, 7, 0, 10, 2, 10, 5, 7, 7, 0, 7]],
  R: [[0, 14, 0, 0, 7, 0, 10, 2, 10, 5, 7, 7, 0, 7], [5, 7, 10, 14]],
  T: [[0, 0, 10, 0], [5, 0, 5, 14]],
  U: [[0, 0, 0, 11, 3, 14, 7, 14, 10, 11, 10, 0]],
  V: [[0, 0, 5, 14, 10, 0]],
  W: [[0, 0, 2, 14, 5, 6, 8, 14, 10, 0]],
  X: [[0, 0, 10, 14], [10, 0, 0, 14]],
  Y: [[0, 0, 5, 7, 10, 0], [5, 7, 5, 14]],
  '2': [[0, 3, 3, 0, 7, 0, 10, 3, 10, 5, 0, 14, 10, 14]],
  '3': [[0, 1, 3, 0, 8, 0, 10, 3, 8, 6, 4, 7, 8, 8, 10, 11, 8, 14, 3, 14, 0, 13]],
  '4': [[8, 14, 8, 0, 0, 10, 10, 10]],
  '6': [[9, 1, 6, 0, 3, 0, 0, 4, 0, 11, 3, 14, 7, 14, 10, 11, 10, 9, 7, 7, 3, 7, 0, 9]],
  '7': [[0, 0, 10, 0, 4, 14]],
  '8': [[5, 7, 2, 5, 1, 2, 3, 0, 7, 0, 9, 2, 8, 5, 5, 7, 1, 9, 1, 12, 3, 14, 7, 14, 9, 12, 9, 9, 5, 7]],
  '9': [[10, 5, 7, 7, 3, 7, 0, 5, 0, 3, 3, 0, 7, 0, 10, 3, 10, 10, 7, 14, 3, 14, 1, 13]],
};

/** SVG picture of the characters, with jitter, rotation and noise lines. */
export function captchaSvg(text: string, seed: string): string {
  let s = parseInt(seed.slice(0, 8), 16) || 1;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const W = 220;
  const H = 70;
  const parts: string[] = [];
  for (let i = 0; i < 6; i++) {
    parts.push(`<path d="M${(rnd() * W).toFixed(1)} ${(rnd() * H).toFixed(1)} Q${(rnd() * W).toFixed(1)} ${(rnd() * H).toFixed(1)} ${(rnd() * W).toFixed(1)} ${(rnd() * H).toFixed(1)}" stroke="hsl(${Math.floor(rnd() * 360)},45%,55%)" stroke-width="${(1 + rnd() * 1.5).toFixed(1)}" fill="none" opacity=".7"/>`);
  }
  [...text].forEach((ch, i) => {
    const scale = 2.6 + rnd() * 0.6;
    const x = 18 + i * 38 + (rnd() - 0.5) * 6;
    const y = 12 + (rnd() - 0.5) * 10;
    const rot = (rnd() - 0.5) * 36;
    const d = (GLYPHS[ch] ?? [])
      .map((line) => line.reduce((acc, v, k) => acc + (k % 2 === 0 ? `${k === 0 ? 'M' : 'L'}${(v + (rnd() - 0.5) * 0.8).toFixed(1)} ` : `${(v + (rnd() - 0.5) * 0.8).toFixed(1)} `), ''))
      .join('');
    parts.push(`<path d="${d}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${rot.toFixed(1)} 5 7) scale(${scale.toFixed(2)} ${(scale * 0.95).toFixed(2)})" stroke="hsl(${Math.floor(rnd() * 360)},55%,35%)" stroke-width="${(0.9 + rnd() * 0.3).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" fill="none" vector-effect="non-scaling-stroke"/>`);
  });
  for (let i = 0; i < 40; i++) parts.push(`<circle cx="${(rnd() * W).toFixed(1)}" cy="${(rnd() * H).toFixed(1)}" r="${(rnd() * 1.4).toFixed(1)}" fill="#64748b" opacity=".5"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#f8fafc"/>${parts.join('')}</svg>`;
}

// ───────────── Third-party widgets (server-side verification) ─────────────

export const PROVIDERS: Record<ProviderStyle, { script: string; verifyUrl: string; className: string; csp: { script: string[]; frame: string[]; connect: string[]; style: string[] } }> = {
  turnstile: {
    script: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
    verifyUrl: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    className: 'cf-turnstile',
    csp: { script: ['https://challenges.cloudflare.com'], frame: ['https://challenges.cloudflare.com'], connect: ['https://challenges.cloudflare.com'], style: [] },
  },
  hcaptcha: {
    script: 'https://js.hcaptcha.com/1/api.js',
    verifyUrl: 'https://api.hcaptcha.com/siteverify',
    className: 'h-captcha',
    csp: { script: ['https://hcaptcha.com', 'https://*.hcaptcha.com'], frame: ['https://hcaptcha.com', 'https://*.hcaptcha.com'], connect: ['https://hcaptcha.com', 'https://*.hcaptcha.com'], style: ['https://hcaptcha.com', 'https://*.hcaptcha.com'] },
  },
};

export type ProviderKeys = Partial<Record<ProviderStyle, { siteKey: string; secret: string }>>;

export function providerKeysOf(json: unknown): ProviderKeys {
  const j = (json ?? {}) as Record<string, { siteKey?: unknown; secret?: unknown }>;
  const out: ProviderKeys = {};
  for (const p of PROVIDER_STYLES) {
    const k = j[p];
    if (k && typeof k.siteKey === 'string' && typeof k.secret === 'string' && k.siteKey && k.secret) out[p] = { siteKey: k.siteKey, secret: k.secret };
  }
  return out;
}

/**
 * Verifies a widget token with the provider. If the provider cannot be reached the respondent is
 * let through (and the check is logged as unverified), so a provider outage never stops fieldwork.
 */
export async function verifyProvider(style: ProviderStyle, secret: string, response: string, ip?: string): Promise<{ ok: boolean; unverified?: boolean; codes?: string[] }> {
  if (!response || response.length > 4096) return { ok: false, codes: ['missing-input-response'] };
  try {
    const body = new URLSearchParams({ secret, response, ...(ip ? { remoteip: ip.replace(/^::ffff:/, '') } : {}) });
    const res = await fetch(PROVIDERS[style].verifyUrl, { method: 'POST', body, signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return { ok: true, unverified: true, codes: [`http-${res.status}`] };
    const j = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    return { ok: !!j.success, codes: j['error-codes'] };
  } catch (e) {
    return { ok: true, unverified: true, codes: [(e as Error).name] };
  }
}
