'use client';
import { Copy, RotateCcw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorBox, Field, Loading, Section } from '@/components/ui';
import { api, get, post } from '@/lib/api';

type Settings = Record<string, number>;
interface Info { settings: Settings; defaults: Settings; webhookUrl: string | null; hasSecret: boolean; secret?: string }

const FIELDS: { key: string; label: string; unit: string; hint: string }[] = [
  { key: 'stalledHours', label: 'Stalled after', unit: 'hours', hint: 'A live market with no entries for this long.' },
  { key: 'irDropPct', label: 'Low incidence', unit: '% below plan', hint: 'Actual IR this far under the planned IR.' },
  { key: 'loiShortPct', label: 'LOI too short', unit: '% of plan', hint: 'Median LOI under this share suggests speeders.' },
  { key: 'loiLongPct', label: 'LOI too long', unit: '% of plan', hint: 'Median LOI over this share of the plan.' },
  { key: 'qualityPct', label: 'Quality spike', unit: '% of 24h entries', hint: 'Vendor entries rejected for quality, duplicates or security.' },
  { key: 'dropOffPct', label: 'Drop-out', unit: '% of 24h entries', hint: 'Vendor entries that left the survey.' },
  { key: 'quotaNearPct', label: 'Near target', unit: '% of target', hint: 'Heads-up before a market fills.' },
  { key: 'minSample', label: 'Minimum sample', unit: 'respondents', hint: 'Rates are only judged after this many.' },
];

/** Admin-only: alert thresholds and the signed webhook that receives new alerts. */
export function AlertSettings() {
  const [info, setInfo] = useState<Info | null>(null);
  const [draft, setDraft] = useState<Settings>({});
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const apply = (r: Info) => {
    setInfo(r);
    setDraft(r.settings);
    setUrl(r.webhookUrl ?? '');
    if (r.secret) setSecret(r.secret);
  };
  useEffect(() => { get<Info>('/organization/alert-settings').then(apply).catch(setError); }, []);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
  };
  const saveThresholds = () => run(async () => { apply(await api<Info>('/organization/alert-settings', { method: 'PUT', json: { settings: draft } })); setMsg('Thresholds saved'); });
  const saveWebhook = (remove = false) => run(async () => {
    apply(await api<Info>('/organization/alert-settings', { method: 'PUT', json: { webhookUrl: remove ? null : url.trim() } }));
    if (remove) setSecret(null);
    setMsg(remove ? 'Webhook removed' : 'Webhook saved');
  });
  const rotate = () => run(async () => { setSecret((await post<{ secret: string }>('/organization/alert-settings/rotate-secret')).secret); setMsg('New secret created. Update your receiver.'); });
  const test = () => run(async () => { const r = await post<{ status: string }>('/organization/alert-settings/test'); setMsg(`Test sent: ${r.status}`); });

  return (
    <Section title="Fieldwork alerts" className="mb-6">
      <div id="alerts" className="scroll-mt-24" />
      <p className="mb-4 text-sm text-muted">The fieldwork monitor checks every live market every five minutes against these thresholds. New alerts can also be posted to your own webhook, for example a Slack or Teams relay.</p>
      <ErrorBox error={error} />
      {!info ? <Loading /> : (
        <div className="grid items-start gap-5 lg:grid-cols-[3fr_2fr]">
          <div>
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <Field key={f.key} label={`${f.label} (${f.unit})`} hint={`${f.hint} Default ${info.defaults[f.key]}.`}>
                  <input className="input tabular-nums" type="number" inputMode="numeric" value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value === '' ? NaN : Number(e.target.value) })} />
                </Field>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-primary" onClick={saveThresholds}>Save thresholds</button>
              <button className="btn-ghost" onClick={() => setDraft(info.defaults)}><RotateCcw className="h-4 w-4" /> Defaults</button>
            </div>
          </div>
          <div className="rounded-lg border border-line p-4">
            <div className="mb-2 font-medium">Alert webhook</div>
            <p className="mb-3 text-xs text-muted">We POST each new alert as JSON, signed with <code className="font-mono">X-Projexa-Signature: sha256=HMAC(secret, timestamp.body)</code>. See docs/FIELDWORK_MONITOR.md.</p>
            <Field label="HTTPS URL"><input className="input font-mono text-xs" placeholder="https://hooks.example.com/projexa" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
            {secret && (
              <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
                <div className="mb-1 font-medium">Signing secret (shown once)</div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all font-mono text-xs">{secret}</code>
                  <button className="btn-ghost px-2 py-1" aria-label="Copy secret" onClick={() => navigator.clipboard?.writeText(secret)}><Copy className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-primary" disabled={!url.trim() || url.trim() === info.webhookUrl} onClick={() => saveWebhook()}>Save</button>
              {info.webhookUrl && (
                <>
                  <button className="btn-ghost" onClick={test}><Send className="h-4 w-4" /> Send test</button>
                  <button className="btn-ghost" onClick={rotate}>Rotate secret</button>
                  <button className="btn-ghost" onClick={() => saveWebhook(true)}>Remove</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-ok" role="status">{msg}</p>}
    </Section>
  );
}
