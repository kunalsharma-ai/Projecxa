'use client';
/**
 * Team chat on the device (docs/TEAM_CHAT.md).
 *
 * One live connection per signed-in tab (Server-Sent Events from this SampTrek server; no outside chat service).
 * Recent messages are kept in this browser, so they can be read while offline. Messages written while offline go
 * into an outbox with an id from this device and are sent in order when the connection is back; the server saves
 * each id once, so a retry never makes a double.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { API_URL, ApiError, api, get, post } from '@/lib/api';

export type Tone = 'on_track' | 'at_risk' | 'blocked' | 'done';
export interface ChatAuthor { id: string; name: string; role: string; superAdmin: boolean }
export interface ChatMessage {
  id: string; seq: number; channelId: string; type: 'TEXT' | 'UPDATE' | string; tone: Tone | null; body: string; clientId: string | null;
  author: ChatAuthor | null; createdAt: string; editedAt: string | null; deletedAt: string | null;
  /** On this device only: waiting for a connection, or refused by the server. */
  pending?: boolean; failed?: string;
}
export interface ChatChannel {
  id: string; kind: 'GENERAL' | 'ANNOUNCEMENTS' | 'PROJECT' | 'DIRECT' | 'GROUP'; name: string;
  project: { id: string; projectCode: string; name: string; status: string } | null; other: ChatAuthor | null; members: ChatAuthor[] | null;
  adminsOnly: boolean; canPost: boolean; postBlock: string | null; canManage: boolean; archived: boolean; muted: boolean;
  readSeq: number; unread: number; lastMessage: ChatMessage | null; lastMessageAt: string | null;
}
export interface ChatPerson { id: string; name: string; email: string; role: string; superAdmin: boolean; online: boolean; lastSeenAt: string | null }
interface Outgoing { clientId: string; channelId: string; body: string; type: 'TEXT' | 'UPDATE'; tone?: Tone; createdAt: string; failed?: string }
export type Connection = 'live' | 'connecting' | 'offline';

interface Saved { v: 1; channels: ChatChannel[]; messages: Record<string, ChatMessage[]>; people: ChatPerson[]; lastSeq: number; syncedAt: string | null; outbox: Outgoing[] }

const KEEP_PER_CHANNEL = 150;
const KEEP_CHANNELS = 60;
const storageKey = (userId: string) => `samptrek.chat.v1.${userId}`;

function load(userId: string): Saved | null {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const s = raw ? (JSON.parse(raw) as Saved) : null;
    return s?.v === 1 ? s : null;
  } catch { return null; }
}
function save(userId: string, s: Saved) {
  const channels = s.channels.slice(0, KEEP_CHANNELS);
  const keep = new Set(channels.map((c) => c.id));
  const messages = Object.fromEntries(Object.entries(s.messages).filter(([id]) => keep.has(id)).map(([id, list]) => [id, list.filter((m) => !m.pending).slice(-KEEP_PER_CHANNEL)]));
  try { localStorage.setItem(storageKey(userId), JSON.stringify({ ...s, channels, messages })); }
  catch { try { localStorage.setItem(storageKey(userId), JSON.stringify({ ...s, channels, messages: {} })); } catch { /* storage full or blocked */ } }
}
/** Forget this person's saved chat (sign out). */
export function clearChatCache(userId: string) {
  try { localStorage.removeItem(storageKey(userId)); } catch { /* ignore */ }
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '') : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);
const isNetwork = (e: unknown) => !(e instanceof ApiError);

/** Adds or replaces messages by id; a server copy replaces this device's pending copy with the same clientId. */
function merge(list: ChatMessage[] = [], incoming: ChatMessage[]) {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) {
    if (m.clientId) byId.delete(`local-${m.clientId}`);
    byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => (a.pending ? Infinity : a.seq) - (b.pending ? Infinity : b.seq) || a.createdAt.localeCompare(b.createdAt));
}

interface ChatApi {
  ready: boolean;
  connection: Connection;
  channels: ChatChannel[];
  people: ChatPerson[];
  messages: Record<string, ChatMessage[]>;
  /** Conversations whose earlier messages are not all on this device yet. */
  hasMore: Record<string, boolean>;
  waiting: number;
  unread: number;
  active: string | null;
  setActive: (id: string | null) => void;
  loadMessages: (channelId: string, older?: boolean) => Promise<void>;
  send: (channelId: string, body: string, update?: Tone) => void;
  retry: (clientId: string) => void;
  discard: (clientId: string) => void;
  edit: (id: string, body: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refreshChannels: () => Promise<ChatChannel[] | null>;
  upsertChannel: (c: ChatChannel) => void;
}
const Ctx = createContext<ChatApi | null>(null);
export const useChat = () => useContext(Ctx);

export function ChatProvider({ userId, enabled, children }: { userId: string; enabled: boolean; children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [hasMore, setHasMore] = useState<Record<string, boolean>>({});
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [active, setActiveState] = useState<string | null>(null);
  const sync = useRef({ lastSeq: 0, syncedAt: null as string | null });
  const outboxRef = useRef<Outgoing[]>([]);
  const activeRef = useRef<string | null>(null);
  const channelsRef = useRef<ChatChannel[]>([]);
  const flushing = useRef(false);
  outboxRef.current = outbox;
  channelsRef.current = channels;

  // Saved copy first, so the chat opens (and reads) without a connection.
  useEffect(() => {
    if (!enabled) return;
    const s = load(userId);
    if (s) {
      setChannels(s.channels); setMessages(s.messages); setPeople(s.people); setOutbox(s.outbox);
      sync.current = { lastSeq: s.lastSeq, syncedAt: s.syncedAt };
      setMessages((cur) => {
        const out = { ...cur };
        for (const o of s.outbox) out[o.channelId] = merge(out[o.channelId], [localCopy(o, userId)]);
        return out;
      });
    }
    setReady(true);
  }, [userId, enabled]);

  // Write the saved copy shortly after anything changes.
  useEffect(() => {
    if (!enabled || !ready) return;
    const t = setTimeout(() => save(userId, { v: 1, channels, messages, people, lastSeq: sync.current.lastSeq, syncedAt: sync.current.syncedAt, outbox }), 400);
    return () => clearTimeout(t);
  }, [enabled, ready, userId, channels, messages, people, outbox]);

  const applyIncoming = useCallback((items: ChatMessage[]) => {
    if (!items.length) return;
    setMessages((cur) => {
      const out = { ...cur };
      const by = new Map<string, ChatMessage[]>();
      for (const m of items) by.set(m.channelId, [...(by.get(m.channelId) ?? []), m]);
      for (const [ch, list] of by) out[ch] = merge(out[ch], list);
      return out;
    });
    setChannels((cur) => cur.map((c) => {
      const mine = items.filter((m) => m.channelId === c.id);
      if (!mine.length) return c;
      const newest = mine.reduce((a, b) => (b.seq > a.seq ? b : a));
      const isNew = mine.filter((m) => m.seq > c.readSeq && m.author?.id !== userId && !m.deletedAt && !(c.lastMessage && m.seq <= c.lastMessage.seq));
      const viewing = activeRef.current === c.id && typeof document !== 'undefined' && document.visibilityState === 'visible';
      const later = !c.lastMessage || newest.seq >= c.lastMessage.seq;
      return { ...c, lastMessage: later ? newest : c.lastMessage, lastMessageAt: later ? newest.createdAt : c.lastMessageAt, unread: viewing ? 0 : c.unread + isNew.length };
    }));
    sync.current.lastSeq = Math.max(sync.current.lastSeq, ...items.map((m) => m.seq));
  }, [userId]);

  const refreshChannels = useCallback(async () => {
    try {
      const list = await get<ChatChannel[]>('/chat/channels');
      setChannels(list);
      return list;
    } catch { return null; }
  }, []);
  const upsertChannel = useCallback((c: ChatChannel) => setChannels((cur) => (cur.some((x) => x.id === c.id) ? cur.map((x) => (x.id === c.id ? c : x)) : [...cur, c])), []);

  const markRead = useCallback((channelId: string) => {
    const list = messages[channelId] ?? [];
    const top = list.filter((m) => !m.pending).at(-1)?.seq;
    const c = channelsRef.current.find((x) => x.id === channelId);
    if (!top || !c || (c.readSeq >= top && !c.unread)) return;
    setChannels((cur) => cur.map((x) => (x.id === channelId ? { ...x, unread: 0, readSeq: Math.max(x.readSeq, top) } : x)));
    post(`/chat/channels/${channelId}/read`, { seq: top }).catch(() => undefined);
  }, [messages]);

  const setActive = useCallback((id: string | null) => { activeRef.current = id; setActiveState(id); }, []);
  useEffect(() => { if (active && connection === 'live') markRead(active); }, [active, connection, markRead, messages]);

  /** Sends what is waiting, oldest first. Stops at the first connection problem and tries again later. */
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      for (const o of outboxRef.current.filter((x) => !x.failed)) {
        try {
          const m = await post<ChatMessage>(`/chat/channels/${o.channelId}/messages`, { body: o.body, clientId: o.clientId, type: o.type, ...(o.tone ? { tone: o.tone } : {}) });
          outboxRef.current = outboxRef.current.filter((x) => x.clientId !== o.clientId);
          setOutbox(outboxRef.current);
          applyIncoming([m]);
        } catch (e) {
          if (isNetwork(e)) { setConnection('offline'); break; }
          const failed = e instanceof Error ? e.message : 'Not sent';
          outboxRef.current = outboxRef.current.map((x) => (x.clientId === o.clientId ? { ...x, failed } : x));
          setOutbox(outboxRef.current);
          setMessages((cur) => ({ ...cur, [o.channelId]: (cur[o.channelId] ?? []).map((m) => (m.clientId === o.clientId && m.pending ? { ...m, failed } : m)) }));
        }
      }
    } finally { flushing.current = false; }
  }, [applyIncoming]);

  /** Everything missed while away: new messages, edits and deletions; then the channel list and the outbox. */
  const catchUp = useCallback(async () => {
    try {
      for (let i = 0; i < 20; i++) {
        const q = new URLSearchParams({ after: String(sync.current.lastSeq) });
        if (sync.current.syncedAt) q.set('changedSince', sync.current.syncedAt);
        // A new device starts from now; conversations load when someone opens them.
        else q.set('latestOnly', 'true');
        const r = await get<{ items: ChatMessage[]; more: boolean; latestSeq: number; serverTime: string }>(`/chat/sync?${q}`);
        applyIncoming(r.items);
        sync.current.lastSeq = Math.max(sync.current.lastSeq, r.latestSeq);
        if (!r.more) { sync.current.syncedAt = r.serverTime; break; }
      }
      await Promise.all([refreshChannels(), get<ChatPerson[]>('/chat/people').then(setPeople).catch(() => undefined)]);
      await flush();
    } catch (e) {
      if (isNetwork(e)) setConnection('offline');
    }
  }, [applyIncoming, refreshChannels, flush]);

  // The live connection. EventSource reconnects by itself; when the server refuses, try again on a timer.
  useEffect(() => {
    if (!enabled || !ready) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let wait = 2000;
    let stopped = false;
    const open = () => {
      if (stopped) return;
      es?.close();
      setConnection(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'connecting');
      es = new EventSource(`${API_URL}/api/v1/chat/stream`, { withCredentials: true });
      es.addEventListener('hello', () => { wait = 2000; setConnection('live'); catchUp(); });
      es.addEventListener('message', (e) => applyIncoming([JSON.parse((e as MessageEvent).data)]));
      es.addEventListener('channel', () => { refreshChannels(); });
      es.addEventListener('read', (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { channelId: string; seq: number };
        setChannels((cur) => cur.map((c) => (c.id === d.channelId ? { ...c, unread: 0, readSeq: Math.max(c.readSeq, d.seq) } : c)));
      });
      es.addEventListener('presence', (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { userId: string; online: boolean };
        setPeople((cur) => cur.map((p) => (p.id === d.userId ? { ...p, online: d.online } : p)));
      });
      es.onerror = () => {
        setConnection(navigator.onLine === false ? 'offline' : 'connecting');
        if (es?.readyState === EventSource.CLOSED) {
          clearTimeout(retry);
          retry = setTimeout(open, wait);
          wait = Math.min(wait * 2, 60_000);
        }
      };
    };
    open();
    const online = () => { wait = 2000; open(); };
    const offline = () => setConnection('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    // Safety net: catch up every minute, in case a message went past while the connection was changing.
    const poll = setInterval(() => { if (es?.readyState === EventSource.OPEN) catchUp(); }, 60_000);
    return () => { stopped = true; es?.close(); clearTimeout(retry); clearInterval(poll); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, [enabled, ready, applyIncoming, catchUp, refreshChannels]);

  const loadMessages = useCallback(async (channelId: string, older = false) => {
    const have = (messages[channelId] ?? []).filter((m) => !m.pending);
    const q = older && have[0] ? `?before=${have[0].seq}` : '';
    try {
      const r = await get<{ items: ChatMessage[]; more: boolean }>(`/chat/channels/${channelId}/messages${q}`);
      setMessages((cur) => ({ ...cur, [channelId]: merge(cur[channelId], r.items) }));
      setHasMore((cur) => ({ ...cur, [channelId]: older || !have.length || have[0].seq >= (r.items[0]?.seq ?? 0) ? r.more : cur[channelId] ?? r.more }));
    } catch (e) {
      if (isNetwork(e)) setConnection('offline');
      else throw e;
    }
  }, [messages]);

  const send = useCallback((channelId: string, body: string, update?: Tone) => {
    const o: Outgoing = { clientId: newId(), channelId, body, type: update ? 'UPDATE' : 'TEXT', ...(update ? { tone: update } : {}), createdAt: new Date().toISOString() };
    outboxRef.current = [...outboxRef.current, o];
    setOutbox(outboxRef.current);
    setMessages((cur) => ({ ...cur, [channelId]: merge(cur[channelId], [localCopy(o, userId, people.find((p) => p.id === userId))]) }));
    flush();
  }, [flush, userId, people]);

  const retry = useCallback((clientId: string) => {
    outboxRef.current = outboxRef.current.map((x) => (x.clientId === clientId ? { ...x, failed: undefined } : x));
    setOutbox(outboxRef.current);
    setMessages((cur) => Object.fromEntries(Object.entries(cur).map(([k, list]) => [k, list.map((m) => (m.clientId === clientId && m.pending ? { ...m, failed: undefined } : m))])));
    flush();
  }, [flush]);
  const discard = useCallback((clientId: string) => {
    outboxRef.current = outboxRef.current.filter((x) => x.clientId !== clientId);
    setOutbox(outboxRef.current);
    setMessages((cur) => Object.fromEntries(Object.entries(cur).map(([k, list]) => [k, list.filter((m) => !(m.pending && m.clientId === clientId))])));
  }, []);

  const edit = useCallback(async (id: string, body: string) => { applyIncoming([await api<ChatMessage>(`/chat/messages/${id}`, { method: 'PATCH', json: { body } })]); }, [applyIncoming]);
  const remove = useCallback(async (id: string) => { applyIncoming([await api<ChatMessage>(`/chat/messages/${id}`, { method: 'DELETE' })]); }, [applyIncoming]);

  const value = useMemo<ChatApi>(() => ({
    ready, connection, channels, people, messages, hasMore, active, setActive, loadMessages, send, retry, discard, edit, remove, refreshChannels, upsertChannel,
    waiting: outbox.length,
    unread: channels.filter((c) => !c.muted).reduce((n, c) => n + c.unread, 0),
  }), [ready, connection, channels, people, messages, hasMore, active, setActive, loadMessages, send, retry, discard, edit, remove, refreshChannels, upsertChannel, outbox.length]);

  return <Ctx.Provider value={enabled ? value : null}>{children}</Ctx.Provider>;
}

function localCopy(o: Outgoing, userId: string, me?: ChatPerson): ChatMessage {
  return {
    id: `local-${o.clientId}`, seq: Number.MAX_SAFE_INTEGER, channelId: o.channelId, type: o.type, tone: o.tone ?? null, body: o.body, clientId: o.clientId,
    author: { id: userId, name: me?.name ?? 'You', role: me?.role ?? '', superAdmin: !!me?.superAdmin }, createdAt: o.createdAt, editedAt: null, deletedAt: null, pending: true, failed: o.failed,
  };
}
