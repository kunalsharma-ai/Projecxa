'use client';
import clsx from 'clsx';
import { useEffect } from 'react';
import { useTheme } from '@/components/theme';
import { initials, orgTheme, PRODUCT_ASSETS, PRODUCT_TAGLINE, usePublicBrand, type Brand } from '@/lib/branding';

/**
 * SampTrek's own logo (product name, "Projects on track." and "by Sampledge"). It comes in a
 * version for dark backgrounds and one for light ones: `surface="page"` follows light/dark mode
 * (cards and panels), `surface="sidebar"` follows the sidebar colour, which can be dark in light mode.
 */
export function ProductLogo({ surface = 'page', className }: { surface?: 'page' | 'sidebar'; className?: string }) {
  const [forLight, forDark] = surface === 'sidebar' ? ['sb-light-logo', 'sb-dark-logo'] : ['dark-hide', 'dark-show'];
  const alt = `SampTrek. ${PRODUCT_TAGLINE} by Sampledge`;
  return (
    <span className={clsx('inline-flex shrink-0', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={PRODUCT_ASSETS.logoForLight} alt={alt} className={clsx(forLight, 'h-full w-auto max-w-none')} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={PRODUCT_ASSETS.logoForDark} alt={alt} className={clsx(forDark, 'h-full w-auto max-w-none')} />
    </span>
  );
}

/** The square mark: the uploaded icon, else SampTrek's icon, else (own product name) initials on the brand gradient. */
export function BrandIcon({ brand, className }: { brand: Pick<Brand, 'appName' | 'iconUrl'> & { custom?: boolean }; className?: string }) {
  if (brand.iconUrl) return <img src={brand.iconUrl} alt="" className={clsx('h-8 w-8 shrink-0 rounded-lg object-cover', className)} />; // eslint-disable-line @next/next/no-img-element
  if (!brand.custom) return <img src={PRODUCT_ASSETS.icon} alt="" className={clsx('h-8 w-8 shrink-0 object-contain', className)} />; // eslint-disable-line @next/next/no-img-element
  return (
    <span className={clsx('brand-icon grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-brand to-accent2 text-[13px] font-bold text-brand-ink shadow-sm', className)} aria-hidden>
      {initials(brand.appName)}
    </span>
  );
}

/**
 * Full logo for sign-in pages and the portal header: the uploaded logo (a dark-mode version when
 * there is one), else the product name.
 */
export function BrandLogo({ brand, className, kicker = true }: { brand: Partial<Brand> & { appName: string }; className?: string; kicker?: boolean }) {
  if (brand.logoUrl) {
    return (
      <span className={clsx('inline-flex', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={brand.logoUrl} alt={brand.appName} className={clsx('h-9 max-w-[220px] object-contain object-left', brand.logoDarkUrl && 'dark-hide')} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {brand.logoDarkUrl && <img src={brand.logoDarkUrl} alt={brand.appName} className="dark-show h-9 max-w-[220px] object-contain object-left" />}
      </span>
    );
  }
  if (!brand.custom) return kicker ? <ProductLogo className={clsx('h-12', className)} /> : null;
  return <div className={clsx('text-sm font-semibold uppercase tracking-[0.18em] text-brand', className)}>{brand.appName}</div>;
}

/** Sign-in pages: the brand for this web address, with its default theme and colour applied. */
export function useBrandedPage() {
  const brand = usePublicBrand();
  const { brandDefaults } = useTheme();
  useEffect(() => { if (brand && !brand.default) brandDefaults(orgTheme(brand) as never); }, [brand, brandDefaults]);
  return brand;
}
