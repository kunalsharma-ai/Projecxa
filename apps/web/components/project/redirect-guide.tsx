'use client';
import { CopyIcon } from '@/components/copy';
import clsx from 'clsx';
import { ArrowRight, Check, Copy, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Section } from '@/components/ui';
import { VENDOR_FALLBACK, VENDOR_REDIRECTS } from '@/lib/contact-rules';
import { STATUS_LABEL } from '@/lib/types';

export interface PolicyVendor { id: string; name: string; code: string; redirectUrls: Record<string, string>; callbackUrlTemplate: string | null }

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost p-1.5"
      aria-label={`Copy ${label}`}
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * The three hops of a respondent, kept apart so each team knows which links are theirs:
 * vendor → SampTrek (entry links), client survey → SampTrek (prebuilt return links for the client),
 * SampTrek → vendor (the vendor redirects configured below).
 */
export function RedirectGuide({ outcomeLinks }: { outcomeLinks: { status: string; url: string }[] }) {
  const main = outcomeLinks.filter((l) => ['COMPLETE', 'TERMINATE', 'QUOTA_FULL', 'SECURITY_REJECT'].includes(l.status));
  const rest = outcomeLinks.filter((l) => !main.includes(l));
  const [more, setMore] = useState(false);
  const steps = [
    { n: 1, title: 'Vendor → SampTrek', body: 'Each vendor sends respondents to its entry link. Find them on the Vendors & links tab.', who: 'Give to the vendor' },
    { n: 2, title: 'Client survey → SampTrek', body: 'At the end of the survey the client sends the respondent back to one of these links. They are prebuilt; copy them to the client.', who: 'Give to the client' },
    { n: 3, title: 'SampTrek → Vendor', body: 'SampTrek records the outcome and sends the respondent on to the vendor’s own page for that status. Set below; prebuilt from each vendor’s saved redirects.', who: 'Set here' },
  ];
  return (
    <Section title="How redirects work in SampTrek">
      <ol className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
        {steps.map((s, i) => (
          <li key={s.n} className="contents">
            <div className={clsx('rounded-lg border p-3', s.n === 3 ? 'border-brand/40 bg-brand/5' : 'border-line bg-sunken/40')}>
              <div className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-5 w-5 place-items-center rounded-full bg-brand text-[11px] text-brand-ink">{s.n}</span>{s.title}</div>
              <p className="mt-1 text-xs text-muted">{s.body}</p>
              <div className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted">{s.who}</div>
            </div>
            {i < steps.length - 1 && <ArrowRight className="mx-auto hidden h-4 w-4 self-center text-muted md:block" aria-hidden />}
          </li>
        ))}
      </ol>

      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Step 2 · Client return links (prebuilt)</h3>
          <div className="flex items-center gap-1 text-xs text-muted">
            Copy all four
            <CopyButton label="all client return links" text={main.map((l) => `${STATUS_LABEL[l.status]}: ${l.url}`).join('\n')} />
          </div>
        </div>
        <p className="mb-2 text-xs text-muted">
          The client replaces <code>[TOKEN]</code> with the value SampTrek adds to their survey link (<code>token</code>, or the parameter named in the survey link, e.g. <code>rid</code>).
          For billing, a signed server-to-server postback is also accepted (see Redirects at the top of the project).
        </p>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <tbody className="divide-y divide-line border-y border-line">
              {(more ? outcomeLinks : main).map((l) => (
                <tr key={l.status}>
                  <td className="td w-44 text-sm font-medium">{STATUS_LABEL[l.status]}</td>
                  <td className="td break-all font-mono text-xs">{l.url}</td>
                  <td className="td w-10"><CopyButton label={`${STATUS_LABEL[l.status]} return link`} text={l.url} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rest.length > 0 && <button type="button" className="mt-2 text-xs text-brand hover:underline" onClick={() => setMore(!more)}>{more ? 'Show the main four' : `Show ${rest.length} more statuses (quality fail, duplicate, partial, technical error)`}</button>}
      </div>
    </Section>
  );
}

/** Step 3 at a glance: what each vendor on the project has saved, and what is missing. */
export function VendorRedirectsSummary({ vendors, editable }: { vendors: PolicyVendor[]; editable: boolean }) {
  const main = VENDOR_REDIRECTS.filter((r) => r.main);
  return (
    <Section help="project.vendorRedirects" title={`Vendor redirects saved on each vendor (${vendors.length})`}>
      <p className="mb-4 text-xs text-muted">
        Rules set to <b>Vendor’s saved redirect</b> use these. Change them once on the vendor and every project picks them up.
        Quality fail and duplicate reuse the security URL, partial and technical error the terminate URL, unless the vendor set its own.
      </p>
      {vendors.length === 0 ? (
        <p className="text-sm text-muted">No vendors on this project yet. Add them on the Vendors & links tab.</p>
      ) : (
        <div className="-mx-5 -mb-5 overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="border-y border-line bg-sunken/60">
              <tr><th className="th">Vendor</th>{main.map((r) => <th key={r.status} className="th">{r.label.split(' (')[0]}</th>)}<th className="th">Callback</th><th className="th" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {vendors.map((v) => (
                <tr key={v.id}>
                  <td className="td font-medium">{v.name} <span className="inline-flex items-center text-xs text-muted">{v.code}<CopyIcon text={v.code} label={`${v.name} vendor ID`} /></span></td>
                  {main.map((r) => {
                    const url = v.redirectUrls[r.status] ?? (VENDOR_FALLBACK[r.status] ? v.redirectUrls[VENDOR_FALLBACK[r.status]] : undefined);
                    return (
                      <td key={r.status} className="td max-w-[220px] truncate font-mono text-xs" title={url}>
                        {url ? <span className="flex items-center gap-1"><span className="truncate">{url.replace(/^https?:\/\//, '')}</span><CopyIcon text={url} label={`${v.name} ${STATUS_LABEL[r.status]} URL`} /></span> : <span className="font-sans text-warn">Missing</span>}
                      </td>
                    );
                  })}
                  <td className="td max-w-[160px] truncate font-mono text-xs text-muted" title={v.callbackUrlTemplate ?? ''}>{v.callbackUrlTemplate ? v.callbackUrlTemplate.replace(/^https?:\/\//, '') : '–'}</td>
                  <td className="td text-right">{editable && <Link className="inline-flex items-center gap-1 text-xs text-brand hover:underline" href={`/vendors/${v.id}`}>Edit on vendor <ExternalLink className="h-3 w-3" /></Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
