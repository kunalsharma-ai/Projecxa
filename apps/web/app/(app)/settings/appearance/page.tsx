'use client';
import clsx from 'clsx';
import { Check, Info, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { MODES } from '@/components/shell/theme-menu';
import { useTheme } from '@/components/theme';
import { OutcomeChip, PageHeader, Progress, Section } from '@/components/ui';
import { THEMES, type Preferences } from '@/lib/theme';

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="inline-flex flex-wrap gap-1 rounded-lg bg-sunken p-1" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} title={o.hint} onClick={() => onChange(o.id)}
            className={clsx('rounded-md px-3 py-1.5 text-sm transition-colors duration-[var(--dur)]', value === o.id ? 'bg-panel font-medium text-ink shadow-sm' : 'text-muted hover:text-ink')}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Slider({ label, value, min = 0, max = 100, unit = '%', onChange }: { label: string; value: number; min?: number; max?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="label flex justify-between"><span>{label}</span><span className="tabular-nums">{value}{unit}</span></span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[rgb(var(--brand))]" />
    </label>
  );
}

function ColourField({ label, value, fallback, onChange }: { label: string; value: string | null; fallback: string; onChange: (v: string | null) => void }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} value={value ?? fallback} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border border-line bg-panel p-1" />
        <code className="text-xs text-muted">{(value ?? fallback).toUpperCase()}</code>
        {value ? <button className="text-xs text-brand hover:underline" onClick={() => onChange(null)}>Use theme colour</button> : <span className="text-xs text-muted">from theme</span>}
      </div>
    </div>
  );
}

export default function ThemeStudio() {
  const { prefs, update, reset, adjusted, saving } = useTheme();
  const [confirmReset, setConfirmReset] = useState(false);
  const theme = THEMES.find((t) => t.id === prefs.theme) ?? THEMES[0];
  const dark = prefs.mode === 'dark' || (prefs.mode === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const pal = dark ? theme.dark : theme.light;
  const set = <K extends keyof Preferences>(k: K) => (v: Preferences[K]) => update({ [k]: v } as Partial<Preferences>);

  return (
    <>
      <PageHeader
        title="Theme Studio"
        subtitle={<>Your personal look and feel. Changes apply instantly and are saved to your profile{saving ? '…' : '.'} Other people in your organization keep their own theme.</>}
        actions={
          confirmReset ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">Reset everything?</span>
              <button className="btn-danger py-1.5" onClick={async () => { await reset(); setConfirmReset(false); }}>Reset</button>
              <button className="btn-ghost py-1.5" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          ) : (
            <button className="btn-ghost" onClick={() => setConfirmReset(true)}><RotateCcw className="h-4 w-4" /> Reset to defaults</button>
          )
        }
      />

      {adjusted.length > 0 && (
        <div className="mb-5 flex gap-2 rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-ink" role="status">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <div>{adjusted.map((a) => <p key={a}>{a}</p>)}</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Section title="Theme">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => {
                const p = dark ? t.dark : t.light;
                const on = prefs.theme === t.id;
                return (
                  <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => update({ theme: t.id, accent: null, accent2: null })}
                    className={clsx('group overflow-hidden border text-left transition-[transform,box-shadow] duration-[var(--dur)] hover:-translate-y-0.5 hover:shadow-md', on ? 'border-brand ring-2 ring-brand/30' : 'border-line')}
                    style={{ borderRadius: 'var(--radius)' }}>
                    <div className="flex h-16" style={{ background: p.bg }} aria-hidden>
                      <div className="w-1/4" style={{ background: p.sidebar }} />
                      <div className="flex flex-1 flex-col justify-center gap-1.5 px-3">
                        <div className="h-2 w-3/4 rounded-full" style={{ background: p.brand }} />
                        <div className="h-2 w-1/2 rounded-full" style={{ background: p.accent2 }} />
                        <div className="h-2 w-2/3 rounded-full" style={{ background: p.panel, outline: `1px solid ${p.muted}33` }} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-panel px-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{t.name}</div>
                        <div className="truncate text-xs text-muted">{t.mood}</div>
                      </div>
                      {on && <Check className="h-4 w-4 shrink-0 text-brand" />}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-5">
              <Segmented label="Mode" value={prefs.mode} options={MODES.map((m) => ({ id: m.id, label: m.label }))} onChange={set('mode')} />
            </div>
          </Section>

          <Section title="Colours">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <ColourField label="Primary accent" value={prefs.accent} fallback={pal.brand} onChange={set('accent')} />
              <ColourField label="Secondary accent" value={prefs.accent2} fallback={pal.accent2} onChange={set('accent2')} />
              <ColourField label="Application background" value={prefs.background} fallback={pal.bg} onChange={set('background')} />
              <ColourField label="Card background" value={prefs.card} fallback={pal.panel} onChange={set('card')} />
            </div>
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Segmented label="Sidebar" value={prefs.sidebar} onChange={set('sidebar')} options={[{ id: 'theme', label: 'Theme' }, { id: 'panel', label: 'Light card' }, { id: 'contrast', label: 'High contrast' }]} />
              <Segmented label="Chart palette" value={prefs.chartPalette} onChange={set('chartPalette')} options={[{ id: 'theme', label: 'Theme' }, { id: 'ocean', label: 'Ocean' }, { id: 'vivid', label: 'Vivid' }, { id: 'mono', label: 'Mono' }]} />
              <Slider label="Border intensity" value={prefs.borderIntensity} onChange={set('borderIntensity')} />
              <Slider label="Gradient intensity" value={prefs.gradientIntensity} onChange={set('gradientIntensity')} />
              <Slider label="Glass effect (top bar, menus, panels)" value={prefs.glass} onChange={set('glass')} />
            </div>
            <p className="mt-4 text-xs text-muted">Text colours are checked against WCAG 2.2 AA. If a colour you pick would be hard to read, SampTrek adjusts the text shade and tells you.</p>
          </Section>

          <Section title="Layout and comfort">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Segmented label="Font size" value={prefs.fontSize} onChange={set('fontSize')} options={[{ id: 'sm', label: 'Small' }, { id: 'md', label: 'Default' }, { id: 'lg', label: 'Large' }, { id: 'xl', label: 'Extra large' }]} />
              <Segmented label="Density" value={prefs.density} onChange={set('density')} options={[{ id: 'compact', label: 'Compact' }, { id: 'comfortable', label: 'Comfortable' }, { id: 'spacious', label: 'Spacious' }]} />
              <Slider label="Corner radius" value={prefs.radius} min={0} max={24} unit="px" onChange={set('radius')} />
              <Segmented label="Sidebar width" value={prefs.sidebarCollapsed ? 'compact' : 'expanded'} onChange={(v) => update({ sidebarCollapsed: v === 'compact' })} options={[{ id: 'expanded', label: 'Expanded' }, { id: 'compact', label: 'Icons only' }]} />
            </div>
          </Section>

          <Section title="Motion">
            <Segmented label="Animation level" value={prefs.motion} onChange={set('motion')} options={[
              { id: 'essential', label: 'Essential', hint: 'No animation, fastest response' },
              { id: 'refined', label: 'Refined', hint: 'Short transitions and feedback (default)' },
              { id: 'cinematic', label: 'Cinematic', hint: 'Richer, slower transitions' },
            ]} />
            <p className="mt-3 text-sm text-muted">
              {prefs.motion === 'essential' ? 'No transitions or animations. Everything responds instantly.' : prefs.motion === 'refined' ? 'Short transitions on pages, menus and buttons. Nothing ever waits for an animation.' : 'Longer, richer transitions on pages, panels and charts. Typing and saving are never delayed.'}
              {' '}If your device asks for reduced motion, SampTrek follows it whatever you choose here.
            </p>
          </Section>
        </div>

        <div className="xl:sticky xl:top-20 xl:self-start">
          <Section title="Live preview">
            <div className="space-y-4">
              <div className="flex overflow-hidden border border-line" style={{ borderRadius: 'var(--radius)' }}>
                <div className="w-24 space-y-1.5 bg-sidebar p-2.5 text-[11px] text-sidebar-muted">
                  <div className="font-semibold text-sidebar-ink">SampTrek</div>
                  <div className="rounded bg-sidebar-ink/10 px-1.5 py-1 text-sidebar-ink">Projects</div>
                  <div className="px-1.5">Reports</div>
                  <div className="px-1.5">Vendors</div>
                </div>
                <div className="flex-1 space-y-2 bg-bg p-3">
                  <div className="card accent-edge p-3">
                    <div className="text-[11px] text-muted">Completes</div>
                    <div className="text-lg font-semibold tabular-nums">1,284</div>
                    <div className="mt-1 flex h-8 items-end gap-1" aria-hidden>
                      {[40, 65, 50, 80, 72, 95, 60].map((h, i) => <div key={i} className="flex-1 rounded-t-[3px] bg-chart-1" style={{ height: `${h}%`, opacity: i === 5 ? 1 : 0.75 }} />)}
                    </div>
                  </div>
                </div>
              </div>
              <div className="overflow-hidden border border-line" style={{ borderRadius: 'var(--radius)' }}>
                <table className="w-full">
                  <thead className="bg-sunken/60"><tr><th className="th">UID</th><th className="th">Status</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    <tr><td className="td font-mono text-xs">DEMO-A-US-001</td><td className="td"><OutcomeChip status="COMPLETE" /></td></tr>
                    <tr><td className="td font-mono text-xs">DEMO-A-US-002</td><td className="td"><OutcomeChip status="QUOTA_FULL" /></td></tr>
                    <tr><td className="td font-mono text-xs">DEMO-B-GB-003</td><td className="td"><OutcomeChip status="SECURITY_REJECT" /></td></tr>
                  </tbody>
                </table>
              </div>
              <label className="block">
                <span className="label">Sample field</span>
                <input className="input" placeholder="Type to try the focus ring" />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn-primary">Primary</button>
                <button className="btn-ghost">Secondary</button>
                <a className="text-sm text-brand hover:underline" href="#preview">A link</a>
              </div>
              <Progress value={36} max={50} />
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
