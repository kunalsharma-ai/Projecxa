'use client';
import { useEffect, useState } from 'react';
import { ErrorBox, Loading, Section, Toggle } from '@/components/ui';
import { api, get } from '@/lib/api';
import type { AiSettings, AiStatus } from '@/lib/ai';

interface Usage { byDay: { day: string; requests: number; failed: number; prompt: number; output: number }[]; today: { name: string; requests: number; tokens: number }[]; recentErrors: { createdAt: string; model: string; kind: string; error: string | null }[]; actions: Record<string, number> }
const ROLES = [['ADMIN', 'Admins'], ['PROJECT_MANAGER', 'Project managers'], ['SALES', 'Sales'], ['VIEWER', 'Viewers']] as const;

/** Admin controls for the AI copilot: who can use it, what it may do, and daily limits. */
export function AiCopilotSettings() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [s, setS] = useState<AiSettings | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    get<AiStatus>('/ai/status').then((x) => { setStatus(x); setS(x.settings ?? null); }).catch(setError);
    get<Usage>('/ai/usage').then(setUsage).catch(() => undefined);
  }, []);
  if (!status || !s) return <Section title="AI copilot" className="mb-6">{error ? <ErrorBox error={error} /> : <Loading />}</Section>;
  const set = (p: Partial<AiSettings>) => { setS({ ...s, ...p }); setSaved(false); };
  const save = async () => {
    setError(null);
    try { setS(await api<AiSettings>('/ai/settings', { method: 'PUT', json: s })); setSaved(true); } catch (e) { setError(e); }
  };
  const num = (k: 'perUserPerMinute' | 'perUserDaily' | 'orgDaily', label: string, max: number) => (
    <label className="block"><span className="label">{label}</span><input type="number" min={1} max={max} className="input" value={s[k]} onChange={(e) => set({ [k]: Math.max(1, Math.min(max, Number(e.target.value) || 1)) })} /></label>
  );
  const week = usage?.byDay.slice(-7) ?? [];
  return (
    <Section title="AI copilot" className="mb-6" actions={<button className="btn-primary" onClick={save}>{saved ? 'Saved' : 'Save'}</button>}>
      <div className="space-y-5">
        <ErrorBox error={error} />
        <p className="text-sm text-muted">
          {status.configured
            ? <>Google Gemini, model <code className="font-mono text-xs">{status.model}</code>, voice <code className="font-mono text-xs">{status.liveModel}</code>. The API key stays on the server.</>
            : <>Not set up: add <code className="font-mono text-xs">GEMINI_API_KEY</code> on the API server (docs/AI_COPILOT.md).</>}
        </p>
        <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs text-warn">On Gemini&rsquo;s free tier, Google may use prompts and answers to improve its products. That includes the project, client and finance details the copilot looks up. Turn on billing for the Google AI Studio project before using it with confidential client work.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {([['enabled', 'Copilot on', 'Ask questions in the app'], ['actions', 'Propose changes', 'Tasks, project status, vendor links; always confirmed by the person'], ['documents', 'Read uploaded files', 'PDF, text and images up to 10 MB'], ['voice', 'Voice', 'Talk with Gemini Live or the browser’s speech']] as const).map(([k, label, hint]) => (
            <div key={k} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
              <div className="min-w-0 text-sm"><div className="font-medium">{label}</div><div className="text-xs text-muted">{hint}</div></div>
              <Toggle checked={s[k]} onChange={(v) => set({ [k]: v })} label={label} />
            </div>
          ))}
        </div>
        <div>
          <span className="label">Who can use it</span>
          <div className="flex flex-wrap gap-4">
            {ROLES.map(([r, label]) => (
              <label key={r} className="inline-flex items-center gap-2 text-sm"><input type="checkbox" disabled={r === 'ADMIN'} checked={r === 'ADMIN' || s.roles.includes(r)} onChange={(e) => set({ roles: e.target.checked ? [...s.roles, r] : s.roles.filter((x) => x !== r) })} />{label}</label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Client and vendor portal users never have the copilot. Each person only sees what their role can see.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {num('perUserPerMinute', 'Questions per person per minute', 60)}
          {num('perUserDaily', 'Questions per person per day', 5000)}
          {num('orgDaily', 'Questions for everyone per day', 100000)}
        </div>
        <p className="-mt-2 text-xs text-muted">Keep these under your Gemini plan&rsquo;s limits (see aistudio.google.com/rate-limit). When Gemini is busy, the copilot retries once on the lighter fallback model.</p>
        {usage && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Last 7 days</h3>
              {week.length === 0 ? <p className="text-sm text-muted">No use yet.</p> : (
                <table className="w-full text-sm"><thead><tr><th className="th">Day</th><th className="th text-right">Questions</th><th className="th text-right">Failed</th><th className="th text-right">Tokens</th></tr></thead>
                  <tbody>{week.map((d) => <tr key={d.day} className="border-t border-line"><td className="td">{d.day}</td><td className="td text-right tabular-nums">{d.requests}</td><td className="td text-right tabular-nums">{d.failed}</td><td className="td text-right tabular-nums">{(d.prompt + d.output).toLocaleString()}</td></tr>)}</tbody></table>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Today by person</h3>
              {usage.today.length === 0 ? <p className="text-sm text-muted">No questions today.</p> : (
                <table className="w-full text-sm"><thead><tr><th className="th">Person</th><th className="th text-right">Questions</th><th className="th text-right">Tokens</th></tr></thead>
                  <tbody>{usage.today.map((d) => <tr key={d.name} className="border-t border-line"><td className="td">{d.name}</td><td className="td text-right tabular-nums">{d.requests}</td><td className="td text-right tabular-nums">{d.tokens.toLocaleString()}</td></tr>)}</tbody></table>
              )}
              {usage.recentErrors[0] && <p className="mt-2 text-xs text-muted">Last error: {usage.recentErrors[0].error}</p>}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
