'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { API_URL } from '@/lib/api';

const STATUSES = ['complete', 'terminate', 'quota_full', 'quality_fail', 'partial', 'technical_error'];

/** Local stand-in for a client survey, so the full respondent journey can be tried without a real survey platform. */
function MockSurvey() {
  const sp = useSearchParams();
  const token = sp.get('token') ?? '';
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="card p-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted">Mock client survey · {sp.get('country')}</div>
        <h1 className="mt-2 text-xl font-semibold">How should this respondent finish?</h1>
        <p className="mt-2 text-sm text-muted">The survey received an opaque token, not the vendor&apos;s respondent ID:</p>
        <code className="mt-2 block break-all rounded bg-sunken p-2 text-xs">{token || 'no token'}</code>
        <div className="mt-6 grid grid-cols-2 gap-2">
          {STATUSES.map((s) => (
            <a key={s} className={s === 'complete' ? 'btn-primary' : 'btn-ghost'} href={`${API_URL}/r/${s}?token=${encodeURIComponent(token)}`}>{s.replace('_', ' ')}</a>
          ))}
        </div>
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense><MockSurvey /></Suspense>;
}
