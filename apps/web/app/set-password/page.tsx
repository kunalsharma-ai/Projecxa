'use client';
import { AuthShell } from '@/components/auth-shell';
import Link from 'next/link';
import { BrandLogo, useBrandedPage } from '@/components/brand-mark';
import { FormEvent, useEffect, useState } from 'react';
import { passwordProblems, PasswordRules } from '@/components/account/password-rules';
import { ErrorBox, Loading } from '@/components/ui';
import { get, post } from '@/lib/api';
import { Label } from '@/components/help';

interface Info { purpose: 'invite' | 'reset'; name: string; email: string; organization: string; mfa: boolean }

/** Opened from an invitation or password-reset email. */
export default function SetPasswordPage() {
  const brand = useBrandedPage();
  const appName = brand?.appName ?? 'SampTrek';
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token') ?? '';
    // Keep the secret out of the address bar and browser history.
    window.history.replaceState(null, '', '/set-password');
    setToken(t);
    get<Info>(`/auth/password/token?token=${encodeURIComponent(t)}`).then(setInfo).catch(setError);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ email: string }>('/auth/password/set', { token, password });
      window.location.href = `/login?password=${info?.purpose === 'invite' ? 'welcome' : 'reset'}&email=${encodeURIComponent(r.email)}`;
    } catch (err) { setError(err); setBusy(false); }
  }

  const ok = passwordProblems(password, confirm).every((r) => r.ok);
  return (
    <AuthShell>
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-7">
        <div>
          {brand && <BrandLogo brand={brand} />}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{info?.purpose === 'invite' ? `Welcome to ${appName}` : 'Choose a new password'}</h1>
          {info && <p className="mt-1 text-sm text-muted">{info.purpose === 'invite' ? `Hi ${info.name}, choose a password for ${info.email} in ${info.organization.replace(/\.$/, '')}.` : `For ${info.email} in ${info.organization.replace(/\.$/, '')}. You'll be signed out everywhere else.`}</p>}
        </div>
        <ErrorBox error={error} />
        {!token || (!info && !error) ? <Loading /> : !info ? (
          <Link href="/forgot-password" className="btn-primary w-full">Ask for a new link</Link>
        ) : (
          <>
            <input type="email" autoComplete="username" value={info.email} readOnly hidden />
            <label className="block">
              <Label>New password</Label>
              <input className="input" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <label className="block">
              <Label>Type it again</Label>
              <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </label>
            <PasswordRules password={password} confirm={confirm} />
            <button className="btn-primary w-full" disabled={busy || !ok}>{busy ? 'Saving…' : info.purpose === 'invite' ? 'Set password and continue' : 'Save new password'}</button>
            {info.mfa && <p className="text-xs text-muted">You&rsquo;ll still enter the code from your authenticator app when you sign in.</p>}
          </>
        )}
      </form>
    </AuthShell>
  );
}
