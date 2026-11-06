'use client';
import clsx from 'clsx';
import { Check, ImagePlus, Monitor, Palette, PartyPopper, RotateCcw, Smartphone, Timer, Trash2, Type } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorBox, Field, Loading, Section, Toggle } from '@/components/ui';
import { api, API_URL, ApiError, get, post } from '@/lib/api';
import type { ProjectDetail } from './types';
import { Label } from '@/components/help';

type Status = 'complete' | 'terminate' | 'quota_full' | 'quality_fail' | 'duplicate' | 'security_reject' | 'partial' | 'technical_error';
type Colors = { primary: string; accent: string; background: string; surface: string; text: string };
interface StatusText { title?: string; message?: string; buttonLabel?: string; buttonUrl?: string }
interface Design {
  template: string;
  colors: Colors;
  font: string;
  radius: 'sharp' | 'soft' | 'round';
  logoAssetId?: string | null;
  heroAssetId?: string | null;
  brandName?: string;
  footer?: string;
  confetti: boolean;
  texts: Partial<Record<Status, StatusText>>;
  interstitial: { enabled: boolean; seconds: number };
}
interface Info {
  design: Design;
  custom: boolean;
  templates: string[];
  fonts: string[];
  palettes: { name: string; colors: Colors }[];
  statuses: Status[];
  defaults: Record<Status, { title: string; message: string; tone: string }>;
  assetBase: string;
}

const TEMPLATE_INFO: Record<string, { name: string; help: string }> = {
  aurora: { name: 'Aurora', help: 'Soft colour glow behind a floating card.' },
  minimal: { name: 'Minimal', help: 'Clean and quiet, lots of white space.' },
  split: { name: 'Split', help: 'Your picture on one side, message on the other.' },
  spotlight: { name: 'Spotlight', help: 'Full-width picture with the message on top.' },
  bold: { name: 'Bold', help: 'Strong brand colour band and big type.' },
  playful: { name: 'Playful', help: 'Rounded shapes and bright accents.' },
};
const FONT_NAMES: Record<string, string> = { system: 'System', humanist: 'Humanist', geometric: 'Geometric', rounded: 'Rounded', serif: 'Serif', mono: 'Mono' };
const FONT_CSS: Record<string, string> = {
  system: 'system-ui,sans-serif',
  humanist: "Seravek,'Gill Sans Nova',Ubuntu,Calibri,sans-serif",
  geometric: 'Avenir,Montserrat,Corbel,sans-serif',
  rounded: "ui-rounded,Quicksand,'Arial Rounded MT',sans-serif",
  serif: "'Iowan Old Style','Palatino Linotype',Georgia,serif",
  mono: 'ui-monospace,Menlo,Consolas,monospace',
};
const STATUS_NAMES: Record<Status, string> = {
  complete: 'Complete',
  terminate: 'Terminate',
  quota_full: 'Quota full',
  quality_fail: 'Quality fail',
  duplicate: 'Duplicate',
  security_reject: 'Security reject',
  partial: 'Partial',
  technical_error: 'Technical error',
};
const COLOR_FIELDS: { key: keyof Colors; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'surface', label: 'Card' },
  { key: 'text', label: 'Text' },
];

function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const HEX = /^#[0-9a-f]{6}$/i;

/** Sorted-key JSON so key order never counts as a change. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
}

/** Drops empty strings so defaults apply, and blank optional fields. */
function clean(d: Design): Design {
  const texts: Design['texts'] = {};
  for (const [k, t] of Object.entries(d.texts) as [Status, StatusText][]) {
    const kept = Object.fromEntries(Object.entries(t ?? {}).filter(([, v]) => typeof v === 'string' && v.trim() !== '').map(([kk, v]) => [kk, (v as string).trim()]));
    if (Object.keys(kept).length) texts[k] = kept;
  }
  const out: Design = { ...d, texts };
  if (!out.brandName?.trim()) delete out.brandName;
  if (!out.footer?.trim()) delete out.footer;
  if (!out.logoAssetId) delete out.logoAssetId;
  if (!out.heroAssetId) delete out.heroAssetId;
  return out;
}

function TemplateThumb({ id, colors, selected }: { id: string; colors: Colors; selected: boolean }) {
  const c = colors;
  const card = <div className="mx-auto h-7 w-14 rounded-sm shadow-sm" style={{ background: c.surface }}><div className="mx-auto mt-1.5 h-1 w-8 rounded" style={{ background: c.text, opacity: 0.7 }} /><div className="mx-auto mt-1 h-1.5 w-5 rounded" style={{ background: c.primary }} /></div>;
  return (
    <div className={clsx('relative h-20 overflow-hidden rounded-md border', selected ? 'border-brand ring-2 ring-brand/30' : 'border-line')} style={{ background: c.background }}>
      {id === 'aurora' && (<><div className="absolute -left-4 -top-4 h-14 w-14 rounded-full opacity-60 blur-md" style={{ background: c.primary }} /><div className="absolute -bottom-5 -right-3 h-14 w-14 rounded-full opacity-60 blur-md" style={{ background: c.accent }} /><div className="relative pt-6">{card}</div></>)}
      {id === 'minimal' && <div className="pt-6">{card}</div>}
      {id === 'split' && (<div className="flex h-full"><div className="w-2/5" style={{ background: `linear-gradient(135deg, ${c.primary}, ${c.accent})` }} /><div className="flex-1 pt-6">{card}</div></div>)}
      {id === 'spotlight' && (<><div className="absolute inset-0" style={{ background: `linear-gradient(160deg, ${c.primary}, ${c.accent})`, opacity: 0.85 }} /><div className="relative pt-6">{card}</div></>)}
      {id === 'bold' && (<><div className="h-9" style={{ background: c.primary }} /><div className="-mt-4">{card}</div></>)}
      {id === 'playful' && (<><div className="absolute left-2 top-2 h-4 w-4 rounded-full" style={{ background: c.accent }} /><div className="absolute bottom-2 right-3 h-5 w-5 rotate-12 rounded-md" style={{ background: c.primary, opacity: 0.8 }} /><div className="absolute right-6 top-3 h-2 w-2 rounded-full" style={{ background: c.primary }} /><div className="pt-6">{card}</div></>)}
      {selected && <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-brand text-brand-ink"><Check className="h-3 w-3" /></span>}
    </div>
  );
}

function ImagePicker({ label, hint, projectId, value, assetBase, editable, onChange }: { label: string; hint: string; projectId: string; value?: string | null; assetBase: string; editable: boolean; onChange: (id: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function upload(f: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const res = await fetch(`${API_URL}/api/v1/projects/${projectId}/page-assets`, { method: 'POST', body: fd, credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data?.message ?? (res.status === 413 ? 'That image is over 1.5 MB' : 'Upload failed'));
      onChange(data.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  }
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-3 rounded-lg border border-line p-2">
        <div className="grid h-14 w-20 shrink-0 place-items-center overflow-hidden rounded-md bg-sunken">
          {value ? <img src={`${assetBase}${value}`} alt="" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="h-5 w-5 text-muted" />}
        </div>
        <div className="min-w-0 flex-1 text-xs text-muted">{hint}</div>
        {editable && (
          <div className="flex shrink-0 gap-1">
            <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => ref.current?.click()}>{busy ? 'Uploading…' : value ? 'Replace' : 'Upload'}</button>
            {value && <button type="button" className="btn-ghost px-2" aria-label={`Remove ${label.toLowerCase()}`} onClick={() => onChange(null)}><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        )}
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

/** Renders the page at a real desktop or phone width, scaled down to fit the panel. */
function ScaledFrame({ html, device }: { html: string; device: 'desktop' | 'phone' }) {
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [w, h] = device === 'phone' ? [390, 780] : [1280, 860];
  const scale = avail ? Math.min(1, avail / w) : 0;
  return (
    <div ref={box} className="w-full">
      <div className="mx-auto overflow-hidden rounded-xl border border-line bg-sunken" style={{ width: w * scale || '100%', height: h * scale || 400 }}>
        {html && scale ? (
          <iframe title="Respondent page preview" sandbox="allow-scripts" srcDoc={html} className="block origin-top-left border-0 bg-white" style={{ width: w, height: h, transform: `scale(${scale})` }} />
        ) : (
          <div className="grid h-full place-items-center"><Loading label="Building preview" /></div>
        )}
      </div>
      <p className="mt-1.5 text-center text-xs text-muted">{device === 'phone' ? 'Phone, 390 px wide' : 'Desktop, 1280 px wide'}{scale && scale < 1 ? `, shown at ${Math.round(scale * 100)}%` : ''}</p>
    </div>
  );
}

export function RespondentPagesTab({ project, editable }: { project: ProjectDetail; editable: boolean }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [design, setDesign] = useState<Design | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [page, setPage] = useState<Status | 'gate'>('complete');
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  const [html, setHtml] = useState('');
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    get<Info>(`/projects/${project.id}/page-design`).then((i) => { setInfo(i); setDesign(i.design); }).catch(setLoadError);
  }, [project.id]);

  const cleaned = useMemo(() => (design ? clean(design) : null), [design]);
  const dirty = !!info && !!cleaned && stable(cleaned) !== stable(clean(info.design));
  const colorProblem = design ? COLOR_FIELDS.find((f) => !HEX.test(design.colors[f.key])) : undefined;
  const interstitialPreview = page !== 'gate' && !!design?.interstitial.enabled;

  // Live preview, debounced.
  useEffect(() => {
    if (!cleaned || colorProblem) return;
    const t = setTimeout(() => {
      post<{ html: string }>(`/projects/${project.id}/page-design/preview`, { design: cleaned, page, interstitial: interstitialPreview })
        .then((r) => { setHtml(r.html); setPreviewError(null); })
        .catch(setPreviewError);
    }, 300);
    return () => clearTimeout(t);
  }, [cleaned, page, interstitialPreview, project.id, colorProblem]);

  if (loadError) return <ErrorBox error={loadError} />;
  if (!info || !design) return <Loading />;

  const set = (patch: Partial<Design>) => { setDesign({ ...design, ...patch }); setSaved(false); };
  const setColor = (k: keyof Colors, v: string) => set({ colors: { ...design.colors, [k]: v } });
  const statusKey: Status = page === 'gate' ? 'complete' : page;
  const text = design.texts[statusKey] ?? {};
  const setText = (patch: StatusText) => set({ texts: { ...design.texts, [statusKey]: { ...text, ...patch } } });
  const ratioText = contrast(design.colors.text, design.colors.surface);
  const ratioPage = contrast(design.colors.text, design.colors.background);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await api<Info>(`/projects/${project.id}/page-design`, { method: 'PUT', json: cleaned });
      setInfo(r);
      setDesign(r.design);
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="min-w-0 space-y-6">
        <Section help="project.respondentTemplate" title={<span className="flex items-center gap-2"><Palette className="h-4 w-4 text-brand" /> Template</span>}>
          <p className="mb-3 text-sm text-muted">The look of every page respondents see for this project: the gate page and the complete, terminate, quota full and other end pages.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {info.templates.map((t) => (
              <button key={t} type="button" disabled={!editable} onClick={() => set({ template: t })} className="text-left disabled:cursor-default" aria-pressed={design.template === t}>
                <TemplateThumb id={t} colors={design.colors} selected={design.template === t} />
                <div className="mt-1.5 text-sm font-medium">{TEMPLATE_INFO[t]?.name ?? t}</div>
                <div className="text-xs text-muted">{TEMPLATE_INFO[t]?.help}</div>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Colours">
          <div className="mb-4 flex flex-wrap gap-2">
            {info.palettes.map((p) => {
              const on = stable(p.colors) === stable(design.colors);
              return (
                <button key={p.name} type="button" disabled={!editable} onClick={() => set({ colors: p.colors })} className={clsx('flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs', on ? 'border-brand bg-brand/10' : 'border-line hover:bg-sunken')}>
                  <span className="flex overflow-hidden rounded-full">
                    {[p.colors.primary, p.colors.accent, p.colors.background].map((c, i) => <span key={i} className="h-5 w-3" style={{ background: c }} />)}
                  </span>
                  {p.name}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {COLOR_FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="label">{f.label}</span>
                <span className="flex items-center gap-1.5 rounded-lg border border-line p-1">
                  <input type="color" aria-label={`${f.label} colour`} disabled={!editable} value={HEX.test(design.colors[f.key]) ? design.colors[f.key] : '#000000'} onChange={(e) => setColor(f.key, e.target.value)} className="h-7 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
                  <input aria-label={`${f.label} hex`} disabled={!editable} value={design.colors[f.key]} onChange={(e) => setColor(f.key, e.target.value.trim())} className={clsx('w-full min-w-0 bg-transparent font-mono text-xs outline-none', !HEX.test(design.colors[f.key]) && 'text-bad')} />
                </span>
              </label>
            ))}
          </div>
          {colorProblem && <p className="mt-2 text-sm text-bad">{colorProblem.label}: use a colour like #2563eb.</p>}
          {!colorProblem && (ratioText < 4.5 || ratioPage < 3) && (
            <p className="mt-2 text-sm text-warn">
              Text may be hard to read: contrast is {ratioText.toFixed(1)}:1 on the card{ratioPage < 3 ? ` and ${ratioPage.toFixed(1)}:1 on the background` : ''}. Aim for 4.5:1 or more.
            </p>
          )}
        </Section>

        <Section help="project.respondentType" title={<span className="flex items-center gap-2"><Type className="h-4 w-4 text-brand" /> Type and shape</span>}>
          <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {info.fonts.map((f) => (
              <button key={f} type="button" disabled={!editable} onClick={() => set({ font: f })} className={clsx('rounded-lg border p-2 text-center', design.font === f ? 'border-brand bg-brand/10' : 'border-line hover:bg-sunken')}>
                <div className="text-lg leading-tight" style={{ fontFamily: FONT_CSS[f] }}>Aa</div>
                <div className="text-xs text-muted">{FONT_NAMES[f] ?? f}</div>
              </button>
            ))}
          </div>
          <Label>Corners</Label>
          <div className="flex gap-2">
            {(['sharp', 'soft', 'round'] as const).map((r) => (
              <button key={r} type="button" disabled={!editable} onClick={() => set({ radius: r })} className={clsx('flex items-center gap-2 border px-3 py-1.5 text-sm capitalize', r === 'sharp' ? 'rounded-none' : r === 'soft' ? 'rounded-lg' : 'rounded-full', design.radius === r ? 'border-brand bg-brand/10' : 'border-line hover:bg-sunken')}>
                {r}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Brand and images">
          <div className="space-y-4">
            <Field label="Brand name" hint="Shown at the top of every page, next to the logo.">
              <input className="input" maxLength={60} disabled={!editable} value={design.brandName ?? ''} placeholder="e.g. Opinion Circle" onChange={(e) => set({ brandName: e.target.value })} />
            </Field>
            <ImagePicker label="Logo" hint="PNG, JPEG, WebP or GIF up to 1.5 MB. A transparent PNG works best." projectId={project.id} value={design.logoAssetId} assetBase={info.assetBase} editable={editable} onChange={(id) => set({ logoAssetId: id })} />
            <ImagePicker label="Hero picture" hint="Shown by the Split and Spotlight templates." projectId={project.id} value={design.heroAssetId} assetBase={info.assetBase} editable={editable} onChange={(id) => set({ heroAssetId: id })} />
            <Field label="Footer" hint="Small print at the bottom, such as a privacy note or support email.">
              <input className="input" maxLength={200} disabled={!editable} value={design.footer ?? ''} onChange={(e) => set({ footer: e.target.value })} />
            </Field>
          </div>
        </Section>

        <Section title="Words on each page">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {info.statuses.map((s) => (
              <button key={s} type="button" onClick={() => setPage(s)} className={clsx('chip border', page === s ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted hover:bg-sunken', design.texts[s] && 'font-semibold')}>
                {STATUS_NAMES[s]}{design.texts[s] ? ' •' : ''}
              </button>
            ))}
          </div>
          {page === 'gate' ? (
            <p className="text-sm text-muted">The gate page uses your questions from the Gate &amp; security tab. Pick an end page above to change its words.</p>
          ) : (
            <div className="space-y-3">
              <Field label="Heading">
                <input className="input" maxLength={120} disabled={!editable} value={text.title ?? ''} placeholder={info.defaults[statusKey].title} onChange={(e) => setText({ title: e.target.value })} />
              </Field>
              <Field label="Message">
                <textarea className="input min-h-20" maxLength={600} disabled={!editable} value={text.message ?? ''} placeholder={info.defaults[statusKey].message} onChange={(e) => setText({ message: e.target.value })} />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Button label (optional)">
                  <input className="input" maxLength={40} disabled={!editable} value={text.buttonLabel ?? ''} placeholder="e.g. Visit our website" onChange={(e) => setText({ buttonLabel: e.target.value })} />
                </Field>
                <Field label="Button link" hint="Must start with https://">
                  <input className="input" disabled={!editable} value={text.buttonUrl ?? ''} placeholder="https://" onChange={(e) => setText({ buttonUrl: e.target.value })} />
                </Field>
              </div>
              {design.texts[statusKey] && editable && (
                <button type="button" className="btn-ghost text-xs" onClick={() => { const { [statusKey]: _drop, ...rest } = design.texts; set({ texts: rest }); }}>
                  <RotateCcw className="h-3.5 w-3.5" /> Use default words
                </button>
              )}
            </div>
          )}
        </Section>

        <Section title="Extras">
          <ul className="divide-y divide-line rounded-lg border border-line">
            <li className="flex items-start gap-3 p-3">
              <PartyPopper className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">Confetti on complete</div><div className="text-xs text-muted">A short burst of confetti in your colours. Skipped for people who turn off motion.</div></div>
              {editable ? <Toggle checked={design.confetti} onChange={(v) => set({ confetti: v })} label="Confetti on complete" /> : <span className="text-xs text-muted">{design.confetti ? 'On' : 'Off'}</span>}
            </li>
            <li className="flex items-start gap-3 p-3">
              <Timer className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Show this page before the vendor redirect</div>
                <div className="text-xs text-muted">When a vendor has its own return link, respondents see your page first, then move on automatically.</div>
                {design.interstitial.enabled && (
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    Continue after
                    <input type="number" min={0} max={15} className="input w-20 py-1" disabled={!editable} value={design.interstitial.seconds} onChange={(e) => set({ interstitial: { ...design.interstitial, seconds: Math.max(0, Math.min(15, Number(e.target.value) || 0)) } })} />
                    seconds
                  </label>
                )}
              </div>
              {editable ? <Toggle checked={design.interstitial.enabled} onChange={(v) => set({ interstitial: { ...design.interstitial, enabled: v } })} label="Show this page before the vendor redirect" /> : <span className="text-xs text-muted">{design.interstitial.enabled ? 'On' : 'Off'}</span>}
            </li>
          </ul>
        </Section>

        {editable && (dirty || saved || !!error) && (
          <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel p-3 shadow-lg">
            <button className="btn-primary" disabled={!dirty || saving || !!colorProblem} onClick={save}>{saving ? 'Saving…' : 'Save page design'}</button>
            {dirty && <span className="text-sm text-muted">Unsaved changes</span>}
            {!dirty && saved && <span className="text-sm text-ok">Saved. New respondents see this design now.</span>}
            <div className="w-full"><ErrorBox error={error} /></div>
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="xl:sticky xl:top-4">
          <Section
            help="project.respondentPreview"
            title="Live preview"
            actions={
              <div className="flex rounded-lg border border-line p-0.5">
                {(['desktop', 'phone'] as const).map((d) => (
                  <button key={d} type="button" aria-label={`${d} preview`} aria-pressed={device === d} onClick={() => setDevice(d)} className={clsx('rounded-md px-2 py-1', device === d ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>
                    {d === 'desktop' ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            }
          >
            <div className="mb-3 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setPage('gate')} className={clsx('chip border', page === 'gate' ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted hover:bg-sunken')}>Gate page</button>
              {info.statuses.map((s) => (
                <button key={s} type="button" onClick={() => setPage(s)} className={clsx('chip border', page === s ? 'border-brand bg-brand/10 text-brand' : 'border-line text-muted hover:bg-sunken')}>{STATUS_NAMES[s]}</button>
              ))}
            </div>
            <ScaledFrame html={html} device={device} />
            {interstitialPreview && <p className="mt-2 text-xs text-muted">Showing the countdown respondents see before the vendor redirect. It does not move on in the preview.</p>}
            <ErrorBox error={previewError} />
          </Section>
        </div>
      </div>
    </div>
  );
}
