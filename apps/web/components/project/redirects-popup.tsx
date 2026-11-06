'use client';
import clsx from 'clsx';
import { ArrowDown, ArrowRight, Flag, Server, User, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CopyIcon } from '@/components/copy';
import { InfoTip } from '@/components/help';
import { get } from '@/lib/api';
import { VENDOR_FALLBACK } from '@/lib/contact-rules';
import { findHelp } from '@/lib/help';
import { OUTCOME_STATUSES, STATUS_LABEL } from '@/lib/types';
import type { PolicyVendor } from './redirect-guide';
import type { ProjectDetail } from './types';

interface Policy { vendors: PolicyVendor[]; outcomeLinks: { status: string; url: string }[] }

/** What each status means, in the words a client's scripter uses. */
const MEANING: Record<string, string> = {
  COMPLETE: 'Qualified and finished the survey',
  TERMINATE: 'Screened out: did not qualify',
  QUOTA_FULL: 'Qualified, but that quota was already full',
  QUALITY_FAIL: 'Speeder, straight-liner or failed an attention check',
  DUPLICATE: 'Took this survey before',
  SECURITY_REJECT: 'Failed a security or fraud check',
  PARTIAL: 'Left before the end',
  TECHNICAL_ERROR: 'The survey broke',
};

/** Colour per status in the example, so the matching links are easy to follow. */
const TONE: Record<string, string> = {
  COMPLETE: 'bg-st-live text-white',
  TERMINATE: 'bg-st-draft text-white',
  QUOTA_FULL: 'bg-st-hold text-white',
  QUALITY_FAIL: 'bg-st-closed text-white',
  DUPLICATE: 'bg-st-invoiced text-white',
  SECURITY_REJECT: 'bg-st-closed text-white',
  PARTIAL: 'bg-st-test text-white',
  TECHNICAL_ERROR: 'bg-st-test text-white',
};

/** Decipher exit conditions; other statuses are set with a custom condition. */
const DECIPHER_COND: Record<string, string> = { COMPLETE: 'qualified', TERMINATE: 'terminated', QUOTA_FULL: 'overquota' };

const EXAMPLE_TOKEN = 'st8Kp2vQ';
const EXAMPLE_UID = 'PANEL-1001';

/** The client's live survey link as SampTrek opens it: {session_token} filled, or token= added. */
function surveyWithToken(link: string, token: string, country: string, projectCode: string) {
  try {
    if (link.includes('{session_token}')) return link.replace(/\{session_token\}/g, token).replace(/\{country_code\}/g, country).replace(/\{project_code\}/g, projectCode);
    const u = new URL(link);
    u.searchParams.set('token', token);
    return u.toString();
  } catch {
    return `${link}${link.includes('?') ? '&' : '?'}token=${token}`;
  }
}

const fillVendor = (url: string, status: string, vendorCode: string, country: string, project: string) =>
  url
    .replace(/\{respondent_uid\}|\{uid\}/g, EXAMPLE_UID)
    .replace(/\{status\}/g, status.toLowerCase())
    .replace(/\{vendor_id\}/g, vendorCode)
    .replace(/\{country_code\}/g, country)
    .replace(/\{project_code\}/g, project)
    .replace(/\{session_token\}/g, EXAMPLE_TOKEN);

/** Shows a URL with the example token picked out, so people see the same value travel through. */
function Url({ url, mark }: { url: string; mark?: string }) {
  const parts = mark ? url.split(mark) : [url];
  return (
    <code className="min-w-0 flex-1 break-all text-xs">
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <mark className="rounded bg-st-hold/25 px-0.5 font-semibold text-ink">{mark}</mark>}
        </span>
      ))}
    </code>
  );
}

function Step({ n, icon: Icon, title, who, children }: { n: number; icon: typeof User; title: string; who: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-line bg-panel p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-brand text-xs font-bold text-brand-ink">{n}</span>
        <Icon className="h-4 w-4 text-muted" aria-hidden />
        <span className="text-sm font-semibold">{title}</span>
        <span className="ml-auto rounded-full bg-sunken px-2 py-0.5 text-[11px] font-medium text-muted">{who}</span>
      </div>
      {children}
    </li>
  );
}

/**
 * The Redirects button in the project header opens this: every prebuilt client return link with
 * Copy all, and a worked example built from this project's own links that follows one respondent
 * from the vendor, through the client's survey, back to SampTrek and on to the vendor's page.
 */
export function RedirectsPopup({ project, onClose, openTab }: { project: ProjectDetail; onClose: () => void; openTab: (tab: 'Redirects' | 'QA studio') => void }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('COMPLETE');
  const [platform, setPlatform] = useState<'decipher' | 'qualtrics' | 'alchemer' | 'code'>('decipher');
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    get<Policy>(`/projects/${project.id}/redirects`).then(setPolicy).catch((e) => setError(e instanceof Error ? e.message : 'Could not load the redirects'));
  }, [project.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    panel.current?.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const links = policy?.outcomeLinks ?? OUTCOME_STATUSES.map((s) => ({ status: s, url: project.outcomeEndpoints.browser.replace('{status}', s.toLowerCase()).replace('{session_token}', '[TOKEN]') }));
  const allText = links.map((l) => `${STATUS_LABEL[l.status]}: ${l.url}`).join('\n');
  const link = links.find((l) => l.status === status)!;
  const returnUrl = link.url.replace('[TOKEN]', EXAMPLE_TOKEN);

  // The example uses this project's first market with a survey link and its first vendor.
  const market = project.countries.find((c) => c.liveSurveyUrl || c.testSurveyUrl) ?? project.countries[0];
  const alloc = market?.allocations[0] ?? project.countries.flatMap((c) => c.allocations)[0];
  const vendor = policy?.vendors.find((v) => v.id === alloc?.vendorId) ?? policy?.vendors[0];
  const entry = alloc ? alloc.entryLink.replace('[UID]', EXAMPLE_UID).replace('&sig=[SIG]', '') : null;
  const survey = market?.liveSurveyUrl || market?.testSurveyUrl;
  const vendorUrl = useMemo(() => {
    if (!vendor) return null;
    const raw = vendor.redirectUrls[status] ?? (VENDOR_FALLBACK[status] ? vendor.redirectUrls[VENDOR_FALLBACK[status]] : undefined);
    return raw ? fillVendor(raw, status, vendor.code, market?.countryCode.toUpperCase() ?? 'US', project.projectCode) : null;
  }, [vendor, status, market, project.projectCode]);

  const tokenUrl = link.url.replace('?token=[TOKEN]', '?token=');
  const snippet: Record<typeof platform, { label: string; where: string; code: string }> = {
    decipher: {
      label: 'Decipher / Forsta',
      where: 'Add token as an extra variable on the survey link, then put this exit in the survey XML.',
      code: DECIPHER_COND[status]
        ? `<exit cond="${DECIPHER_COND[status]}" url="${tokenUrl}\${token}"/>`
        : `<exit cond="your_${status.toLowerCase()}_condition" url="${tokenUrl}\${token}"/>`,
    },
    qualtrics: {
      label: 'Qualtrics',
      where: 'Survey flow: add Embedded data "token" at the top (set from the panel / URL). Then End of survey → Redirect to a full URL:',
      code: `${tokenUrl}\${e://Field/token}`,
    },
    alchemer: {
      label: 'Alchemer',
      where: 'Add a URL Redirect action on the page for this outcome, using the URL variable merge code:',
      code: `${tokenUrl}[url("token")]`,
    },
    code: {
      label: 'Own code',
      where: 'Any survey tool or your own page: read token from the address it was opened with and send the respondent here.',
      code: `const token = new URLSearchParams(location.search).get('token');\nlocation.href = '${tokenUrl}' + encodeURIComponent(token);`,
    },
  };
  const snip = snippet[platform];

  // Rendered on <body> so it covers the sidebar and top bar too.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Redirects" className="anim-pop w-full min-w-0 max-w-4xl rounded-2xl border border-line bg-bg shadow-2xl outline-none">
        <div className="flex items-start gap-3 border-b border-line p-4 sm:p-5">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-1 text-lg font-bold">Redirects <InfoTip entry={findHelp('project.redirectsPopup')} /></h2>
            <p className="text-sm text-muted">The links the client&apos;s survey sends respondents back to. They are prebuilt for {project.projectCode}; copy them to the client.</p>
          </div>
          <button type="button" className="btn-ghost p-2" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          {error && <p className="rounded-lg border border-bad/40 bg-bad/10 p-2 text-sm text-bad">{error}</p>}

          <section className="card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Prebuilt client return links ({links.length})</h3>
              <span className="flex items-center gap-1 rounded-full border border-line px-2 text-xs font-medium">Copy all <CopyIcon text={allText} label="all client return links" /></span>
            </div>
            <ul className="divide-y divide-line">
              {links.map((l) => (
                <li key={l.status} className="flex items-center gap-2 py-1.5">
                  <button type="button" onClick={() => setStatus(l.status)} className={clsx('w-24 shrink-0 rounded-full px-2 py-0.5 text-left text-xs font-semibold sm:w-32', TONE[l.status])} title="Show this status in the example below">{STATUS_LABEL[l.status]}</button>
                  <Url url={l.url} />
                  <CopyIcon text={l.url} label={`${STATUS_LABEL[l.status]} return link`} />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">The client&apos;s survey replaces <code>[TOKEN]</code> with the <code>token</code> value SampTrek added to their survey link. The example below shows exactly how.</p>
          </section>

          <section className="card p-4">
            <h3 className="text-sm font-semibold">See it work: one respondent, start to finish</h3>
            <p className="mb-3 text-xs text-muted">Built from this project&apos;s own links{market ? ` (${market.countryCode.toUpperCase()}${vendor ? `, ${vendor.name}` : ''})` : ''}. Pick how the survey ended:</p>
            <div className="mb-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="How the survey ended">
              {OUTCOME_STATUSES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={status === s} onClick={() => setStatus(s)}
                  className={clsx('rounded-full px-3 py-1 text-xs font-semibold transition', status === s ? clsx(TONE[s], 'shadow') : 'border border-line text-muted hover:text-ink')}>
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <ol className="space-y-2">
              <Step n={1} icon={User} title="Vendor sends a respondent to SampTrek" who="Vendor">
                {entry ? (
                  <div className="flex items-start gap-1 rounded-lg bg-sunken p-2"><Url url={entry} mark={EXAMPLE_UID} /><CopyIcon text={alloc!.entryLink} label="entry link" /></div>
                ) : (
                  <p className="text-xs text-muted">Add a vendor on the Vendors &amp; links tab to get its entry link.</p>
                )}
                <p className="mt-1 text-xs text-muted">The vendor puts its own respondent ID in place of [UID]; here it is <b>{EXAMPLE_UID}</b>.</p>
              </Step>
              <ArrowDown className="mx-auto h-4 w-4 text-muted" aria-hidden />
              <Step n={2} icon={Server} title="SampTrek checks them and opens the client's survey" who="Automatic">
                {survey ? (
                  <div className="rounded-lg bg-sunken p-2"><Url url={surveyWithToken(survey, EXAMPLE_TOKEN, market!.countryCode.toUpperCase(), project.projectCode)} mark={EXAMPLE_TOKEN} /></div>
                ) : (
                  <p className="text-xs text-muted">Add the client&apos;s survey link on the Overview tab.</p>
                )}
                <p className="mt-1 text-xs text-muted">SampTrek adds a one-time <b>token</b> (here <mark className="rounded bg-st-hold/25 px-0.5 font-semibold text-ink">{EXAMPLE_TOKEN}</mark>). The client&apos;s survey must keep it until the end.</p>
              </Step>
              <ArrowDown className="mx-auto h-4 w-4 text-muted" aria-hidden />
              <Step n={3} icon={Flag} title={`Survey ends as ${STATUS_LABEL[status]}: client sends them back`} who="Client sets this up">
                <p className="mb-1 text-xs text-muted">{MEANING[status]}. The survey redirects to the {STATUS_LABEL[status]} link with the same token:</p>
                <div className="flex items-start gap-1 rounded-lg bg-sunken p-2"><Url url={returnUrl} mark={EXAMPLE_TOKEN} /><CopyIcon text={link.url} label={`${STATUS_LABEL[status]} return link`} /></div>
                <div className="mt-3 rounded-lg border border-line p-2">
                  <div className="mb-2 flex flex-wrap items-center gap-1 text-xs">
                    <span className="mr-1 font-medium">In the client&apos;s survey tool:</span>
                    {(Object.keys(snippet) as (typeof platform)[]).map((k) => (
                      <button key={k} type="button" onClick={() => setPlatform(k)} className={clsx('rounded-full px-2.5 py-0.5', platform === k ? 'bg-brand text-brand-ink' : 'bg-sunken text-muted hover:text-ink')}>{snippet[k].label}</button>
                    ))}
                  </div>
                  <p className="mb-1 text-xs text-muted">{snip.where}</p>
                  <div className="flex items-start gap-1 rounded-lg bg-sunken p-2"><code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-xs">{snip.code}</code><CopyIcon text={snip.code} label={`${snip.label} snippet`} /></div>
                  <p className="mt-1 text-[11px] text-muted">A common pattern for that tool; the client&apos;s scripter may name the variable differently.</p>
                </div>
              </Step>
              <ArrowDown className="mx-auto h-4 w-4 text-muted" aria-hidden />
              <Step n={4} icon={ArrowRight} title={`SampTrek records ${STATUS_LABEL[status]} and sends them to the vendor`} who="Automatic">
                {vendorUrl ? (
                  <div className="rounded-lg bg-sunken p-2"><Url url={vendorUrl} mark={EXAMPLE_UID} /></div>
                ) : (
                  <p className="text-xs text-muted">{vendor ? `${vendor.name} has no ${STATUS_LABEL[status]} URL saved, so SampTrek shows its own end page.` : 'No vendor yet: SampTrek shows its own end page.'}</p>
                )}
                <p className="mt-1 text-xs text-muted">The vendor gets back its own ID <b>{EXAMPLE_UID}</b>, so it knows which respondent finished and how. The count shows up under {STATUS_LABEL[status]} straight away.</p>
              </Step>
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" onClick={() => openTab('QA studio')}>Try it with a test respondent</button>
              <button type="button" className="btn-ghost" onClick={() => openTab('Redirects')}>Change where vendors are sent</button>
            </div>
          </section>

          <details className="card p-4">
            <summary className="cursor-pointer text-sm font-semibold">Server-to-server confirmation (optional, recommended before billing)</summary>
            <p className="mt-2 text-xs text-muted">Besides the browser redirect, the client&apos;s server can confirm each outcome. POST to:</p>
            <div className="mt-1 flex items-start gap-1 rounded-lg bg-sunken p-2"><Url url={project.outcomeEndpoints.s2s} /><CopyIcon text={project.outcomeEndpoints.s2s} label="server-to-server URL" /></div>
            <p className="mt-2 text-xs text-muted">Example body for this respondent:</p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-sunken p-2 text-xs">{`{ "token": "${EXAMPLE_TOKEN}", "status": "${status.toLowerCase()}", "timestamp": 1767225600,\n  "signature": "<hex HMAC-SHA256(client secret, \\"${EXAMPLE_TOKEN}.${status.toLowerCase()}.1767225600\\")>" }`}</pre>
          </details>
        </div>
      </div>
    </div>,
    document.body,
  );
}
