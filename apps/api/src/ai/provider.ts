/**
 * Provider-independent AI gateway types. Gemini is the first provider; Claude or OpenAI plug in by
 * implementing AiProvider with the same neutral messages, so nothing above this layer changes.
 */

export type JsonSchema = { type: string; description?: string; properties?: Record<string, JsonSchema>; items?: JsonSchema; enum?: string[]; required?: string[] };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export type Part =
  | { text: string }
  | { file: { mimeType: string; data: string; name: string } }
  | { call: { id: string; name: string; args: Record<string, unknown> } }
  | { result: { id: string; name: string; data: unknown } };

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  parts: Part[];
  /**
   * The provider's own parts for an assistant turn (for example Gemini thought signatures), replayed
   * as they were when the same provider continues the conversation.
   */
  raw?: { provider: string; parts: unknown[] };
}

export interface GenerateRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  calls: { id: string; name: string; args: Record<string, unknown> }[];
  raw: { provider: string; parts: unknown[] };
  usage: { promptTokens: number; outputTokens: number };
  finishReason: string | null;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    /** rate_limited | auth | bad_request | unavailable | blocked */
    readonly kind: 'rate_limited' | 'auth' | 'bad_request' | 'unavailable' | 'blocked',
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface LiveSessionRequest {
  model: string;
  system: string;
  tools: ToolSpec[];
  /** Seconds the browser has to open the session. */
  startWithin: number;
  /** Seconds the session may last. */
  lastFor: number;
}

export interface LiveSession {
  token: string;
  url: string;
  /** The first message the browser sends on the socket. */
  setup: Record<string, unknown>;
  expiresAt: string;
}

export interface AiProvider {
  readonly id: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  /** A short-lived credential so the browser can talk to the voice API without seeing the key. */
  liveSession?(req: LiveSessionRequest): Promise<LiveSession>;
}

export type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown>; text(): Promise<string> }>;
