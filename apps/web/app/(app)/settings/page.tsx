'use client';
import { Copy, ListPlus, Palette, PlugZap, ShieldCheck, Stamp, Webhook, ToggleRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { AiCopilotSettings } from '@/components/settings/ai-settings';
import { AlertSettings } from '@/components/settings/alert-settings';
import { FinanceSettings } from '@/components/settings/finance-settings';
import { InvoiceProfileSettings } from '@/components/settings/invoice-profile';
import { SignInSecurity } from '@/components/settings/sign-in-security';
import { SingleSignOn } from '@/components/settings/single-sign-on';
import { NumberingSettings } from '@/components/settings/numbering';
import { ErrorBox, Field, Loading, PageHeader, Section } from '@/components/ui';
import { api, get, patch, post } from '@/lib/api';

interface SampBidx { enabled: boolean; tenant: string; endpoint: string; lastReceivedAt: string | null; secret?: string }
interface Org { id: string; name: string; slug: string; redirectAllowedDomains: string[]; fallbackRedirectUrl: string | null }

export default function SettingsPage() {
  const me = useMe();
  const isAdmin = me?.user.role === 'ADMIN';
  const [org, setOrg] = useState<Org | null>(null);
  const [domains, setDomains] = useState('');
  const [fallback, setFallback] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    get<Org>('/organization').then((o) => {
      setOrg(o);
      setDomains(o.redirectAllowedDomains.join('\n'));
      setFallback(o.fallbackRedirectUrl ?? '');
    }).catch(setError);
  }, []);

  async function save() {
    setError(null);
    setSaved(false);
    try {
      const o = await patch<Org>('/organization', { redirectAllowedDomains: domains.split(/[\s,]+/).filter(Boolean), fallbackRedirectUrl: fallback || null });
      setOrg(o);
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  }

  if (!org) return error ? <ErrorBox error={error} /> : <Loading />;
  return (
    <>
      <PageHeader title="Settings" subtitle={`${org.name} · ${org.slug}`} actions={<div className="flex flex-wrap gap-2">{isAdmin && <Link href="/settings/integrations" className="btn-primary"><PlugZap className="h-4 w-4" /> Integrations</Link>}{isAdmin && <Link href="/settings/features" className="btn-ghost"><ToggleRight className="h-4 w-4" /> Features & access</Link>}<Link href="/settings/branding" className="btn-ghost"><Stamp className="h-4 w-4" /> Branding</Link><Link href="/settings/privacy" className="btn-ghost"><ShieldCheck className="h-4 w-4" /> Privacy</Link><Link href="/settings/developers" className="btn-ghost"><Webhook className="h-4 w-4" /> API and webhooks</Link><Link href="/settings/options" className="btn-ghost"><ListPlus className="h-4 w-4" /> Dropdown options</Link><Link href="/settings/appearance" className="btn-ghost"><Palette className="h-4 w-4" /> Theme Studio</Link></div>} />
      <div className="mb-4"><ErrorBox error={error} /></div>
      {isAdmin && (
        <Link href="/settings/integrations" className="card mb-6 flex items-center gap-3 p-4 hover:bg-sunken/50">
          <PlugZap className="h-5 w-5 shrink-0 text-brand" />
          <span className="min-w-0 flex-1"><span className="block font-medium">Set up integrations</span><span className="block text-sm text-muted">Email (Zoho Mail), Google, Microsoft and Zoho sign-in, Gemini AI, Zoho Books, Xero, QuickBooks, Tally and SampBidx, all from here with step-by-step help.</span></span>
          <span className="text-sm text-brand">Open →</span>
        </Link>
      )}
      <NumberingSettings isAdmin={isAdmin} />
      {isAdmin && <SignInSecurity />}
      {isAdmin && <SingleSignOn />}
      {isAdmin && <AiCopilotSettings />}
      <SampBidxConnection isAdmin={isAdmin} />
      <CaptchaKeys isAdmin={isAdmin} />
      {isAdmin && <AlertSettings />}
      <div id="finance" className="scroll-mt-20"><FinanceSettings isAdmin={isAdmin} /></div>
      <InvoiceProfileSettings isAdmin={isAdmin} />
      <Section title="Redirect security policy">
        <p className="mb-4 text-sm text-muted">Respondents can only be redirected to these domains (plus each vendor&apos;s own domains for that vendor). Overrides cannot bypass this list.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Allowed domains (one per line)" hint="example.com or *.example.com">
            <textarea className="input min-h-[160px] font-mono text-xs" disabled={!isAdmin} value={domains} onChange={(e) => setDomains(e.target.value)} />
          </Field>
          <Field label="Fallback URL" hint="Used when no rule applies or a destination is blocked. Must be on the allowlist; otherwise SampTrek shows its own end page.">
            <input className="input" disabled={!isAdmin} value={fallback} onChange={(e) => setFallback(e.target.value)} />
          </Field>
        </div>
        {isAdmin ? (
          <div className="mt-4 flex items-center gap-3"><button className="btn-primary" onClick={save}>Save</button>{saved && <span className="text-sm text-ok">Saved</span>}</div>
        ) : (
          <p className="mt-4 text-xs text-muted">Only admins can change these settings.</p>
        )}
      </Section>
    </>
  );
}

function SampBidxConnection({ isAdmin }: { isAdmin: boolean }) {
  const [b, setB] = useState<SampBidx | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { get<SampBidx>('/integrations/sampbidx').then(setB).catch(setError); }, []);

  async function rotate() {
    if (b?.enabled && !confirm('Create a new signing secret? SampBidx stops being accepted until it is updated with the new one.')) return;
    setError(null);
    try { const r = await post<SampBidx>('/integrations/sampbidx/secret'); setSecret(r.secret ?? null); setB(r); } catch (e) { setError(e); }
  }
  async function disable() {
    if (!confirm('Turn off the SampBidx connection? Won bids will stop arriving.')) return;
    setError(null);
    try { setB(await post<SampBidx>('/integrations/sampbidx/disable')); setSecret(null); } catch (e) { setError(e); }
  }
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => undefined);

  return (
    <Section id="sampbidx" title="SampBidx connection" className="mb-6">
      <p className="mb-4 text-sm text-muted">When a bid is marked won in SampBidx, it is sent here and appears in <Link href="/won-bids" className="text-brand underline-offset-2 hover:underline">Won bids</Link> for a PM to set up. SampBidx signs each delivery with the secret below.</p>
      <ErrorBox error={error} />
      {b && (
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-[160px_1fr]">
          <dt className="text-muted">Status</dt>
          <dd>{b.enabled ? <span className="chip bg-ok/15 text-ok">Connected</span> : <span className="chip bg-sunken text-muted">Off</span>}</dd>
          <dt className="text-muted">Endpoint</dt>
          <dd className="flex min-w-0 items-center gap-2"><code className="truncate font-mono text-xs">{b.endpoint}</code><button className="btn-ghost h-7 px-2" aria-label="Copy endpoint" onClick={() => copy(b.endpoint)}><Copy className="h-3.5 w-3.5" /></button></dd>
          <dt className="text-muted">Tenant</dt>
          <dd><code className="font-mono text-xs">{b.tenant}</code> <span className="text-xs text-muted">(X-SampBidx-Tenant header)</span></dd>
          <dt className="text-muted">Last received</dt>
          <dd>{b.lastReceivedAt ? new Date(b.lastReceivedAt).toLocaleString() : 'Nothing yet'}</dd>
        </dl>
      )}
      {secret && (
        <div className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          <p className="mb-2 font-medium">Copy this secret into SampBidx now. It will not be shown again.</p>
          <div className="flex min-w-0 items-center gap-2"><code className="break-all font-mono text-xs">{secret}</code><button className="btn-ghost h-7 shrink-0 px-2" aria-label="Copy secret" onClick={() => copy(secret)}><Copy className="h-3.5 w-3.5" /></button></div>
        </div>
      )}
      {isAdmin ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={rotate}>{b?.enabled ? 'Rotate secret' : 'Connect SampBidx'}</button>
          {b?.enabled && <button className="btn-ghost" onClick={disable}>Turn off</button>}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">Only admins can change the connection.</p>
      )}
    </Section>
  );
}

interface CaptchaInfo { providers: Record<'turnstile' | 'hcaptcha', { configured: boolean; siteKey: string | null }> }
const PROVIDERS = [
  { id: 'turnstile', name: 'Cloudflare Turnstile', note: 'Free: unlimited checks, up to 20 widgets per Cloudflare account.', href: 'https://dash.cloudflare.com/?to=/:account/turnstile' },
  { id: 'hcaptcha', name: 'hCaptcha', note: 'Free Basic plan.', href: 'https://dashboard.hcaptcha.com/sites' },
] as const;

/** Keys for the free third-party captcha styles executives can pick per project. */
function CaptchaKeys({ isAdmin }: { isAdmin: boolean }) {
  const [info, setInfo] = useState<CaptchaInfo | null>(null);
  const [draft, setDraft] = useState<Record<string, { siteKey: string; secret: string }>>({});
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { get<CaptchaInfo>('/security/captcha').then(setInfo).catch(setError); }, []);

  async function save(id: 'turnstile' | 'hcaptcha', remove = false) {
    setError(null);
    setSaved(null);
    const d = draft[id] ?? { siteKey: info?.providers[id].siteKey ?? '', secret: '' };
    try {
      const r = await api<CaptchaInfo>('/security/captcha', { method: 'PUT', json: { [id]: remove ? null : { siteKey: d.siteKey.trim(), ...(d.secret.trim() ? { secret: d.secret.trim() } : {}) } } });
      setInfo(r);
      setDraft({ ...draft, [id]: { siteKey: r.providers[id].siteKey ?? '', secret: '' } });
      setSaved(id);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Section title="Captcha providers" className="mb-6">
      <p className="mb-4 text-sm text-muted">The built-in human checks (math, logic, picture text, invisible) need nothing. To let executives pick Cloudflare Turnstile or hCaptcha, add the free keys here. Google reCAPTCHA is not offered: its free tier stops at 10,000 checks a month.</p>
      <ErrorBox error={error} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {PROVIDERS.map((p) => {
          const cur = info?.providers[p.id];
          const d = draft[p.id] ?? { siteKey: cur?.siteKey ?? '', secret: '' };
          return (
            <div key={p.id} className="rounded-lg border border-line p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium">{p.name}</span>
                {cur?.configured ? <span className="chip bg-ok/15 text-ok">Ready</span> : <span className="chip bg-sunken text-muted">Not set up</span>}
              </div>
              <p className="mb-3 text-xs text-muted">{p.note} <a href={p.href} target="_blank" rel="noreferrer" className="text-brand hover:underline">Get keys</a></p>
              <fieldset disabled={!isAdmin} className="space-y-3">
                <Field label="Site key"><input className="input font-mono text-xs" value={d.siteKey} onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, siteKey: e.target.value } })} /></Field>
                <Field label="Secret key" hint={cur?.configured ? 'Saved. Leave empty to keep it.' : undefined}><input className="input font-mono text-xs" type="password" autoComplete="off" value={d.secret} onChange={(e) => setDraft({ ...draft, [p.id]: { ...d, secret: e.target.value } })} /></Field>
              </fieldset>
              {isAdmin && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button className="btn-primary" disabled={!d.siteKey.trim() || (!cur?.configured && !d.secret.trim())} onClick={() => save(p.id)}>Save</button>
                  {cur?.configured && <button className="btn-ghost" onClick={() => save(p.id, true)}>Remove</button>}
                  {saved === p.id && <span className="text-sm text-ok">Saved</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!isAdmin && <p className="mt-4 text-xs text-muted">Only admins can change captcha keys.</p>}
    </Section>
  );
}
