'use client';
import clsx from 'clsx';
import { CheckCircle2, Copy, Globe, ImageUp, Mail, RefreshCw, Trash2 } from 'lucide-react';
import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import { BrandIcon, BrandLogo } from '@/components/brand-mark';
import { FormField } from '@/components/form/field';
import { SmartForm, type FormSchema, type Values } from '@/components/form/smart-form';
import { useMe } from '@/components/me';
import { ErrorBox, Loading, PageHeader, Section } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import type { Brand } from '@/lib/branding';
import { THEMES } from '@/lib/theme';

type Kind = 'logo' | 'logoDark' | 'icon';
interface Settings { appName: string | null; tagline: string | null; brandColor: string | null; theme: string | null; hidePoweredBy: boolean; supportEmail: string | null; emailFromName: string | null; emailReplyTo: string | null; loginMessage: string | null }
interface Domain { name: string; verified: boolean; verifiedAt: string | null; record: { type: string; name: string; value: string } | null; cname: string }
interface Data { branding: Settings; brand: Brand & { organization: { name: string; slug: string } }; assets: Record<Kind, string | null>; maxAssetBytes: number; domain: Domain | null; webBase: string }

const ASSETS: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'logo', label: 'Logo', hint: 'Sign-in pages, portal header and emails. A wide PNG with a transparent background works best (about 480 × 120).' },
  { kind: 'logoDark', label: 'Logo for dark mode', hint: 'Optional. Shown instead of the logo when someone uses a dark theme.' },
  { kind: 'icon', label: 'Icon', hint: 'Square, at least 128 × 128. Used in the sidebar and as the browser tab icon.' },
];

const schema = (canEdit: boolean): FormSchema => ({
  sections: [
    {
      title: 'Name and words',
      columns: 2,
      fields: [
        { name: 'appName', type: 'text', label: 'Product name', placeholder: 'PROJEXA', minLength: 2, maxLength: 40, hint: 'Replaces “PROJEXA” in the app, sign-in pages, emails and authenticator apps. Leave empty to keep PROJEXA.' },
        { name: 'tagline', type: 'text', label: 'Tagline', maxLength: 80, placeholder: 'Fieldwork by Acme' },
        { name: 'loginMessage', type: 'textarea', label: 'Sign-in message', maxLength: 300, span: 'full', hint: 'Shown under “Sign in” on your custom domain.', props: { rows: 2 } },
        { name: 'supportEmail', type: 'email', label: 'Support email', hint: 'Shown in portal footers and at the end of invitation emails.' },
        { name: 'hidePoweredBy', type: 'switch', label: 'Powered by', props: { switchLabel: 'Hide “Powered by Sampledge PROJEXA”', description: 'In the client and vendor portals.' } },
      ],
    },
    {
      title: 'Look',
      description: 'The starting theme and accent for everyone in your organisation. People can still choose their own in Theme Studio.',
      columns: 2,
      fields: [
        { name: 'theme', type: 'select', label: 'Default theme', placeholder: 'Keep the PROJEXA default', options: THEMES.map((t) => ({ value: t.id, label: t.name, hint: t.mood })) },
        { name: 'brandColor', type: 'color', label: 'Brand colour', hint: 'Buttons, links and highlights. Text colours are adjusted if needed so they stay readable.' },
      ],
    },
    {
      title: 'Email',
      columns: 2,
      fields: [
        { name: 'emailFromName', type: 'text', label: 'Sender name', maxLength: 60, placeholder: 'Defaults to the product name', hint: 'The address stays the server’s sending address, so emails keep passing spam checks.' },
        { name: 'emailReplyTo', type: 'email', label: 'Reply-to address', hint: 'Where replies to invitations, reports and portal emails go.' },
      ],
    },
  ].map((s) => (canEdit ? s : { ...s, fields: s.fields.map((f) => ({ ...f, props: { ...('props' in f ? f.props : {}), disabled: true } })) })) as FormSchema['sections'],
});

export default function BrandingPage() {
  const me = useMe();
  const admin = me?.user.role === 'ADMIN';
  const [data, setData] = useState<Data | null>(null);
  const [live, setLive] = useState<Values>({});
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(async () => { const d = await get<Data>('/branding'); setData(d); setDomain(d.domain?.name ?? ''); return d; }, []);
  useEffect(() => { load().catch(setError); }, [load]);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setError(null); setNote(null);
    try { await fn(); } catch (e) { setError(e); } finally { setBusy(null); }
  };
  const save = (v: Values) => run('save', async () => {
    const body = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' ? x.trim() || null : x]));
    setData(await api<Data>('/branding', { method: 'PUT', json: body }));
    setNote('Branding saved. Reload the page to see the new name and colours everywhere.');
  });
  const upload = (kind: Kind, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void run(kind, async () => {
      const fd = new FormData();
      fd.append('file', file);
      setData(await api<Data>(`/branding/assets/${kind}`, { method: 'POST', body: fd }));
    });
  };
  const removeAsset = (kind: Kind) => run(kind, async () => { setData(await api<Data>(`/branding/assets/${kind}`, { method: 'DELETE' })); });
  const saveDomain = () => run('domain', async () => { setData(await api<Data>('/branding/domain', { method: 'PUT', json: { domain } })); });
  const verify = () => run('verify', async () => {
    const r = await post<Data & { verified: boolean; found: number }>('/branding/domain/verify');
    setData(r);
    setNote(r.verified ? `${r.domain?.name} is verified. Sign-in pages and email links now use it.` : r.found ? 'A verification record was found, but its value does not match. Check it and try again.' : 'The TXT record was not found yet. DNS changes can take up to an hour.');
  });
  const removeDomain = () => { if (confirm('Stop using this domain? Email links go back to the main app address.')) void run('domain', async () => { setData(await api<Data>('/branding/domain', { method: 'DELETE' })); }); };

  if (!data) return <><PageHeader title="Branding" /><ErrorBox error={error} />{!error && <Loading />}</>;
  const s = data.branding;
  const preview: Brand = {
    ...data.brand,
    appName: (typeof live.appName === 'string' && live.appName.trim()) || 'PROJEXA',
    custom: typeof live.appName === 'string' ? !!live.appName.trim() : data.brand.custom,
    brandColor: (live.brandColor as string) || null,
  };
  const color = /^#[0-9a-f]{6}$/i.test(preview.brandColor ?? '') ? preview.brandColor! : undefined;

  return (
    <>
      <PageHeader title="Branding" subtitle="Show your own name, logo and colours to your team, clients and vendors, and use your own web address. Respondent pages stay neutral." />
      <ErrorBox error={error} />
      {note && <div className="mb-4 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">{note}</div>}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Section title="Brand">
            {admin ? (
              <SmartForm key={formKey} schema={schema(true)} submitLabel="Save branding" onChange={setLive} onSubmit={save} onCancel={() => setFormKey((k) => k + 1)}
                initial={{ appName: s.appName ?? '', tagline: s.tagline ?? '', loginMessage: s.loginMessage ?? '', supportEmail: s.supportEmail ?? '', hidePoweredBy: s.hidePoweredBy, theme: s.theme, brandColor: s.brandColor ?? '', emailFromName: s.emailFromName ?? '', emailReplyTo: s.emailReplyTo ?? '' }} />
            ) : <p className="text-sm text-muted">Only admins can change branding. Current product name: <strong>{data.brand.appName}</strong>.</p>}
          </Section>

          <Section title={<span className="flex items-center gap-2"><ImageUp className="h-4 w-4 text-brand" /> Logo and icon</span>}>
            <div className="grid gap-4 md:grid-cols-3">
              {ASSETS.map((a) => {
                const url = data.assets[a.kind];
                return (
                  <FormField key={a.kind} label={a.label} hint={a.hint}>
                    <div className={clsx('grid h-28 place-items-center rounded-lg border border-dashed border-line p-3', a.kind === 'logoDark' ? 'bg-[#0f172a]' : 'bg-sunken/40')}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {url ? <img src={url} alt={a.label} className={clsx('max-h-full max-w-full object-contain', a.kind === 'icon' && 'h-16 w-16 rounded-xl')} /> : <span className={clsx('text-xs', a.kind === 'logoDark' ? 'text-white/60' : 'text-muted')}>None yet</span>}
                    </div>
                    {admin && (
                      <div className="mt-2 flex gap-2">
                        <label className={clsx('btn-ghost h-8 cursor-pointer px-2.5 text-xs', busy === a.kind && 'pointer-events-none opacity-60')}>
                          <ImageUp className="h-3.5 w-3.5" />{busy === a.kind ? 'Uploading…' : url ? 'Replace' : 'Upload'}
                          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => upload(a.kind, e)} />
                        </label>
                        {url && <button type="button" className="btn-ghost h-8 px-2.5 text-xs text-bad" onClick={() => removeAsset(a.kind)} aria-label={`Remove ${a.label.toLowerCase()}`}><Trash2 className="h-3.5 w-3.5" /></button>}
                      </div>
                    )}
                  </FormField>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-muted">PNG, JPEG or WebP, up to {Math.round(data.maxAssetBytes / 1024)} KB. SVG is not accepted, because images are shown on public pages and in emails.</p>
          </Section>

          <Section title={<span className="flex items-center gap-2"><Globe className="h-4 w-4 text-brand" /> Custom domain</span>}>
            <p className="mb-4 text-sm text-muted">Let your team, clients and vendors sign in at your own address, for example <span className="font-mono">research.yourcompany.com</span>. Invitation, report and portal emails then link there too.</p>
            {admin && (
              <div className="flex flex-wrap items-end gap-2">
                <FormField label="Domain" className="min-w-[16rem] flex-1"><input className="input font-mono" placeholder="research.yourcompany.com" value={domain} onChange={(e) => setDomain(e.target.value)} /></FormField>
                <button className="btn-ghost" disabled={!domain.trim() || busy === 'domain' || domain.trim().toLowerCase() === data.domain?.name} onClick={saveDomain}>{data.domain ? 'Change' : 'Add domain'}</button>
              </div>
            )}
            {data.domain && (
              <div className="mt-4 rounded-lg border border-line">
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                  <span className="font-mono text-sm">{data.domain.name}</span>
                  {data.domain.verified
                    ? <span className="chip bg-ok/15 text-ok"><CheckCircle2 className="h-3.5 w-3.5" /> Verified</span>
                    : <span className="chip bg-warn/15 text-warn">Waiting for DNS</span>}
                  {admin && (
                    <span className="ml-auto flex gap-2">
                      {!data.domain.verified && <button className="btn-primary h-8 px-3 text-xs" disabled={busy === 'verify'} onClick={verify}><RefreshCw className={clsx('h-3.5 w-3.5', busy === 'verify' && 'animate-spin')} /> Check DNS</button>}
                      <button className="btn-ghost h-8 px-2.5 text-xs text-bad" onClick={removeDomain} aria-label="Remove domain"><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                  )}
                </div>
                <div className="px-4 py-3 text-sm">
                  <p className="mb-2 text-muted">Add these records at your DNS provider:</p>
                  <dl className="divide-y divide-line rounded-lg border border-line">
                    {[{ type: 'CNAME', name: data.domain.name, value: data.domain.cname }, ...(data.domain.record ? [data.domain.record] : [])].map((r) => (
                      <div key={r.type} className="grid gap-x-4 gap-y-1 px-3 py-2.5 font-mono text-xs sm:grid-cols-[4rem_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-center">
                        <dt className="font-sans font-semibold text-muted">{r.type}</dt>
                        <dd className="break-all"><span className="font-sans text-muted sm:hidden">Name: </span>{r.name}</dd>
                        <dd className="break-all"><span className="font-sans text-muted sm:hidden">Value: </span>{r.value}</dd>
                        <dd><CopyBtn text={r.value} /></dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2 text-xs text-muted">The CNAME sends visitors to PROJEXA; your server administrator also adds the domain to the HTTPS certificate. The TXT record proves the domain is yours. The domain is used only after it is verified.</p>
                </div>
              </div>
            )}
          </Section>
        </div>

        <div className="min-w-0 space-y-6 xl:sticky xl:top-20 xl:self-start">
          <Section title="Preview">
            <div className="space-y-4" style={color ? ({ '--brand': hexToRgb(color) } as React.CSSProperties) : undefined}>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">Sidebar</p>
                <div className="flex items-center gap-2.5 rounded-lg bg-sidebar px-3 py-3 text-sidebar-ink">
                  <BrandIcon brand={preview} />
                  <span className="truncate font-semibold tracking-tight">{preview.custom ? preview.appName : <>PROJEXA <span className="text-xs font-normal text-sidebar-muted">by Sampledge</span></>}</span>
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">Sign-in page</p>
                <div className="card space-y-3 p-5">
                  <BrandLogo brand={preview} />
                  <div className="text-lg font-semibold tracking-tight">Sign in to {preview.appName}</div>
                  {typeof live.loginMessage === 'string' && live.loginMessage && <p className="text-xs text-muted">{live.loginMessage}</p>}
                  <div className="h-8 rounded-md border border-line" />
                  <div className="h-8 rounded-md bg-brand" />
                </div>
              </div>
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><Mail className="h-3.5 w-3.5" /> Invitation email</p>
                <div className="rounded-lg border border-line bg-white p-4 text-[13px] text-slate-900">
                  <div className="text-slate-500">From: <strong className="text-slate-900">{(live.emailFromName as string) || (preview.custom ? preview.appName : 'PROJEXA')}</strong></div>
                  <div className="mb-3 text-slate-500">Subject: You&apos;re invited to {data.brand.organization.name} on {preview.appName}</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {data.assets.logo ? <img src={data.assets.logo} alt="" className="mb-3 h-7" /> : <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: color ?? '#1d4ed8' }}>{preview.custom ? preview.appName : 'Sampledge · PROJEXA'}</div>}
                  <span className="inline-block rounded-md px-3 py-1.5 font-semibold text-white" style={{ background: color ?? '#1d4ed8' }}>Choose a password</span>
                  <div className="mt-2 break-all text-[11px] text-slate-500">{data.webBase}/set-password?token=…</div>
                </div>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="rounded p-1 text-muted hover:text-ink" aria-label={`Copy ${text}`} onClick={() => { void navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>{done ? <CheckCircle2 className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}</button>;
}

/** "#1d4ed8" → "29 78 216", the format the theme's colour variables use. */
function hexToRgb(h: string) {
  const n = parseInt(h.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
