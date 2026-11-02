'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, post } from '@/lib/api';
import type { AiAction, Display } from '@/lib/ai';

/**
 * Talking to the copilot.
 * - "live": Gemini Live in the browser over a WebSocket with a short-lived token from the server.
 *   The microphone streams 16 kHz PCM; answers come back as 24 kHz PCM audio with transcripts.
 *   Tool calls are sent to the server, which runs them with the person's permissions.
 * - "browser": the browser's own speech recognition and speech synthesis around the normal chat,
 *   used when the Live model is not available on the key or the browser cannot stream audio.
 */

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
export interface VoiceEvents {
  /** A spoken exchange finished and was saved: reload the conversation. */
  onTurn: (conversationId: string) => void;
  /** A tool ran during the call (show its tables and confirmation cards). */
  onTool?: (r: { displays: Display[]; action: AiAction | null }) => void;
  /** Browser mode: send recognised speech through the normal chat and return the answer to speak. */
  ask: (text: string, conversationId: string | null) => Promise<{ conversationId: string; answer: string }>;
}

const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor(o) { super(); this.ratio = sampleRate / 16000; this.buf = []; this.acc = 0; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.n++;
      if (this.n >= this.ratio) { this.buf.push(this.acc / this.n); this.acc = 0; this.n -= this.ratio; if (this.n < 0) this.n = 0; }
    }
    if (this.buf.length >= 1600) {
      const out = new Int16Array(this.buf.length);
      for (let i = 0; i < this.buf.length; i++) { const s = Math.max(-1, Math.min(1, this.buf[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      this.port.postMessage(out.buffer, [out.buffer]);
      this.buf = [];
    }
    return true;
  }
}
registerProcessor('pcm16', Pcm16);
`;

function b64(buf: ArrayBuffer) {
  let s = '';
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

type SR = { start(): void; stop(): void; abort(): void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const speechRecognition = () => (typeof window === 'undefined' ? null : ((window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition ?? null));
export const browserVoiceSupported = () => !!speechRecognition() && typeof window !== 'undefined' && 'speechSynthesis' in window;

export function useVoice(ev: VoiceEvents) {
  const [state, setState] = useState<VoiceState>('idle');
  const [mode, setMode] = useState<'live' | 'browser' | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState('');
  const [said, setSaid] = useState('');
  const r = useRef<{ ws?: WebSocket; mic?: MediaStream; inCtx?: AudioContext; outCtx?: AudioContext; node?: AudioWorkletNode; next: number; sources: AudioBufferSourceNode[]; conv: string | null; user: string; model: string; muted: boolean; sr?: SR; stopped: boolean }>({ next: 0, sources: [], conv: null, user: '', model: '', muted: false, stopped: true });
  const evRef = useRef(ev);
  evRef.current = ev;

  const stopPlayback = () => {
    for (const s of r.current.sources) try { s.stop(); } catch { /* already ended */ }
    r.current.sources = [];
    r.current.next = 0;
  };

  const stop = useCallback(() => {
    const c = r.current;
    c.stopped = true;
    try { c.ws?.close(); } catch { /* closed */ }
    c.mic?.getTracks().forEach((t) => t.stop());
    c.node?.disconnect();
    c.inCtx?.close().catch(() => undefined);
    c.outCtx?.close().catch(() => undefined);
    try { c.sr?.abort(); } catch { /* not running */ }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    Object.assign(c, { ws: undefined, mic: undefined, inCtx: undefined, outCtx: undefined, node: undefined, sr: undefined, sources: [], next: 0 });
    setState('idle');
    setMode(null);
    setHeard('');
    setSaid('');
  }, []);
  useEffect(() => stop, [stop]);

  const play = (pcm: ArrayBuffer) => {
    const c = r.current;
    if (!c.outCtx) return;
    const i16 = new Int16Array(pcm);
    const buf = c.outCtx.createBuffer(1, i16.length, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < i16.length; i++) ch[i] = i16[i] / 0x8000;
    const src = c.outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(c.outCtx.destination);
    const at = Math.max(c.outCtx.currentTime + 0.02, c.next);
    src.start(at);
    c.next = at + buf.duration;
    c.sources.push(src);
    src.onended = () => {
      c.sources = c.sources.filter((x) => x !== src);
      if (!c.sources.length && !c.stopped) setState('listening');
    };
    setState('speaking');
  };

  async function startMic() {
    const c = r.current;
    c.mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    c.inCtx = new AudioContext();
    await c.inCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
    const srcNode = c.inCtx.createMediaStreamSource(c.mic);
    c.node = new AudioWorkletNode(c.inCtx, 'pcm16');
    c.node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (c.muted || c.ws?.readyState !== WebSocket.OPEN) return;
      c.ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64(e.data), mimeType: 'audio/pcm;rate=16000' } } }));
    };
    srcNode.connect(c.node);
  }

  async function handle(msg: Record<string, any>) {
    const c = r.current;
    if (msg.setupComplete) {
      await startMic();
      setState('listening');
      return;
    }
    if (msg.toolCall?.functionCalls) {
      setState('thinking');
      const responses = [];
      for (const fc of msg.toolCall.functionCalls as { id: string; name: string; args?: Record<string, unknown> }[]) {
        try {
          const out = await post<{ response: unknown; displays: Display[]; action: AiAction | null }>('/ai/voice/tool', { conversationId: c.conv, name: fc.name, args: fc.args ?? {} });
          evRef.current.onTool?.({ displays: out.displays, action: out.action });
          responses.push({ id: fc.id, name: fc.name, response: { result: out.response } });
        } catch (e) {
          responses.push({ id: fc.id, name: fc.name, response: { error: (e as Error).message } });
        }
      }
      c.ws?.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
      return;
    }
    const sc = msg.serverContent;
    if (!sc) {
      if (msg.goAway) setError('The voice session is about to end. Start it again to keep talking.');
      return;
    }
    if (sc.interrupted) stopPlayback();
    if (sc.inputTranscription?.text) {
      c.user += sc.inputTranscription.text;
      setHeard(c.user);
    }
    if (sc.outputTranscription?.text) {
      c.model += sc.outputTranscription.text;
      setSaid(c.model);
    }
    for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data && String(p.inlineData.mimeType ?? '').startsWith('audio/pcm')) play(unb64(p.inlineData.data));
    if (sc.turnComplete) {
      const user = c.user.trim(), model = c.model.trim();
      c.user = '';
      c.model = '';
      if (c.conv && (user || model)) {
        await post('/ai/voice/turn', { conversationId: c.conv, userText: user, assistantText: model }).catch(() => undefined);
        evRef.current.onTurn(c.conv);
      }
    }
  }

  async function startLive(conversationId: string | null, path: string) {
    const c = r.current;
    const s = await post<{ conversationId: string; url: string; setup: unknown }>('/ai/voice/session', { conversationId, path });
    c.conv = s.conversationId;
    c.outCtx = new AudioContext({ sampleRate: 24000 });
    const ws = new WebSocket(s.url);
    c.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        ws.send(JSON.stringify(s.setup));
        resolve();
      };
      ws.onerror = () => reject(new Error('Could not connect to the voice service'));
    });
    ws.onmessage = async (e) => {
      try {
        const text = typeof e.data === 'string' ? e.data : await (e.data as Blob).text();
        await handle(JSON.parse(text));
      } catch (err) {
        setError((err as Error).message);
      }
    };
    ws.onclose = (e) => {
      if (!c.stopped) {
        setError(e.reason ? `Voice session ended: ${e.reason}` : 'The voice session ended.');
        stop();
      }
    };
    return s.conversationId;
  }

  function startBrowser(conversationId: string | null) {
    const c = r.current;
    const Ctor = speechRecognition();
    if (!Ctor) throw new Error('This browser has no speech recognition. Use Chrome or Edge, or type instead.');
    c.conv = conversationId;
    const listen = () => {
      if (c.stopped) return;
      const sr = new Ctor();
      c.sr = sr;
      sr.lang = navigator.language || 'en-US';
      sr.interimResults = true;
      sr.continuous = false;
      let finalText = '';
      sr.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
          else interim += e.results[i][0].transcript;
        }
        setHeard(finalText + interim);
      };
      sr.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') setError(`Speech recognition: ${e.error}`); };
      sr.onend = async () => {
        if (c.stopped) return;
        if (!finalText.trim() || c.muted) return listen();
        setState('thinking');
        try {
          const out = await evRef.current.ask(finalText.trim(), c.conv);
          c.conv = out.conversationId;
          evRef.current.onTurn(out.conversationId);
          setSaid(out.answer);
          setState('speaking');
          const u = new SpeechSynthesisUtterance(out.answer.replace(/[*#`_]/g, '').slice(0, 1200));
          u.lang = sr.lang;
          u.onend = () => { setState('listening'); setHeard(''); listen(); };
          window.speechSynthesis.speak(u);
        } catch (e) {
          setError((e as Error).message);
          setState('listening');
          listen();
        }
      };
      sr.start();
      setState('listening');
    };
    listen();
  }

  const start = useCallback(async (conversationId: string | null, path: string, prefer: 'live' | 'browser' = 'live') => {
    const c = r.current;
    stop();
    c.stopped = false;
    c.user = '';
    c.model = '';
    setError(null);
    setState('connecting');
    if (prefer === 'live' && typeof AudioWorkletNode !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function') {
      try {
        const id = await startLive(conversationId, path);
        setMode('live');
        return id;
      } catch (e) {
        const c2 = r.current;
        try { c2.ws?.close(); } catch { /* closed */ }
        c2.mic?.getTracks().forEach((t) => t.stop());
        // A 4xx from our own server (turned off, limits) is final; otherwise fall back to the browser's speech.
        if (e instanceof ApiError && e.status !== 502) { setError(e.message); setState('error'); c2.stopped = true; return null; }
        if (!browserVoiceSupported()) { setError(`${(e as Error).message}. This browser has no built-in speech recognition either.`); setState('error'); c2.stopped = true; return null; }
        setError('Live voice is not available right now, so the browser’s own speech is used.');
      }
    }
    try {
      c.stopped = false;
      startBrowser(conversationId);
      setMode('browser');
      return conversationId;
    } catch (e) {
      setError((e as Error).message);
      setState('error');
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop]);

  const toggleMute = useCallback(() => {
    r.current.muted = !r.current.muted;
    setMuted(r.current.muted);
  }, []);

  return { state, mode, muted, error, heard, said, start, stop, toggleMute };
}
