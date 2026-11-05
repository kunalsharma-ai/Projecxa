'use client';
import clsx from 'clsx';
import { Check, Copy, Download, FileText, Loader2, Mic, MicOff, Paperclip, PhoneOff, Send, Sparkles, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { get, post } from '@/lib/api';
import { type AiAction, type AiDoc, type AiStatus, type ChatMessage, uploadDoc } from '@/lib/ai';
import { DisplayBlock } from './displays';
import { Markdown } from './markdown';
import { useVoice } from './voice';

const EXAMPLES = [
  'Show me all active projects',
  'Which projects are delayed?',
  'What tasks are overdue?',
  'Who has the highest workload?',
  "Summarise today's project activities",
  'How much is invoiced but not yet paid?',
];

function ActionCard({ a, onChange }: { a: AiAction; onChange: (a: AiAction) => void }) {
  const [busy, setBusy] = useState<'' | 'confirm' | 'cancel'>('');
  const [error, setError] = useState<unknown>(null);
  const decide = async (what: 'confirm' | 'cancel') => {
    setBusy(what);
    setError(null);
    try {
      onChange(await post<AiAction>(`/ai/actions/${a.id}/${what}`));
    } catch (e) {
      setError(e);
    } finally {
      setBusy('');
    }
  };
  const tone = a.status === 'done' ? 'border-ok/40 bg-ok/5' : a.status === 'failed' ? 'border-bad/40 bg-bad/5' : a.status === 'pending' ? 'border-brand/40 bg-brand/5' : 'border-line bg-sunken/50';
  return (
    <div className={clsx('rounded-lg border p-3 text-sm', tone)} data-action={a.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted">{a.status === 'pending' ? 'Needs your confirmation' : a.status === 'done' ? 'Done' : a.status === 'failed' ? 'Failed' : a.status === 'expired' ? 'Expired' : 'Cancelled'}</div>
          <div className="font-medium">{a.summary}</div>
          {a.error && <div className="mt-1 text-xs text-bad">{a.error}</div>}
        </div>
        {a.status === 'pending' && (
          <div className="flex shrink-0 gap-2">
            <button className="btn-ghost px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => decide('cancel')}>Cancel</button>
            <button className="btn-primary px-3 py-1.5 text-xs" disabled={!!busy} onClick={() => decide('confirm')}>{busy === 'confirm' ? 'Working…' : 'Confirm'}</button>
          </div>
        )}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Assistant({ m, onAction }: { m: ChatMessage; onAction: (a: AiAction) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3" data-role="assistant">
      {m.text && <Markdown text={m.text} />}
      {m.displays?.map((d, i) => <DisplayBlock key={i} d={d} />)}
      {m.actions?.map((a) => <ActionCard key={a.id} a={a} onChange={onAction} />)}
      {m.text.length > 280 && (
        <div className="flex gap-1">
          <button className="btn-ghost h-7 px-2 text-xs" onClick={() => { navigator.clipboard?.writeText(m.text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy'}</button>
          <button className="btn-ghost h-7 px-2 text-xs" onClick={() => download(`projexa-copilot-${new Date(m.createdAt).toISOString().slice(0, 10)}.md`, m.text)}><Download className="h-3.5 w-3.5" />Download</button>
        </div>
      )}
    </div>
  );
}

const VOICE_LABEL = { idle: '', connecting: 'Connecting…', listening: 'Listening', thinking: 'Looking it up…', speaking: 'Speaking', error: 'Voice stopped' } as const;

export function CopilotChat({ conversationId, onConversation, compact, draft }: { conversationId: string | null; onConversation: (id: string | null, title?: string) => void; compact?: boolean; draft?: string }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // A question typed elsewhere (the command center's copilot box) arrives as a draft to review and send.
  const [input, setInput] = useState(draft ?? '');
  const [docs, setDocs] = useState<AiDoc[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const end = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const convRef = useRef(conversationId);
  convRef.current = conversationId;

  const refreshStatus = useCallback(() => get<AiStatus>('/ai/status').then(setStatus).catch(setError), []);
  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const load = useCallback(async (id: string) => {
    const c = await get<{ id: string; title: string; messages: ChatMessage[] }>(`/ai/conversations/${id}`);
    setMessages(c.messages);
    return c;
  }, []);
  useEffect(() => {
    if (conversationId) load(conversationId).catch(setError);
    else setMessages([]);
  }, [conversationId, load]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages, sending]);

  const ask = useCallback(async (text: string, conv: string | null) => {
    const r = await post<{ conversationId: string; title: string; messages: ChatMessage[] }>('/ai/chat', { conversationId: conv, message: text, documentIds: [], path: pathname });
    if (r.conversationId !== convRef.current) onConversation(r.conversationId, r.title);
    return { conversationId: r.conversationId, answer: r.messages.filter((m) => m.role === 'assistant').map((m) => m.text).join('\n') };
  }, [pathname, onConversation]);

  const voice = useVoice({
    ask,
    onTurn: (id) => {
      if (id !== convRef.current) onConversation(id);
      else load(id).catch(() => undefined);
      refreshStatus();
    },
  });

  async function send(text = input) {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);
    const optimistic: ChatMessage = { id: `tmp-${Date.now()}`, role: 'user', text: t, channel: 'text', createdAt: new Date().toISOString(), documents: docs.map((d) => ({ id: d.id, name: d.name })) };
    setMessages((m) => [...m, optimistic]);
    setInput('');
    const attached = docs;
    setDocs([]);
    try {
      const r = await post<{ conversationId: string; title: string; messages: ChatMessage[] }>('/ai/chat', { conversationId, message: t, documentIds: attached.map((d) => d.id), path: pathname });
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), ...r.messages]);
      if (r.conversationId !== conversationId) onConversation(r.conversationId, r.title);
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(t);
      setDocs(attached);
      setError(e);
      const cid = (e as { conversationId?: string }).conversationId;
      if (cid && !conversationId) onConversation(cid);
    } finally {
      setSending(false);
      refreshStatus();
    }
  }

  async function attach(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const f of Array.from(files).slice(0, 5 - docs.length)) {
        const d = await uploadDoc(f);
        setDocs((cur) => [...cur, d]);
      }
    } catch (e) {
      setError(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const updateAction = (a: AiAction) => setMessages((ms) => ms.map((m) => (m.actions?.some((x) => x.id === a.id) ? { ...m, actions: m.actions.map((x) => (x.id === a.id ? a : x)) } : m)));

  if (status && !status.enabled) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-sm">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="font-medium">{status.reason === 'not_configured' ? 'The AI copilot is not set up yet' : status.reason === 'turned_off' ? 'The AI copilot is turned off' : 'The AI copilot is not available for your role'}</p>
          <p className="mt-1 text-sm text-muted">{status.reason === 'not_configured' ? 'An admin adds a Google Gemini API key under Settings → Integrations.' : 'An admin can change this under Settings → AI copilot.'}</p>
        </div>
      </div>
    );
  }

  const live = voice.state !== 'idle' && voice.state !== 'error';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={clsx('min-h-0 flex-1 overflow-y-auto', compact ? 'px-4 py-4' : 'px-4 py-6 sm:px-6')}>
        <div className="mx-auto max-w-3xl space-y-5">
          {messages.length === 0 && !sending && (
            <div className="py-6 text-center">
              <Sparkles className="mx-auto mb-2 h-7 w-7 text-brand" />
              <p className="font-medium">Ask about your projects, fieldwork, tasks, team or finances</p>
              <p className="mt-1 text-sm text-muted">Answers come from PROJEXA records you can see. Changes are only made after you confirm them.</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {EXAMPLES.slice(0, compact ? 4 : 6).map((x) => <button key={x} className="chip bg-sunken px-3 py-1.5 text-sm text-ink hover:bg-line" onClick={() => send(x)}>{x}</button>)}
              </div>
            </div>
          )}
          {messages.map((m) => m.role === 'user' ? (
            <div key={m.id} className="flex justify-end" data-role="user">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-sm text-brand-ink">
                {m.channel === 'voice' && <Mic className="mr-1 inline h-3.5 w-3.5 opacity-80" />}
                <span className="whitespace-pre-wrap">{m.text}</span>
                {!!m.documents?.length && <div className="mt-1 flex flex-wrap gap-1">{m.documents.map((d) => <span key={d.id} className="chip bg-white/20 text-brand-ink"><FileText className="h-3 w-3" />{d.name}</span>)}</div>}
              </div>
            </div>
          ) : (
            <Assistant key={m.id} m={m} onAction={updateAction} />
          ))}
          {sending && <div className="flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Looking it up…</div>}
          <div ref={end} />
        </div>
      </div>

      <div className="border-t border-line bg-panel px-3 py-3 sm:px-4">
        <div className="mx-auto max-w-3xl space-y-2">
          <ErrorBox error={error} />
          {(live || voice.error) && (
            <div className="rounded-lg border border-line bg-sunken/60 p-3 text-sm" role="status" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={clsx('h-2.5 w-2.5 rounded-full', voice.state === 'listening' ? 'animate-pulse bg-ok' : voice.state === 'speaking' ? 'bg-brand' : voice.state === 'error' ? 'bg-bad' : 'bg-warn')} />
                  <span className="font-medium">{VOICE_LABEL[voice.state]}</span>
                  {voice.mode && <span className="text-xs text-muted">{voice.mode === 'live' ? `Gemini Live · ${status?.liveModel}` : 'Browser speech'}</span>}
                </div>
                {live && (
                  <div className="flex gap-2">
                    <button className="btn-ghost h-8 px-2.5 text-xs" onClick={voice.toggleMute} aria-pressed={voice.muted}>{voice.muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}{voice.muted ? 'Unmute' : 'Mute'}</button>
                    <button className="btn-danger h-8 px-2.5 text-xs" onClick={voice.stop}><PhoneOff className="h-3.5 w-3.5" />End</button>
                  </div>
                )}
              </div>
              {voice.error && <p className="mt-1 text-xs text-warn">{voice.error}</p>}
              {voice.heard && <p className="mt-2 text-xs"><span className="text-muted">You: </span>{voice.heard}</p>}
              {voice.said && <p className="mt-1 text-xs"><span className="text-muted">Copilot: </span>{voice.said}</p>}
            </div>
          )}
          {docs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {docs.map((d) => <span key={d.id} className="chip bg-sunken text-ink"><FileText className="h-3 w-3" />{d.name}<button aria-label={`Remove ${d.name}`} onClick={() => setDocs(docs.filter((x) => x.id !== d.id))}><X className="h-3 w-3" /></button></span>)}
            </div>
          )}
          <div className="flex items-end gap-2">
            {status?.features.documents && (
              <>
                <input ref={fileRef} type="file" className="hidden" multiple accept=".pdf,.txt,.md,.csv,.html,.json,.png,.jpg,.jpeg,.webp" onChange={(e) => attach(e.target.files)} />
                <button className="btn-ghost h-10 w-10 shrink-0 justify-center p-0" aria-label="Attach a file" title="Attach a PDF, text or image (up to 10 MB)" disabled={uploading || docs.length >= 5} onClick={() => fileRef.current?.click()}>{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}</button>
              </>
            )}
            <textarea
              className="input min-h-10 flex-1 resize-none py-2"
              rows={Math.min(5, Math.max(1, input.split('\n').length))}
              placeholder={live ? 'Talking… you can also type' : 'Ask the copilot…'}
              aria-label="Message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            {status?.features.voice && (
              <button className={clsx('h-10 w-10 shrink-0 justify-center p-0', live ? 'btn-danger' : 'btn-ghost')} aria-label={live ? 'End voice' : 'Talk to the copilot'} title={live ? 'End voice' : 'Talk to the copilot'}
                onClick={async () => { if (live) voice.stop(); else { const id = await voice.start(conversationId, pathname); if (id && id !== conversationId) onConversation(id); } }}>
                {live ? <PhoneOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
            )}
            <button className="btn-primary h-10 w-10 shrink-0 justify-center p-0" aria-label="Send" disabled={!input.trim() || sending} onClick={() => send()}><Send className="h-4 w-4" /></button>
          </div>
          {status && <p className="text-[11px] text-muted">{status.usage.mineToday} of {status.usage.myDailyLimit} questions today · Answers can be wrong; check figures before acting on them.</p>}
        </div>
      </div>
    </div>
  );
}
