'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { post } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organization, setOrganization] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ home?: string }>('/auth/login', { email, password, ...(organization ? { organization } : {}) });
      router.replace(r.home ?? '/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-7">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Sampledge</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sign in to PROJEXA</h1>
        </div>
        <ErrorBox error={error} />
        <label className="block">
          <span className="label">Email</span>
          <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="block">
          <span className="label">Password</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <details className="text-sm text-muted">
          <summary className="cursor-pointer">Organization (only if you belong to several)</summary>
          <input className="input mt-2" placeholder="organization slug" value={organization} onChange={(e) => setOrganization(e.target.value)} />
        </details>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
