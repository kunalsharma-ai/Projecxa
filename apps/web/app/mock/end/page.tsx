'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function MockEnd() {
  const sp = useSearchParams();
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="card p-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted">Mock static end page</div>
        <h1 className="mt-2 text-xl font-semibold">{sp.get('state')?.replace('_', ' ')}</h1>
        <p className="mt-2 text-sm text-muted">Static destination: no respondent parameters were added.</p>
        <code className="mt-3 block break-all rounded bg-sunken p-2 text-xs">{sp.toString()}</code>
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense><MockEnd /></Suspense>;
}
