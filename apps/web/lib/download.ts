import { API_URL } from './api';

/** Downloads a file from the API with the session cookie and saves it under the server's file name. */
export async function downloadFile(path: string, fallbackName: string) {
  const res = await fetch(`${API_URL}/api/v1${path}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ? (Array.isArray(body.message) ? body.message.join(', ') : body.message) : `Download failed (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
