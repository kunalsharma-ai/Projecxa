/** White-label (docs/WHITE_LABEL.md): the organisation's brand as the web app shows it. */
import { useEffect, useState } from 'react';

export interface Brand {
  appName: string;
  custom: boolean;
  tagline: string | null;
  brandColor: string | null;
  theme: string | null;
  hidePoweredBy: boolean;
  supportEmail: string | null;
  loginMessage: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  iconUrl: string | null;
}
export interface PublicBrand extends Partial<Brand> { default: boolean; appName: string; organization: { name: string; slug: string } | null }

export const DEFAULT_BRAND: Brand = { appName: 'PROJEXA', custom: false, tagline: null, brandColor: null, theme: null, hidePoweredBy: false, supportEmail: null, loginMessage: null, logoUrl: null, logoDarkUrl: null, iconUrl: null };

/** Two letters for the mark when there is no icon ("Acme Insight Hub" → "AI", "PROJEXA" → "PX"). */
export function initials(name: string) {
  if (name === 'PROJEXA') return 'PX';
  const w = name.split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
}

/** Tab title and icon follow the brand. */
export function applyDocumentBrand(b: Pick<Brand, 'appName' | 'custom' | 'iconUrl'>) {
  if (typeof document === 'undefined') return;
  document.title = b.custom ? b.appName : 'PROJEXA · Sampledge';
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"][data-brand]');
  if (b.iconUrl) {
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; link.dataset.brand = ''; document.head.appendChild(link); }
    link.href = b.iconUrl;
  } else link?.remove();
}

let cache: Promise<PublicBrand> | null = null;
/** Sign-in pages: the brand for this web address (a verified custom domain), else the default. */
export function usePublicBrand(): PublicBrand | null {
  const [b, setB] = useState<PublicBrand | null>(null);
  useEffect(() => {
    // Imported lazily so this file stays free of the API client for scripts.
    cache ??= import('./api').then(({ get }) => get<PublicBrand>(`/public/branding?host=${encodeURIComponent(location.host)}`)).catch(() => ({ default: true, appName: 'PROJEXA', organization: null }));
    let live = true;
    cache.then((r) => { if (live) { setB(r); if (!r.default) applyDocumentBrand({ appName: r.appName, custom: !!r.custom, iconUrl: r.iconUrl ?? null }); } });
    return () => { live = false; };
  }, []);
  return b;
}

/** The organisation's default theme and brand colour, as theme preferences. */
export function orgTheme(b: Partial<Brand> | undefined): Record<string, unknown> {
  return { ...(b?.theme ? { theme: b.theme } : {}), ...(b?.brandColor ? { accent: b.brandColor } : {}) };
}
