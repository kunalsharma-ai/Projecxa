'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { API_URL, get, post } from '@/lib/api';

interface Provider { id: string; label: string }

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
  const [providers, setProviders] = useState<Provider[]>([]);
  // Back from Google, Microsoft or Zoho, and the person also uses an authenticator app: the in-between token is in a cookie.
  const [ssoStep, setSsoStep] = useState(false);
  const codeStep = !!mfaToken || ssoStep;

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('step') === 'code') setSsoStep(true);
    const msg = q.get('sso_error');
    if (msg) setError(new Error(msg));
    if (q.size) window.history.replaceState(null, '', '/login');
    get<Provider[]>('/auth/sso/providers').then(setProviders).catch(() => setProviders([]));
  }, []);

  const back = () => { setMfaToken(null); setSsoStep(false); setPassword(''); setCode(''); setError(null); };
  const ssoHref = (id: string) => `${API_URL}/api/v1/auth/sso/${id}/start${organization.trim() ? `?org=${encodeURIComponent(organization.trim())}` : ''}`;

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
      if (codeStep) {
        done(await post<LoginResult>('/auth/login/mfa', { ...(mfaToken ? { mfaToken } : {}), ...(useRecovery ? { recoveryCode: code } : { code }) }));
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
      if (codeStep && err instanceof Error && /took too long|expired|Sign in again/i.test(err.message)) { setMfaToken(null); setSsoStep(false); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-7">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Sampledge</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{codeStep ? 'Enter your code' : 'Sign in to PROJEXA'}</h1>
          {codeStep && <p className="mt-1 text-sm text-muted">{useRecovery ? 'Enter one of the recovery codes you saved. Each works once.' : 'Open your authenticator app and enter the 6-digit code for PROJEXA.'}</p>}
        </div>
        <ErrorBox error={error} />
        {codeStep ? (
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
              <button type="button" className="text-muted hover:text-ink" onClick={back}>Back</button>
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
            {providers.length > 0 && (
              <>
                <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted">
                  <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
                </div>
                <div className="space-y-2">
                  {providers.map((p) => (
                    <a key={p.id} href={ssoHref(p.id)} className="btn-ghost flex w-full items-center justify-center gap-2" data-provider={p.id}>
                      <ProviderMark id={p.id} />
                      Continue with {p.label}
                    </a>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </form>
    </main>
  );
}

/** Small neutral marks (not the providers' logos) so the buttons are easy to tell apart. */
function ProviderMark({ id }: { id: string }) {
  const colour: Record<string, string> = { google: '#4285F4', microsoft: '#737373', zoho: '#E42527' };
  return (
    <span aria-hidden className="grid h-5 w-5 place-items-center rounded text-[11px] font-bold text-white" style={{ background: colour[id] ?? '#64748b' }}>
      {id[0].toUpperCase()}
    </span>
  );
}
