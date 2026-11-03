'use client';
import clsx from 'clsx';
import { BrandLogo, useBrandedPage } from '@/components/brand-mark';
import { CheckCircle2 } from 'lucide-react';
import { useParams } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ErrorBox, Field, Loading } from '@/components/ui';
import { get, post } from '@/lib/api';
import { COUNTRIES, flag } from '@/lib/countries';

interface FormInfo { organization: string; specialties: string[]; challenge: { token: string; question: string } }
const SPECIALTY_LABEL: Record<string, string> = { B2C: 'Consumers', B2B: 'Business (B2B)', HEALTHCARE: 'Healthcare', AUTOMOTIVE: 'Automotive', FINANCE: 'Finance', GAMING: 'Gaming', YOUTH: 'Youth', ETHNIC: 'Ethnic and multicultural', MOBILE: 'Mobile-first' };

/** Public sign-up form for panel companies. No login; the link itself identifies the organisation. */
export default function JoinPage() {
  const brand = useBrandedPage();
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<FormInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [f, setF] = useState({ companyName: '', website: '', contactName: '', email: '', phone: '', panelSize: '', message: '', answer: '', homepage: '' });
  const [countries, setCountries] = useState<string[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = () => get<FormInfo>(`/public/vendor-signup/${encodeURIComponent(token)}`).then(setInfo).catch(() => setMissing(true));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!info) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/public/vendor-signup/${encodeURIComponent(token)}`, {
        companyName: f.companyName,
        website: f.website || undefined,
        contactName: f.contactName,
        email: f.email,
        phone: f.phone || undefined,
        countries,
        panelSize: f.panelSize ? Number(f.panelSize) : undefined,
        specialties,
        message: f.message || undefined,
        challenge: info.challenge.token,
        answer: f.answer,
        ...(f.homepage ? { homepage: f.homepage } : {}),
      });
      setDone(true);
    } catch (err) {
      setError(err);
      // A new question after a wrong answer or an expired check.
      setF((x) => ({ ...x, answer: '' }));
      load();
    } finally {
      setBusy(false);
    }
  }

  if (missing) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="card max-w-md p-7 text-center"><h1 className="text-xl font-semibold">This sign-up link does not work</h1><p className="mt-2 text-sm text-muted">Ask the research company that sent it for a new link.</p></div>
      </main>
    );
  }
  if (!info) return <Loading />;
  if (done) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="card max-w-md p-7 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-ok" />
          <h1 className="mt-3 text-xl font-semibold">Thanks, we have your application</h1>
          <p className="mt-2 text-sm text-muted">{info.organization} will review it. If it is approved, you get an email to set up your vendor portal login.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {brand && <BrandLogo brand={brand} />}
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Become a sample partner of {info.organization}</h1>
      <p className="mt-1 text-sm text-muted">Tell us about your panel. We review every application; approved partners get a vendor portal login for links, quotes, payouts and documents.</p>
      <form onSubmit={submit} className="card mt-6 space-y-5 p-6">
        <ErrorBox error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name"><input className="input" required maxLength={160} value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} autoComplete="organization" /></Field>
          <Field label="Website"><input className="input" type="url" maxLength={300} placeholder="https://" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></Field>
          <Field label="Your name"><input className="input" required maxLength={120} value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} autoComplete="name" /></Field>
          <Field label="Work email"><input className="input" type="email" required maxLength={200} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></Field>
          <Field label="Phone (optional)"><input className="input" maxLength={40} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></Field>
          <Field label="Panel members (optional)"><input className="input" type="number" min={0} value={f.panelSize} onChange={(e) => setF({ ...f, panelSize: e.target.value })} /></Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Countries you cover <span className="font-normal text-muted">({countries.length} selected)</span></legend>
          <div className="flex max-h-56 flex-wrap gap-1.5 overflow-auto rounded-lg border border-line p-2">
            {COUNTRIES.map((c) => (
              <button type="button" key={c.code} aria-pressed={countries.includes(c.code)} onClick={() => toggle(countries, setCountries, c.code)} className={clsx('rounded-full border px-2.5 py-1 text-xs', countries.includes(c.code) ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted hover:bg-sunken')}>
                {flag(c.code)} {c.name}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Audiences</legend>
          <div className="flex flex-wrap gap-1.5">
            {info.specialties.map((s) => (
              <button type="button" key={s} aria-pressed={specialties.includes(s)} onClick={() => toggle(specialties, setSpecialties, s)} className={clsx('rounded-full border px-2.5 py-1 text-xs', specialties.includes(s) ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted hover:bg-sunken')}>
                {SPECIALTY_LABEL[s] ?? s}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="Anything else (optional)"><textarea className="input min-h-[100px]" maxLength={3000} placeholder="Recruitment methods, certifications such as ISO 20252, profiling depth…" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
        {/* Hidden from people; bots fill it. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>Homepage<input tabIndex={-1} autoComplete="off" value={f.homepage} onChange={(e) => setF({ ...f, homepage: e.target.value })} /></label>
        </div>
        <div className="grid gap-4 rounded-lg bg-sunken/60 p-4 sm:grid-cols-[1fr_160px] sm:items-end">
          <div className="text-sm"><div className="font-medium">Quick check</div><div className="text-muted">{info.challenge.question}</div></div>
          <input className="input" inputMode="numeric" required maxLength={20} value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} aria-label={info.challenge.question} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">We use these details only to review your application.</p>
          <button className="btn-primary" disabled={busy || countries.length === 0}>{busy ? 'Sending…' : 'Send application'}</button>
        </div>
      </form>
    </main>
  );
}
