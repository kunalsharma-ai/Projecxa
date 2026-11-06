'use client';
import { ShieldCheck, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { RecoveryCodes } from '@/components/account/recovery-codes';
import { ErrorBox, Loading, Section } from '@/components/ui';
import { get, post } from '@/lib/api';
import type { MfaStatus } from '@/lib/types';

interface Setup { secret: string; otpauthUrl: string; qrSvg: string }
const when = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');

/** Turn two-step sign-in on or off, and manage recovery codes. Used by staff and portal users. */
export function MfaPanel({ email, onFinished }: { email: string; onFinished?: () => void }) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<'off' | 'regen' | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => get<MfaStatus>('/auth/mfa').then(setStatus).catch(setError), []);
  useEffect(() => { load(); }, [load]);

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await f(); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const start = () => run(async () => { setSetup(await post<Setup>('/auth/mfa/setup')); setCode(''); });
  const confirm = () => run(async () => {
    const r = await post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code });
    setCodes(r.recoveryCodes);
    setSetup(null);
    setCode('');
    await load();
  });
  const turnOff = () => run(async () => {
    const isCode = /^\d{6}$/.test(code.trim());
    await post('/auth/mfa/disable', { password, ...(isCode ? { code: code.trim() } : { recoveryCode: code.trim() }) });
    setMode(null);
    setPassword('');
    setCode('');
    await load();
  });
  const regen = () => run(async () => {
    setCodes((await post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { code: code.trim() })).recoveryCodes);
    setMode(null);
    setCode('');
    await load();
  });

  if (!status) return error ? <ErrorBox error={error} /> : <Loading />;
  return (
    <Section title="Two-step sign-in">
      {status.setupRequired && !setup && !codes && (
        <p className="mb-4 rounded-lg border border-brand/30 bg-brand/10 p-3 text-sm">Your organization requires two-step sign-in. Set it up below to keep using SampTrek. It takes about a minute.</p>
      )}
      <ErrorBox error={error} />
      {codes ? (
        <RecoveryCodes codes={codes} account={email} onDone={() => { setCodes(null); onFinished?.(); }} />
      ) : status.enabled ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
            <div className="text-sm">
              <div className="font-medium">On since {when(status.enabledAt)}</div>
              <div className="text-muted">After your password, SampTrek asks for the 6-digit code from your authenticator app. {status.recoveryCodesLeft} recovery code{status.recoveryCodesLeft === 1 ? '' : 's'} left{status.recoveryCodesLeft <= 3 ? ': make new ones soon.' : '.'}</div>
              {status.required && <div className="mt-1 text-muted">Required by your organization, so it stays on. If you get a new phone, ask an admin to reset it.</div>}
            </div>
          </div>
          {mode === null && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => setMode('regen')}>New recovery codes</button>
              {!status.required && <button className="btn-ghost text-bad" onClick={() => setMode('off')}>Turn off</button>}
            </div>
          )}
          {mode && (
            <div className="rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-end gap-3">
                {mode === 'off' && <label><span className="label">Password</span><input className="input w-56" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
                <label><span className="label">{mode === 'off' ? 'Code from your app or a recovery code' : 'Code from your app'}</span><input className="input w-56 font-mono" inputMode={mode === 'regen' ? 'numeric' : undefined} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
                <button className={mode === 'off' ? 'btn-danger' : 'btn-primary'} disabled={busy || !code.trim() || (mode === 'off' && !password)} onClick={mode === 'off' ? turnOff : regen}>{mode === 'off' ? 'Turn off two-step sign-in' : 'Make new codes'}</button>
                <button className="btn-ghost" onClick={() => { setMode(null); setCode(''); setPassword(''); }}>Cancel</button>
              </div>
              {mode === 'regen' && <p className="mt-2 text-xs text-muted">Your old recovery codes stop working.</p>}
            </div>
          )}
        </div>
      ) : setup ? (
        <div className="grid gap-6 md:grid-cols-[220px_1fr]">
          <div className="mx-auto w-[200px] rounded-lg bg-white p-2 md:mx-0" aria-label="QR code for your authenticator app" role="img" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
          <div className="space-y-4 text-sm">
            <ol className="list-decimal space-y-2 pl-5">
              <li>Open a free authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator, Authy or 1Password.</li>
              <li>Add an account and scan the QR code. If you cannot scan it, enter this key: <code className="break-all rounded bg-sunken px-1.5 py-0.5 font-mono text-xs">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code></li>
              <li>Type the 6-digit code the app shows.</li>
            </ol>
            <div className="flex flex-wrap items-end gap-3">
              <label><span className="label">Code</span><input className="input w-36 text-center font-mono text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
              <button className="btn-primary" disabled={busy || code.length !== 6} onClick={confirm}>Turn on</button>
              <button className="btn-ghost" onClick={() => setSetup(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3 text-sm">
            <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
            <div><div className="font-medium">Off</div><div className="text-muted">Protect your account with a code from your phone, so a stolen password is not enough to sign in.</div></div>
          </div>
          <button className="btn-primary" disabled={busy} onClick={start}>Set up</button>
        </div>
      )}
    </Section>
  );
}
