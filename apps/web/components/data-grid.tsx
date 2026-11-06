'use client';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Rows3, Rows4 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export type SortDir = 'asc' | 'desc';
export interface Sort { key: string; dir: SortDir }

export interface GridColumn<T> {
  id: string;
  header: string;
  /** Tooltip for the header. */
  title?: string;
  cell: (row: T) => ReactNode;
  /** Server-sorted grids: the sort key sent to the API. Client-sorted grids: use `sortValue`. */
  sortKey?: string;
  sortValue?: (row: T) => string | number | null;
  align?: 'left' | 'right';
  /** Starting width in pixels; people can drag the header edge to change it. */
  width?: number;
  /** The first column stays visible and pinned while scrolling sideways. */
  pinned?: boolean;
  hideable?: boolean;
  defaultHidden?: boolean;
}

interface Prefs { hidden: string[]; widths: Record<string, number>; density: 'comfortable' | 'compact' }
const EMPTY: Prefs = { hidden: [], widths: {}, density: 'comfortable' };

/** Column choices, widths and density, kept per grid in this browser. */
function usePrefs(id: string, columns: GridColumn<unknown>[]): [Prefs, (p: Prefs) => void] {
  const key = `projexa.grid.${id}`;
  const defaults = useMemo<Prefs>(() => ({ ...EMPTY, hidden: columns.filter((c) => c.defaultHidden).map((c) => c.id) }), [columns]);
  const [prefs, setPrefs] = useState<Prefs>(defaults);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setPrefs({ ...defaults, ...(JSON.parse(raw) as Partial<Prefs>) });
    } catch {
      /* blocked or bad JSON: keep defaults */
    }
  }, [key, defaults]);
  const save = (p: Prefs) => {
    setPrefs(p);
    try {
      localStorage.setItem(key, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  };
  return [prefs, save];
}

/**
 * A table with sortable, resizable and hideable columns, a pinned first column, a sticky header and
 * two densities. Sorting is either done by the server (`sort` + `onSort`) or here (`sortValue`).
 */
export function DataGrid<T>({
  id,
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  toolbar,
  empty,
  maxHeight = '70vh',
  rowAccent,
}: {
  id: string;
  columns: GridColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: Sort | null;
  onSort?: (s: Sort | null) => void;
  toolbar?: ReactNode;
  empty?: ReactNode;
  maxHeight?: string;
  /** Classes for a coloured stripe on the row's first cell, e.g. the project status colour. */
  rowAccent?: (row: T) => string | undefined;
}) {
  const [prefs, setPrefs] = usePrefs(id, columns as GridColumn<unknown>[]);
  const [localSort, setLocalSort] = useState<Sort | null>(null);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const server = !!onSort;
  const current = server ? (sort ?? null) : localSort;
  const visible = columns.filter((c) => !prefs.hidden.includes(c.id));
  const compact = prefs.density === 'compact';

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  const sorted = useMemo(() => {
    if (server || !current) return rows;
    const col = columns.find((c) => c.id === current.key);
    if (!col?.sortValue) return rows;
    const f = current.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = col.sortValue!(a);
      const y = col.sortValue!(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * f;
    });
  }, [rows, columns, current, server]);

  /** Click cycles: ascending, descending, then back to the default order. */
  function toggleSort(c: GridColumn<T>) {
    const key = server ? c.sortKey! : c.id;
    const next: Sort | null = current?.key !== key ? { key, dir: 'asc' } : current.dir === 'asc' ? { key, dir: 'desc' } : null;
    if (server) onSort!(next);
    else setLocalSort(next);
  }

  function startResize(e: React.PointerEvent, c: GridColumn<T>) {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest('th')!;
    const start = e.clientX;
    const from = th.getBoundingClientRect().width;
    let width = from;
    const move = (ev: PointerEvent) => {
      width = Math.max(60, Math.min(800, from + ev.clientX - start));
      th.style.width = `${width}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPrefs({ ...prefs, widths: { ...prefs.widths, [c.id]: Math.round(width) } });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const hideable = columns.filter((c) => c.hideable !== false && !c.pinned);
  const pad = compact ? 'px-3 py-1.5' : 'px-4 py-3';

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">{toolbar}</div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost px-2 py-1.5 text-xs" onClick={() => setPrefs({ ...prefs, density: compact ? 'comfortable' : 'compact' })} aria-pressed={compact} title={compact ? 'Comfortable rows' : 'Compact rows'}>
            {compact ? <Rows3 className="h-4 w-4" /> : <Rows4 className="h-4 w-4" />} <span className="hidden sm:inline">{compact ? 'Compact' : 'Comfortable'}</span>
          </button>
          <div className="relative" ref={menuRef}>
            <button type="button" className="btn-ghost px-2 py-1.5 text-xs" aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu(!menu)}>
              <Columns3 className="h-4 w-4" /> Columns{prefs.hidden.length ? ` (${columns.length - prefs.hidden.length}/${columns.length})` : ''}
            </button>
            {menu && (
              <div className="absolute right-0 z-30 mt-1 w-60 rounded-lg border border-line bg-panel p-2 shadow-lg" role="menu">
                <div className="max-h-72 overflow-auto">
                  {hideable.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-sunken">
                      <input
                        type="checkbox"
                        checked={!prefs.hidden.includes(c.id)}
                        onChange={(e) => setPrefs({ ...prefs, hidden: e.target.checked ? prefs.hidden.filter((h) => h !== c.id) : [...prefs.hidden, c.id] })}
                      />
                      {c.header}
                    </label>
                  ))}
                </div>
                <button type="button" className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-brand hover:bg-sunken" onClick={() => setPrefs({ ...EMPTY, hidden: columns.filter((c) => c.defaultHidden).map((c) => c.id) })}>
                  Reset columns and widths
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="p-5">{empty}</div>
      ) : (
        <div className="overflow-auto rounded-b-xl" style={{ maxHeight }}>
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {visible.map((c, i) => {
                  const key = server ? c.sortKey : c.sortValue ? c.id : undefined;
                  const active = key && current?.key === key ? current.dir : null;
                  const width = prefs.widths[c.id] ?? c.width;
                  return (
                    <th
                      key={c.id}
                      scope="col"
                      title={c.title}
                      aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : undefined}
                      style={width ? { width, minWidth: width } : undefined}
                      className={clsx(
                        'group sticky top-0 z-10 whitespace-nowrap border-b border-line bg-sunken text-xs font-medium uppercase tracking-wide text-muted',
                        compact ? 'px-3 py-2' : 'px-4 py-2.5',
                        c.align === 'right' ? 'text-right' : 'text-left',
                        c.pinned && i === 0 && 'left-0 z-20 border-r',
                      )}
                    >
                      {key ? (
                        <button type="button" onClick={() => toggleSort(c)} className={clsx('inline-flex items-center gap-1 uppercase hover:text-ink', c.align === 'right' && 'flex-row-reverse', active && 'text-ink')}>
                          {c.header}
                          {active === 'asc' ? <ArrowUp className="h-3 w-3" /> : active === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-0 group-hover:opacity-60" />}
                        </button>
                      ) : (
                        c.header
                      )}
                      <span onPointerDown={(e) => startResize(e, c)} className="absolute inset-y-0 right-0 w-1.5 cursor-col-resize touch-none hover:bg-brand/40" aria-hidden />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={rowKey(r)} className="group/row">
                  {visible.map((c, i) => (
                    <td key={c.id} className={clsx('border-b border-line bg-panel group-hover/row:bg-sunken', pad, c.align === 'right' && 'text-right tabular-nums', c.pinned && i === 0 && 'sticky left-0 z-[5] border-r', i === 0 && rowAccent?.(r) && clsx('border-l-4', rowAccent(r)))}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
