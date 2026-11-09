'use client';
import clsx from 'clsx';
import { ArrowRightLeft, AtSign, Check, ClipboardCheck, MessageSquare, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useMe } from '@/components/me';
import { Empty, ErrorBox, Field, Loading, Section } from '@/components/ui';
import { api, get, patch, post } from '@/lib/api';
import type { ProjectDetail } from './types';

/** Team tab (docs/TEAM_COLLABORATION.md): comments with @mentions, the handover checklist and the activity feed. */

interface Person { id: string; name: string; email: string; role: string }
interface Comment { id: string; body: string; author: { id: string; name: string }; mentions: { id: string; name: string }[]; mine: boolean; canDelete: boolean; editedAt: string | null; createdAt: string }
interface HandoverItem { key: string; label: string; done: boolean; doneBy: string | null; doneAt: string | null }
interface Handover {
  id: string; status: 'OPEN' | 'ACCEPTED' | 'CANCELLED'; from: { id: string; name: string }; to: { id: string; name: string }; note: string | null; makeManager: boolean;
  items: HandoverItem[]; done: number; total: number; canTick: boolean; canAccept: boolean; canCancel: boolean; acceptedAt: string | null; cancelledAt: string | null; createdAt: string;
}
interface Activity { id: string; action: string; kind: string; actor: string; system: boolean; label: string; summary: string | null; at: string }

const when = (d: string) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const ROLE: Record<string, string> = { ADMIN: 'Admin', PROJECT_MANAGER: 'Project manager', SALES: 'Sales', VIEWER: 'Viewer' };

export function TeamTab({ project, editable, reload }: { project: ProjectDetail; editable: boolean; reload: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [feedKey, setFeedKey] = useState(0);
  useEffect(() => {
    get<Person[]>(`/projects/${project.id}/mentionable`).then(setPeople).catch(() => setPeople([]));
  }, [project.id]);
  const changed = useCallback(() => setFeedKey((k) => k + 1), []);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Comments project={project} people={people} onChange={changed} />
      <div className="space-y-5">
        <HandoverCard project={project} people={people} editable={editable} onChange={() => { changed(); reload(); }} />
        <ActivityFeed key={feedKey} project={project} />
      </div>
    </div>
  );
}

// ─────────────────────────────── Comments ───────────────────────────────

/** Shows the text with each "@Name" of a mentioned person as a chip. */
function Body({ text, names }: { text: string; names: string[] }) {
  if (!names.length) return <>{text}</>;
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|')}))(?![\\w])`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 === 1 ? <span key={i} className="rounded bg-brand/10 px-1 font-medium text-brand">{part}</span> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

function Composer({ people, initial = '', busy, onSubmit, onCancel, submitLabel }: { people: Person[]; initial?: string; busy: boolean; onSubmit: (body: string, mentionIds: string[]) => Promise<boolean>; onCancel?: () => void; submitLabel: string }) {
  const [text, setText] = useState(initial);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  // After picking a name, put the caret right after it once the new text is on screen.
  const caretAt = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caretAt.current === null || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(caretAt.current, caretAt.current);
    caretAt.current = null;
  }, [text]);
  const matches = useMemo(() => (query === null ? [] : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6)), [people, query]);

  function track(value: string, caret: number) {
    setText(value);
    const m = /(^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/.exec(value.slice(0, caret));
    setQuery(m ? m[2] : null);
    setActive(0);
  }

  function pick(p: Person) {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/, `@${p.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setPicked((x) => [...new Set([...x, p.id])]);
    setQuery(null);
    caretAt.current = before.length;
  }

  async function submit() {
    if (!text.trim()) return;
    if (await onSubmit(text.trim(), picked)) { setText(''); setPicked([]); }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (matches.length && query !== null) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active]); return; }
      if (e.key === 'Escape') { setQuery(null); return; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  }

  return (
    <div>
      <div className="relative">
      <textarea
        ref={ref}
        className="input min-h-[84px] w-full resize-y"
        placeholder="Write a comment. Type @ to mention a colleague."
        aria-label="Comment"
        value={text}
        maxLength={5000}
        onChange={(e) => track(e.target.value, e.target.selectionStart)}
        onKeyDown={onKey}
      />
      {query !== null && matches.length > 0 && (
        <ul className="anim-pop absolute left-0 right-0 top-full z-50 mt-1 max-w-sm overflow-hidden rounded-lg border border-line bg-panel p-1 shadow-xl" role="listbox" aria-label="Mention a colleague">
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button type="button" className={clsx('flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm', i === active ? 'bg-brand/10' : 'hover:bg-sunken')} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/15 text-[10px] font-semibold text-brand">{initials(p.name)}</span>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="text-xs text-muted">{ROLE[p.role] ?? p.role}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-xs text-muted"><AtSign className="h-3.5 w-3.5" /> People you mention get a bell notification and an email.</span>
        <div className="ml-auto flex gap-2">
          {onCancel && <button type="button" className="btn-ghost h-8 px-3 text-xs" onClick={onCancel}>Cancel</button>}
          <button type="button" className="btn-primary h-8 px-3 text-xs" disabled={busy || !text.trim()} onClick={submit}><Send className="h-3.5 w-3.5" /> {busy ? 'Saving…' : submitLabel}</button>
        </div>
      </div>
    </div>
  );
}

function Comments({ project, people, onChange }: { project: ProjectDetail; people: Person[]; onChange: () => void }) {
  const [rows, setRows] = useState<Comment[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const load = useCallback(() => get<Comment[]>(`/projects/${project.id}/comments`).then(setRows).catch(setError), [project.id]);
  useEffect(() => { load(); }, [load]);

  // Links from the bell and emails end in #comment-<id>: scroll to it and highlight it once.
  useEffect(() => {
    if (!rows) return;
    const id = window.location.hash.match(/^#comment-(.+)$/)?.[1];
    if (!id) return;
    setFlash(id);
    document.getElementById(`comment-${id}`)?.scrollIntoView({ block: 'center' });
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [rows]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); onChange(); return true; } catch (e) { setError(e); return false; } finally { setBusy(false); }
  }

  return (
    <Section title="Comments" actions={<span className="text-xs text-muted">Staff only · never shown in a portal</span>}>
      <ErrorBox error={error} />
      {!rows ? <Loading /> : (
        <>
          {rows.length === 0 && <Empty>No comments yet. Start the conversation with your team below.</Empty>}
          <ol className="mb-4 space-y-3">
            {rows.map((c) => (
              <li key={c.id} id={`comment-${c.id}`} className={clsx('flex scroll-mt-24 gap-3 rounded-lg p-2 transition-colors', flash === c.id && 'bg-brand/10')}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/15 text-xs font-semibold text-brand" aria-hidden>{initials(c.author.name)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-sm">
                    <span className="font-semibold">{c.author.name}</span>
                    <span className="text-xs text-muted">{when(c.createdAt)}{c.editedAt ? ' · edited' : ''}</span>
                    <span className="ml-auto flex gap-1">
                      {c.mine && editing !== c.id && <button className="btn-ghost h-7 px-2 text-xs" aria-label="Edit comment" onClick={() => setEditing(c.id)}><Pencil className="h-3.5 w-3.5" /></button>}
                      {c.canDelete && <button className="btn-ghost h-7 px-2 text-xs" aria-label="Delete comment" disabled={busy} onClick={() => confirm('Delete this comment?') && run(() => api(`/projects/${project.id}/comments/${c.id}`, { method: 'DELETE' }))}><Trash2 className="h-3.5 w-3.5" /></button>}
                    </span>
                  </div>
                  {editing === c.id ? (
                    <div className="mt-1">
                      <Composer people={people} initial={c.body} busy={busy} submitLabel="Save" onCancel={() => setEditing(null)} onSubmit={async (body, mentionIds) => { const ok = await run(() => patch(`/projects/${project.id}/comments/${c.id}`, { body, mentionIds })); if (ok) setEditing(null); return ok; }} />
                    </div>
                  ) : (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm"><Body text={c.body} names={c.mentions.map((m) => m.name)} /></p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <Composer people={people} busy={busy} submitLabel="Comment" onSubmit={(body, mentionIds) => run(() => post(`/projects/${project.id}/comments`, { body, mentionIds }))} />
        </>
      )}
    </Section>
  );
}

// ─────────────────────────────── Handover ───────────────────────────────

function HandoverCard({ project, people, editable, onChange }: { project: ProjectDetail; people: Person[]; editable: boolean; onChange: () => void }) {
  const me = useMe();
  const [data, setData] = useState<{ handovers: Handover[]; defaults: { key: string; label: string }[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [toUserId, setTo] = useState('');
  const [note, setNote] = useState('');
  const [skip, setSkip] = useState<string[]>([]);
  const [extra, setExtra] = useState<string[]>([]);
  const [makeManager, setMakeManager] = useState(true);
  const load = useCallback(() => get<{ handovers: Handover[]; defaults: { key: string; label: string }[] }>(`/projects/${project.id}/handovers`).then(setData).catch(setError), [project.id]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); onChange(); return true; } catch (e) { setError(e); return false; } finally { setBusy(false); }
  }

  const open = data?.handovers.find((h) => h.status === 'OPEN');
  const past = data?.handovers.filter((h) => h.status !== 'OPEN').slice(0, 3) ?? [];
  const receivers = people.filter((p) => (p.role === 'ADMIN' || p.role === 'PROJECT_MANAGER') && p.id !== me?.user.id);

  async function start() {
    const ok = await run(() => post(`/projects/${project.id}/handovers`, { toUserId, note: note.trim() || null, skip, extraItems: extra.map((x) => x.trim()).filter(Boolean), makeManager }));
    if (ok) { setStarting(false); setTo(''); setNote(''); setSkip([]); setExtra([]); setMakeManager(true); }
  }

  let body: ReactNode;
  if (!data) body = error ? null : <Loading />;
  else if (open) {
    body = (
      <div>
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{open.from.name}</span>
          <ArrowRightLeft className="h-4 w-4 text-muted" aria-label="to" />
          <span className="font-medium">{open.to.name}</span>
          <span className="ml-auto text-xs tabular-nums text-muted">{open.done} of {open.total}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={open.done} aria-valuemax={open.total} aria-label="Checklist progress">
          <div className="h-full bg-ok transition-all" style={{ width: `${(open.done / Math.max(open.total, 1)) * 100}%` }} />
        </div>
        {open.note && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-sunken/60 p-2.5 text-sm">{open.note}</p>}
        <ul className="mt-3 space-y-1.5">
          {open.items.map((i) => (
            <li key={i.key}>
              <label className={clsx('flex items-start gap-2.5 rounded-md px-1.5 py-1 text-sm', open.canTick && 'cursor-pointer hover:bg-sunken/60')}>
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" checked={i.done} disabled={!open.canTick || busy} onChange={(e) => run(() => patch(`/projects/${project.id}/handovers/${open.id}/items/${encodeURIComponent(i.key)}`, { done: e.target.checked }))} />
                <span className="min-w-0 flex-1">
                  <span className={clsx(i.done && 'text-muted line-through')}>{i.label}</span>
                  {i.done && i.doneBy && <span className="block text-xs text-muted">Ticked by {i.doneBy}{i.doneAt ? `, ${when(i.doneAt)}` : ''}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">{open.makeManager ? `When ${open.to.name} accepts, they become the project manager.` : 'Accepting keeps the current project manager.'}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {open.canAccept && <button className="btn-primary h-8 px-3 text-xs" disabled={busy || open.done < open.total} title={open.done < open.total ? 'Tick every item first' : undefined} onClick={() => run(() => post(`/projects/${project.id}/handovers/${open.id}/accept`))}><Check className="h-3.5 w-3.5" /> Accept handover</button>}
          {open.canCancel && <button className="btn-ghost h-8 px-3 text-xs" disabled={busy} onClick={() => confirm('Cancel this handover?') && run(() => post(`/projects/${project.id}/handovers/${open.id}/cancel`))}><X className="h-3.5 w-3.5" /> Cancel</button>}
        </div>
      </div>
    );
  } else if (starting) {
    body = (
      <div className="space-y-3">
        <Field label="Hand over to">
          <select className="input w-full" value={toUserId} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose a project manager…</option>
            {receivers.map((p) => <option key={p.id} value={p.id}>{p.name} · {ROLE[p.role]}</option>)}
          </select>
        </Field>
        <Field label="Handover note">
          <textarea className="input min-h-[64px] w-full" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the next person should know first" />
        </Field>
        <div>
          <span className="label">Checklist</span>
          <ul className="space-y-1">
            {data.defaults.map((d) => (
              <li key={d.key}>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!skip.includes(d.key)} onChange={(e) => setSkip((s) => (e.target.checked ? s.filter((x) => x !== d.key) : [...s, d.key]))} />
                  {d.label}
                </label>
              </li>
            ))}
            {extra.map((x, n) => (
              <li key={n} className="flex gap-2">
                <input className="input h-8 flex-1 text-sm" maxLength={160} value={x} placeholder="Your own checklist item" aria-label={`Extra checklist item ${n + 1}`} onChange={(e) => setExtra((xs) => xs.map((v, i) => (i === n ? e.target.value : v)))} />
                <button className="btn-ghost h-8 px-2" aria-label="Remove item" onClick={() => setExtra((xs) => xs.filter((_, i) => i !== n))}><X className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
          {extra.length < 10 && <button className="btn-ghost mt-1 h-7 px-2 text-xs" onClick={() => setExtra((xs) => [...xs, ''])}><Plus className="h-3.5 w-3.5" /> Add an item</button>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={makeManager} onChange={(e) => setMakeManager(e.target.checked)} />
          Make them the project manager when they accept
        </label>
        <div className="flex gap-2">
          <button className="btn-primary h-8 px-3 text-xs" disabled={busy || !toUserId} onClick={start}><Send className="h-3.5 w-3.5" /> Start handover</button>
          <button className="btn-ghost h-8 px-3 text-xs" onClick={() => setStarting(false)}>Cancel</button>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="text-sm">
        <p className="text-muted">Moving this project to another project manager? Start a handover: you both tick the checklist, then they accept it.</p>
        {editable && <button className="btn-primary mt-3 h-8 px-3 text-xs" onClick={() => setStarting(true)}><ClipboardCheck className="h-3.5 w-3.5" /> Start a handover</button>}
      </div>
    );
  }

  return (
    <Section title="Handover">
      <ErrorBox error={error} />
      {body}
      {past.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-muted">
          {past.map((h) => (
            <li key={h.id}>{h.from.name} → {h.to.name}: {h.status === 'ACCEPTED' ? `accepted ${when(h.acceptedAt!)}` : `cancelled ${when(h.cancelledAt!)}`}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ─────────────────────────────── Activity ───────────────────────────────

const KINDS = [
  { key: 'all', label: 'All' },
  { key: 'comments', label: 'Comments' },
  { key: 'handovers', label: 'Handovers' },
  { key: 'changes', label: 'Changes' },
  { key: 'fieldwork', label: 'Fieldwork' },
  { key: 'requests', label: 'Requests' },
] as const;
const DOT: Record<string, string> = { comments: 'bg-brand', handovers: 'bg-ok', changes: 'bg-info', fieldwork: 'bg-warn', requests: 'bg-muted' };

function ActivityFeed({ project }: { project: ProjectDetail }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('all');
  const [items, setItems] = useState<Activity[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [more, setMore] = useState(false);

  const fetchPage = useCallback((before?: string) => get<{ items: Activity[]; next: string | null }>(`/projects/${project.id}/activity?kind=${kind}&limit=25${before ? `&before=${encodeURIComponent(before)}` : ''}`), [project.id, kind]);
  useEffect(() => {
    setItems(null);
    fetchPage().then((r) => { setItems(r.items); setNext(r.next); }).catch(setError);
  }, [fetchPage]);

  async function loadMore() {
    if (!next) return;
    setMore(true);
    try { const r = await fetchPage(next); setItems((x) => [...(x ?? []), ...r.items]); setNext(r.next); } catch (e) { setError(e); } finally { setMore(false); }
  }

  return (
    <Section title="Activity">
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {KINDS.map((k) => (
          <button key={k.key} className={clsx('rounded-full border px-2.5 py-0.5 text-xs', kind === k.key ? 'border-brand bg-brand/10 font-medium text-brand' : 'border-line text-muted hover:text-ink')} aria-pressed={kind === k.key} onClick={() => setKind(k.key)}>{k.label}</button>
        ))}
      </div>
      <ErrorBox error={error} />
      {!items ? <Loading /> : items.length === 0 ? (
        <p className="text-sm text-muted">Nothing here yet.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-line pl-4">
          {items.map((a) => (
            <li key={a.id} className="relative text-sm">
              <span className={clsx('absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-[rgb(var(--surface))]', DOT[a.kind] ?? 'bg-muted')} aria-hidden />
              <div>
                {a.system ? <span className="font-medium">{a.label.charAt(0).toUpperCase() + a.label.slice(1)}</span> : <><span className="font-medium">{a.actor}</span> {a.label}</>}
              </div>
              {a.summary && <div className="break-words text-xs text-muted">{a.kind === 'comments' ? <MessageSquare className="mr-1 inline h-3 w-3" /> : null}{a.summary}</div>}
              <div className="text-[11px] text-muted">{when(a.at)}</div>
            </li>
          ))}
        </ol>
      )}
      {next && <button className="btn-ghost mt-3 h-8 w-full text-xs" disabled={more} onClick={loadMore}>{more ? 'Loading…' : 'Show older'}</button>}
    </Section>
  );
}
