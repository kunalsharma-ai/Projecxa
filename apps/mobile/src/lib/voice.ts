/**
 * Talking to the copilot on the phone.
 *
 * - "live": Gemini Live, the same as the web app. The server hands out a short-lived token
 *   (POST /ai/voice/session) so the phone never holds the API key. The microphone streams 16 kHz
 *   PCM over a WebSocket; answers come back as 24 kHz PCM, which is played in short WAV pieces.
 *   Tool calls go to the server (POST /ai/voice/tool), which runs them with the person's rights,
 *   and every spoken exchange is saved in the conversation (POST /ai/voice/turn).
 *   The microphone is paused while the copilot speaks so it does not hear itself on the speaker;
 *   "Interrupt" stops the answer and listens again.
 * - "talk": hold-free tap to talk, used when Live is not available on the key. The phone records
 *   one question, the server writes it down with Gemini (POST /ai/voice/transcribe), the normal chat
 *   answers, and the phone reads the answer aloud with its own voice (expo-speech).
 */
import { createAudioPlayer, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream, type AudioPlayer, type AudioStreamBuffer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { ApiError, type Api } from './api';
import { concat, floatToInt16, fromBase64, resampleInt16, toBase64, utf8, wav } from './pcm';

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'recording' | 'thinking' | 'speaking' | 'error';
export type VoiceMode = 'live' | 'talk';

export interface ToolOutcome<D, A> { displays: D[]; action: A | null }

export interface VoiceEvents<D = unknown, A = unknown> {
  /** A spoken exchange was saved: reload or append the conversation. */
  onTurn: (conversationId: string, said: { user: string; assistant: string }) => void;
  /** A tool ran during a live call (tables and confirmation cards). */
  onTool?: (r: ToolOutcome<D, A>) => void;
  /** Tap-to-talk: send the written-down question through the normal chat and return the answer. */
  ask: (text: string, conversationId: string | null) => Promise<{ conversationId: string; answer: string }>;
}

const IN_RATE = 16000;
const OUT_RATE = 24000;
/** First piece of an answer is short so it starts quickly; later ones longer so playback is smooth. */
const FIRST_PIECE = OUT_RATE * 2 * 0.35;
const NEXT_PIECE = OUT_RATE * 2 * 1.2;
const MAX_TALK_SECONDS = 45;

export const voiceSupported = Platform.OS === 'ios' || Platform.OS === 'android';

/** Plays 24 kHz PCM pieces one after another (one short-lived player per piece). */
class PcmQueue {
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private files: { file: File; seconds: number }[] = [];
  private player: AudioPlayer | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pieces = 0;
  private n = 0;
  busyUntil = 0;
  constructor(private readonly onIdle: () => void) {}

  push(pcm: Uint8Array) {
    this.pending.push(pcm);
    this.pendingBytes += pcm.length;
    if (this.pendingBytes >= (this.pieces === 0 ? FIRST_PIECE : NEXT_PIECE)) void this.flush();
  }

  /** End of an answer: play what is left. */
  async flush() {
    if (!this.pendingBytes) return;
    const pcm = concat(this.pending);
    this.pending = [];
    this.pendingBytes = 0;
    this.pieces++;
    const seconds = pcm.length / 2 / OUT_RATE;
    this.busyUntil = Math.max(Date.now(), this.busyUntil) + seconds * 1000 + 150;
    const file = new File(Paths.cache, `projexa-voice-${Date.now()}-${this.n++}.wav`);
    try {
      file.create({ overwrite: true });
      await file.write(wav(pcm, OUT_RATE));
    } catch {
      return;
    }
    this.files.push({ file, seconds });
    if (!this.player && !this.timer) this.next();
  }

  private next() {
    this.release();
    const item = this.files.shift();
    if (!item) {
      this.pieces = 0;
      this.onIdle();
      return;
    }
    try {
      this.player = createAudioPlayer({ uri: item.file.uri });
      this.player.play();
    } catch {
      this.player = null;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      try { item.file.delete(); } catch { /* cache */ }
      this.next();
    }, item.seconds * 1000 + 60);
  }

  private release() {
    try { this.player?.remove(); } catch { /* gone */ }
    this.player = null;
  }

  /** Interrupted or stopped: drop everything. */
  clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.release();
    for (const f of this.files) try { f.file.delete(); } catch { /* cache */ }
    this.files = [];
    this.pending = [];
    this.pendingBytes = 0;
    this.pieces = 0;
    this.busyUntil = 0;
  }
}

/** Mic buffers (whatever rate and encoding the phone gives) → 16 kHz 16-bit mono bytes. */
export function toInputPcm(b: { data: ArrayBuffer; sampleRate: number; channels: number }, encoding: 'int16' | 'float32'): Uint8Array {
  let mono: Int16Array = encoding === 'int16' ? new Int16Array(b.data) : floatToInt16(new Float32Array(b.data));
  if (b.channels > 1) {
    const m = new Int16Array(Math.floor(mono.length / b.channels));
    for (let i = 0; i < m.length; i++) m[i] = mono[i * b.channels];
    mono = m;
  }
  const out = resampleInt16(mono, b.sampleRate, IN_RATE);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

type LiveMsg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function useVoice<D = unknown, A = unknown>(api: Api, ev: VoiceEvents<D, A>) {
  const [state, setState] = useState<VoiceState>('idle');
  const [mode, setMode] = useState<VoiceMode | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState('');
  const [said, setSaid] = useState('');
  const evRef = useRef(ev);
  evRef.current = ev;
  const r = useRef({ ws: null as WebSocket | null, conv: null as string | null, user: '', model: '', muted: false, stopped: true, mode: null as VoiceMode | null, talk: [] as Uint8Array[], talkBytes: 0, ready: false });
  const queue = useRef<PcmQueue | null>(null);
  if (!queue.current) queue.current = new PcmQueue(() => !r.current.stopped && r.current.mode === 'live' && setState('listening'));

  const onBuffer = useCallback((b: AudioStreamBuffer) => {
    const c = r.current;
    if (c.stopped || c.muted) return;
    const pcm = toInputPcm(b, 'int16');
    if (c.mode === 'live') {
      if (!c.ready || c.ws?.readyState !== 1 || Date.now() < (queue.current?.busyUntil ?? 0)) return;
      c.ws.send(JSON.stringify({ realtimeInput: { audio: { data: toBase64(pcm), mimeType: `audio/pcm;rate=${IN_RATE}` } } }));
    } else if (c.mode === 'talk') {
      if (c.talkBytes > IN_RATE * 2 * MAX_TALK_SECONDS) return;
      c.talk.push(pcm);
      c.talkBytes += pcm.length;
    }
  }, []);
  const { stream } = useAudioStream({ sampleRate: IN_RATE, channels: 1, encoding: 'int16', onBuffer });

  const stopMic = useCallback(() => {
    try { if (stream.isStreaming) stream.stop(); } catch { /* not running */ }
  }, [stream]);

  const stop = useCallback(() => {
    const c = r.current;
    c.stopped = true;
    c.ready = false;
    try { c.ws?.close(); } catch { /* closed */ }
    c.ws = null;
    stopMic();
    queue.current?.clear();
    void Speech.stop();
    c.mode = null;
    c.talk = [];
    c.talkBytes = 0;
    setState('idle');
    setMode(null);
    setHeard('');
    setSaid('');
  }, [stopMic]);
  useEffect(() => stop, [stop]);

  async function prepareAudio() {
    const p = await requestRecordingPermissionsAsync();
    if (!p.granted) throw new Error('Allow microphone access for SampTrek in your phone settings to talk to the copilot.');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldRouteThroughEarpiece: false });
  }

  async function handle(msg: LiveMsg) {
    const c = r.current;
    if (msg.setupComplete) {
      c.ready = true;
      await stream.start();
      setState('listening');
      return;
    }
    if (msg.toolCall?.functionCalls) {
      setState('thinking');
      const responses = [];
      for (const fc of msg.toolCall.functionCalls as { id: string; name: string; args?: Record<string, unknown> }[]) {
        try {
          const out = await api.post<{ response: unknown; displays: D[]; action: A | null }>('/ai/voice/tool', { conversationId: c.conv, name: fc.name, args: fc.args ?? {} });
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
    if (sc.interrupted) queue.current?.clear();
    if (sc.inputTranscription?.text) {
      c.user += sc.inputTranscription.text;
      setHeard(c.user);
    }
    if (sc.outputTranscription?.text) {
      c.model += sc.outputTranscription.text;
      setSaid(c.model);
    }
    for (const p of sc.modelTurn?.parts ?? []) {
      if (p.inlineData?.data && String(p.inlineData.mimeType ?? '').startsWith('audio/pcm')) {
        queue.current?.push(fromBase64(p.inlineData.data));
        setState('speaking');
      }
    }
    if (sc.turnComplete || sc.generationComplete) await queue.current?.flush();
    if (sc.turnComplete) {
      const user = c.user.trim();
      const model = c.model.trim();
      c.user = '';
      c.model = '';
      if (c.conv && (user || model)) {
        await api.post('/ai/voice/turn', { conversationId: c.conv, userText: user, assistantText: model }).catch(() => undefined);
        evRef.current.onTurn(c.conv, { user, assistant: model });
      }
    }
  }

  async function startLive(conversationId: string | null, path: string) {
    const c = r.current;
    const s = await api.post<{ conversationId: string; url: string; setup: unknown }>('/ai/voice/session', { conversationId, path });
    c.conv = s.conversationId;
    const ws = new WebSocket(s.url);
    ws.binaryType = 'arraybuffer';
    c.ws = ws;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The voice service did not answer')), 15_000);
      ws.onopen = () => {
        clearTimeout(t);
        ws.send(JSON.stringify(s.setup));
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(t);
        reject(new Error('Could not connect to the voice service'));
      };
    });
    ws.onmessage = async (e) => {
      try {
        const text = typeof e.data === 'string' ? e.data : utf8(new Uint8Array(e.data as ArrayBuffer));
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

  /** Starts a live call; falls back to tap to talk when Live is not available. */
  const start = useCallback(
    async (conversationId: string | null, path: string, prefer: VoiceMode = 'live') => {
      stop();
      const c = r.current;
      c.stopped = false;
      c.user = '';
      c.model = '';
      c.conv = conversationId;
      setError(null);
      setState('connecting');
      try {
        await prepareAudio();
      } catch (e) {
        setError((e as Error).message);
        setState('error');
        c.stopped = true;
        return null;
      }
      if (prefer === 'live') {
        try {
          c.mode = 'live';
          const id = await startLive(conversationId, path);
          setMode('live');
          return id;
        } catch (e) {
          try { c.ws?.close(); } catch { /* closed */ }
          c.ws = null;
          c.ready = false;
          stopMic();
          // Turned off or over the limit is final; anything else falls back to tap to talk.
          if (e instanceof ApiError && e.status !== 502 && e.status !== 503 && e.status !== 0) {
            setError(e.message);
            setState('error');
            c.stopped = true;
            c.mode = null;
            return null;
          }
          setError('Live voice is not available right now, so tap to talk is used.');
        }
      }
      c.mode = 'talk';
      setMode('talk');
      setState('listening');
      return conversationId;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stop, stopMic, api],
  );

  /** Tap to talk: first tap starts recording, second tap sends it. */
  const talk = useCallback(async () => {
    const c = r.current;
    if (c.mode !== 'talk' || c.stopped) return;
    if (!stream.isStreaming) {
      void Speech.stop();
      c.talk = [];
      c.talkBytes = 0;
      setHeard('');
      setSaid('');
      await stream.start();
      setState('recording');
      return;
    }
    stopMic();
    const pcm = concat(c.talk);
    c.talk = [];
    c.talkBytes = 0;
    if (pcm.length < IN_RATE * 2 * 0.4) {
      setState('listening');
      return;
    }
    setState('thinking');
    try {
      const file = new File(Paths.cache, `projexa-question-${Date.now()}.wav`);
      file.create({ overwrite: true });
      await file.write(wav(pcm, IN_RATE));
      const form = new FormData();
      form.append('audio', { uri: file.uri, name: 'question.wav', type: 'audio/wav' } as unknown as Blob);
      let text: string;
      try {
        text = (await api.upload<{ text: string }>('/ai/voice/transcribe', form)).text.trim();
      } finally {
        try { file.delete(); } catch { /* cache */ }
      }
      if (!text) {
        setError('I did not catch that. Tap and try again.');
        setState('listening');
        return;
      }
      setHeard(text);
      const out = await evRef.current.ask(text, c.conv);
      c.conv = out.conversationId;
      evRef.current.onTurn(out.conversationId, { user: text, assistant: out.answer });
      if (c.stopped) return;
      setSaid(out.answer);
      setState('speaking');
      const back = () => {
        if (!c.stopped) setState('listening');
      };
      Speech.speak(out.answer.replace(/[*#`_|>]/g, '').slice(0, 1500), { onDone: back, onStopped: back, onError: back });
    } catch (e) {
      setError((e as Error).message);
      setState('listening');
    }
  }, [api, stream, stopMic]);

  /** Live: stop the answer now and listen. */
  const interrupt = useCallback(() => {
    queue.current?.clear();
    void Speech.stop();
    if (!r.current.stopped) setState('listening');
  }, []);

  const toggleMute = useCallback(() => {
    r.current.muted = !r.current.muted;
    setMuted(r.current.muted);
  }, []);

  return { state, mode, muted, error, heard, said, start, stop, talk, interrupt, toggleMute };
}
