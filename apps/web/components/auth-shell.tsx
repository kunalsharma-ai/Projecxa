'use client';
import { Activity, BarChart3, ReceiptText, ShieldCheck, Sparkles, Trophy } from 'lucide-react';
import { ProductLogo } from '@/components/brand-mark';
import { usePublicBrand } from '@/lib/branding';

const STEPS = [
  { label: 'Won bids', icon: Trophy, tone: 'tone-amber' },
  { label: 'Gate & survey', icon: ShieldCheck, tone: 'tone-blue' },
  { label: 'Fieldwork', icon: Activity, tone: 'tone-green' },
  { label: 'Reporting', icon: BarChart3, tone: 'tone-violet' },
  { label: 'Invoicing', icon: ReceiptText, tone: 'tone-pink' },
  { label: 'AI copilot', icon: Sparkles, tone: 'tone-cyan' },
];

/**
 * Signed-out pages (sign in, forgot and set password): the form on the right, and on wide screens a
 * neon panel on the left with the product name and lifecycle. A white-labelled address shows its own
 * name and tagline and never mentions Sampledge.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const brand = usePublicBrand();
  const custom = !!brand && !brand.default && !!brand.custom;
  const name = brand?.appName ?? 'SampTrek';
  const tagline = custom ? (brand?.tagline ?? 'Research project management') : 'Research Project Management Suite';
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="neon-rail relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-ink lg:flex lg:flex-col lg:justify-between" aria-hidden>
        <div>
          {custom ? <div className="text-3xl font-bold tracking-wide">{name}</div> : <ProductLogo surface="sidebar" className="h-20" />}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sidebar-active">Plan · Program · Execute · Monitor · Deliver</p>
          <h2 className="mt-3 max-w-md text-4xl font-bold leading-tight">{tagline}</h2>
          <p className="mt-3 max-w-md text-sidebar-muted">From won bid to project closure: fieldwork, quotas, reconciliation and invoicing in one place.</p>
          <ul className="mt-8 grid max-w-md grid-cols-3 gap-4">
            {STEPS.map((s) => (
              <li key={s.label} className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-center text-xs font-medium backdrop-blur">
                <span className={`icon-tile ${s.tone}`}><s.icon className="h-5 w-5" /></span>{s.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-between gap-4 text-xs text-sidebar-muted">
          <span>© {new Date().getFullYear()} {name}</span>
          {!custom && <span className="flex items-center gap-2">A product of <img src="/brand/sampledge-logo-on-dark.svg" alt="Sampledge" className="h-6 w-auto" /></span>}
        </div>
      </section>
      <div className="grid place-items-center px-4 py-10">
        <div className="flex w-full max-w-md flex-col items-center">
          {children}
          {/* The company behind the product, on every signed-out page (not on white-labelled addresses). */}
          {brand && !custom && (
            <p className="mt-6 flex items-center justify-center gap-2 text-xs text-muted">
              Powered by
              <img src="/brand/sampledge-logo-on-light.svg" alt="Sampledge" className="h-6 w-auto dark:hidden" />
              <img src="/brand/sampledge-logo-on-dark.svg" alt="Sampledge" className="hidden h-6 w-auto dark:block" />
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
