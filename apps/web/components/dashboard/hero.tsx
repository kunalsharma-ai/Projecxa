'use client';
import clsx from 'clsx';
import { Activity, ArrowRight, BarChart3, CheckCircle2, ChevronUp, FlaskConical, ReceiptText, Send, Settings2, ShieldCheck, Sparkles, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** One step of the research lifecycle, linked to the screen where that work happens. */
interface Stage { label: string; href: string; icon: typeof Trophy; tone: string; count?: number; countLabel?: string }

const HIDE_KEY = 'projexa.hero.hidden';
const SUGGESTIONS = ['Which live projects are behind pace?', 'Summarise this week’s completes by vendor', 'Which invoices are still unpaid?'];

/**
 * The command center's opening panel (Neon redesign): the lifecycle from won bid to closure as a ring of
 * linked stages with live counts, and a quick question box for the AI copilot. Numbers are real; nothing
 * here is sample data. People can fold it away; the choice is remembered in this browser.
 */
export function CommandHero({ firstName, canCreate, counts }: {
  firstName: string;
  canCreate: boolean;
  counts: { live: number; draft: number; test: number; closed: number; invoiced: number; total: number };
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try { setHidden(localStorage.getItem(HIDE_KEY) === '1'); } catch { /* storage unavailable: keep it open */ }
  }, []);
  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    try { localStorage.setItem(HIDE_KEY, next ? '1' : '0'); } catch { /* not remembered */ }
  };

  const stages: Stage[] = [
    { label: 'Won bids', href: '/won-bids', icon: Trophy, tone: 'tone-amber' },
    { label: 'Project setup', href: canCreate ? '/projects/new' : '/projects', icon: Settings2, tone: 'tone-violet', count: counts.draft, countLabel: 'draft' },
    { label: 'Gate & survey', href: '/projects', icon: ShieldCheck, tone: 'tone-blue' },
    { label: 'QA testing', href: '/projects', icon: FlaskConical, tone: 'tone-cyan', count: counts.test, countLabel: 'in test' },
    { label: 'Fieldwork', href: '/monitor', icon: Activity, tone: 'tone-green', count: counts.live, countLabel: 'live' },
    { label: 'Reporting', href: '/reports', icon: BarChart3, tone: 'tone-blue' },
    { label: 'Invoice', href: '/invoices', icon: ReceiptText, tone: 'tone-pink', count: counts.invoiced, countLabel: 'invoiced' },
    { label: 'Closure', href: '/projects', icon: CheckCircle2, tone: 'tone-red', count: counts.closed, countLabel: 'closed' },
  ];
  const ask = (text: string) => router.push(`/copilot?ask=${encodeURIComponent(text)}`);

  if (hidden) {
    return (
      <div className="mb-4 flex justify-end">
        <button type="button" className="btn-ghost h-8 px-3 text-xs" onClick={toggle}><Sparkles className="h-3.5 w-3.5" /> Show lifecycle and copilot</button>
      </div>
    );
  }

  return (
    <section className="card relative mb-5 overflow-hidden" aria-label="Research lifecycle">
      <div className="pointer-events-none absolute inset-0 opacity-90" aria-hidden
        style={{ background: 'radial-gradient(600px 300px at 55% 50%, rgb(var(--brand) / 0.16), transparent 70%), radial-gradient(420px 260px at 100% 0%, rgb(var(--accent2) / 0.14), transparent 70%)' }} />
      <button type="button" onClick={toggle} className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink" aria-label="Fold away the lifecycle panel" title="Hide">
        <ChevronUp className="h-4 w-4" />
      </button>
      <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,0.75fr)]">
        {/* Intro */}
        <div className="flex min-w-0 flex-col justify-center pr-6 lg:pr-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Plan · Program · Execute · Monitor · Deliver</p>
          <h2 className="mt-2 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
            Your end-to-end research project <span className="text-gradient">command center</span>
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            Welcome back{firstName ? `, ${firstName}` : ''}. From won bid to project closure, with {counts.live} live of {counts.total} {counts.total === 1 ? 'project' : 'projects'} in total.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {canCreate && <Link href="/projects/new" className="btn-primary">Create project <ArrowRight className="h-4 w-4" /></Link>}
            <Link href="/projects" className="btn-ghost">All projects</Link>
          </div>
        </div>

        {/* Lifecycle ring (large screens) */}
        <div className="relative hidden aspect-[16/10] min-w-0 md:block">
          <div className="absolute left-1/2 top-1/2 h-[80%] w-[82%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-brand/25" aria-hidden
            style={{ boxShadow: '0 0 40px -6px rgb(var(--brand) / 0.55), inset 0 0 40px -10px rgb(var(--accent2) / 0.5)' }} />
          <div className="absolute left-1/2 top-1/2 grid h-24 w-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-3xl bg-neon"
            style={{ boxShadow: '0 0 0 1px rgb(255 255 255 / 0.25) inset, 0 18px 40px -10px rgb(var(--brand) / 0.9), 0 0 60px -10px rgb(var(--accent2) / 0.9)' }} aria-hidden>
            <span className="text-center leading-none"><span className="block text-4xl font-black">P</span><span className="mt-1 block text-[9px] font-semibold tracking-[0.2em]">LIFECYCLE</span></span>
          </div>
          <ol className="absolute inset-0">
            {stages.map((s, i) => {
              // Evenly round an ellipse, starting at the top-left and going clockwise.
              const a = (-90 - 67.5 + i * 45) * (Math.PI / 180);
              const x = 50 + 41 * Math.cos(a);
              const y = 50 + 40 * Math.sin(a);
              return (
                <li key={s.label} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
                  <StageLink s={s} step={i + 1} />
                </li>
              );
            })}
          </ol>
        </div>

        {/* Lifecycle row (phones) */}
        <ol className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 md:hidden">
          {stages.map((s, i) => <li key={s.label} className="snap-start"><StageLink s={s} step={i + 1} /></li>)}
        </ol>

        {/* Copilot box */}
        <div className="min-w-0 rounded-2xl border border-brand/20 bg-panel/70 p-4 backdrop-blur lg:col-span-2 2xl:col-span-1">
          <div className="flex items-center gap-2 text-sm font-semibold"><span className="icon-tile tone-brand h-8 w-8 rounded-xl"><Sparkles className="h-4 w-4" /></span>AI copilot</div>
          <p className="mt-2 text-sm text-muted">How can I help you today?</p>
          <div className="mt-2 flex flex-wrap gap-1.5 2xl:flex-col">
            {SUGGESTIONS.map((t) => (
              <button key={t} type="button" onClick={() => ask(t)} className="flex items-center gap-1.5 rounded-full border border-line bg-panel/80 px-3 py-1.5 text-left text-xs text-ink transition-colors hover:border-brand/50 hover:bg-brand/5">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />{t}
              </button>
            ))}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q.trim()); }}>
            <input className="input rounded-full" placeholder="Ask me anything…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ask the copilot" />
            <button type="submit" className="btn-primary h-10 w-10 shrink-0 p-0" aria-label="Ask" disabled={!q.trim()}><Send className="h-4 w-4" /></button>
          </form>
        </div>
      </div>
    </section>
  );
}

function StageLink({ s, step }: { s: Stage; step: number }) {
  return (
    <Link href={s.href} className="group flex w-[92px] flex-col items-center gap-1 rounded-xl p-1 text-center outline-offset-2" title={`Step ${step}: ${s.label}`}>
      <span className={clsx('icon-tile transition-transform duration-[var(--dur)] group-hover:-translate-y-0.5 group-hover:scale-105', s.tone)}>
        <s.icon className="h-5 w-5" aria-hidden />
      </span>
      <span className="text-xs font-semibold leading-tight text-ink">{s.label}</span>
      {s.count !== undefined && <span className="text-[11px] leading-none tabular-nums text-muted">{s.count} {s.countLabel}</span>}
    </Link>
  );
}
