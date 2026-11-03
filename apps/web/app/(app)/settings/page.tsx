'use client';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { ErrorBox, Field, Loading, PageHeader, Section } from '@/components/ui';
import { get, patch } from '@/lib/api';

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
      <PageHeader title="Settings" subtitle={`${org.name} · ${org.slug}`} />
      <div className="mb-4"><ErrorBox error={error} /></div>
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
