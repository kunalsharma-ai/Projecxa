'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { post } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ message: string }>('/auth/password/forgot', { email, ...(organization.trim() ? { organization: organization.trim() } : {}) });
      setDone(r.message);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-7">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Sampledge</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm text-muted">Enter the email you sign in with. We&rsquo;ll send a link to choose a new password.</p>
        </div>
        <ErrorBox error={error} />
        {done ? (
          <p className="rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">{done} Check your spam folder if it doesn&rsquo;t arrive in a few minutes.</p>
        ) : (
          <>
            <label className="block">
              <span className="label">Email</span>
              <input className="input" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <details className="text-sm text-muted">
              <summary className="cursor-pointer">Organization (only if you belong to several)</summary>
              <input className="input mt-2" placeholder="organization slug" value={organization} onChange={(e) => setOrganization(e.target.value)} />
            </details>
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          </>
        )}
        <Link href="/login" className="block text-center text-sm text-brand hover:underline">Back to sign in</Link>
      </form>
    </main>
  );
}
