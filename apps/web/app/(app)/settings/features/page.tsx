'use client';
import clsx from 'clsx';
import { Check, Gift, Lock, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMe } from '@/components/me';
import { Empty, ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { api, get } from '@/lib/api';
import { ACCESS_LABEL } from '@/lib/super-admin';

/**
 * Settings → Features & access (docs/FEATURE_ACCESS.md). The Super Admin decides what the organisation's
 * plan includes; here the Admin decides who in the team gets each of those features.
 */
type Mode = 'everyone' | 'admins' | 'people' | 'off';
type Role = 'ADMIN' | 'PROJECT_MANAGER' | 'SALES' | 'VIEWER' | 'CLIENT_USER' | 'VENDOR_USER';
interface Person { id: string; name: string; email: string; role: Role }
interface Row {
  key: string; label: string; group: string; summary: string; roles: Role[]; mobile: boolean;
  available: boolean; source: 'plan' | 'extra' | 'not_in_plan' | 'taken_away'; controllable: boolean;
  mode: Mode | null; people: string[]; defaultMode: Mode | null;
}
interface Access { plan: string | null; unrestricted: boolean; people: Person[]; features: Row[] }

const MODES: Mode[] = ['everyone', 'admins', 'people', 'off'];
const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Admin', PROJECT_MANAGER: 'Project manager', SALES: 'Sales', VIEWER: 'Viewer', CLIENT_USER: 'Client portal', VENDOR_USER: 'Vendor portal' };
const MODE_HINT: Record<Mode, string> = {
  everyone: 'Everyone whose role can use it',
  admins: 'Only admins, until you allow others',
  people: 'Admins and the people you tick',
  off: 'Hidden for everyone, admins too',
};

export default function FeatureAccessPage() {
  const me = useMe();
  const [data, setData] = useState<Access | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [show, setShow] = useState<'all' | 'yours' | 'locked'>('all');

  const load = useCallback(() => get<Access>('/feature-access').then(setData).catch(setError), []);
  useEffect(() => { if (me?.user.role === 'ADMIN') load(); }, [me, load]);
  const groups = useMemo(() => [...new Set(data?.features.map((f) => f.group) ?? [])], [data]);
  if (me && me.user.role !== 'ADMIN') return (<><PageHeader title="Features & access" /><Empty>Only admins can choose who gets which feature.</Empty></>);
  if (!data) return (<><PageHeader title="Features & access" /><ErrorBox error={error} />{!error && <Loading />}</>);

  const save = async (f: Row, mode: Mode, people = f.people) => {
    setError(null); setNote(null);
    if (mode === 'off' && !confirm(`Hide ${f.label} for everyone in your organisation, admins too?`)) return;
    try {
      await api(`/feature-access/${encodeURIComponent(f.key)}`, { method: 'PUT', json: { mode, people: mode === 'people' ? people : undefined } });
      await load();
      setNote(`${f.label}: ${ACCESS_LABEL[mode].toLowerCase()}${mode === 'people' ? ` (${people.length} ${people.length === 1 ? 'person' : 'people'} plus admins)` : ''}. It applies at once on the web and in the app.`);
      if (mode === 'people') setOpen(f.key);
    } catch (e) { setError(e); }
  };
  const nonAdmins = (f: Row) => data.people.filter((p) => p.role !== 'ADMIN' && f.roles.includes(p.role));
  const yours = data.features.filter((f) => f.available).length;
  const rows = (g: string) => data.features.filter((f) => f.group === g && (show === 'all' || (show === 'yours' ? f.available : !f.available)));

  return (
    <>
      <PageHeader
        title="Features & access"
        subtitle="Your plan decides which features your organisation has. Here you choose who in your team gets each of them. Changes apply at once on the web and in the Android/iOS app."
      />
      <ErrorBox error={error} />
      {note && <p className="mb-4 rounded-lg bg-ok/10 px-3 py-2 text-sm text-ok" role="status">{note}</p>}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><div className="text-xs text-muted">Plan</div><div className="text-lg font-semibold">{data.plan ?? (data.unrestricted ? 'Every feature' : 'No plan')}</div></div>
        <div className="card p-4"><div className="text-xs text-muted">Features you have</div><div className="text-lg font-semibold">{yours} of {data.features.length}</div></div>
        <div className="card p-4 text-sm text-muted">Need a locked feature? Ask your SampTrek provider, or upgrade under <a className="text-brand hover:underline" href="/settings/subscription">Subscription</a>.</div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-line bg-panel p-0.5 text-sm" role="radiogroup" aria-label="Show">
        {([['all', 'All'], ['yours', 'In your plan'], ['locked', 'Locked']] as const).map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={show === k} onClick={() => setShow(k)} className={clsx('rounded-md px-3 py-1', show === k ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>{l}</button>
        ))}
      </div>

      <div className="space-y-6">
        {groups.filter((g) => rows(g).length > 0).map((g) => (
          <Section key={g} title={g}>
            <ul className="-mx-5 divide-y divide-line">
              {rows(g).map((f) => (
                <li key={f.key} className="px-5 py-3" data-feature={f.key}>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={clsx('font-medium', !f.available && 'text-muted')}>{f.label}</span>
                        {f.source === 'extra' && <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand"><Gift className="h-3 w-3" />Extra from your provider</span>}
                        {!f.available && <span className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-xs text-muted"><Lock className="h-3 w-3" />{f.source === 'taken_away' ? 'Turned off by your provider' : 'Not in your plan'}</span>}
                        {f.mobile && f.available && <span className="inline-flex items-center gap-1 text-xs text-muted"><Smartphone className="h-3 w-3" />Also in the app</span>}
                      </div>
                      <div className="text-xs text-muted">{f.summary}</div>
                    </div>
                    {f.available && f.controllable && f.mode && (
                      <div className="flex flex-col items-start gap-1 md:items-end">
                        <div className="flex flex-wrap rounded-lg border border-line bg-panel p-0.5" role="radiogroup" aria-label={`Who gets ${f.label}`}>
                          {MODES.map((m) => (
                            <button key={m} type="button" role="radio" aria-checked={f.mode === m} title={MODE_HINT[m]}
                              onClick={() => (f.mode !== m ? save(f, m) : m === 'people' && setOpen(open === f.key ? null : f.key))}
                              className={clsx('rounded-md px-2 py-0.5 text-xs', f.mode === m ? (m === 'off' ? 'bg-bad text-white' : 'bg-brand text-brand-ink') : 'text-muted hover:bg-sunken')}>
                              {ACCESS_LABEL[m]}{m === 'people' && f.mode === 'people' ? ` (${f.people.length})` : ''}
                            </button>
                          ))}
                        </div>
                        <span className="text-xs text-muted">{MODE_HINT[f.mode]}{f.defaultMode === 'admins' && f.mode === 'admins' ? '. New feature: allow your team when you are ready.' : ''}</span>
                      </div>
                    )}
                    {f.available && !f.controllable && <span className="inline-flex items-center gap-1 text-xs text-muted"><Check className="h-3 w-3" />{f.roles.every((r) => r === 'ADMIN') ? 'Admins only' : 'Always on'}</span>}
                  </div>
                  {f.available && f.mode === 'people' && open === f.key && (
                    <div className="mt-3 rounded-lg border border-line bg-sunken/40 p-3">
                      <div className="mb-2 text-xs text-muted">Admins always have it. Tick the other people who should get {f.label}:</div>
                      {nonAdmins(f).length === 0 ? <p className="text-sm text-muted">No one else in your team has a role that can use this.</p> : (
                        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                          {nonAdmins(f).map((p) => {
                            const on = f.people.includes(p.id);
                            return (
                              <label key={p.id} className="flex min-w-0 items-center gap-2 text-sm">
                                <input type="checkbox" checked={on} onChange={() => save(f, 'people', on ? f.people.filter((x) => x !== p.id) : [...f.people, p.id])} />
                                <span className="truncate">{p.name}</span><span className="shrink-0 text-xs text-muted">{ROLE_LABEL[p.role]}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        ))}
      </div>
    </>
  );
}
