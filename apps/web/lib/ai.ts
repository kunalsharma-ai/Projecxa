import { API_URL, ApiError } from './api';

export type Display =
  | { type: 'table'; title: string; columns: { key: string; label: string; align?: 'right' }[]; rows: Record<string, string | number | boolean | null>[]; links?: (string | null)[] }
  | { type: 'bars'; title: string; unit?: string; items: { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' }[] }
  | { type: 'stats'; title: string; items: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }[] };

export interface AiAction { id: string; tool: string; summary: string; status: 'pending' | 'running' | 'done' | 'cancelled' | 'failed' | 'expired'; result: unknown; error: string | null; createdAt: string }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; channel: string; createdAt: string; documents?: { id: string; name: string }[]; displays?: Display[]; actions?: AiAction[] }
export interface AiDoc { id: string; name: string; mimeType: string; size: number; createdAt: string }
export interface AiStatus {
  configured: boolean; provider: string | null; model: string | null; liveModel: string | null; enabled: boolean; reason: 'not_configured' | 'turned_off' | 'role' | null;
  features: { actions: boolean; documents: boolean; voice: boolean };
  usage: { mineToday: number; myDailyLimit: number; orgToday: number; orgDailyLimit: number };
  settings?: AiSettings;
}
export interface AiSettings { enabled: boolean; roles: string[]; actions: boolean; documents: boolean; voice: boolean; perUserPerMinute: number; perUserDaily: number; orgDaily: number }

export async function uploadDoc(file: File): Promise<AiDoc> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API_URL}/api/v1/ai/documents`, { method: 'POST', body: fd, credentials: 'include' });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.message ?? 'Upload failed');
  return data;
}
