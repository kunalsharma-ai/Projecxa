'use client';
import { MobileOsPicker, devicesProblem, withOs, type DeviceSettings } from './mobile-os';
import clsx from 'clsx';
import { Bot, Copy, ExternalLink, Fingerprint, Globe2, Link2, ListChecks, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMe } from '@/components/me';
import { Empty, ErrorBox, Section, Toggle } from '@/components/ui';
import { get, patch } from '@/lib/api';
import type { CaptchaStyle, Question } from '@/lib/types';
import { cleanQuestion, QuestionBuilder, questionProblems } from './question-builder';
import type { ProjectDetail } from './types';
import { InfoTip } from '@/components/help';
import { SpeederCheck } from './speeder-check';
import { FraudRulesSection, fraudRulesOf, fraudRulesProblem, LinkedPeople } from './fraud-rules';

interface Status {
  geolocation: { configured: boolean; header: string | null };
  tor: { nodes: number; updatedAt: string | null };
  ipReputation?: { lists: boolean; proxycheck: boolean; allowList: boolean; blockList: boolean; sources: { id: string; count: number; error: string | null }[] };
}
interface CaptchaInfo { providers: Record<'turnstile' | 'hcaptcha', { configured: boolean; siteKey: string | null }> }
interface Summary { entries: number; gate: { required: number; passed: number }; reasons: { reason: string; label: string; status: string; count: number }[]; risk?: { low: number; medium: number; high: number } }

type Key = 'gateSurvey' | 'prescreening' | 'captcha' | 'urlProtection' | 'duplicateDetection' | 'browserFingerprinting' | 'cookieValidation' | 'geolocation' | 'timezoneTracking' | 'browserLanguage' | 'torDetection' | 'proxyDetection' | 'automationDetection' | 'crossProjectDuplicates';

const GROUPS: { title: string; icon: typeof Bot; items: { key: Key; label: string; help: string }[] }[] = [
  {
    title: 'Before the survey',
    icon: ListChecks,
    items: [
      { key: 'gateSurvey', label: 'Gate survey', help: 'A human check, then your gate questions (e.g. age, income, education), before anything else.' },
      { key: 'prescreening', label: 'Prescreener', help: 'Your screening questions, asked after the gate survey. Non-qualifiers never reach the client survey.' },
    ],
  },
  {
    title: 'Bots',
    icon: Bot,
    items: [
      { key: 'captcha', label: 'Captcha', help: 'Adds the human check (style below) and a background proof-of-work that slows down scripts.' },
      { key: 'automationDetection', label: 'Automated browsers', help: 'Stops bots and scripted browsers (automation flag, headless browsers, faked devices) on the gate page.' },
    ],
  },
  {
    title: 'Duplicates',
    icon: Fingerprint,
    items: [
      { key: 'duplicateDetection', label: 'Duplicate detection', help: 'Same IP address and browser entering this project again, through any vendor.' },
      { key: 'browserFingerprinting', label: 'Browser fingerprinting', help: 'Same device, recognised from screen, hardware and browser traits, even after a browser update or a language change.' },
      { key: 'cookieValidation', label: 'Cookie validation', help: 'Needs cookies switched on, and catches the same browser coming back.' },
      { key: 'crossProjectDuplicates', label: 'Across projects', help: 'Same device or browser already took part in another of your projects (rules below).' },
    ],
  },
  {
    title: 'Location and browser',
    icon: Globe2,
    items: [
      { key: 'geolocation', label: 'Geolocation', help: 'Respondent must be in the survey country.' },
      { key: 'timezoneTracking', label: 'Time zone', help: "The device's time zone must belong to the survey country." },
      { key: 'browserLanguage', label: 'Browser language', help: 'One of the browser languages must match the survey language.' },
      { key: 'torDetection', label: 'TOR detection', help: 'Blocks connections through the TOR network.' },
      { key: 'proxyDetection', label: 'IP and proxy reputation', help: 'Blocks VPNs, proxies, data centre networks and known abusive addresses, from free lists.' },
    ],
  },
  {
    title: 'Links',
    icon: Link2,
    items: [{ key: 'urlProtection', label: 'URL protection', help: 'Vendors sign every entry link, so respondent IDs cannot be made up or swapped.' }],
  },
];

const STYLES: { id: CaptchaStyle; name: string; help: string; provider?: 'turnstile' | 'hcaptcha' }[] = [
  { id: 'math', name: 'Math question', help: '“What is seven plus four?” Numbers written as words.' },
  { id: 'logic', name: 'Logic question', help: '“Which of these is a fruit?” Pick one of four words.' },
  { id: 'text_image', name: 'Picture text', help: 'Type five distorted characters from a picture.' },
  { id: 'invisible', name: 'Invisible', help: 'No question; a background proof-of-work only. Smoothest, least strict.' },
  { id: 'turnstile', name: 'Cloudflare Turnstile', help: 'Free, unlimited checks. Usually one click or none.', provider: 'turnstile' },
  { id: 'hcaptcha', name: 'hCaptcha', help: 'Free Basic plan. Image puzzles when it is unsure.', provider: 'hcaptcha' },
];

/** JSON with sorted keys, so key order never counts as a change. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

export function SecurityTab({ project, editable, reload }: { project: ProjectDetail; editable: boolean; reload: () => void }) {
  const me = useMe();
  const [security, setSecurity] = useState(project.security);
  const [devices, setDevices] = useState<DeviceSettings>(withOs(project.devices));
  const [style, setStyle] = useState<CaptchaStyle>(project.captchaStyle ?? 'math');
  const [gate, setGate] = useState<Question[]>(project.gateQuestions ?? []);
  const [pre, setPre] = useState<Question[]>(project.prescreen ?? []);
  const [rules, setRules] = useState(fraudRulesOf(project.fraudRules));
  const [status, setStatus] = useState<Status | null>(null);
  const [captcha, setCaptcha] = useState<CaptchaInfo | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    get<Status>('/security/status').then(setStatus).catch(() => undefined);
    get<CaptchaInfo>('/security/captcha').then(setCaptcha).catch(() => undefined);
    get<Summary>(`/projects/${project.id}/security-summary`).then(setSummary).catch(() => undefined);
  }, [project.id]);

  const original = useMemo(
    () => stable([project.security, withOs(project.devices), project.captchaStyle, (project.gateQuestions ?? []).map(cleanQuestion), (project.prescreen ?? []).map(cleanQuestion), fraudRulesOf(project.fraudRules)]),
    [project],
  );
  const dirty = stable([security, devices, style, gate.map(cleanQuestion), pre.map(cleanQuestion), rules]) !== original;
  const rulesProblem = fraudRulesProblem(rules, !!security.crossProjectDuplicates);
  const problems = [...gate, ...pre].reduce((n, q) => n + questionProblems(q).length, 0);
  const humanOn = security.gateSurvey || security.captcha;
  const currency = project.countries[0]?.currency ?? 'USD';
  const testLink = project.countries.flatMap((c) => c.allocations)[0]?.testEntryLink.replace('[UID]', 'qa-preview').replace('&sig=[SIG]', '');

  async function save() {
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      await patch(`/projects/${project.id}`, { security, devices, captchaStyle: style, gateQuestions: gate.length ? gate.map(cleanQuestion) : null, prescreen: pre.length ? pre.map(cleanQuestion) : null, fraudRules: rules });
      setSaved(true);
      reload();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  function note(key: Key): { text: string; tone: 'warn' | 'ok' } | null {
    if (!security[key]) return null;
    if (key === 'geolocation' && status && !status.geolocation.configured) return { text: 'Not active yet: the server needs a country header from your CDN (GEO_COUNTRY_HEADER). Entries are let through until then.', tone: 'warn' };
    if (key === 'torDetection' && status && !status.tor.nodes) return { text: 'The TOR exit list has not loaded yet, so entries are let through.', tone: 'warn' };
    if (key === 'torDetection' && status?.tor.nodes) return { text: `${status.tor.nodes.toLocaleString()} TOR exit addresses loaded.`, tone: 'ok' };
    if (key === 'proxyDetection' && status?.ipReputation) {
      const r = status.ipReputation;
      const loaded = r.sources.filter((x) => x.count > 0).reduce((n, x) => n + x.count, 0);
      if (r.lists && !loaded && !r.proxycheck) return { text: 'The free IP lists have not loaded yet, so entries are let through. An admin can load them in Settings → Integrations.', tone: 'warn' };
      if (!r.lists && !r.proxycheck) return { text: r.blockList ? 'Only your block list is used: the free lists are off in Settings → Integrations.' : 'No source is on: an admin turned the free lists off in Settings → Integrations.', tone: 'warn' };
      return { text: [r.lists && `${loaded.toLocaleString()} VPN, data centre and abuse ranges loaded`, r.proxycheck && 'proxycheck.io on', r.allowList && 'your allow list applies'].filter(Boolean).join(' · ') + '.', tone: 'ok' };
    }
    if (key === 'crossProjectDuplicates') return { text: rules.crossProject.scope === 'listed' ? `Looks in ${rules.crossProject.projectIds.length} picked project${rules.crossProject.projectIds.length === 1 ? '' : 's'}, last ${rules.crossProject.days} days.` : `Looks in ${rules.crossProject.scope === 'client' ? "this client's" : 'all your'} projects, last ${rules.crossProject.days} days.`, tone: 'ok' };
    if (key === 'prescreening' && !pre.length) return { text: 'Add prescreener questions below.', tone: 'warn' };
    if (key === 'gateSurvey' && !gate.length) return { text: 'Only the human check runs until you add gate questions below.', tone: 'warn' };
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-6">
        <Section help="project.security" title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand" /> Respondent security</span>}>
          <p className="mb-4 text-sm text-muted">
            Order for every respondent: entry checks → human check → gate survey → prescreener → browser checks → client survey. Set these before launch. Test links run every check but never block, so QA can click through.
          </p>
          <div className="space-y-5">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><g.icon className="h-3.5 w-3.5" /> {g.title}</div>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {g.items.map((it) => {
                    const n = note(it.key);
                    return (
                      <li key={it.key} className="flex items-start gap-3 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium">{it.label}</div>
                          <div className="text-xs text-muted">{it.help}</div>
                          {n && <div className={clsx('mt-1 text-xs', n.tone === 'warn' ? 'text-warn' : 'text-ok')}>{n.text}</div>}
                        </div>
                        {editable ? <Toggle checked={!!security[it.key]} onChange={(v) => setSecurity({ ...security, [it.key]: v })} label={it.label} /> : <span className="text-xs text-muted">{security[it.key] ? 'On' : 'Off'}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><MonitorSmartphone className="h-3.5 w-3.5" /> Devices allowed<InfoTip id="device.allowed" /></div>
              <div className="flex flex-wrap gap-4 rounded-lg border border-line p-3">
                {(['desktop', 'mobile', 'tablet'] as const).map((d) => (
                  <label key={d} className="flex items-center gap-2 text-sm capitalize">
                    {editable ? <Toggle checked={devices[d] !== false} onChange={(v) => setDevices({ ...devices, [d]: v })} label={d} /> : null}
                    {d}{!editable && `: ${devices[d] !== false ? 'yes' : 'no'}`}
                  </label>
                ))}
                <div className="basis-full">
                  {editable ? <MobileOsPicker devices={devices} onChange={setDevices} /> : <span className="pl-6 text-sm text-muted">Mobile systems: {[devices.android && 'Android', devices.ios && 'iOS'].filter(Boolean).join(', ') || 'none'}</span>}
                </div>
                {editable && devicesProblem(devices) && <p className="basis-full text-xs text-warn">{devicesProblem(devices)}</p>}
              </div>
            </div>
          </div>
        </Section>

        <FraudRulesSection project={project} value={rules} onChange={setRules} editable={editable} crossOn={!!security.crossProjectDuplicates} />

        <SpeederCheck key={`${project.speederCheck?.enabled}-${project.speederCheck?.fraction}`} project={project} editable={editable} reload={reload} />

        <Section title="Human check style">
          {!humanOn && <p className="mb-3 text-sm text-muted">Turn on the gate survey or captcha to use a human check.</p>}
          <div className={clsx('grid grid-cols-1 gap-2 sm:grid-cols-2', !humanOn && 'opacity-60')} role="radiogroup" aria-label="Human check style">
            {STYLES.map((s) => {
              const missingKeys = !!s.provider && captcha !== null && !captcha.providers[s.provider].configured;
              const selected = style === s.id;
              return (
                <button key={s.id} type="button" role="radio" aria-checked={selected} disabled={!editable || missingKeys}
                  onClick={() => setStyle(s.id)}
                  className={clsx('rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed', selected ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-line hover:border-brand/50', missingKeys && 'opacity-60')}>
                  <div className="flex items-center justify-between gap-2 text-sm font-medium">{s.name}{s.provider && <span className="chip bg-ok/15 text-ok">Free</span>}</div>
                  <div className="mt-0.5 text-xs text-muted">{s.help}</div>
                  {missingKeys && (
                    <div className="mt-1 text-xs text-warn">
                      Needs keys from an admin{me?.user.role === 'ADMIN' ? <> in <Link href="/settings" className="underline">Settings</Link></> : ''}.
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted">Only free options are offered. Google reCAPTCHA is left out because its free tier stops at 10,000 checks a month.</p>
        </Section>

        <Section title="Gate survey questions">
          {!security.gateSurvey && <p className="mb-3 text-sm text-warn">The gate survey is off; these questions are saved but not asked.</p>}
          <QuestionBuilder value={gate} onChange={setGate} editable={editable} templatesCurrency={currency} emptyText="No gate questions yet. Pick an audience set (B2B, B2C, parents, teens, healthcare consumers, patients or caregivers), add single profile questions from the library, or build your own." />
        </Section>

        <Section title="Prescreener questions">
          {!security.prescreening && <p className="mb-3 text-sm text-warn">The prescreener is off; these questions are saved but not asked.</p>}
          <QuestionBuilder value={pre} onChange={setPre} editable={editable} emptyText="No prescreener questions yet. Add the questions that decide who qualifies, and mark which answers screen out." />
        </Section>

        {editable && (dirty || saved || !!error) && (
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel p-3 shadow-lg">
            <button className="btn-primary" disabled={!dirty || saving || problems > 0 || !!devicesProblem(devices) || !!rulesProblem} onClick={save}>{saving ? 'Saving…' : 'Save security and questions'}</button>
            {problems > 0 && <span className="text-sm text-bad">Fix {problems} question {problems === 1 ? 'problem' : 'problems'} first.</span>}
            {!problems && dirty && <span className="text-sm text-muted">Unsaved changes</span>}
            {!dirty && saved && <span className="text-sm text-ok">Saved</span>}
            {project.status === 'LIVE' && dirty && <span className="text-sm text-warn">The survey is live: changes apply to new respondents straight away.</span>}
            <div className="w-full"><ErrorBox error={error} /></div>
          </div>
        )}
      </div>

      <div className="space-y-6">
        <Section title="What the checks caught">
          {!summary ? <p className="text-sm text-muted">Loading…</p> : summary.reasons.length === 0 ? (
            <Empty>Nothing stopped yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {summary.reasons.map((r) => (
                <li key={r.reason} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">{r.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{r.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
          {summary && summary.gate.required > 0 && (
            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
              {summary.gate.passed.toLocaleString()} of {summary.gate.required.toLocaleString()} respondents passed the gate ({Math.round((summary.gate.passed / summary.gate.required) * 100)}%). Live traffic only.
            </p>
          )}
          {summary?.risk && summary.risk.low + summary.risk.medium + summary.risk.high > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted">Fraud risk<InfoTip id="field:Reject at risk score" /></div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {(['low', 'medium', 'high'] as const).map((b) => (
                  <div key={b} className={clsx('rounded-lg px-2 py-1.5', b === 'low' ? 'bg-ok/10 text-ok' : b === 'medium' ? 'bg-warn/10 text-warn' : 'bg-bad/10 text-bad')}>
                    <div className="text-base font-semibold tabular-nums">{summary.risk![b].toLocaleString()}</div>
                    <div className="text-[11px] capitalize">{b}{b === 'low' ? ' (0–34)' : b === 'medium' ? ' (35–69)' : ' (70+)'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        <LinkedPeople projectId={project.id} />

        {testLink && (
          <Section title="Try it">
            <p className="mb-3 text-sm text-muted">Save, then open a test link to walk through the gate as a respondent.</p>
            <a href={testLink} target="_blank" rel="noreferrer" className="btn-ghost w-full justify-center"><ExternalLink className="h-4 w-4" /> Open test entry</a>
          </Section>
        )}

        {security.urlProtection && (
          <Section title="Signed entry links">
            <p className="text-sm text-muted">Each vendor adds <code className="font-mono text-xs">sig</code> to the entry link:</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-sunken p-3 text-xs">sig = hex(HMAC-SHA256(secret, UID))</pre>
            <p className="mt-2 text-sm text-muted">The secret is the vendor&apos;s signing secret (admins see it on the vendor page). Unsigned links are refused without using up the respondent ID.</p>
            <button type="button" className="btn-ghost mt-3 text-xs" onClick={() => navigator.clipboard?.writeText("const sig = require('crypto').createHmac('sha256', SECRET).update(UID).digest('hex');").catch(() => undefined)}><Copy className="h-3.5 w-3.5" /> Copy Node example</button>
          </Section>
        )}
      </div>
    </div>
  );
}
