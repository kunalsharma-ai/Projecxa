'use client';
import { Bookmark, FileDown, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { presetRange, PRESETS } from './filter-bar';
import { filterQuery, type Filters } from './types';

export interface SavedView { id: string; name: string; tab: string; period: string; filters: Partial<Filters>; shared: boolean; owner: string; mine: boolean; canEdit: boolean }

/** Which PDF each tab downloads. Conversion and Clicks are respondent lists: CSV only. */
const PDF_REPORT: Record<string, string | undefined> = { Overall: 'overall', Clients: 'client', Vendors: 'vendor' };
const periodLabel = (p: string) => PRESETS.find(([k]) => k === p)?.[1] ?? p;

/** Builds the filters a view stands for today: relative periods move with the calendar. */
export function viewFilters(v: SavedView): Filters {
  const range = v.period === 'custom' ? { from: v.filters.from ?? '', to: v.filters.to ?? '' } : presetRange(v.period);
  return { clientId: v.filters.clientId ?? '', vendorId: v.filters.vendorId ?? '', projectId: v.filters.projectId ?? '', countryCode: v.filters.countryCode ?? '', ...range };
}

export function ViewsBar({ tab, filters, preset, current, onApply }: {
  tab: string; filters: Filters; preset: string; current: string | null; onApply: (v: SavedView | null) => void;
}) {
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = () => get<SavedView[]>('/reports/views').then(setViews).catch(setError);
  useEffect(() => { load(); }, []);
  const view = views?.find((v) => v.id === current) ?? null;
  const canSave = tab !== 'Answers';

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const f = Object.fromEntries(Object.entries(filters).filter(([k, v]) => v && (preset === 'custom' || (k !== 'from' && k !== 'to'))));
      const v = await post<SavedView>('/reports/views', { name: name.trim(), tab, period: preset, filters: f, shared });
      setSaving(false);
      setName('');
      setShared(false);
      await load();
      onApply(v);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove(v: SavedView) {
    if (!confirm(`Delete the view “${v.name}”?${v.shared ? ' Everyone who uses it loses it too.' : ''}`)) return;
    try {
      await api(`/reports/views/${v.id}`, { method: 'DELETE' });
      onApply(null);
      await load();
    } catch (e) {
      setError(e);
    }
  }
  async function pdf() {
    setBusy(true);
    setError(null);
    try {
      const title = view?.name ?? `${tab === 'Overall' ? 'Overall' : tab === 'Clients' ? 'Client' : 'Vendor'} report`;
      await downloadFile(`/reports/pdf${filterQuery(filters, { report: PDF_REPORT[tab], title, tz: Intl.DateTimeFormat().resolvedOptions().timeZone })}`, 'report.pdf');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const mine = views?.filter((v) => v.mine) ?? [];
  const team = views?.filter((v) => !v.mine) ?? [];
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 items-center gap-2 text-sm">
          <Bookmark className="h-4 w-4 shrink-0 text-muted" />
          <span className="sr-only">Saved view</span>
          <select className="input w-60 max-w-full py-1.5" aria-label="Saved view" value={current ?? ''} onChange={(e) => onApply(views?.find((v) => v.id === e.target.value) ?? null)}>
            <option value="">{views?.length ? 'Saved views…' : 'No saved views yet'}</option>
            {mine.length > 0 && <optgroup label="Mine">{mine.map((v) => <option key={v.id} value={v.id}>{v.name}{v.shared ? ' (shared)' : ''}</option>)}</optgroup>}
            {team.length > 0 && <optgroup label="Shared with the team">{team.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.owner}</option>)}</optgroup>}
          </select>
        </label>
        {view && <span className="text-xs text-muted">{view.tab} · {periodLabel(view.period)}{view.shared && <><Users className="mb-0.5 ml-1.5 inline h-3.5 w-3.5" /> shared</>}</span>}
        {view?.canEdit && <button className="btn-ghost h-8 px-2 text-xs text-bad" onClick={() => remove(view)} aria-label={`Delete view ${view.name}`}><Trash2 className="h-3.5 w-3.5" /></button>}
        <div className="ml-auto flex flex-wrap gap-2">
          {canSave && <button className="btn-ghost h-9" onClick={() => setSaving(!saving)}><Bookmark className="h-4 w-4" />Save view</button>}
          <button className="btn-ghost h-9" disabled={!PDF_REPORT[tab] || busy} title={PDF_REPORT[tab] ? undefined : 'PDF is available on the Overall, Clients and Vendors tabs. Use CSV here.'} onClick={pdf}>
            <FileDown className="h-4 w-4" />{busy ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </div>
      {saving && (
        <div className="card mt-2 flex flex-wrap items-end gap-3 p-3">
          <label className="block min-w-[14rem] flex-1 text-xs text-muted">
            Name
            <input className="input mt-1" autoFocus maxLength={80} value={name} placeholder={`${tab} · ${periodLabel(preset)}`} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />Share with the team</label>
          <p className="basis-full text-xs text-muted">Saves the {tab} tab, {preset === 'custom' ? 'these exact dates' : `“${periodLabel(preset)}” (it moves with the calendar)`} and the client, project, vendor and market filters.</p>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setSaving(false)}>Cancel</button>
            <button className="btn-primary" disabled={!name.trim() || busy} onClick={save}>Save</button>
          </div>
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
