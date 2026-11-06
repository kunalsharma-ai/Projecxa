import { z } from 'zod';

/**
 * Look of the respondent-facing pages: the gate page and the end pages (complete, terminate,
 * quota full, ...). Executives pick a template and customise colours, font, corners, logo,
 * images and the text per status, per project.
 */

export const TEMPLATES = ['aurora', 'minimal', 'split', 'spotlight', 'bold', 'playful'] as const;
export type Template = (typeof TEMPLATES)[number];
export const FONTS = ['system', 'humanist', 'geometric', 'rounded', 'serif', 'mono'] as const;
export const END_STATUSES = ['complete', 'terminate', 'quota_full', 'quality_fail', 'duplicate', 'security_reject', 'partial', 'technical_error'] as const;
export type EndStatus = (typeof END_STATUSES)[number];

const FONT_STACKS: Record<(typeof FONTS)[number], string> = {
  system: "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  humanist: "Seravek,'Gill Sans Nova',Ubuntu,Calibri,'DejaVu Sans',source-sans-pro,sans-serif",
  geometric: "Avenir,Montserrat,Corbel,'URW Gothic',source-sans-pro,sans-serif",
  rounded: "ui-rounded,'Hiragino Maru Gothic ProN',Quicksand,Comfortaa,Manjari,'Arial Rounded MT','Arial Rounded MT Bold',Calibri,source-sans-pro,sans-serif",
  serif: "'Iowan Old Style','Palatino Linotype','URW Palladio L',P052,Georgia,serif",
  mono: "ui-monospace,'Cascadia Code','Source Code Pro',Menlo,Consolas,'DejaVu Sans Mono',monospace",
};

const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb colour');
const assetId = z.string().regex(/^[a-z0-9]{20,40}$/).nullable().optional();
const text = z.object({
  title: z.string().max(120).optional(),
  message: z.string().max(600).optional(),
  buttonLabel: z.string().max(40).optional(),
  buttonUrl: z.string().url().refine((u) => u.startsWith('https://'), 'Links must use https').optional(),
}).strict();

export const pageDesignSchema = z
  .object({
    template: z.enum(TEMPLATES).default('aurora'),
    colors: z.object({ primary: color, accent: color, background: color, surface: color, text: color }).strict(),
    font: z.enum(FONTS).default('system'),
    radius: z.enum(['sharp', 'soft', 'round']).default('soft'),
    logoAssetId: assetId,
    heroAssetId: assetId,
    /** Name shown next to (or instead of) the logo. */
    brandName: z.string().max(60).optional(),
    footer: z.string().max(200).optional(),
    confetti: z.boolean().default(true),
    /** Show the platform logo (SampTrek by Sampledge, or the organisation's white-label logo) and its tab icon. */
    platformLogo: z.boolean().default(true),
    texts: z.object(Object.fromEntries(END_STATUSES.map((k) => [k, text.optional()])) as Record<EndStatus, z.ZodOptional<typeof text>>).strict().default({}),
    /** Show the end page first, then continue to the vendor's redirect after `seconds`. */
    interstitial: z.object({ enabled: z.boolean(), seconds: z.number().int().min(0).max(15) }).strict().default({ enabled: false, seconds: 5 }),
  })
  .strict();
export type PageDesign = z.infer<typeof pageDesignSchema>;

export const PALETTES: { name: string; colors: PageDesign['colors'] }[] = [
  { name: 'Ocean', colors: { primary: '#2563eb', accent: '#06b6d4', background: '#eef4ff', surface: '#ffffff', text: '#0f172a' } },
  { name: 'Forest', colors: { primary: '#15803d', accent: '#84cc16', background: '#effaf3', surface: '#ffffff', text: '#0f1f17' } },
  { name: 'Sunset', colors: { primary: '#ea580c', accent: '#db2777', background: '#fff5ed', surface: '#ffffff', text: '#1f130c' } },
  { name: 'Grape', colors: { primary: '#7c3aed', accent: '#ec4899', background: '#f6f0ff', surface: '#ffffff', text: '#1b1029' } },
  { name: 'Graphite', colors: { primary: '#334155', accent: '#0ea5e9', background: '#f1f5f9', surface: '#ffffff', text: '#0f172a' } },
  { name: 'Rose', colors: { primary: '#e11d48', accent: '#f59e0b', background: '#fff1f3', surface: '#ffffff', text: '#2a0f16' } },
  { name: 'Gold', colors: { primary: '#b45309', accent: '#0f766e', background: '#fdf8ec', surface: '#fffdf7', text: '#231a0a' } },
  { name: 'Midnight', colors: { primary: '#818cf8', accent: '#22d3ee', background: '#0b1020', surface: '#151c33', text: '#e5e7eb' } },
];

export const DEFAULT_DESIGN: PageDesign = {
  template: 'aurora',
  colors: PALETTES[0].colors,
  font: 'system',
  radius: 'soft',
  confetti: true,
  platformLogo: true,
  texts: {},
  interstitial: { enabled: false, seconds: 5 },
};

export function designOf(json: unknown): PageDesign {
  const r = pageDesignSchema.safeParse(json);
  return r.success ? r.data : DEFAULT_DESIGN;
}

/** Default wording and look per status. */
export const STATUS_DEFAULTS: Record<EndStatus, { title: string; message: string; tone: 'good' | 'neutral' | 'bad'; icon: keyof typeof ICONS }> = {
  complete: { title: 'Thank you!', message: 'Your answers have been recorded. We really appreciate the time you gave us.', tone: 'good', icon: 'check' },
  terminate: { title: 'Thanks for your interest', message: "This survey is looking for a different profile this time, so it ends here. We hope to see you in the next one.", tone: 'neutral', icon: 'compass' },
  quota_full: { title: 'This survey is now full', message: 'We already have all the answers we need from people like you. Thank you for coming by.', tone: 'neutral', icon: 'hourglass' },
  quality_fail: { title: 'Thank you for your time', message: 'Your answers could not be used for this survey.', tone: 'neutral', icon: 'info' },
  duplicate: { title: "You've already taken part", message: 'Our records show you have already started this survey, so it can only be taken once.', tone: 'neutral', icon: 'repeat' },
  security_reject: { title: "We couldn't verify this visit", message: 'This survey link is not valid or has already been used.', tone: 'bad', icon: 'shield' },
  partial: { title: 'Your session has ended', message: 'This survey session is no longer active. Thank you for your time.', tone: 'neutral', icon: 'clock' },
  technical_error: { title: 'Something went wrong', message: 'Sorry, we could not load the survey. Please try again later.', tone: 'bad', icon: 'alert' },
};

const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z"/>',
  hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
} as const;

// ───────────── Colour helpers ─────────────

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lum(hex: string) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** White or near-black, whichever reads better on `bg`. */
export function inkOn(bg: string) {
  return contrast(bg, '#ffffff') >= contrast(bg, '#111827') ? '#ffffff' : '#111827';
}
function mix(a: string, b: string, t: number) {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
/** Text colour that keeps at least 4.5:1 on the surface: the chosen one, or the nearest readable fallback. */
function readable(text: string, surface: string) {
  return contrast(text, surface) >= 4.5 ? text : inkOn(surface);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const assetUrl = (base: string, id: string) => `${base}/pa/${encodeURIComponent(id)}`;

/** CSS variables and base styles shared by the gate page and the end pages. */
export function designCss(d: PageDesign) {
  const c = d.colors;
  const ink = readable(c.text, c.surface);
  const muted = mix(ink, c.surface, 0.38);
  const line = mix(ink, c.surface, 0.85);
  const radius = { sharp: '4px', soft: '14px', round: '26px' }[d.radius];
  const control = { sharp: '4px', soft: '10px', round: '999px' }[d.radius];
  const pageInk = readable(c.text, c.background);
  return `:root{--bg:${c.background};--card:${c.surface};--ink:${ink};--page-ink:${pageInk};--muted:${muted};--line:${line};--brand:${c.primary};--brand-ink:${inkOn(c.primary)};--accent:${c.accent};--bad:#dc2626;--radius:${radius};--ctl:${control};--font:${FONT_STACKS[d.font]}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font:16px/1.55 var(--font)}
img{max-width:100%}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em}.brand.on-dark{color:#fff}.brand img{max-height:40px;width:auto}.brand .plogo{max-height:34px}.pbrand.on-dark .plogo{max-height:44px;background:#0b1020b3;padding:6px 12px;border-radius:12px}.plogo-name,.pmini-name{font-weight:700}
.powered{display:flex;align-items:center;justify-content:center;gap:6px;font-size:.75rem;opacity:.7;margin:18px 0 0}.powered .pmini{height:16px;width:auto}`;
}

/** Background for the gate page in the project's template (a lighter version of the end page). */
export function gateBackgroundCss(d: PageDesign, base: string) {
  const c = d.colors;
  switch (d.template) {
    case 'aurora':
      return `body{background:radial-gradient(60rem 40rem at 10% -10%,${c.primary}33,transparent 60%),radial-gradient(50rem 40rem at 110% 110%,${c.accent}33,transparent 60%),var(--bg)}`;
    case 'spotlight':
      return d.heroAssetId
        ? `body{background:linear-gradient(#0009,#0009),url(${assetUrl(base, d.heroAssetId)}) center/cover fixed,var(--bg)}`
        : `body{background:linear-gradient(135deg,${c.primary},${c.accent})}`;
    case 'bold':
      return `body{background:linear-gradient(var(--brand) 0 220px,var(--bg) 220px)}`;
    case 'playful':
      return `body{background:radial-gradient(${c.accent}40 2px,transparent 2px) 0 0/22px 22px,var(--bg)}`;
    default:
      return '';
  }
}

/**
 * The platform's brand on respondent pages: SampTrek by Sampledge, or the organisation's own
 * white-label name and logo. URLs are on the public API host so the pages' `img-src 'self'` allows them.
 */
export interface PlatformBrand {
  name: string;
  /** Logo for light backgrounds. */
  logo: string | null;
  /** Logo for dark backgrounds. */
  logoDark: string | null;
  /** Square icon for the browser tab. */
  icon: string | null;
}

/** SampTrek's own files, served by the API from apps/api/assets/brand (see BrandAssetsController). */
export function defaultPlatformBrand(base: string): PlatformBrand {
  return { name: 'SampTrek by Sampledge', logo: `${base}/brand/samptrek-logo-light.png`, logoDark: `${base}/brand/samptrek-logo-dark.png`, icon: `${base}/brand/samptrek-icon-64.png` };
}

/** True when the page behind the header is dark enough that the light-on-dark logo reads better. */
function darkBehind(d: PageDesign, onDark: boolean) {
  return onDark || inkOn(d.colors.background) === '#ffffff';
}

function platformLogoImg(p: PlatformBrand, dark: boolean, cls: string) {
  const src = dark ? (p.logoDark ?? p.logo) : (p.logo ?? p.logoDark);
  return src ? `<img class="${cls}" src="${esc(src)}" alt="${esc(p.name)}">` : `<span class="${cls}-name">${esc(p.name)}</span>`;
}

/**
 * Header brand: the project's own logo or name; when the project has none and the platform logo is
 * on, the platform logo instead.
 */
export function brandHtml(d: PageDesign, base: string, onDark = false, platform?: PlatformBrand | null) {
  if (!d.logoAssetId && !d.brandName) {
    if (!platform || !d.platformLogo) return '';
    return `<div class="brand pbrand${onDark ? ' on-dark' : ''}">${platformLogoImg(platform, darkBehind(d, onDark), 'plogo')}</div>`;
  }
  return `<div class="brand${onDark ? ' on-dark' : ''}">${d.logoAssetId ? `<img src="${assetUrl(base, d.logoAssetId)}" alt="${esc(d.brandName ?? 'Logo')}">` : ''}${d.brandName ? `<span>${esc(d.brandName)}</span>` : ''}</div>`;
}

/** Small "Powered by" line under the page, used when the project shows its own logo at the top. */
export function poweredByHtml(d: PageDesign, platform: PlatformBrand | null | undefined, dark: boolean) {
  if (!platform || !d.platformLogo || (!d.logoAssetId && !d.brandName)) return '';
  return `<p class="powered">Powered by ${platformLogoImg(platform, dark, 'pmini')}</p>`;
}

/** Browser-tab icon link for the head. */
export function faviconHtml(d: PageDesign, platform: PlatformBrand | null | undefined) {
  return platform?.icon && d.platformLogo ? `<link rel="icon" href="${esc(platform.icon)}">` : '';
}

/**
 * Full end page. `continueUrl` (interstitial mode) adds a countdown and a button that
 * takes the respondent on to the vendor's page.
 */
export function renderEndPage(d: PageDesign, status: EndStatus, opts: { base: string; nonce: string; continueUrl?: string; seconds?: number; preview?: boolean; platform?: PlatformBrand | null }): string {
  const def = STATUS_DEFAULTS[status];
  const t = d.texts[status] ?? {};
  const title = esc(t.title?.trim() || def.title);
  const message = esc(t.message?.trim() || def.message);
  const c = d.colors;
  const toneColor = def.tone === 'good' ? c.primary : def.tone === 'bad' ? '#dc2626' : c.accent;
  const icon = `<div class="icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[def.icon]}</svg></div>`;
  const button = opts.continueUrl
    ? `<a class="btn" id="go" href="${esc(opts.continueUrl)}">${esc(t.buttonLabel?.trim() || 'Continue')}</a>${opts.seconds ? `<p class="small" id="cd">Continuing in <b id="n">${opts.seconds}</b> seconds…</p>` : ''}`
    : t.buttonUrl
      ? `<a class="btn" href="${esc(t.buttonUrl)}" rel="noopener">${esc(t.buttonLabel?.trim() || 'Continue')}</a>`
      : '';
  const hero = d.heroAssetId ? assetUrl(opts.base, d.heroAssetId) : null;
  const confetti = status === 'complete' && d.confetti;
  const darkCard = d.template === 'spotlight' || inkOn(d.template === 'minimal' ? c.background : c.surface) === '#ffffff';
  const footer = `${d.footer ? `<p class="foot">${esc(d.footer)}</p>` : ''}${poweredByHtml(d, opts.platform, darkCard)}`;
  const content = `${icon}<h1>${title}</h1><p class="msg">${message}</p>${button}${footer}`;

  let layout = '';
  let css = '';
  switch (d.template) {
    case 'minimal':
      css = `.bar{height:6px;background:linear-gradient(90deg,var(--brand),var(--accent))}.wrap{max-width:40rem;margin:0 auto;padding:48px 20px}.wrap .brand{margin-bottom:56px;color:var(--page-ink)}
main{color:var(--page-ink)}.icon{margin-bottom:22px}h1{font-size:clamp(1.75rem,5vw,2.5rem)}.msg{color:var(--page-ink);opacity:.8;font-size:1.1rem}`;
      layout = `<div class="bar"></div><div class="wrap">${brandHtml(d, opts.base, false, opts.platform)}<main>${content}</main></div>`;
      break;
    case 'split':
      css = `.split{display:grid;grid-template-columns:1fr 1fr;min-height:100vh}.art{background:${hero ? `url(${hero}) center/cover` : `linear-gradient(135deg,var(--brand),var(--accent))`};position:relative;min-height:220px}
.art::after{content:"";position:absolute;inset:0;background:linear-gradient(0deg,#0005,transparent 50%)}.art .brand{position:absolute;left:24px;bottom:24px;z-index:1;color:#fff}
.side{display:grid;place-items:center;padding:40px 24px;background:var(--card)}main{max-width:28rem}
@media (max-width:760px){.split{grid-template-columns:1fr}.art{min-height:200px}}`;
      layout = `<div class="split"><div class="art">${brandHtml(d, opts.base, true, opts.platform)}</div><div class="side"><main>${content}</main></div></div>`;
      break;
    case 'spotlight':
      css = `body{background:${hero ? `linear-gradient(#000a,#000c),url(${hero}) center/cover fixed` : `linear-gradient(135deg,var(--brand),var(--accent))`}}.wrap{min-height:100vh;display:grid;place-items:center;padding:24px;text-align:center;color:#fff}
.wrap .brand{justify-content:center;margin-bottom:28px;color:#fff}main{max-width:34rem}.msg{color:#fffd}.foot{color:#fffb}.icon{margin:0 auto 22px;box-shadow:0 0 0 10px #ffffff22}
h1{font-size:clamp(2rem,6vw,3rem);text-shadow:0 2px 20px #0006}.btn{background:#fff;color:#111}.small{color:#fffc}`;
      layout = `<div class="wrap"><main>${brandHtml(d, opts.base, true, opts.platform)}${content}</main></div>`;
      break;
    case 'bold':
      css = `.top{background:linear-gradient(135deg,var(--brand),${mix(c.primary, c.accent, 0.35)});color:var(--brand-ink);padding:28px 20px 120px}.top .brand{max-width:36rem;margin:0 auto;color:var(--brand-ink)}
main{max-width:36rem;margin:-96px auto 40px;background:var(--card);border-radius:var(--radius);padding:36px 28px;box-shadow:0 30px 60px -20px #0004;text-align:center;position:relative}
@media (max-width:640px){main{margin:-96px 16px 32px;padding:28px 20px}}.icon{margin:-72px auto 18px;box-shadow:0 0 0 8px var(--card)}`;
      layout = `<div class="top">${brandHtml(d, opts.base, true, opts.platform)}</div><main>${content}</main>`;
      break;
    case 'playful':
      css = `body{background:radial-gradient(${c.accent}40 2px,transparent 2px) 0 0/22px 22px,var(--bg)}.wrap{min-height:100vh;display:grid;place-items:center;padding:20px}
main{max-width:30rem;background:var(--card);border-radius:calc(var(--radius) + 12px);padding:40px 28px;text-align:center;border:3px solid var(--ink);box-shadow:10px 10px 0 var(--brand)}
.icon{margin:0 auto 18px;transform:rotate(-6deg);border:3px solid var(--ink)}h1{font-size:2rem}.wrap .brand{justify-content:center;margin-bottom:20px}.btn{border:3px solid var(--ink);box-shadow:4px 4px 0 var(--ink)}`;
      layout = `<div class="wrap"><main>${brandHtml(d, opts.base, false, opts.platform)}${content}</main></div>`;
      break;
    default: // aurora
      css = `body{background:radial-gradient(60rem 40rem at 10% -10%,${c.primary}40,transparent 60%),radial-gradient(50rem 40rem at 110% 110%,${c.accent}40,transparent 60%),var(--bg)}
.wrap{min-height:100vh;display:grid;place-items:center;padding:20px}main{max-width:32rem;width:100%;background:color-mix(in srgb,var(--card) 86%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:var(--radius);padding:40px 28px;text-align:center;box-shadow:0 30px 80px -30px #0003}
.icon{margin:0 auto 20px}.wrap main .brand{justify-content:center;margin-bottom:26px}`;
      layout = `<div class="wrap"><main>${brandHtml(d, opts.base, false, opts.platform)}${content}</main></div>`;
  }

  const confettiJs = confetti
    ? `var C=['${c.primary}','${c.accent}','#facc15','#34d399','#f472b6'];if(!matchMedia('(prefers-reduced-motion: reduce)').matches){for(var i=0;i<90;i++){var s=document.createElement('i');s.className='cf';s.style.left=Math.random()*100+'vw';s.style.background=C[i%C.length];s.style.animationDelay=Math.random()*1.2+'s';s.style.animationDuration=2.4+Math.random()*2+'s';s.style.transform='rotate('+Math.random()*360+'deg)';document.body.appendChild(s);}}`
    : '';
  const countdownJs = opts.preview
    ? ''
    : opts.continueUrl && opts.seconds
    ? `var n=${opts.seconds},el=document.getElementById('n');var t=setInterval(function(){n--;if(el)el.textContent=n;if(n<=0){clearInterval(t);location.replace(document.getElementById('go').href)}},1000);`
    : opts.continueUrl
      ? `location.replace(document.getElementById('go').href);`
      : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>${faviconHtml(d, opts.platform)}
<style nonce="${opts.nonce}">${designCss(d)}
h1{margin:0 0 10px;line-height:1.15;letter-spacing:-.02em;font-size:clamp(1.6rem,4.5vw,2.2rem)}.msg{margin:0 auto 24px;color:var(--muted);max-width:30rem}
.icon{--tone:${toneColor};--tone-ink:${inkOn(toneColor)};width:72px;height:72px;border-radius:calc(var(--radius) + 8px);display:grid;place-items:center;background:var(--tone);color:var(--tone-ink);animation:pop .5s cubic-bezier(.2,1.4,.4,1) both}
.btn{display:inline-block;padding:12px 26px;border-radius:var(--ctl);background:var(--brand);color:var(--brand-ink);font-weight:600;text-decoration:none}.btn:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.small{font-size:.875rem;color:var(--muted);margin:14px 0 0}.foot{font-size:.8rem;color:var(--muted);margin:28px 0 0}
.cf{position:fixed;top:-12px;width:9px;height:14px;border-radius:2px;opacity:.9;animation:fall linear forwards;pointer-events:none}
@keyframes fall{to{top:105vh;transform:translateX(40px) rotate(540deg)}}@keyframes pop{from{transform:scale(.6);opacity:0}}
@media (prefers-reduced-motion:reduce){.icon{animation:none}}
${css}</style></head><body>${layout}${confettiJs || countdownJs ? `<script nonce="${opts.nonce}">${confettiJs}${countdownJs}</script>` : ''}</body></html>`;
}

/** Platform brand for an organisation: its white-label name/logo when set, else SampTrek by Sampledge. */
export function platformBrandOf(
  base: string,
  brand: { custom: boolean; appName: string; logoUrl: string | null; logoDarkUrl: string | null; iconUrl: string | null } | null,
): PlatformBrand {
  const def = defaultPlatformBrand(base);
  if (!brand || (!brand.custom && !brand.logoUrl)) return def;
  return {
    name: brand.custom ? brand.appName : def.name,
    logo: brand.logoUrl ?? brand.logoDarkUrl ?? (brand.custom ? null : def.logo),
    logoDark: brand.logoDarkUrl ?? brand.logoUrl ?? (brand.custom ? null : def.logoDark),
    icon: brand.iconUrl ?? (brand.custom ? null : def.icon),
  };
}
