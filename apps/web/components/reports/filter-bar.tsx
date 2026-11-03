'use client';
import { countryName, flag } from '@/lib/countries';
import type { Filters, Options } from './types';

const iso = (d: Date) => d.toISOString().slice(0, 10);
export function presetRange(p: string): { from: string; to: string } {
  const today = new Date();
  const back = (days: number) => iso(new Date(today.getTime() - days * 86_400_000));
  switch (p) {
    case 'today': return { from: iso(today), to: iso(today) };
    case '7': return { from: back(6), to: iso(today) };
    case '30': return { from: back(29), to: iso(today) };
    case '90': return { from: back(89), to: iso(today) };
    case 'month': return { from: `${iso(today).slice(0, 7)}-01`, to: iso(today) };
    default: return { from: '', to: '' };
  }
}
export const PRESETS = [
  ['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['month', 'This month'], ['all', 'All time'], ['custom', 'Custom'],
] as const;
export const defaultFilters = (): Filters => ({ ...presetRange('30'), clientId: '', vendorId: '', projectId: '', countryCode: '' });

export function FilterBar({ value, onChange, options, preset, onPreset }: {
  value: Filters; onChange: (f: Filters) => void; options: Options | null; preset: string; onPreset: (p: string) => void;
}) {
  const set = (k: keyof Filters, v: string) => onChange({ ...value, [k]: v });
  const projects = options?.projects.filter((p) => !value.clientId || p.clientId === value.clientId) ?? [];
  return (
    <div className="card mb-5 grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <label className="text-xs text-muted">
        Date range
        <select className="input mt-1" value={preset} onChange={(e) => { onPreset(e.target.value); if (e.target.value !== 'custom') onChange({ ...value, ...presetRange(e.target.value) }); }}>
          {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {preset === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">From<input type="date" className="input mt-1" value={value.from} max={value.to || undefined} onChange={(e) => set('from', e.target.value)} /></label>
          <label className="text-xs text-muted">To<input type="date" className="input mt-1" value={value.to} min={value.from || undefined} onChange={(e) => set('to', e.target.value)} /></label>
        </div>
      )}
      <label className="text-xs text-muted">
        Client
        <select className="input mt-1" value={value.clientId} onChange={(e) => onChange({ ...value, clientId: e.target.value, projectId: '' })}>
          <option value="">All clients</option>
          {options?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted">
        Project
        <select className="input mt-1" value={value.projectId} onChange={(e) => set('projectId', e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.projectCode} · {p.name}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted">
        Vendor
        <select className="input mt-1" value={value.vendorId} onChange={(e) => set('vendorId', e.target.value)}>
          <option value="">All vendors</option>
          {options?.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted">
        Market
        <select className="input mt-1" value={value.countryCode} onChange={(e) => set('countryCode', e.target.value)}>
          <option value="">All markets</option>
          {options?.countries.map((c) => <option key={c} value={c}>{flag(c)} {countryName(c)}</option>)}
        </select>
      </label>
    </div>
  );
}
