'use client';
import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FxInfo, MoneyMode, SummaryRow } from './types';

const KEY = 'projexa.reports.money';

/** The viewer's money mode, remembered in this browser. Converted is the default. */
export function useMoneyMode(): [MoneyMode, (m: MoneyMode) => void] {
  const [mode, setMode] = useState<MoneyMode>('reporting');
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'market' || v === 'reporting') setMode(v);
    } catch {
      /* storage blocked: keep the default */
    }
  }, []);
  const set = (m: MoneyMode) => {
    setMode(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* ignore */
    }
  };
  return [mode, set];
}

/** Switch between converted and per-currency money, with the rates and any currency left out. */
export function MoneyModeBar({ mode, onMode, fx, rows }: { mode: MoneyMode; onMode: (m: MoneyMode) => void; fx: FxInfo | undefined; rows: (SummaryRow | null | undefined)[] }) {
  if (!fx) return null;
  const missing = [...new Set(rows.flatMap((r) => r?.reporting?.missing ?? []))].sort();
  const rates = fx.rates.map((r) => `1 ${r.currency} = ${r.rate} ${fx.currency}`).join(' · ');
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <div className="inline-flex rounded-lg border border-line bg-panel p-0.5" role="radiogroup" aria-label="Show money">
        {(['reporting', 'market'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} onClick={() => onMode(m)} className={clsx('rounded-md px-3 py-1.5', mode === m ? 'bg-brand text-white' : 'text-muted hover:text-ink')}>
            {m === 'reporting' ? `In ${fx.currency}` : 'Market currencies'}
          </button>
        ))}
      </div>
      {mode === 'reporting' && (
        <span className="min-w-0 text-muted">
          {rates ? `Today’s rates: ${rates}` : `Every market is in ${fx.currency}, or no rates are set yet`}
          {fx.updatedAt ? ` · changed ${new Date(fx.updatedAt).toLocaleDateString()}` : ''} · <Link href="/settings#finance" className="text-brand hover:underline">Exchange rates</Link>
        </span>
      )}
      {mode === 'reporting' && missing.length > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-warn/10 px-2 py-1 text-warn">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> * {missing.join(', ')} {missing.length === 1 ? 'has' : 'have'} no rate and {missing.length === 1 ? 'is' : 'are'} left out
        </span>
      )}
    </div>
  );
}
