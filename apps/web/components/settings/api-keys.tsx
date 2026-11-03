'use client';
import clsx from 'clsx';
import { KeyRound, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { SecretOnce } from '@/components/settings/secret-once';
import { Empty, ErrorBox, Loading, Section } from '@/components/ui';
import { api, get, post } from '@/lib/api';

interface Key { id: string; name: string; prefix: string; scopes: string[]; state: 'active' | 'revoked' | 'expired'; lastUsedAt: string | null; expiresAt: string | null; createdAt: string; createdBy: { name: string } | null }
interface List { scopes: { name: string; description: string }[]; keys: Key[] }

const when = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const ago = (d: string | null) => {
  if (!d) return 'Never';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
  if (m < 2) return 'Just now';
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return when(d);
};
const STATE: Record<Key['state'], string> = { active: 'bg-ok/15 text-ok', revoked: 'bg-sunken text-muted', expired: 'bg-warn/15 text-warn' };

export function ApiKeys() {
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['projects:read']);
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);

  const load = useCallback(() => get<List>('/api-keys').then(setList).catch(setError), []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const k = await post<Key & { key: string }>('/api-keys', { name, scopes, ...(expiry ? { expiresInDays: Number(expiry) } : {}) });
      setShown(k.key);
      setAdding(false);
      setName('');
      setScopes(['projects:read']);
      setExpiry('');
      load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(k: Key) {
    if (!confirm(`Revoke "${k.name}"? Anything using it stops working straight away.`)) return;
    setError(null);
    try { await api(`/api-keys/${k.id}`, { method: 'DELETE' }); load(); } catch (e) { setError(e); }
  }

  return (
    <Section title="API keys" actions={!adding ? <button className="btn-primary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />New key</button> : undefined}>
      <ErrorBox error={error} />
      {shown && <SecretOnce title="Copy this key now. It will not be shown again." value={shown} onDone={() => setShown(null)} />}
      {adding && list && (
        <div className="mb-5 rounded-lg border border-line p-4">
          <div className="grid gap-4 md:grid-cols-[1fr_180px]">
            <label><span className="label">Name</span><input className="input" autoFocus maxLength={80} placeholder="Data warehouse sync" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label><span className="label">Expires</span>
              <select className="input" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                <option value="">Never</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In 1 year</option>
              </select>
            </label>
          </div>
          <fieldset className="mt-4">
            <legend className="label">Permissions</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {list.scopes.map((s) => (
                <label key={s.name} className="flex items-start gap-2 rounded-md border border-line p-2.5 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={scopes.includes(s.name)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s.name] : scopes.filter((x) => x !== s.name))} />
                  <span><code className="font-mono text-xs">{s.name}</code><span className="block text-xs text-muted">{s.description}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          {scopes.includes('projects:write') && <p className="mt-3 text-xs text-muted">Changes made with this key are recorded in the audit trail as you, and stop working if you are no longer an admin or project manager.</p>}
          <div className="mt-4 flex gap-2">
            <button className="btn-primary" disabled={busy || !name.trim() || !scopes.length} onClick={create}><KeyRound className="h-4 w-4" />Create key</button>
            <button className="btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
      {!list ? <Loading /> : list.keys.length === 0 ? <Empty>No API keys yet.</Empty> : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr><th className="th">Name</th><th className="th">Key</th><th className="th">Permissions</th><th className="th">Last used</th><th className="th">Expires</th><th className="th" /></tr></thead>
            <tbody>
              {list.keys.map((k) => (
                <tr key={k.id} className={clsx('border-t border-line', k.state !== 'active' && 'text-muted')}>
                  <td className="td"><div className="font-medium">{k.name}</div><div className="text-xs text-muted">{k.createdBy ? `By ${k.createdBy.name}, ` : ''}{when(k.createdAt)}</div></td>
                  <td className="td"><code className="font-mono text-xs">{k.prefix}…</code> <span className={clsx('chip', STATE[k.state])}>{k.state}</span></td>
                  <td className="td"><div className="flex flex-wrap gap-1">{k.scopes.map((s) => <span key={s} className="chip bg-sunken font-mono text-[11px] text-muted">{s}</span>)}</div></td>
                  <td className="td whitespace-nowrap">{ago(k.lastUsedAt)}</td>
                  <td className="td whitespace-nowrap">{k.expiresAt ? when(k.expiresAt) : 'Never'}</td>
                  <td className="td text-right">{k.state === 'active' && <button className="btn-ghost px-2.5 py-1 text-xs text-bad" onClick={() => revoke(k)}>Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
