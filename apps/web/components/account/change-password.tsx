'use client';
import { FormEvent, useState } from 'react';
import { PasswordRules, passwordProblems } from '@/components/account/password-rules';
import { ErrorBox, Section } from '@/components/ui';
import { post } from '@/lib/api';

/** Change your own password. Other browsers and devices are signed out. */
export function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await post('/auth/password/change', { currentPassword: current, newPassword: password });
      setDone(true);
      setCurrent(''); setPassword(''); setConfirm('');
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <Section title="Password" className="mt-6">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-[1fr_1fr_1fr]">
        <div className="md:col-span-3"><ErrorBox error={error} />{done && <p className="rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">Password changed. Other browsers and devices were signed out.</p>}</div>
        <label className="block"><span className="label">Current password</span><input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></label>
        <label className="block"><span className="label">New password</span><input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <label className="block"><span className="label">Type it again</span><input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></label>
        <div className="flex flex-wrap items-end justify-between gap-3 md:col-span-3">
          <PasswordRules password={password} confirm={confirm} />
          <button className="btn-primary" disabled={busy || !current || !passwordProblems(password, confirm).every((r) => r.ok)}>{busy ? 'Saving…' : 'Change password'}</button>
        </div>
      </form>
    </Section>
  );
}
