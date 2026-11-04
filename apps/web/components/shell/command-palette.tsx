'use client';
import clsx from 'clsx';
import { Building2, Compass, CornerDownLeft, FolderKanban, Moon, Palette, PanelLeft, PanelRight, Search, Sun, Truck, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { canEdit, useMe } from '@/components/me';
import { useTheme } from '@/components/theme';
import { get } from '@/lib/api';
import { THEMES } from '@/lib/theme';
import { bidzoUrl, NAV, visibleNav } from './nav';

interface Cmd { id: string; group: string; label: string; hint?: string; icon: React.ComponentType<{ className?: string }>; run: () => void; keywords?: string }
interface Lookups { clients: { id: string; name: string; code: string }[]; vendors: { id: string; name: string; code: string }[] }

const norm = (s: string) => s.toLowerCase().normalize('NFKD');
function score(q: string, text: string) {
  const t = norm(text);
  if (t.startsWith(q)) return 3;
  if (t.split(/[\s·/-]+/).some((w) => w.startsWith(q))) return 2;
  return t.includes(q) ? 1 : 0;
}

/** Ctrl/Cmd+K: jump to any page, project, client or vendor, or run a workspace action. */
export function CommandPalette({ open, onClose, onToggleInsights, onStartTour }: { open: boolean; onClose: () => void; onToggleInsights: () => void; onStartTour?: () => void }) {
  const router = useRouter();
  const me = useMe();
  const { prefs, update } = useTheme();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [projects, setProjects] = useState<{ id: string; projectCode: string; name: string }[]>([]);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const req = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setSel(0);
    input.current?.focus();
    if (!lookups) {
      Promise.all([get<Lookups['clients']>('/clients'), get<Lookups['vendors']>('/vendors')])
        .then(([clients, vendors]) => setLookups({ clients, vendors }))
        .catch(() => setLookups({ clients: [], vendors: [] }));
    }
  }, [open, lookups]);

  // Projects are searched on the server (there can be thousands).
  useEffect(() => {
    if (!open) return;
    const n = ++req.current;
    const t = setTimeout(() => {
      get<{ items: { id: string; projectCode: string; name: string }[] }>(`/projects?pageSize=8${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
        .then((r) => n === req.current && setProjects(r.items))
        .catch(() => n === req.current && setProjects([]));
    }, 120);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = (href: string) => () => {
    onClose();
    router.push(href);
  };

  const commands = useMemo<Cmd[]>(() => {
    const dark = prefs.mode === 'dark';
    const cmds: Cmd[] = [
      ...visibleNav(me?.user.role).map((n) => ({ id: `nav-${n.href}`, group: 'Go to', label: n.label, icon: n.icon, run: go(n.href), keywords: n.keywords })),
      ...(canEdit(me) ? [{ id: 'new-project', group: 'Actions', label: 'Create project', icon: Zap, run: go('/projects/new') }, { id: 'project-templates', group: 'Actions', label: 'Project templates', icon: Zap, run: go('/projects/templates') }] : []),
      ...(bidzoUrl(me) ? [{ id: 'new-bid', group: 'Actions', label: 'Create bid in Bidzo', icon: Zap, run: () => { onClose(); window.open(`${bidzoUrl(me)}/bids/new`, '_blank', 'noopener'); } }] : []),
      { id: 'mode', group: 'Actions', label: dark ? 'Switch to light mode' : 'Switch to dark mode', icon: dark ? Sun : Moon, run: () => { update({ mode: dark ? 'light' : 'dark' }); onClose(); }, keywords: 'theme appearance' },
      { id: 'sidebar', group: 'Actions', label: prefs.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar', hint: '[', icon: PanelLeft, run: () => { update({ sidebarCollapsed: !prefs.sidebarCollapsed }); onClose(); } },
      { id: 'insights', group: 'Actions', label: prefs.insightsOpen ? 'Hide insights panel' : 'Show insights panel', hint: ']', icon: PanelRight, run: () => { onToggleInsights(); onClose(); } },
      ...(onStartTour ? [{ id: 'tour', group: 'Actions', label: 'Take the product tour', icon: Compass, run: () => { onClose(); onStartTour(); }, keywords: 'tour help guide walkthrough onboarding features introduction' }] : []),
      ...THEMES.map((t) => ({ id: `theme-${t.id}`, group: 'Themes', label: `Theme: ${t.name}`, hint: t.mood, icon: Palette, run: () => { update({ theme: t.id }); onClose(); }, keywords: 'appearance colour color' })),
    ];
    for (const p of projects) cmds.push({ id: `p-${p.id}`, group: 'Projects', label: `${p.projectCode} · ${p.name}`, icon: FolderKanban, run: go(`/projects/${p.id}`) });
    for (const c of lookups?.clients ?? []) cmds.push({ id: `c-${c.id}`, group: 'Clients', label: c.name, hint: c.code, icon: Building2, run: go(`/reports?clientId=${c.id}`), keywords: c.code });
    for (const v of lookups?.vendors ?? []) cmds.push({ id: `v-${v.id}`, group: 'Vendors', label: v.name, hint: v.code, icon: Truck, run: go(`/reports?vendorId=${v.id}`), keywords: v.code });
    return cmds;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.mode, prefs.sidebarCollapsed, prefs.insightsOpen, projects, lookups, me]);

  const results = useMemo(() => {
    const term = norm(q.trim());
    if (!term) return commands.filter((c) => c.group === 'Go to' || c.group === 'Actions' || c.group === 'Projects');
    return commands
      .map((c) => ({ c, s: c.group === 'Projects' ? 2 : Math.max(score(term, c.label), score(term, c.keywords ?? '') && 1) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.c);
  }, [q, commands]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const groups: [string, { c: Cmd; i: number }[]][] = [];
  results.forEach((c, i) => {
    const g = groups.find(([n]) => n === c.group);
    if (g) g[1].push({ c, i });
    else groups.push([c.group, [{ c, i }]]);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="glass anim-pop w-full max-w-xl overflow-hidden border border-line shadow-2xl"
        style={{ borderRadius: 'var(--radius)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); results[sel]?.run(); }
            }}
            placeholder="Search projects, clients, vendors or type a command"
            className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted focus-visible:outline-none"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={results[sel] ? `cmdk-${results[sel].id}` : undefined}
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[10px] text-muted sm:block">Esc</kbd>
        </div>
        <div ref={list} id="cmdk-list" role="listbox" className="max-h-[55vh] overflow-y-auto p-2">
          {results.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">Nothing matches “{q}”.</p>}
          {groups.map(([g, rows]) => (
            <div key={g} role="group" aria-label={g} className="mb-1">
              <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{g}</div>
              {rows.map(({ c, i }) => (
                <button
                  key={c.id}
                  id={`cmdk-${c.id}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === sel}
                  onMouseMove={() => setSel(i)}
                  onClick={c.run}
                  className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm', i === sel ? 'bg-brand/10 text-ink' : 'text-ink/90')}
                >
                  <c.icon className={clsx('h-4 w-4 shrink-0', i === sel ? 'text-brand' : 'text-muted')} />
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {c.hint && <span className="hidden shrink-0 truncate text-xs text-muted sm:block">{c.hint}</span>}
                  {i === sel && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-muted">
          <span><kbd className="font-sans">↑↓</kbd> to move</span>
          <span><kbd className="font-sans">Enter</kbd> to open</span>
          <span className="ml-auto">Ctrl K anywhere</span>
        </div>
      </div>
    </div>
  );
}
