import { randomUUID } from 'crypto';
import { AiProvider, AiProviderError, GenerateRequest, GenerateResult, Http, JsonSchema, LiveSession, LiveSessionRequest, Message, ToolSpec } from './provider';

/**
 * Google Gemini (AI Studio key) over REST: generateContent with function calling, and ephemeral
 * tokens for the Live API so the browser never holds the key.
 */

type GPart = { text?: string; inlineData?: { mimeType: string; data: string }; functionCall?: { id?: string; name: string; args?: Record<string, unknown> }; functionResponse?: { id?: string; name: string; response: unknown }; thought?: boolean; thoughtSignature?: string };
type GContent = { role: 'user' | 'model'; parts: GPart[] };

/** Gemini's schema subset: no additionalProperties, enum only on strings. */
function schema(s: JsonSchema): Record<string, unknown> {
  return {
    type: s.type,
    ...(s.description ? { description: s.description } : {}),
    ...(s.enum ? { enum: s.enum } : {}),
    ...(s.items ? { items: schema(s.items) } : {}),
    ...(s.properties ? { properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, schema(v)])) } : {}),
    ...(s.required?.length ? { required: s.required } : {}),
  };
}
export const geminiTools = (tools: ToolSpec[]) => (tools.length ? [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: schema(t.parameters) })) }] : []);

export function toContents(messages: Message[]): GContent[] {
  const out: GContent[] = [];
  for (const m of messages) {
    if (m.role === 'assistant') {
      if (m.raw?.provider === 'gemini' && m.raw.parts.length) {
        out.push({ role: 'model', parts: m.raw.parts as GPart[] });
        continue;
      }
      const parts: GPart[] = [];
      for (const p of m.parts) {
        if ('text' in p && p.text) parts.push({ text: p.text });
        if ('call' in p) parts.push({ functionCall: { id: p.call.id, name: p.call.name, args: p.call.args } });
      }
      if (parts.length) out.push({ role: 'model', parts });
      continue;
    }
    const parts: GPart[] = [];
    for (const p of m.parts) {
      if ('text' in p && p.text) parts.push({ text: p.text });
      if ('file' in p) parts.push({ text: `[Attached file: ${p.file.name}]` }, { inlineData: { mimeType: p.file.mimeType, data: p.file.data } });
      if ('result' in p) parts.push({ functionResponse: { id: p.result.id, name: p.result.name, response: { result: p.result.data } } });
    }
    if (parts.length) {
      // Consecutive turns of the same role are merged: Gemini expects user and model to alternate.
      const last = out[out.length - 1];
      if (last?.role === 'user') last.parts.push(...parts);
      else out.push({ role: 'user', parts });
    }
  }
  return out;
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini';
  constructor(
    private readonly key: string,
    private readonly base: string,
    private readonly http: Http,
  ) {}

  private async post(path: string, body: unknown, timeoutMs = 60_000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await this.http(`${this.base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key }, body: JSON.stringify(body), signal: ctl.signal });
      const j = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null;
      if (res.status >= 400 || !j) {
        const msg = j?.error?.message ?? `Gemini answered ${res.status}`;
        if (res.status === 429) throw new AiProviderError('The AI service is busy or the free daily allowance is used up. Try again in a minute.', 'rate_limited', 429);
        if (res.status === 401 || res.status === 403) throw new AiProviderError('The AI service did not accept the API key. An admin should check GEMINI_API_KEY.', 'auth', res.status);
        if (res.status === 400 || res.status === 404) throw new AiProviderError(`The AI service refused the request: ${msg}`, 'bad_request', res.status);
        throw new AiProviderError(`The AI service is unavailable (${res.status}). Try again shortly.`, 'unavailable', res.status);
      }
      return j as Record<string, unknown>;
    } catch (e) {
      if (e instanceof AiProviderError) throw e;
      throw new AiProviderError((e as Error).name === 'AbortError' ? 'The AI service took too long to answer.' : 'The AI service could not be reached.', 'unavailable');
    } finally {
      clearTimeout(t);
    }
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: toContents(req.messages),
      ...(req.tools.length ? { tools: geminiTools(req.tools), toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
      generationConfig: { temperature: req.temperature ?? 0.2 },
    };
    const j = (await this.post(`/v1beta/models/${encodeURIComponent(req.model)}:generateContent`, body)) as {
      candidates?: { content?: { parts?: GPart[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    if (j.promptFeedback?.blockReason) throw new AiProviderError('The AI service declined to answer this message.', 'blocked');
    const c = j.candidates?.[0];
    const parts = c?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall).map((p) => ({ id: p.functionCall!.id || randomUUID(), name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
    // Keep the ids we generated in the replayed parts so results line up.
    let i = 0;
    const raw = parts.map((p) => (p.functionCall ? { ...p, functionCall: { ...p.functionCall, id: calls[i++].id } } : p));
    return {
      text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim(),
      calls,
      raw: { provider: this.id, parts: raw },
      usage: { promptTokens: j.usageMetadata?.promptTokenCount ?? 0, outputTokens: (j.usageMetadata?.candidatesTokenCount ?? 0) + (j.usageMetadata?.thoughtsTokenCount ?? 0) },
      finishReason: c?.finishReason ?? null,
    };
  }

  async liveSession(req: LiveSessionRequest): Promise<LiveSession> {
    const now = Date.now();
    const config = {
      responseModalities: ['AUDIO'],
      systemInstruction: { parts: [{ text: req.system }] },
      tools: geminiTools(req.tools),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
    const expiresAt = new Date(now + req.lastFor * 1000).toISOString();
    const j = (await this.post('/v1beta/auth_tokens', {
      uses: 1,
      expireTime: expiresAt,
      newSessionExpireTime: new Date(now + req.startWithin * 1000).toISOString(),
      liveConnectConstraints: { model: `models/${req.model}`, config },
    }, 20_000)) as { name?: string };
    if (!j.name) throw new AiProviderError('The voice service did not issue a session token.', 'unavailable');
    const host = this.base.replace(/^http/, 'ws');
    return {
      token: j.name,
      url: `${host}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(j.name)}`,
      // On the socket, the response modality sits inside generationConfig.
      setup: { setup: { model: `models/${req.model}`, generationConfig: { responseModalities: ['AUDIO'] }, systemInstruction: config.systemInstruction, tools: config.tools, inputAudioTranscription: {}, outputAudioTranscription: {} } },
      expiresAt,
    };
  }
}
