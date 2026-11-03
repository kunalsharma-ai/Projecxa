'use client';
import { Copy, Palette } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { ErrorBox, Field, Loading, PageHeader, Section } from '@/components/ui';
import { get, patch, post } from '@/lib/api';

interface Bidzo { enabled: boolean; tenant: string; endpoint: string; lastReceivedAt: string | null; secret?: string }
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
      <PageHeader title="Settings" subtitle={`${org.name} · ${org.slug}`} actions={<Link href="/settings/appearance" className="btn-ghost"><Palette className="h-4 w-4" /> Theme Studio</Link>} />
      <div className="mb-4"><ErrorBox error={error} /></div>
      <BidzoConnection isAdmin={isAdmin} />
      <Section title="Redirect security policy">
        <p className="mb-4 text-sm text-muted">Respondents can only be redirected to these domains (plus each vendor&apos;s own domains for that vendor). Overrides cannot bypass this list.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Allowed domains (one per line)" hint="example.com or *.example.com">
            <textarea className="input min-h-[160px] font-mono text-xs" disabled={!isAdmin} value={domains} onChange={(e) => setDomains(e.target.value)} />
          </Field>
          <Field label="Fallback URL" hint="Used when no rule applies or a destination is blocked. Must be on the allowlist; otherwise PROJEXA shows its own end page.">
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

function BidzoConnection({ isAdmin }: { isAdmin: boolean }) {
  const [b, setB] = useState<Bidzo | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { get<Bidzo>('/integrations/bidzo').then(setB).catch(setError); }, []);

  async function rotate() {
    if (b?.enabled && !confirm('Create a new signing secret? Bidzo stops being accepted until it is updated with the new one.')) return;
    setError(null);
    try { const r = await post<Bidzo>('/integrations/bidzo/secret'); setSecret(r.secret ?? null); setB(r); } catch (e) { setError(e); }
  }
  async function disable() {
    if (!confirm('Turn off the Bidzo connection? Won bids will stop arriving.')) return;
    setError(null);
    try { setB(await post<Bidzo>('/integrations/bidzo/disable')); setSecret(null); } catch (e) { setError(e); }
  }
  const copy = (t: string) => navigator.clipboard?.writeText(t).catch(() => undefined);

  return (
    <Section title="Bidzo connection" className="mb-6">
      <p className="mb-4 text-sm text-muted">When a bid is marked won in Bidzo, it is sent here and appears in <Link href="/won-bids" className="text-brand underline-offset-2 hover:underline">Won bids</Link> for a PM to set up. Bidzo signs each delivery with the secret below.</p>
      <ErrorBox error={error} />
      {b && (
        <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-[160px_1fr]">
          <dt className="text-muted">Status</dt>
          <dd>{b.enabled ? <span className="chip bg-ok/15 text-ok">Connected</span> : <span className="chip bg-sunken text-muted">Off</span>}</dd>
          <dt className="text-muted">Endpoint</dt>
          <dd className="flex min-w-0 items-center gap-2"><code className="truncate font-mono text-xs">{b.endpoint}</code><button className="btn-ghost h-7 px-2" aria-label="Copy endpoint" onClick={() => copy(b.endpoint)}><Copy className="h-3.5 w-3.5" /></button></dd>
          <dt className="text-muted">Tenant</dt>
          <dd><code className="font-mono text-xs">{b.tenant}</code> <span className="text-xs text-muted">(X-Bidzo-Tenant header)</span></dd>
          <dt className="text-muted">Last received</dt>
          <dd>{b.lastReceivedAt ? new Date(b.lastReceivedAt).toLocaleString() : 'Nothing yet'}</dd>
        </dl>
      )}
      {secret && (
        <div className="mt-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          <p className="mb-2 font-medium">Copy this secret into Bidzo now. It will not be shown again.</p>
          <div className="flex min-w-0 items-center gap-2"><code className="break-all font-mono text-xs">{secret}</code><button className="btn-ghost h-7 shrink-0 px-2" aria-label="Copy secret" onClick={() => copy(secret)}><Copy className="h-3.5 w-3.5" /></button></div>
        </div>
      )}
      {isAdmin ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className="btn-primary" onClick={rotate}>{b?.enabled ? 'Rotate secret' : 'Connect Bidzo'}</button>
          {b?.enabled && <button className="btn-ghost" onClick={disable}>Turn off</button>}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">Only admins can change the connection.</p>
      )}
    </Section>
  );
}
