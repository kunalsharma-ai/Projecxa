'use client';
import clsx from 'clsx';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ErrorBox, Field, Loading } from '@/components/ui';
import { get, post } from '@/lib/api';

interface Info { open: boolean; trialDays?: number; plans?: { code: string; name: string; description: string | null; priceLabel: string | null }[]; challenge?: { token: string; question: string } }

/** Public: a company registers for PROJEXA (docs/SUPER_ADMIN.md). The Super Admin approves it, or Automation does. */
export default function RegisterPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [f, setF] = useState({ companyName: '', contactName: '', email: '', phone: '', website: '', message: '', plan: '', answer: '', homepage: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const load = () => get<Info>('/public/register').then(setInfo).catch(setError);
  useEffect(() => { load(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!info?.challenge) return;
    setBusy(true); setError(null);
    try {
      await post('/public/register', {
        companyName: f.companyName, contactName: f.contactName, email: f.email, phone: f.phone || undefined, website: f.website || undefined, message: f.message || undefined,
        plan: f.plan || undefined, challenge: info.challenge.token, answer: f.answer, ...(f.homepage ? { homepage: f.homepage } : {}),
      });
      setDone(true);
    } catch (err) {
      setError(err);
      setF((x) => ({ ...x, answer: '' }));
      load();
    } finally { setBusy(false); }
  }

  if (!info) return error ? <main className="mx-auto max-w-md px-4 py-16"><ErrorBox error={error} /></main> : <Loading />;
  if (!info.open) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="card max-w-md p-7 text-center"><h1 className="text-xl font-semibold">Registration is closed</h1><p className="mt-2 text-sm text-muted">Contact us to get a PROJEXA workspace for your company.</p><Link href="/login" className="btn-ghost mt-4 inline-flex">Sign in</Link></div>
      </main>
    );
  }
  if (done) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="card max-w-md p-7 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-ok" />
          <h1 className="mt-3 text-xl font-semibold">Thanks, you are registered</h1>
          <p className="mt-2 text-sm text-muted">When your workspace is ready you get an email at {f.email} to choose a password.</p>
        </div>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="text-sm font-semibold tracking-tight">PROJEXA <span className="font-normal text-muted">by Sampledge</span></div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Get PROJEXA for your company</h1>
      <p className="mt-1 text-sm text-muted">Research project management and fieldwork, on the web and on Android and iOS.{info.trialDays ? ` Start with a ${info.trialDays}-day free trial.` : ''}</p>
      <form onSubmit={submit} className="card mt-6 space-y-5 p-6">
        <ErrorBox error={error} />
        {!!info.plans?.length && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Plan</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {info.plans.map((p) => (
                <button type="button" key={p.code} aria-pressed={f.plan === p.code} onClick={() => setF({ ...f, plan: f.plan === p.code ? '' : p.code })}
                  className={clsx('rounded-lg border p-3 text-left text-sm', f.plan === p.code ? 'border-brand bg-brand/5' : 'border-line hover:bg-sunken')}>
                  <div className="font-medium">{p.name}</div>{p.priceLabel && <div className="text-xs">{p.priceLabel}</div>}{p.description && <div className="mt-1 text-xs text-muted">{p.description}</div>}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name"><input className="input" required minLength={2} maxLength={160} value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} autoComplete="organization" /></Field>
          <Field label="Website (optional)"><input className="input" maxLength={300} placeholder="https://" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></Field>
          <Field label="Your name"><input className="input" required minLength={2} maxLength={120} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} autoComplete="name" /></Field>
          <Field label="Work email"><input className="input" type="email" required maxLength={200} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></Field>
          <Field label="Phone (optional)"><input className="input" maxLength={40} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></Field>
        </div>
        <Field label="Anything else (optional)"><textarea className="input min-h-[90px]" maxLength={3000} placeholder="Team size, projects a month, what you need…" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Homepage<input tabIndex={-1} autoComplete="off" value={f.homepage} onChange={(e) => setF({ ...f, homepage: e.target.value })} /></label></div>
        <div className="grid gap-4 rounded-lg bg-sunken/60 p-4 sm:grid-cols-[1fr_160px] sm:items-end">
          <div className="text-sm"><div className="font-medium">Quick check</div><div className="text-muted">{info.challenge?.question}</div></div>
          <input className="input" inputMode="numeric" required maxLength={20} value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} aria-label={info.challenge?.question ?? 'Check'} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">Already have an account? <Link href="/login" className="text-brand hover:underline">Sign in</Link></p>
          <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Register'}</button>
        </div>
      </form>
    </main>
  );
}
