'use client';
import { CircleSlash, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ProductLogo } from '@/components/brand-mark';
import { StatusBoard, type StatusPage } from '@/components/status/status-board';
import { ApiError, get } from '@/lib/api';

/** Public: is SampTrek working? (docs/STATUS_PAGE.md). No sign-in; refreshes every minute. */
export default function PublicStatusPage() {
  const [page, setPage] = useState<StatusPage | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'hidden' | 'unreachable'>('loading');
  const load = useCallback(() => get<StatusPage>('/public/status').then((p) => { setPage(p); setState('ok'); document.title = p.title; }).catch((e) => {
    setState(e instanceof ApiError && e.status === 404 ? 'hidden' : 'unreachable');
  }), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <ProductLogo className="h-8" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{page?.title ?? 'SampTrek status'}</h1>
          {page?.intro && <p className="mt-1 text-sm text-muted">{page.intro}</p>}
        </div>
      </div>
      {state === 'loading' && <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Checking…</div>}
      {state === 'hidden' && <div className="card p-6 text-sm text-muted">This status page is not published.</div>}
      {state === 'unreachable' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl bg-bad px-5 py-4 text-base font-semibold text-white" role="status"><CircleSlash className="h-6 w-6" />SampTrek is not answering right now</div>
          <p className="text-sm text-muted">The server could not be reached{page ? '; the last known status is below' : ''}. This page tries again every minute.</p>
          {page && <StatusBoard page={page} />}
        </div>
      )}
      {state === 'ok' && page && <StatusBoard page={page} />}
      <p className="mt-10 text-center text-xs text-muted">Uptime is measured by SampTrek checking itself every minute. A minute without a check counts as down.</p>
    </main>
  );
}
