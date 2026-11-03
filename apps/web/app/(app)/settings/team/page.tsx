'use client';
import clsx from 'clsx';
import { Copy, LogOut, Mail, UserPlus } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { Empty, ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { api, get, post } from '@/lib/api';

type Role = 'ADMIN' | 'PROJECT_MANAGER' | 'SALES' | 'VIEWER';
interface Member { id: string; name: string; email: string; role: Role; active: boolean; status: 'active' | 'invited' | 'deactivated'; inviteExpiresAt: string | null; lastLoginAt: string | null; mfaEnabled: boolean; sso: string[]; isYou: boolean }
interface Team { emailConfigured: boolean; users: Member[] }

const ROLES: [Role, string, string][] = [
  ['ADMIN', 'Admin', 'Everything, including settings, team and finance settings'],
  ['PROJECT_MANAGER', 'Project manager', 'Create and run projects, vendors, invoices and bills'],
  ['SALES', 'Sales', 'See projects and reports'],
  ['VIEWER', 'Viewer', 'Read only'],
];
const ROLE_LABEL = Object.fromEntries(ROLES.map(([k, l]) => [k, l])) as Record<Role, string>;
const STATUS: Record<Member['status'], [string, string]> = { active: ['Active', 'bg-ok/15 text-ok'], invited: ['Invited', 'bg-brand/10 text-brand'], deactivated: ['Deactivated', 'bg-sunken text-muted'] };
const when = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never');

export default function TeamPage() {
  const me = useMe();
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<{ text: string; url?: string } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'PROJECT_MANAGER' as Role });
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'current' | 'deactivated'>('current');

  const load = useCallback(() => get<Team>('/team').then(setTeam).catch(setError), []);
  useEffect(() => { if (me?.user.role === 'ADMIN') load(); }, [me, load]);
  if (me && me.user.role !== 'ADMIN') return (<><PageHeader title="Team" /><Empty>Only admins can manage the team.</Empty></>);

  const run = async (fn: () => Promise<void>) => { setError(null); setNote(null); try { await fn(); await load(); } catch (e) { setError(e); } };
  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await run(async () => {
      const r = await post<{ emailed: boolean; inviteUrl: string }>('/team', form);
      setNote(r.emailed ? { text: `Invitation sent to ${form.email}. The link works for 72 hours.` } : { text: `${form.name} was added, but email sending is not set up (Settings → Integrations), so no invitation was sent. Copy this link and send it to them yourself. It works for 72 hours.`, url: r.inviteUrl });
      setForm({ name: '', email: '', role: form.role });
    });
    setBusy(false);
  }
  const patch = (m: Member, body: object, confirmText?: string) => { if (confirmText && !confirm(confirmText)) return; void run(async () => { await api(`/team/${m.id}`, { method: 'PATCH', json: body }); }); };
  const link = (m: Member) => void run(async () => {
    const r = await post<{ purpose: string; emailed: boolean; url: string }>(`/team/${m.id}/link`);
    const what = r.purpose === 'invite' ? 'A new invitation' : 'A password reset link';
    setNote(r.emailed ? { text: `${what} was sent to ${m.email}.` } : { text: `${what} was made for ${m.name}, but email sending is not set up (Settings → Integrations). Copy it and send it to them yourself.`, url: r.url });
  });
  const signOut = (m: Member) => { if (confirm(`Sign ${m.name} out of every browser and device?`)) void run(async () => { await post(`/team/${m.id}/sign-out`); setNote({ text: `${m.name} was signed out everywhere.` }); }); };

  const rows = team?.users.filter((u) => (filter === 'current' ? u.active : !u.active)) ?? [];
  return (
    <>
      <PageHeader title="Team" subtitle="Invite staff, set their role, and take access away when someone leaves. Client and vendor logins are under Portal access." />
      <ErrorBox error={error} />
      {note && (
        <div className="mb-4 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">
          {note.text}
          {note.url && (
            <button type="button" className="mt-2 flex w-full items-center gap-2 rounded border border-line bg-panel px-2 py-1.5 text-left font-mono text-xs text-ink" onClick={() => navigator.clipboard?.writeText(note.url!)} title="Copy">
              <span className="min-w-0 flex-1 truncate">{note.url}</span><Copy className="h-3.5 w-3.5 shrink-0 text-muted" />
            </button>
          )}
        </div>
      )}
      <Section title={<span className="flex items-center gap-2"><UserPlus className="h-4 w-4 text-brand" /> Invite someone</span>} className="mb-6">
        <form onSubmit={invite} className="grid gap-4 md:grid-cols-[1fr_1fr_14rem_auto] md:items-end">
          <label className="block"><span className="label">Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label className="block"><span className="label">Work email</span><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
          <label className="block"><span className="label">Role</span>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <button className="btn-primary" disabled={busy}><Mail className="h-4 w-4" />{busy ? 'Sending…' : 'Send invitation'}</button>
        </form>
        <p className="mt-3 text-xs text-muted">{ROLES.find(([k]) => k === form.role)![2]}. {team && !team.emailConfigured && 'Email sending is not set up yet (Settings → Integrations), so you will get a link to share instead.'}</p>
      </Section>
      <Section
        title={`People${team ? ` (${team.users.filter((u) => u.active).length})` : ''}`}
        actions={
          <div className="flex rounded-lg border border-line bg-panel p-0.5" role="group" aria-label="Show">
            {(['current', 'deactivated'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={clsx('rounded-md px-3 py-1 text-xs', filter === k ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>{k === 'current' ? 'Current' : 'Deactivated'}</button>
            ))}
          </div>
        }
      >
        {!team ? <Loading /> : rows.length === 0 ? <p className="text-sm text-muted">Nobody here.</p> : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr><th className="th">Person</th><th className="th">Role</th><th className="th">Status</th><th className="th">Sign-in</th><th className="th">Last sign-in</th><th className="th" /></tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className="border-t border-line" data-member={m.email}>
                    <td className="td"><div className="font-medium">{m.name}{m.isYou && <span className="ml-1.5 text-xs font-normal text-muted">(you)</span>}</div><div className="text-xs text-muted">{m.email}</div></td>
                    <td className="td">
                      <select className="input h-8 py-0 text-sm" aria-label={`Role of ${m.name}`} value={m.role} disabled={m.isYou || !m.active} onChange={(e) => patch(m, { role: e.target.value }, `Make ${m.name} ${ROLE_LABEL[e.target.value as Role]}?`)}>
                        {ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </td>
                    <td className="td"><span className={clsx('chip', STATUS[m.status][1])}>{STATUS[m.status][0]}</span>{m.status === 'invited' && m.inviteExpiresAt && <div className="mt-1 text-xs text-muted">{new Date(m.inviteExpiresAt) < new Date() ? 'Invitation expired' : `Until ${when(m.inviteExpiresAt)}`}</div>}</td>
                    <td className="td text-xs">{[m.mfaEnabled && 'Two-step', ...m.sso.map((s) => s[0].toUpperCase() + s.slice(1))].filter(Boolean).join(' · ') || 'Password'}</td>
                    <td className="td whitespace-nowrap text-xs text-muted">{when(m.lastLoginAt)}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1.5">
                        {m.active ? (
                          <>
                            <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => link(m)}>{m.status === 'invited' ? 'Resend invite' : 'Send reset link'}</button>
                            {!m.isYou && <button className="btn-ghost px-2.5 py-1 text-xs" title="Sign out everywhere" aria-label={`Sign ${m.name} out everywhere`} onClick={() => signOut(m)}><LogOut className="h-3.5 w-3.5" /></button>}
                            {!m.isYou && <button className="btn-danger px-2.5 py-1 text-xs" onClick={() => patch(m, { active: false }, `Deactivate ${m.name}? They are signed out at once and cannot sign in. Their projects and history stay.`)}>Deactivate</button>}
                          </>
                        ) : (
                          <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => patch(m, { active: true })}>Reactivate</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
