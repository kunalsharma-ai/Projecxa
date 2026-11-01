'use client';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

/** Local stand-in for a vendor's redirect landing page; shows exactly which parameters arrived. */
function MockVendor() {
  const { code } = useParams<{ code: string }>();
  const sp = useSearchParams();
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="card p-6">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted">Mock vendor page · {code}</div>
        <h1 className="mt-2 text-xl font-semibold">Respondent returned: {sp.get('state')}</h1>
        <table className="mt-4 w-full text-sm">
          <tbody className="divide-y divide-line">
            {[...sp.entries()].map(([k, v]) => (
              <tr key={k}><td className="py-1.5 font-mono text-xs text-muted">{k}</td><td className="py-1.5 font-mono text-xs">{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense><MockVendor /></Suspense>;
}
