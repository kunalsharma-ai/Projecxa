'use client';
import { Check, Copy, ExternalLink, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ErrorBox, Loading, PageHeader, Section, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { ago, type OrgSummary, type Plan } from '@/lib/super-admin';
import { Label } from '@/components/help';

interface Settings { registrationOpen: boolean; defaultPlanCode: string | null; trialDays: number }

export default function RegistrationsPage() {
  const [rows, setRows] = useState<OrgSummary[] | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [choice, setChoice] = useState<Record<string, { planCode: string; trialDays: number }>>({});
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<{ text: string; url?: string } | null>(null);
  const load = useCallback(() => get<OrgSummary[]>('/super-admin/organizations?status=PENDING').then(setRows).catch(setError), []);
  useEffect(() => {
    load();
    get<Plan[]>('/super-admin/plans').then(setPlans).catch(setError);
    get<Settings>('/super-admin/settings').then(setSettings).catch(setError);
  }, [load]);
  const saveSettings = async (b: Partial<Settings>) => { setError(null); try { setSettings(await api<Settings>('/super-admin/settings', { method: 'PUT', json: b })); } catch (e) { setError(e); } };
  const pick = (o: OrgSummary) => choice[o.id] ?? { planCode: o.registration?.requestedPlan ?? settings?.defaultPlanCode ?? 'starter', trialDays: settings?.trialDays ?? 14 };
  const approve = async (o: OrgSummary) => {
    setError(null); setNote(null);
    try {
      const r = await post<{ invite: { emailed: boolean; inviteUrl: string } | null }>(`/super-admin/organizations/${o.id}/approve`, pick(o));
      setNote(r.invite?.emailed ? { text: `${o.name} is approved. Its admin got an email to choose a password.` } : { text: `${o.name} is approved, but email is not set up on your organisation, so send this link to its admin yourself.`, url: r.invite?.inviteUrl });
      load();
    } catch (e) { setError(e); }
  };
  const reject = async (o: OrgSummary) => {
    if (!confirm(`Turn down ${o.name}? The registration is deleted.`)) return;
    try { await post(`/super-admin/organizations/${o.id}/reject`); load(); } catch (e) { setError(e); }
  };
  const link = typeof window !== 'undefined' ? `${window.location.origin}/register` : '/register';
  return (
    <>
      <PageHeader title="Registrations" subtitle="Companies that signed up on the registration page. Approve to start them on a plan, or let Automation approve them for you." />
      <ErrorBox error={error} />
      {note && (
        <div className="mb-4 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">{note.text}
          {note.url && <button type="button" className="mt-2 flex w-full items-center gap-2 rounded border border-line bg-panel px-2 py-1.5 text-left font-mono text-xs text-ink" onClick={() => navigator.clipboard?.writeText(note.url!)}><span className="min-w-0 flex-1 truncate">{note.url}</span><Copy className="h-3.5 w-3.5 shrink-0 text-muted" /></button>}
        </div>
      )}
      <Section title="Registration page" className="mb-6">
        {!settings ? <Loading /> : (
          <div className="grid gap-4 md:grid-cols-[auto_1fr_1fr] md:items-end">
            <div className="flex items-center gap-3"><Toggle checked={settings.registrationOpen} onChange={(v) => saveSettings({ registrationOpen: v })} label="Registration open" /><span className="text-sm">{settings.registrationOpen ? 'Open: anyone with the link can register' : 'Closed'}</span></div>
            <label className="block"><Label>Default plan</Label>
              <select className="input" value={settings.defaultPlanCode ?? ''} onChange={(e) => saveSettings({ defaultPlanCode: e.target.value || null })}>
                <option value="">No plan (every feature)</option>
                {plans.filter((p) => p.active).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
              </select>
            </label>
            <label className="block"><Label>Free trial (days)</Label><input className="input" type="number" min={0} max={365} value={settings.trialDays} onChange={(e) => setSettings({ ...settings, trialDays: Number(e.target.value) })} onBlur={() => saveSettings({ trialDays: settings.trialDays })} /></label>
            {settings.registrationOpen && <a href="/register" target="_blank" className="flex items-center gap-1.5 text-sm text-brand hover:underline md:col-span-3"><ExternalLink className="h-4 w-4" />{link}</a>}
          </div>
        )}
      </Section>
      <Section title={`Waiting for approval${rows ? ` (${rows.length})` : ''}`}>
        {!rows ? <Loading /> : rows.length === 0 ? <p className="text-sm text-muted">Nobody is waiting.</p> : (
          <ul className="divide-y divide-line">
            {rows.map((o) => {
              const r = o.registration ?? {};
              const c = pick(o);
              return (
                <li key={o.id} className="grid gap-3 py-4 lg:grid-cols-[1.4fr_1fr_auto] lg:items-center">
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">{o.name} <span className="text-xs font-normal text-muted">· {ago(r.at ?? o.createdAt)}</span></div>
                    <div className="text-xs text-muted">{[r.contactName, r.phone, r.website].filter(Boolean).join(' · ')}{r.requestedPlan && ` · asked for ${plans.find((p) => p.code === r.requestedPlan)?.name ?? r.requestedPlan}`}</div>
                    {r.message && <p className="mt-1 text-xs">“{r.message}”</p>}
                  </div>
                  <div className="flex gap-2">
                    <select className="input h-9 py-0 text-sm" aria-label={`Plan for ${o.name}`} value={c.planCode} onChange={(e) => setChoice({ ...choice, [o.id]: { ...c, planCode: e.target.value } })}>{plans.filter((p) => p.active).map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
                    <label className="flex items-center gap-1 text-xs text-muted"><input className="input h-9 w-16 py-0 text-sm" type="number" min={0} max={365} value={c.trialDays} onChange={(e) => setChoice({ ...choice, [o.id]: { ...c, trialDays: Number(e.target.value) } })} aria-label="Trial days" />trial days</label>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-primary" onClick={() => approve(o)}><Check className="h-4 w-4" />Approve</button>
                    <button className="btn-ghost" onClick={() => reject(o)}><X className="h-4 w-4" />Turn down</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
