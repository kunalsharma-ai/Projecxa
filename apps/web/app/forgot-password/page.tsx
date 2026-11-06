'use client';
import { AuthShell } from '@/components/auth-shell';
import Link from 'next/link';
import { BrandLogo, useBrandedPage } from '@/components/brand-mark';
import { FormEvent, useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { post } from '@/lib/api';
import { Label } from '@/components/help';

export default function ForgotPasswordPage() {
  const brand = useBrandedPage();
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
    <AuthShell>
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-7">
        <div>
          {brand && <BrandLogo brand={brand} />}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm text-muted">Enter the email you sign in with. We&rsquo;ll send a link to choose a new password.</p>
        </div>
        <ErrorBox error={error} />
        {done ? (
          <p className="rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">{done} Check your spam folder if it doesn&rsquo;t arrive in a few minutes.</p>
        ) : (
          <>
            <label className="block">
              <Label>Email</Label>
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
    </AuthShell>
  );
}
