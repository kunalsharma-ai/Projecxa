'use client';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, EyeOff, GripVertical, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export type WidgetSize = 'third' | 'half' | 'two-thirds' | 'full';
export interface WidgetPlace { id: string; size: WidgetSize; hidden: boolean }

export const WIDGET_NAMES: Record<string, string> = {
  kpis: 'Key numbers',
  trend: 'Revenue, payout and profit',
  waterfall: 'Revenue to profit',
  map: 'Markets map',
  finance: 'Reconciliation and invoicing',
  payables: 'Vendor payables',
  'top-vendors': 'Top 5 vendors',
  'top-projects': 'Top 5 projects',
  'top-clients': 'Top 5 clients',
  'live-projects': 'Live projects',
  health: 'Fieldwork health',
  heatmap: 'Traffic by hour',
  workspace: 'Workspace',
};
const SIZE_LABEL: Record<WidgetSize, string> = { third: 'Narrow (⅓)', half: 'Half', 'two-thirds': 'Wide (⅔)', full: 'Full width' };
/** On large screens a 12-column grid; narrower screens stack widgets (two narrow ones share a row on laptops). */
const SPAN: Record<WidgetSize, string> = { third: 'lg:col-span-6 xl:col-span-4', half: 'lg:col-span-6', 'two-thirds': 'lg:col-span-12 xl:col-span-8', full: 'lg:col-span-12' };

/** Lays out visible widgets; in edit mode each gets a toolbar to drag, move, resize or hide it. */
export function WidgetGrid({ layout, editing, onChange, render }: { layout: WidgetPlace[]; editing: boolean; onChange: (l: WidgetPlace[]) => void; render: (id: string) => ReactNode }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const visible = layout.filter((w) => !w.hidden);
  const hidden = layout.filter((w) => w.hidden);

  const update = (id: string, patch: Partial<WidgetPlace>) => onChange(layout.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  /** Moves `id` to just before `target` (or to the end), keeping hidden widgets where they are. */
  const moveBefore = (id: string, target: string | null) => {
    if (id === target) return;
    const rest = layout.filter((w) => w.id !== id);
    const item = layout.find((w) => w.id === id)!;
    const at = target ? rest.findIndex((w) => w.id === target) : rest.length;
    onChange([...rest.slice(0, at), item, ...rest.slice(at)]);
  };
  const step = (id: string, dir: -1 | 1) => {
    const i = visible.findIndex((w) => w.id === id);
    const j = i + dir;
    if (j < 0 || j >= visible.length) return;
    if (dir === -1) moveBefore(id, visible[j].id);
    else moveBefore(id, visible[j + 1]?.id ?? null);
  };

  return (
    <>
      {editing && (
        <div className="mb-4 rounded-xl border border-dashed border-brand/50 bg-brand/5 p-3 text-sm">
          <p className="text-muted">Drag a widget by its handle, or use the arrows. Pick a size, or hide what you do not need. Changes are saved when you press Done.</p>
          {hidden.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted">Hidden:</span>
              {hidden.map((w) => (
                <button key={w.id} type="button" onClick={() => update(w.id, { hidden: false })} className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-2.5 py-1 text-xs hover:border-brand/50">
                  <Plus className="h-3 w-3" /> {WIDGET_NAMES[w.id] ?? w.id}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {visible.map((w, i) => (
          <div
            key={w.id}
            className={clsx('@container min-w-0', SPAN[w.size], editing && 'rounded-xl outline-dashed outline-2 outline-offset-4', editing && (over === w.id && dragging !== w.id ? 'outline-brand' : 'outline-line'), dragging === w.id && 'opacity-50')}
            onDragOver={editing ? (e) => { e.preventDefault(); setOver(w.id); } : undefined}
            onDrop={editing ? (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) moveBefore(id, w.id); setDragging(null); setOver(null); } : undefined}
          >
            {editing && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1.5 text-xs">
                <span
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', w.id); e.dataTransfer.effectAllowed = 'move'; setDragging(w.id); }}
                  onDragEnd={() => { setDragging(null); setOver(null); }}
                  className="cursor-grab rounded p-1 text-muted hover:bg-sunken active:cursor-grabbing"
                  title="Drag to move"
                  aria-hidden
                >
                  <GripVertical className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{WIDGET_NAMES[w.id] ?? w.id}</span>
                <select aria-label={`Size of ${WIDGET_NAMES[w.id]}`} className="input w-auto py-1 text-xs" value={w.size} onChange={(e) => update(w.id, { size: e.target.value as WidgetSize })}>
                  {(Object.keys(SIZE_LABEL) as WidgetSize[]).map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
                </select>
                <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" disabled={i === 0} onClick={() => step(w.id, -1)} aria-label={`Move ${WIDGET_NAMES[w.id]} earlier`}><ArrowUp className="h-4 w-4" /></button>
                <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" disabled={i === visible.length - 1} onClick={() => step(w.id, 1)} aria-label={`Move ${WIDGET_NAMES[w.id]} later`}><ArrowDown className="h-4 w-4" /></button>
                <button type="button" className="rounded p-1 text-muted hover:bg-sunken disabled:opacity-30" disabled={visible.length === 1} onClick={() => update(w.id, { hidden: true })} aria-label={`Hide ${WIDGET_NAMES[w.id]}`}><EyeOff className="h-4 w-4" /></button>
              </div>
            )}
            {render(w.id)}
          </div>
        ))}
        {editing && dragging && (
          <div
            className={clsx('flex h-16 items-center justify-center rounded-xl border-2 border-dashed text-xs text-muted lg:col-span-12', over === '__end' ? 'border-brand' : 'border-line')}
            onDragOver={(e) => { e.preventDefault(); setOver('__end'); }}
            onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) moveBefore(id, null); setDragging(null); setOver(null); }}
          >
            Drop here to move to the end
          </div>
        )}
      </div>
    </>
  );
}
