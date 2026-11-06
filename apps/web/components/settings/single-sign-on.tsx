'use client';
import { Check, Copy, Unlink } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorBox, Loading, Section, Toggle } from '@/components/ui';
import { api, get } from '@/lib/api';

type P = 'google' | 'microsoft' | 'zoho';
interface Settings { providers: Record<P, boolean>; domains: string[]; microsoftTenantId: string | null; ssoOnly: boolean }
interface Available { id: P; label: string; configured: boolean; redirectUri: string }
interface Identity { id: string; provider: P; email: string | null; lastUsedAt: string | null; user: { id: string; name: string; email: string } }
interface Sso { settings: Settings; available: Available[]; identities: Identity[] }

const HELP: Record<P, string> = {
  google: 'Google Workspace accounts. Only verified emails on your domains get in.',
  microsoft: 'Microsoft 365 / Entra ID work accounts from your own tenant only.',
  zoho: 'Zoho accounts, in any Zoho data centre.',
};

/** Admins: which providers staff may sign in with, for which email domains, and who has linked an account. */
export function SingleSignOn() {
  const [s, setS] = useState<Sso | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [domains, setDomains] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = (x: Sso) => { setS(x); setDraft(x.settings); setDomains(x.settings.domains.join('\n')); };
  useEffect(() => { get<Sso>('/organization/sso').then(load).catch(setError); }, []);
  if (!s || !draft) return <Section title="Single sign-on" className="mb-6">{error ? <ErrorBox error={error} /> : <Loading />}</Section>;

  const set = (patch: Partial<Settings>) => { setDraft({ ...draft, ...patch }); setSaved(false); };
  const anyOn = Object.values(draft.providers).some(Boolean);
  const save = async () => {
    setError(null);
    if (draft.ssoOnly && !s.settings.ssoOnly && !confirm('Make single sign-on the only way in for staff? Project managers, sales and viewers lose password sign-in. Admins and portal users keep it.')) return;
    try {
      load(await api<Sso>('/organization/sso', { method: 'PUT', json: { ...draft, domains: domains.split(/[\s,]+/).filter(Boolean), microsoftTenantId: draft.microsoftTenantId?.trim() || null } }));
      setSaved(true);
    } catch (e) { setError(e); }
  };
  const unlink = async (i: Identity) => {
    if (!confirm(`Unlink ${i.user.name}'s ${i.provider} account (${i.email ?? 'no email'})? Their next sign-in with it links again by email.`)) return;
    try { await api(`/sso-identities/${i.id}`, { method: 'DELETE' }); load(await get<Sso>('/organization/sso')); } catch (e) { setError(e); }
  };
  const copy = async (v: string) => { await navigator.clipboard?.writeText(v); setCopied(v); setTimeout(() => setCopied(null), 1500); };

  return (
    <Section id="sso" title="Single sign-on" className="mb-6" actions={<button className="btn-primary" onClick={save}>{saved ? 'Saved' : 'Save'}</button>}>
      <div className="space-y-5">
        <ErrorBox error={error} />
        <p className="text-sm text-muted">Let staff sign in with their company Google, Microsoft or Zoho account. Only people you already added in SampTrek can sign in. Their account links the first time, by email.</p>
        <div className="grid gap-3 md:grid-cols-3">
          {s.available.map((a) => (
            <div key={a.id} className="min-w-0 rounded-lg border border-line p-4" data-provider={a.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{a.label}</span>
                <Toggle checked={draft.providers[a.id]} onChange={(v) => a.configured && set({ providers: { ...draft.providers, [a.id]: v } })} label={`${a.label} sign-in`} />
              </div>
              <p className="mt-1 text-xs text-muted">{HELP[a.id]}</p>
              {!a.configured && <p className="mt-2 rounded bg-warn/10 px-2 py-1 text-xs text-warn">Needs its client ID and secret first. <Link href={`/settings/integrations#sso_${a.id}`} className="underline">Set it up in Integrations</Link></p>}
              <div className="mt-3">
                <span className="label">Redirect URI</span>
                <button type="button" onClick={() => copy(a.redirectUri)} className="flex w-full items-center gap-2 rounded border border-line bg-sunken px-2 py-1 text-left font-mono text-[11px]" title="Copy">
                  <span className="min-w-0 flex-1 truncate">{a.redirectUri}</span>
                  {copied === a.redirectUri ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5 text-muted" />}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="label">Email domains allowed</span>
            <textarea className="input h-20 font-mono text-sm" placeholder={'yourcompany.com'} value={domains} onChange={(e) => { setDomains(e.target.value); setSaved(false); }} />
            <span className="mt-1 block text-xs text-muted">One per line. Sign-ins from other domains are refused.</span>
          </label>
          <label className="block">
            <span className="label">Microsoft tenant ID</span>
            <input className="input font-mono text-sm" placeholder="00000000-0000-0000-0000-000000000000" value={draft.microsoftTenantId ?? ''} onChange={(e) => set({ microsoftTenantId: e.target.value })} />
            <span className="mt-1 block text-xs text-muted">Directory (tenant) ID from the Microsoft Entra admin centre. Needed for Microsoft sign-in.</span>
          </label>
        </div>
        <div className="flex items-start justify-between gap-4 rounded-lg border border-line p-4">
          <div>
            <div className="font-medium">Single sign-on only</div>
            <p className="text-xs text-muted">Project managers, sales and viewers can no longer use a password. Admins and client or vendor portal users keep their password as a way back in.</p>
          </div>
          <Toggle checked={draft.ssoOnly} onChange={(v) => (anyOn || !v) && set({ ssoOnly: v })} label="Single sign-on only" />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Linked accounts ({s.identities.length})</h3>
          {s.identities.length === 0 ? (
            <p className="text-sm text-muted">Nobody has signed in with single sign-on yet.</p>
          ) : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[600px] text-sm">
                <thead><tr><th className="th">Person</th><th className="th">Provider</th><th className="th">Signed in as</th><th className="th">Last used</th><th className="th" /></tr></thead>
                <tbody>
                  {s.identities.map((i) => (
                    <tr key={i.id} className="border-t border-line">
                      <td className="td"><div className="font-medium">{i.user.name}</div><div className="text-xs text-muted">{i.user.email}</div></td>
                      <td className="td capitalize">{i.provider}</td>
                      <td className="td font-mono text-xs">{i.email ?? '—'}</td>
                      <td className="td whitespace-nowrap text-xs text-muted">{i.lastUsedAt ? new Date(i.lastUsedAt).toLocaleString() : 'First sign-in'}</td>
                      <td className="td text-right"><button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => unlink(i)}><Unlink className="h-3.5 w-3.5" />Unlink</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
