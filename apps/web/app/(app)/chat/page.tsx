'use client';
import clsx from 'clsx';
import { ArrowLeft, BellOff, Bell, Check, Clock, Crown, FolderKanban, Hash, Lock, Megaphone, MoreHorizontal, Pencil, Plus, Search, Send, Trash2, UserPlus, Users, WifiOff, X, Archive, LogOut, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useMe } from '@/components/me';
import { useChat, type ChatChannel, type ChatMessage, type ChatPerson, type Connection, type Tone } from '@/components/chat/chat-provider';
import { ErrorBox, Loading } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { hasFeature } from '@/lib/types';

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Admin', PROJECT_MANAGER: 'Project manager', SALES: 'Sales', VIEWER: 'Viewer' };
const TONES: { key: Tone; label: string; chip: string; bar: string }[] = [
  { key: 'on_track', label: 'On track', chip: 'bg-ok/15 text-ok', bar: 'border-l-ok' },
  { key: 'at_risk', label: 'At risk', chip: 'bg-warn/15 text-warn', bar: 'border-l-warn' },
  { key: 'blocked', label: 'Blocked', chip: 'bg-bad/15 text-bad', bar: 'border-l-bad' },
  { key: 'done', label: 'Done', chip: 'bg-info/15 text-info', bar: 'border-l-info' },
];
const SECTIONS: { title: string; kinds: ChatChannel['kind'][] }[] = [
  { title: 'Team', kinds: ['ANNOUNCEMENTS', 'GENERAL'] },
  { title: 'Project rooms', kinds: ['PROJECT'] },
  { title: 'Groups', kinds: ['GROUP'] },
  { title: 'Direct messages', kinds: ['DIRECT'] },
];
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
const time = (d: string) => new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayLabel = (d: string) => {
  const x = new Date(d); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (x.toDateString() === t.toDateString()) return 'Today';
  if (x.toDateString() === y.toDateString()) return 'Yesterday';
  return x.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: x.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
};

export default function ChatPage() {
  return <Suspense fallback={<Loading label="Opening chat" />}><Chat /></Suspense>;
}

function Chat() {
  const chat = useChat();
  const me = useMe();
  const router = useRouter();
  const params = useSearchParams();
  const [filter, setFilter] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const activeId = params.get('c');
  const projectParam = params.get('project');

  // ?project=<id> opens (and makes) that project's room.
  useEffect(() => {
    if (!projectParam || !chat) return;
    post<ChatChannel>(`/chat/projects/${projectParam}`).then((c) => { chat.upsertChannel(c); router.replace(`/chat?c=${c.id}`); }).catch(setError);
  }, [projectParam]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    chat?.setActive(activeId);
    return () => chat?.setActive(null);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!chat || !me) return <Loading label="Opening chat" />;
  const channel = chat.channels.find((c) => c.id === activeId) ?? null;
  const open = (id: string | null) => router.push(id ? `/chat?c=${id}` : '/chat');
  const q = filter.trim().toLowerCase();
  const shown = chat.channels.filter((c) => !q || c.name.toLowerCase().includes(q));

  return (
    <div className="card flex h-[calc(100dvh-7.5rem)] min-h-[480px] overflow-hidden">
      {/* Conversation list */}
      <aside className={clsx('flex w-full shrink-0 flex-col border-r border-line lg:w-80', channel && 'hidden lg:flex')} aria-label="Conversations">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold">Team chat</h1>
            <ConnectionPill connection={chat.connection} waiting={chat.waiting} />
          </div>
          <button className="btn-primary h-8 px-2.5 text-xs" onClick={() => setStarting(true)} disabled={chat.connection === 'offline'} title={chat.connection === 'offline' ? 'Needs a connection' : undefined}>
            <Plus className="h-4 w-4" /> New
          </button>
        </div>
        <label className="relative mx-3 mt-3 block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
          <input className="input pl-8" placeholder="Find a conversation" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a conversation" />
        </label>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {!chat.channels.length && <p className="px-3 py-6 text-sm text-muted">{chat.connection === 'live' ? 'Loading conversations…' : 'Conversations appear here once SampTrek is back online.'}</p>}
          {SECTIONS.map((s) => {
            const list = shown.filter((c) => s.kinds.includes(c.kind));
            if (!list.length) return null;
            return (
              <div key={s.title} className="mb-2">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{s.title}</p>
                {list.map((c) => <ChannelRow key={c.id} c={c} active={c.id === activeId} online={c.other ? chat.people.find((p) => p.id === c.other!.id)?.online : undefined} onClick={() => open(c.id)} meId={me.user.id} />)}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Conversation */}
      <section className={clsx('min-w-0 flex-1 flex-col', channel ? 'flex' : 'hidden lg:flex')}>
        {error ? <div className="p-5"><ErrorBox error={error} /></div> : null}
        {channel ? <Conversation key={channel.id} channel={channel} onBack={() => open(null)} /> : (
          <div className="grid flex-1 place-items-center p-8 text-center">
            <div className="max-w-sm">
              <Hash className="mx-auto h-10 w-10 text-muted" />
              <p className="mt-3 font-medium">Pick a conversation</p>
              <p className="mt-1 text-sm text-muted">Announcements and General are for the whole team. Open a project room to share updates on a project, or message someone directly.</p>
            </div>
          </div>
        )}
      </section>
      {starting && <StartDialog onClose={() => setStarting(false)} onOpen={(c) => { chat.upsertChannel(c); setStarting(false); open(c.id); }} />}
    </div>
  );
}

function ConnectionPill({ connection, waiting }: { connection: Connection; waiting: number }) {
  const label = connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Offline';
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted" role="status">
      <span className={clsx('h-2 w-2 rounded-full', connection === 'live' ? 'bg-ok' : connection === 'connecting' ? 'bg-warn animate-pulse' : 'bg-bad')} aria-hidden />
      {label}{waiting ? ` · ${waiting} waiting to send` : ''}
    </p>
  );
}

function ChannelIcon({ c, className }: { c: ChatChannel; className?: string }) {
  const Icon = c.kind === 'ANNOUNCEMENTS' ? Megaphone : c.kind === 'PROJECT' ? FolderKanban : c.kind === 'GROUP' ? Users : Hash;
  return <Icon className={clsx('h-4 w-4 shrink-0', className)} aria-hidden />;
}

function Avatar({ name, superAdmin, online, size = 'md' }: { name: string; superAdmin?: boolean; online?: boolean; size?: 'sm' | 'md' }) {
  return (
    <span className={clsx('relative grid shrink-0 place-items-center rounded-full font-semibold', size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-xs', superAdmin ? 'bg-brand text-brand-ink' : 'bg-brand/15 text-brand')}>
      {initials(name)}
      {online !== undefined && <span className={clsx('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel', online ? 'bg-ok' : 'bg-line')} aria-label={online ? 'Online' : 'Away'} />}
    </span>
  );
}

function ChannelRow({ c, active, online, onClick, meId }: { c: ChatChannel; active: boolean; online?: boolean; onClick: () => void; meId: string }) {
  const last = c.lastMessage;
  const preview = last ? (last.deletedAt ? 'Message deleted' : `${last.author?.id === meId ? 'You' : last.author?.name.split(' ')[0] ?? 'Someone'}: ${last.body}`) : c.kind === 'ANNOUNCEMENTS' ? 'News for the whole team' : 'No messages yet';
  return (
    <button onClick={onClick} className={clsx('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left', active ? 'bg-brand/10' : 'hover:bg-sunken')} aria-current={active ? 'page' : undefined}>
      {c.kind === 'DIRECT' && c.other ? <Avatar name={c.other.name} superAdmin={c.other.superAdmin} online={online} size="sm" /> : <span className="grid h-6 w-6 place-items-center rounded-md bg-sunken text-muted"><ChannelIcon c={c} className="h-3.5 w-3.5" /></span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className={clsx('truncate text-sm', c.unread ? 'font-semibold' : 'font-medium')}>{c.name}</span>
          {c.adminsOnly && c.kind !== 'ANNOUNCEMENTS' && <Lock className="h-3 w-3 shrink-0 text-muted" aria-label="Admins post" />}
          {c.muted && <BellOff className="h-3 w-3 shrink-0 text-muted" aria-label="Muted" />}
        </span>
        <span className="block truncate text-xs text-muted">{preview}</span>
      </span>
      {c.unread > 0 && <span className={clsx('grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold', c.muted ? 'bg-sunken text-muted' : 'bg-brand text-brand-ink')}>{c.unread > 99 ? '99+' : c.unread}</span>}
    </button>
  );
}

function RoleBadge({ a }: { a: { role: string; superAdmin: boolean } }) {
  if (a.superAdmin) return <span className="chip bg-brand/15 text-brand"><Crown className="h-3 w-3" />Super Admin</span>;
  if (a.role === 'ADMIN') return <span className="chip bg-info/15 text-info">Admin</span>;
  return null;
}

function Conversation({ channel, onBack }: { channel: ChatChannel; onBack: () => void }) {
  const chat = useChat()!;
  const me = useMe()!;
  const list = chat.messages[channel.id] ?? [];
  const [loading, setLoading] = useState(!list.length);
  const [error, setError] = useState<unknown>(null);
  const [menu, setMenu] = useState(false);
  const [adding, setAdding] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const admin = me.user.role === 'ADMIN' || !!me.features?.superAdmin;

  useEffect(() => {
    if (chat.connection === 'offline') { setLoading(false); return; }
    chat.loadMessages(channel.id).catch(setError).finally(() => setLoading(false));
  }, [channel.id, chat.connection === 'offline']); // eslint-disable-line react-hooks/exhaustive-deps

  // Stay at the newest message unless the person scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [list.length, loading]);

  async function settings(b: Record<string, unknown>) {
    setMenu(false); setError(null);
    try { chat.upsertChannel(await api<ChatChannel>(`/chat/channels/${channel.id}`, { method: 'PATCH', json: b })); } catch (e) { setError(e); }
  }
  async function leave() {
    setMenu(false);
    try { await api(`/chat/channels/${channel.id}/members/me`, { method: 'DELETE' }); await chat.refreshChannels(); onBack(); } catch (e) { setError(e); }
  }
  const other = channel.other ? chat.people.find((p) => p.id === channel.other!.id) : null;
  const subtitle = channel.kind === 'ANNOUNCEMENTS' ? 'Everyone reads. Admins and the Super Admin post.'
    : channel.kind === 'GENERAL' ? 'Everyone on the team'
    : channel.kind === 'PROJECT' ? 'Project room: chat and status updates for everyone on the team'
    : channel.kind === 'GROUP' ? `${channel.members?.length ?? 0} members: ${(channel.members ?? []).map((m) => m.name.split(' ')[0]).join(', ')}`
    : other ? `${other.superAdmin ? 'Super Admin' : ROLE_LABEL[other.role] ?? other.role} · ${other.online ? 'Online' : other.lastSeenAt ? `Last seen ${dayLabel(other.lastSeenAt).toLowerCase()} ${time(other.lastSeenAt)}` : 'Away'}` : '';

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
        <button className="btn-ghost p-1.5 lg:hidden" onClick={onBack} aria-label="Back to conversations"><ArrowLeft className="h-4 w-4" /></button>
        {channel.kind === 'DIRECT' && channel.other ? <Avatar name={channel.other.name} superAdmin={channel.other.superAdmin} online={other?.online} /> : <span className="grid h-9 w-9 place-items-center rounded-lg bg-sunken text-muted"><ChannelIcon c={channel} /></span>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate text-sm font-semibold">{channel.name}</h2>
            {channel.archived && <span className="chip bg-sunken text-muted">Archived</span>}
            {channel.adminsOnly && channel.kind !== 'ANNOUNCEMENTS' && <span className="chip bg-sunken text-muted"><Lock className="h-3 w-3" />Admins post</span>}
          </div>
          <p className="truncate text-xs text-muted">{subtitle}</p>
        </div>
        {channel.project && <Link href={`/projects/${channel.project.id}`} className="btn-ghost hidden h-8 px-2.5 text-xs sm:inline-flex">Open project</Link>}
        <div className="relative">
          <button className="btn-ghost p-1.5" onClick={() => setMenu((m) => !m)} aria-label="Conversation options" aria-expanded={menu}><MoreHorizontal className="h-4 w-4" /></button>
          {menu && (
            <div className="card absolute right-0 top-10 z-30 w-56 p-1 text-sm" role="menu">
              <MenuItem icon={channel.muted ? Bell : BellOff} onClick={() => settings({ muted: !channel.muted })}>{channel.muted ? 'Unmute' : 'Mute'} for me</MenuItem>
              {channel.kind === 'GROUP' && channel.canManage && <MenuItem icon={UserPlus} onClick={() => { setMenu(false); setAdding(true); }}>Add people</MenuItem>}
              {admin && ['PROJECT', 'GENERAL', 'GROUP'].includes(channel.kind) && <MenuItem icon={Lock} onClick={() => settings({ adminsOnly: !channel.adminsOnly })}>{channel.adminsOnly ? 'Let everyone post' : 'Only admins post'}</MenuItem>}
              {channel.canManage && ['PROJECT', 'GROUP'].includes(channel.kind) && <MenuItem icon={Archive} onClick={() => settings({ archived: !channel.archived })}>{channel.archived ? 'Reopen' : 'Archive'}</MenuItem>}
              {channel.kind === 'GROUP' && <MenuItem icon={LogOut} onClick={leave}>Leave group</MenuItem>}
            </div>
          )}
        </div>
      </header>
      {chat.connection === 'offline' && (
        <div className="flex items-start gap-2 border-b border-line bg-warn/10 px-4 py-2 text-xs text-warn" role="status">
          <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>You are offline. You are reading messages saved on this device, and anything you write is kept here and sent when you are back online.</span>
        </div>
      )}
      {error ? <div className="px-4 pt-3"><ErrorBox error={error} /></div> : null}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5" onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {loading ? <Loading label="Loading messages" /> : (
          <>
            {chat.hasMore[channel.id] && chat.connection !== 'offline' && (
              <div className="mb-3 text-center"><button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => chat.loadMessages(channel.id, true).catch(setError)}>Load earlier messages</button></div>
            )}
            {!list.length && <p className="py-10 text-center text-sm text-muted">{chat.connection === 'offline' ? 'Nothing from this conversation is saved on this device yet.' : 'No messages yet. Say hello.'}</p>}
            <MessageList list={list} meId={me.user.id} admin={admin} />
          </>
        )}
      </div>
      <Composer channel={channel} />
      {adding && <AddPeople channel={channel} onClose={() => setAdding(false)} />}
    </>
  );
}

function MenuItem({ icon: Icon, onClick, children }: { icon: typeof Bell; onClick: () => void; children: React.ReactNode }) {
  return <button role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-sunken" onClick={onClick}><Icon className="h-4 w-4 text-muted" />{children}</button>;
}

function MessageList({ list, meId, admin }: { list: ChatMessage[]; meId: string; admin: boolean }) {
  const rows: React.ReactNode[] = [];
  let lastDay = '';
  let prev: ChatMessage | null = null;
  for (const m of list) {
    const d = new Date(m.createdAt).toDateString();
    if (d !== lastDay) {
      rows.push(<div key={`d-${d}`} className="my-3 flex items-center gap-3 text-[11px] font-medium text-muted"><span className="h-px flex-1 bg-line" />{dayLabel(m.createdAt)}<span className="h-px flex-1 bg-line" /></div>);
      lastDay = d; prev = null;
    }
    // Messages from the same person within five minutes sit together under one name.
    const grouped = !!prev && prev.author?.id === m.author?.id && m.type === 'TEXT' && prev.type === 'TEXT' && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 300_000;
    rows.push(<MessageRow key={m.id} m={m} grouped={grouped} mine={m.author?.id === meId} admin={admin} />);
    prev = m;
  }
  return <ol className="space-y-0.5" aria-label="Messages">{rows}</ol>;
}

function MessageRow({ m, grouped, mine, admin }: { m: ChatMessage; grouped: boolean; mine: boolean; admin: boolean }) {
  const chat = useChat()!;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.body);
  const [err, setErr] = useState<string | null>(null);
  const tone = TONES.find((t) => t.key === m.tone);
  const name = m.author?.name ?? 'Former teammate';
  async function saveEdit() {
    try { await chat.edit(m.id, text.trim()); setEditing(false); setErr(null); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save'); }
  }
  return (
    <li className={clsx('group relative flex gap-3 rounded-lg px-2 py-1 hover:bg-sunken/60', !grouped && 'mt-2')}>
      <div className="w-9 shrink-0">{!grouped && <Avatar name={name} superAdmin={m.author?.superAdmin} />}</div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold">{mine ? `${name} (you)` : name}</span>
            {m.author && <RoleBadge a={m.author} />}
            <span className="text-[11px] text-muted">{time(m.createdAt)}</span>
          </div>
        )}
        {m.deletedAt ? <p className="text-sm italic text-muted">Message deleted</p> : editing ? (
          <div className="mt-1">
            <textarea className="input min-h-[60px]" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} aria-label="Edit message" />
            {err && <p className="mt-1 text-xs text-bad">{err}</p>}
            <div className="mt-1 flex gap-2"><button className="btn-primary px-2.5 py-1 text-xs" onClick={saveEdit} disabled={!text.trim()}><Check className="h-3.5 w-3.5" />Save</button><button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => { setEditing(false); setText(m.body); }}>Cancel</button></div>
          </div>
        ) : m.type === 'UPDATE' ? (
          <div className={clsx('mt-1 rounded-lg border border-line border-l-4 bg-panel px-3 py-2', tone?.bar)}>
            <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted">Project update {tone && <span className={clsx('chip', tone.chip)}>{tone.label}</span>}</p>
            <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
          </div>
        ) : <p className="whitespace-pre-wrap break-words text-sm">{m.body}{m.editedAt && <span className="ml-1 text-[11px] text-muted">(edited)</span>}</p>}
        {m.pending && (
          m.failed ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-bad">Not sent: {m.failed}
              <button className="underline" onClick={() => chat.retry(m.clientId!)}><RotateCw className="mr-0.5 inline h-3 w-3" />Try again</button>
              <button className="underline" onClick={() => chat.discard(m.clientId!)}>Discard</button>
            </p>
          ) : <p className="mt-0.5 flex items-center gap-1 text-xs text-muted"><Clock className="h-3 w-3" />{chat.connection === 'live' ? 'Sending…' : 'Waiting for a connection. It will be sent automatically.'}</p>
        )}
      </div>
      {!m.pending && !m.deletedAt && !editing && (mine || admin) && chat.connection === 'live' && (
        <div className="absolute right-2 top-1 hidden gap-1 group-hover:flex group-focus-within:flex">
          {mine && m.type === 'TEXT' && <button className="btn-ghost p-1" onClick={() => setEditing(true)} aria-label="Edit message"><Pencil className="h-3.5 w-3.5" /></button>}
          <button className="btn-ghost p-1" onClick={() => { if (confirm('Delete this message for everyone?')) chat.remove(m.id).catch(() => undefined); }} aria-label="Delete message"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </li>
  );
}

function Composer({ channel }: { channel: ChatChannel }) {
  const chat = useChat()!;
  const [text, setText] = useState('');
  const [update, setUpdate] = useState(false);
  const [tone, setTone] = useState<Tone>('on_track');
  const ref = useRef<HTMLTextAreaElement>(null);
  const draftKey = `samptrek.chat.draft.${channel.id}`;
  useEffect(() => { try { setText(localStorage.getItem(draftKey) ?? ''); } catch { /* ignore */ } }, [draftKey]);
  useEffect(() => { try { if (text) localStorage.setItem(draftKey, text); else localStorage.removeItem(draftKey); } catch { /* ignore */ } }, [text, draftKey]);
  useEffect(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; } }, [text]);

  if (!channel.canPost) return <p className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-muted"><Lock className="h-3.5 w-3.5" />{channel.postBlock}</p>;
  const submit = () => {
    const body = text.trim();
    if (!body) return;
    chat.send(channel.id, body, update ? tone : undefined);
    setText(''); setUpdate(false);
  };
  return (
    <div className="border-t border-line px-3 py-2.5 sm:px-4">
      {channel.kind === 'PROJECT' && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={update} onChange={(e) => setUpdate(e.target.checked)} />Post as a project update</label>
          {update && TONES.map((t) => (
            <button key={t.key} type="button" onClick={() => setTone(t.key)} className={clsx('chip', tone === t.key ? t.chip : 'bg-sunken text-muted')} aria-pressed={tone === t.key}>{t.label}</button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref} rows={1} className="input max-h-40 min-h-[40px] resize-none" maxLength={4000} value={text}
          placeholder={update ? 'What changed on this project?' : `Message ${channel.kind === 'DIRECT' ? channel.name : channel.kind === 'PROJECT' ? 'the project room' : channel.name}`}
          aria-label="Message" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
        />
        <button className="btn-primary h-10 px-3" onClick={submit} disabled={!text.trim()} aria-label="Send"><Send className="h-4 w-4" /></button>
      </div>
      <p className="mt-1 hidden text-[11px] text-muted sm:block">Enter sends, Shift+Enter adds a line.{chat.connection !== 'live' ? ' Offline: messages are kept on this device and sent when you reconnect.' : ''}</p>
    </div>
  );
}

function PersonPicker({ people, selected, onToggle, single }: { people: ChatPerson[]; selected: string[]; onToggle: (id: string) => void; single?: boolean }) {
  const [q, setQ] = useState('');
  const shown = people.filter((p) => !q || `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <input className="input" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" autoFocus />
      <ul className="mt-2 max-h-64 overflow-y-auto">
        {shown.map((p) => (
          <li key={p.id}>
            <button className={clsx('flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-sunken', selected.includes(p.id) && 'bg-brand/10')} onClick={() => onToggle(p.id)}>
              <Avatar name={p.name} superAdmin={p.superAdmin} online={p.online} size="sm" />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.name}</span><span className="block truncate text-xs text-muted">{p.superAdmin ? 'Super Admin' : ROLE_LABEL[p.role] ?? p.role} · {p.email}</span></span>
              {!single && selected.includes(p.id) && <Check className="h-4 w-4 text-brand" />}
            </button>
          </li>
        ))}
        {!shown.length && <li className="px-2 py-3 text-sm text-muted">Nobody found.</li>}
      </ul>
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-4" role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{title}</h3><button className="btn-ghost p-1.5" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button></div>
        {children}
      </div>
    </div>
  );
}

function StartDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (c: ChatChannel) => void }) {
  const chat = useChat()!;
  const me = useMe()!;
  // Each kind of conversation is its own option, given by the organisation's Admin (Settings → Features & access).
  const tabs = ([['direct', 'Direct message', 'chat.direct'], ['group', 'Group', 'chat.groups'], ['project', 'Project room', 'chat.project_rooms']] as const).filter(([, , f]) => hasFeature(me, f));
  const [tab, setTab] = useState<'direct' | 'group' | 'project'>(tabs[0]?.[0] ?? 'direct');
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [projects, setProjects] = useState<{ id: string; projectCode: string; name: string }[] | null>(null);
  const [pq, setPq] = useState('');
  const [error, setError] = useState<unknown>(null);
  const others = useMemo(() => chat.people.filter((p) => p.id !== me.user.id), [chat.people, me.user.id]);
  useEffect(() => {
    if (tab !== 'project' || projects) return;
    get<{ items: { id: string; projectCode: string; name: string }[] }>('/projects?pageSize=100').then((r) => setProjects(r.items)).catch(setError);
  }, [tab, projects]);
  const go = async (fn: () => Promise<ChatChannel>) => { setError(null); try { onOpen(await fn()); } catch (e) { setError(e); } };
  return (
    <Dialog title="New conversation" onClose={onClose}>
      <div className="mb-3 flex gap-1 rounded-lg bg-sunken p-1 text-xs">
        {tabs.map(([k, l]) => (
          <button key={k} className={clsx('flex-1 rounded-md px-2 py-1.5 font-medium', tab === k ? 'bg-panel shadow-sm' : 'text-muted')} onClick={() => { setTab(k); setPicked([]); }}>{l}</button>
        ))}
      </div>
      {error ? <div className="mb-2"><ErrorBox error={error} /></div> : null}
      {!tabs.length && <p className="text-sm text-muted">Your admin has not turned on direct messages, groups or project rooms for you yet. They can do it in Settings → Features &amp; access.</p>}
      {tab === 'direct' && tabs.length > 0 && <PersonPicker single people={others.filter((p) => p.direct)} selected={picked} onToggle={(id) => go(() => post<ChatChannel>('/chat/direct', { userId: id }))} />}
      {tab === 'group' && tabs.length > 0 && (
        <>
          <input className="input mb-2" placeholder="Group name, e.g. DE launch team" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
          <PersonPicker people={others} selected={picked} onToggle={(id) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))} />
          <button className="btn-primary mt-3 w-full" disabled={!name.trim() || !picked.length} onClick={() => go(() => post<ChatChannel>('/chat/groups', { name: name.trim(), userIds: picked }))}>Create group with {picked.length || 'no'} {picked.length === 1 ? 'person' : 'people'}</button>
        </>
      )}
      {tab === 'project' && tabs.length > 0 && (
        <>
          <input className="input" placeholder="Search projects" value={pq} onChange={(e) => setPq(e.target.value)} aria-label="Search projects" autoFocus />
          <ul className="mt-2 max-h-64 overflow-y-auto">
            {!projects && <li className="px-2 py-3 text-sm text-muted">Loading projects…</li>}
            {projects?.filter((p) => !pq || `${p.projectCode} ${p.name}`.toLowerCase().includes(pq.toLowerCase())).map((p) => (
              <li key={p.id}><button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-sunken" onClick={() => go(() => post<ChatChannel>(`/chat/projects/${p.id}`))}><FolderKanban className="h-4 w-4 text-muted" /><span className="font-mono text-xs text-muted">{p.projectCode}</span><span className="truncate">{p.name}</span></button></li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}

function AddPeople({ channel, onClose }: { channel: ChatChannel; onClose: () => void }) {
  const chat = useChat()!;
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const inside = new Set((channel.members ?? []).map((m) => m.id));
  return (
    <Dialog title={`Add people to ${channel.name}`} onClose={onClose}>
      {error ? <div className="mb-2"><ErrorBox error={error} /></div> : null}
      <PersonPicker people={chat.people.filter((p) => !inside.has(p.id))} selected={picked} onToggle={(id) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))} />
      <button className="btn-primary mt-3 w-full" disabled={!picked.length} onClick={async () => { try { chat.upsertChannel(await post<ChatChannel>(`/chat/channels/${channel.id}/members`, { userIds: picked })); onClose(); } catch (e) { setError(e); } }}>Add {picked.length || ''}</button>
    </Dialog>
  );
}
