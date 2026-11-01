'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMe } from '@/components/me';
import { ErrorBox, Loading, Section, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';

interface U { id: string; name: string; email: string; role: string; staff: boolean; mfaEnabled: boolean; recoveryCodesLeft: number; locked: boolean }
interface Sec { mfaRequired: boolean; users: U[] }

const ROLE: Record<string, string> = { ADMIN: 'Admin', PROJECT_MANAGER: 'Project manager', SALES: 'Sales', VIEWER: 'Viewer', CLIENT_USER: 'Client portal', VENDOR_USER: 'Vendor portal' };

/** Admins: require two-step sign-in for staff, see who has it, reset it for someone who lost their phone. */
export function SignInSecurity() {
  const me = useMe();
  const [s, setS] = useState<Sec | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { get<Sec>('/organization/security').then(setS).catch(setError); }, []);

  const setRequired = async (v: boolean) => {
    if (v && !confirm('Require two-step sign-in for all staff? Anyone without it must set it up before they can continue. Portal users stay optional.')) return;
    setError(null);
    try { setS(await api<Sec>('/organization/security', { method: 'PUT', json: { mfaRequired: v } })); } catch (e) { setError(e); }
  };
  const reset = async (u: U) => {
    if (!confirm(`Reset two-step sign-in for ${u.name}? They can sign in with only their password and set it up again${s?.mfaRequired && u.staff ? ' (required straight away)' : ''}.`)) return;
    setError(null);
    try {
      await post(`/users/${u.id}/mfa/reset`);
      setNote(`Reset for ${u.name}.`);
      setS(await get<Sec>('/organization/security'));
    } catch (e) { setError(e); }
  };

  const staff = s?.users.filter((u) => u.staff) ?? [];
  const on = staff.filter((u) => u.mfaEnabled).length;
  const meRow = s?.users.find((u) => u.id === me?.user.id);
  return (
    <Section title="Sign-in security" className="mb-6">
      <ErrorBox error={error} />
      {!s ? <Loading /> : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl text-sm">
              <div className="font-medium">Require two-step sign-in for staff</div>
              <p className="text-muted">Staff sign in with their password and a code from a free authenticator app. {on} of {staff.length} staff have it on.{!meRow?.mfaEnabled && <> Turn it on for <Link className="text-brand hover:underline" href="/account/security">your own account</Link> first.</>}</p>
            </div>
            <Toggle checked={s.mfaRequired} onChange={setRequired} label="Require two-step sign-in for staff" />
          </div>
          {note && <p className="mt-3 text-sm text-ok" role="status">{note}</p>}
          <div className="-mx-5 mt-4 overflow-x-auto px-5">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr><th className="th">Person</th><th className="th">Role</th><th className="th">Two-step sign-in</th><th className="th" /></tr></thead>
              <tbody>
                {s.users.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="td"><div className="font-medium">{u.name}</div><div className="text-xs text-muted">{u.email}</div></td>
                    <td className="td text-muted">{ROLE[u.role] ?? u.role}</td>
                    <td className="td">
                      <span className={clsx('chip', u.mfaEnabled ? 'bg-ok/15 text-ok' : s.mfaRequired && u.staff ? 'bg-warn/15 text-warn' : 'bg-sunken text-muted')}>
                        {u.mfaEnabled ? 'On' : s.mfaRequired && u.staff ? 'Must set up' : 'Off'}
                      </span>
                      {u.locked && <span className="chip ml-1.5 bg-bad/15 text-bad">Locked</span>}
                      {u.mfaEnabled && u.recoveryCodesLeft <= 3 && <span className="ml-1.5 text-xs text-muted">{u.recoveryCodesLeft} recovery codes left</span>}
                    </td>
                    <td className="td text-right">{u.mfaEnabled && u.id !== me?.user.id && <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => reset(u)}>Reset</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}
