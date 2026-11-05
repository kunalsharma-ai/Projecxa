'use client';
import clsx from 'clsx';
import { useEffect } from 'react';
import { useTheme } from '@/components/theme';
import { initials, orgTheme, usePublicBrand, type Brand } from '@/lib/branding';

/** The square mark: the uploaded icon, else initials on the brand gradient. */
export function BrandIcon({ brand, className }: { brand: Pick<Brand, 'appName' | 'iconUrl'>; className?: string }) {
  if (brand.iconUrl) return <img src={brand.iconUrl} alt="" className={clsx('h-8 w-8 shrink-0 rounded-lg object-cover', className)} />; // eslint-disable-line @next/next/no-img-element
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
  if (!brand.custom) return kicker ? <div className={clsx('text-xs font-semibold uppercase tracking-[0.2em] text-brand', className)}>Sampledge</div> : null;
  return <div className={clsx('text-sm font-semibold uppercase tracking-[0.18em] text-brand', className)}>{brand.appName}</div>;
}

/** Sign-in pages: the brand for this web address, with its default theme and colour applied. */
export function useBrandedPage() {
  const brand = usePublicBrand();
  const { brandDefaults } = useTheme();
  useEffect(() => { if (brand && !brand.default) brandDefaults(orgTheme(brand) as never); }, [brand, brandDefaults]);
  return brand;
}
