'use client';
import clsx from 'clsx';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { ErrorBox } from '@/components/ui';
import { api, API_URL } from '@/lib/api';

/** Logos are capped on the server (apps/api/src/parties/logos.ts). */
export const MAX_LOGO_KB = 200;
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.ico,.svg';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** A client's or vendor's logo, or their initials when there is none. `url` is relative to /api/v1. */
export function PartyLogo({ url, name, size = 24, className }: { url?: string | null; name: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size };
  if (url && !broken)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`${API_URL}/api/v1${url}`} alt="" style={box} className={clsx('shrink-0 rounded-md border border-line bg-white object-contain', className)} onError={() => setBroken(true)} loading="lazy" />;
  return (
    <span aria-hidden style={{ ...box, fontSize: Math.max(9, Math.round(size * 0.4)) }} className={clsx('inline-flex shrink-0 items-center justify-center rounded-md bg-brand/10 font-semibold text-brand', className)}>
      {initials(name)}
    </span>
  );
}

/**
 * Raster images over the cap are made smaller in the browser (longest side 512 px, WebP or PNG),
 * so people can pick any logo file without resizing it first. SVGs are small already.
 */
async function fitToCap(file: File): Promise<File> {
  if (file.size <= MAX_LOGO_KB * 1024 || file.type === 'image/svg+xml' || typeof createImageBitmap !== 'function') return file;
  const bmp = await createImageBitmap(file);
  for (const side of [512, 384, 256, 160]) {
    const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    for (const [type, q] of [['image/webp', 0.9], ['image/webp', 0.75], ['image/png', undefined]] as const) {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
      if (blob && blob.size <= MAX_LOGO_KB * 1024 && blob.type === type) return new File([blob], file.name.replace(/\.[^.]+$/, '') + (type === 'image/webp' ? '.webp' : '.png'), { type });
    }
  }
  return file; // still too big: the server explains
}

/** Uploads a logo for a client or vendor that exists (made smaller first when needed). */
export async function uploadLogo(kind: 'client' | 'vendor', id: string, file: File) {
  const fitted = await fitToCap(file);
  const fd = new FormData();
  fd.append('file', fitted, fitted.name);
  const r = await api<{ logoUrl: string; bytes: number }>(`/${kind}s/${id}/logo`, { method: 'POST', body: fd });
  return { ...r, resized: fitted !== file };
}

/** Picks a logo before the client or vendor is saved; the parent uploads it after saving. */
export function LogoPicker({ name, file, onChange }: { name: string; file: File | null; onChange: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {preview && file
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={preview} alt="" className="h-12 w-12 rounded-md border border-line bg-white object-contain" />
        : <PartyLogo name={name || '?'} size={48} />}
      <input ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label="Logo file" onChange={(e) => {
        const f = e.target.files?.[0] ?? null;
        if (preview) URL.revokeObjectURL(preview);
        setPreview(f ? URL.createObjectURL(f) : null);
        onChange(f);
        e.target.value = '';
      }} />
      <div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost h-8 px-2.5 text-xs" onClick={() => input.current?.click()}><ImageUp className="h-3.5 w-3.5" /> {file ? 'Change logo' : 'Add logo (optional)'}</button>
          {file && <button type="button" className="btn-ghost h-8 px-2.5 text-xs" onClick={() => { setPreview(null); onChange(null); }}><Trash2 className="h-3.5 w-3.5" /> Remove</button>}
        </div>
        <div className="mt-1 text-muted">{file ? `${file.name} · ${Math.ceil(file.size / 1024)} KB${file.size > MAX_LOGO_KB * 1024 ? ' (will be made smaller)' : ''}` : `Any image format, up to ${MAX_LOGO_KB} KB. Bigger pictures are made smaller for you.`}</div>
      </div>
    </div>
  );
}

/** Upload, replace or remove a logo. Shows the result right away. */
export function LogoUpload({ kind, id, name, url, onChange, editable = true }: { kind: 'client' | 'vendor'; id: string; name: string; url: string | null; onChange?: (url: string | null) => void; editable?: boolean }) {
  const [current, setCurrent] = useState(url);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function pick(file: File) {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      const r = await uploadLogo(kind, id, file);
      setCurrent(r.logoUrl);
      onChange?.(r.logoUrl);
      setNote(r.resized ? `Made smaller for you: ${Math.ceil(r.bytes / 1024)} KB.` : `Saved, ${Math.ceil(r.bytes / 1024)} KB.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await api(`/${kind}s/${id}/logo`, { method: 'DELETE' });
      setCurrent(null);
      onChange?.(null);
      setNote(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <PartyLogo url={current} name={name} size={48} />
      {editable && (
        <div className="min-w-0 text-xs">
          <input ref={input} type="file" accept={ACCEPT} className="sr-only" aria-label={`${kind === 'client' ? 'Client' : 'Vendor'} logo file`} onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost h-8 px-2.5 text-xs" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />} {current ? 'Change logo' : 'Upload logo'}
            </button>
            {current && <button type="button" className="btn-ghost h-8 px-2.5 text-xs" disabled={busy} onClick={remove}><Trash2 className="h-3.5 w-3.5" /> Remove</button>}
          </div>
          <div className="mt-1 text-muted">{note ?? `PNG, JPG, GIF, WebP, AVIF, BMP, ICO or SVG, up to ${MAX_LOGO_KB} KB. Bigger pictures are made smaller for you.`}</div>
        </div>
      )}
      {!!error && <div className="w-full"><ErrorBox error={error} /></div>}
    </div>
  );
}
