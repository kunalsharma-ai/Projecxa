'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { post } from '@/lib/api';

interface LoginResult { home?: string; mfaRequired?: boolean; mfaToken?: string; recoveryCodesLeft?: number }

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organization, setOrganization] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const done = (r: LoginResult) => {
    // Running low on recovery codes after using one: go make new ones.
    if (r.recoveryCodesLeft !== undefined && r.recoveryCodesLeft <= 3) return router.replace(r.home === '/' ? '/account/security' : '/portal/account');
    router.replace(r.home ?? '/');
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mfaToken) {
        done(await post<LoginResult>('/auth/login/mfa', { mfaToken, ...(useRecovery ? { recoveryCode: code } : { code }) }));
      } else {
        const r = await post<LoginResult>('/auth/login', { email, password, ...(organization ? { organization } : {}) });
        if (r.mfaRequired && r.mfaToken) {
          setMfaToken(r.mfaToken);
          setCode('');
        } else done(r);
      }
    } catch (err) {
      setError(err);
      // The 5-minute window passed: start again from the password.
      if (mfaToken && err instanceof Error && /took too long/.test(err.message)) setMfaToken(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-7">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Sampledge</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{mfaToken ? 'Enter your code' : 'Sign in to PROJEXA'}</h1>
          {mfaToken && <p className="mt-1 text-sm text-muted">{useRecovery ? 'Enter one of the recovery codes you saved. Each works once.' : 'Open your authenticator app and enter the 6-digit code for PROJEXA.'}</p>}
        </div>
        <ErrorBox error={error} />
        {mfaToken ? (
          <>
            <label className="block">
              <span className="label">{useRecovery ? 'Recovery code' : 'Code'}</span>
              {useRecovery ? (
                <input key="rc" className="input font-mono" autoComplete="off" autoFocus placeholder="xxxx-xxxx-xx" value={code} onChange={(e) => setCode(e.target.value)} required />
              ) : (
                <input key="totp" className="input text-center font-mono text-lg tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
              )}
            </label>
            <button className="btn-primary w-full" disabled={busy || (!useRecovery && code.length !== 6)}>{busy ? 'Checking…' : 'Continue'}</button>
            <div className="flex justify-between text-sm">
              <button type="button" className="text-brand hover:underline" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setError(null); }}>{useRecovery ? 'Use the app code' : 'Use a recovery code'}</button>
              <button type="button" className="text-muted hover:text-ink" onClick={() => { setMfaToken(null); setPassword(''); setError(null); }}>Back</button>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </form>
    </main>
  );
}
