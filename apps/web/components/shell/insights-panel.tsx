'use client';
import clsx from 'clsx';
import { AlertOctagon, AlertTriangle, CheckCircle2, History, Info, Lightbulb, X } from 'lucide-react';
import Link from 'next/link';

export interface Insight { id: string; severity: 'info' | 'warn' | 'bad'; title: string; detail: string; href: string }
export interface Insights { items: Insight[]; alerts: number; wonBidsNew?: number; activity: { id: string; action: string; entityType: string; entityId: string; at: string; actor: string }[] }

const ICON = { bad: AlertOctagon, warn: AlertTriangle, info: Info } as const;
const TONE = { bad: 'text-bad', warn: 'text-warn', info: 'text-info' } as const;
const LABEL = { bad: 'Problem', warn: 'Attention', info: 'For you' } as const;

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
const humanAction = (a: string) => a.replace(/[._-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Right-hand panel: what needs attention now, and recent activity. Hidden unless the user opens it. */
export function InsightsPanel({ data, onClose }: { data: Insights | null; onClose: () => void }) {
  return (
    <aside aria-label="Insights" className="flex h-full w-full flex-col border-l border-line bg-panel shadow-2xl 2xl:shadow-none">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-brand" /> Insights</h2>
        <button onClick={onClose} className="rounded p-1 text-muted hover:text-ink" aria-label="Hide insights panel"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Needs attention</h3>
          {!data ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-14" />)}</div>
          ) : data.items.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg bg-ok/10 p-3 text-sm text-ok"><CheckCircle2 className="h-4 w-4" /> Nothing needs attention right now.</p>
          ) : (
            <ul className="space-y-2">
              {data.items.map((it, i) => {
                const Icon = ICON[it.severity];
                return (
                  <li key={it.id} className="anim-in" style={{ animationDelay: `calc(${i} * var(--dur) / 4)` }}>
                    <Link href={it.href} className="flex gap-3 rounded-lg border border-line bg-panel p-3 text-sm transition-colors duration-[var(--dur)] hover:border-brand/40">
                      <Icon className={clsx('mt-0.5 h-4 w-4 shrink-0', TONE[it.severity])} aria-label={LABEL[it.severity]} />
                      <span className="min-w-0">
                        <span className="block font-medium">{it.title}</span>
                        <span className="block truncate text-xs text-muted">{it.detail}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted"><History className="h-3.5 w-3.5" /> Recent activity</h3>
          {data && data.activity.length === 0 && <p className="text-sm text-muted">No activity yet.</p>}
          <ol className="relative space-y-3 border-l border-line pl-4">
            {data?.activity.map((a) => (
              <li key={a.id} className="text-sm">
                <span className="absolute -left-[4.5px] mt-1.5 h-2 w-2 rounded-full bg-brand/60" aria-hidden />
                <div>{humanAction(a.action)}</div>
                <div className="text-xs text-muted">{a.actor} · {ago(a.at)}</div>
              </li>
            ))}
          </ol>
        </section>
        <p className="text-xs text-muted">These insights are rule-based checks on live fieldwork data. The AI copilot is planned for a later milestone.</p>
      </div>
    </aside>
  );
}
