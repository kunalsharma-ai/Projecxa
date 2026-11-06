'use client';
import clsx from 'clsx';
import { CircleAlert, FileText, Info, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FileDrop } from '@/components/form/rich-text';
import { ErrorBox } from '@/components/ui';
import { api, get, post } from '@/lib/api';

/** What the server learned from a brief; stored in the project draft as `brief`. */
export interface BriefInfo {
  fileName: string | null;
  clientName: string | null;
  client: { id: string; name: string } | null;
  filled: string[];
  missing: string[];
  warnings: string[];
  evidence: { field: string; quote: string }[];
  quotas: string[];
}

interface AiStatus { enabled: boolean; reason: string | null; features: { documents: boolean } }

/** Whether reading a brief is available to this person, and whether files are allowed. */
export function useBriefAvailability() {
  const [s, setS] = useState<AiStatus | null>(null);
  useEffect(() => {
    get<AiStatus>('/ai/status').then(setS).catch(() => setS(null));
  }, []);
  return s && s.enabled ? { files: s.features.documents } : null;
}

const ACCEPT = '.pdf,.txt,.md,.csv,.html,.json,.png,.jpg,.jpeg,.webp,application/pdf,text/plain,text/markdown,text/csv,image/png,image/jpeg,image/webp';

/** Attach or paste a brief; the server reads it into a draft and returns its id. */
export function BriefReader({ files, onRead, onClose }: { files: boolean; onRead: (draftId: string) => void; onClose: () => void }) {
  const [file, setFile] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<'file' | 'text'>(files ? 'file' : 'text');
  const ready = mode === 'file' ? file.length === 1 : text.trim().length >= 40;

  async function read() {
    setBusy(true);
    setError(null);
    try {
      let r: { draftId: string };
      if (mode === 'file') {
        const fd = new FormData();
        fd.append('file', file[0]);
        r = await api<{ draftId: string }>('/ai/brief', { method: 'POST', body: fd });
      } else r = await post<{ draftId: string }>('/ai/brief', { text });
      onRead(r.draftId);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-brand/30 bg-brand/5 p-4" role="region" aria-label="Read a brief">
      <div className="mb-3 flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Set up from a brief</div>
          <p className="text-sm text-muted">The AI reads the client brief or RFQ and fills this form: name, client, markets, completes, LOI, incidence, CPI, dates, target group and quotas. Nothing is created until you check it and press Create.</p>
        </div>
        <button type="button" className="btn-ghost h-8 w-8 justify-center p-0" aria-label="Close" onClick={onClose} disabled={busy}><X className="h-4 w-4" /></button>
      </div>
      {files && (
        <div className="mb-3 flex w-fit rounded-lg border border-line bg-panel p-0.5 text-sm" role="group" aria-label="Brief source">
          {(['file', 'text'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} className={clsx('rounded-md px-3 py-1', mode === m ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-sunken')}>{m === 'file' ? 'Attach a file' : 'Paste text'}</button>
          ))}
        </div>
      )}
      {mode === 'file' ? (
        <FileDrop value={file} onChange={(f) => setFile(f.slice(-1))} accept={ACCEPT} maxSizeMb={10} hint="PDF, image or text, up to 10 MB. Save Word files as PDF first." />
      ) : (
        <>
          <label className="label" htmlFor="brief-text">Brief text</label>
          <textarea id="brief-text" className="input min-h-[140px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the email or brief: audience, markets, sample sizes, LOI, incidence, price, timings…" />
        </>
      )}
      <ErrorBox error={error} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={read} disabled={!ready || busy}>
          <Sparkles className={clsx('h-4 w-4', busy && 'animate-pulse')} /> {busy ? 'Reading the brief…' : 'Read brief and fill the form'}
        </button>
        <span className="text-xs text-muted">Counts as one AI request. The brief is sent to the AI service your admin set up.</span>
      </div>
    </div>
  );
}

/** Shown above the form after a brief was read: what was filled, what is missing, what to check. */
export function BriefBanner({ brief, clientChosen, onAddClient, addingClient, onDismiss }: { brief: BriefInfo; clientChosen: boolean; onAddClient: (name: string) => void; addingClient: boolean; onDismiss: () => void }) {
  const missing = brief.missing.filter((m) => !(clientChosen && (m === 'Client' || m.startsWith('Client (no match'))));
  return (
    <div className="mb-5 rounded-xl border border-brand/30 bg-brand/5 p-4 text-sm" role="status">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">Filled from {brief.fileName ? <>the brief <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{brief.fileName}</span></> : 'the pasted brief'}</span>
            <span className="text-muted">· check every value before you create the project</span>
          </div>
          {brief.filled.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {brief.filled.map((f) => <span key={f} className="chip bg-brand/10 text-brand">{f}</span>)}
            </div>
          )}
          {missing.length > 0 && (
            <div className="flex items-start gap-2 text-warn">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span><b>Not in the brief:</b> {missing.join(', ')}. Fill these in below.</span>
            </div>
          )}
          {!clientChosen && brief.clientName && !brief.client && (
            <div className="flex flex-wrap items-center gap-2">
              <span>Client “{brief.clientName}” is not in SampTrek yet.</span>
              <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => onAddClient(brief.clientName!)} disabled={addingClient}>{addingClient ? 'Adding…' : 'Add it as a client'}</button>
              <span className="text-muted">or choose an existing client below.</span>
            </div>
          )}
          {brief.warnings.length > 0 && (
            <ul className="space-y-0.5">
              {brief.warnings.map((w) => <li key={w} className="flex items-start gap-2"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" />{w}</li>)}
            </ul>
          )}
          {brief.evidence.length > 0 && (
            <details className="text-muted">
              <summary className="cursor-pointer select-none"><Info className="mr-1 inline h-3.5 w-3.5" />Where the values came from ({brief.evidence.length})</summary>
              <ul className="mt-1.5 space-y-1">
                {brief.evidence.map((e, i) => <li key={i}><span className="font-medium text-ink">{e.field}</span>: “{e.quote}”</li>)}
              </ul>
            </details>
          )}
        </div>
        <button type="button" className="btn-ghost h-8 w-8 justify-center p-0" aria-label="Hide" onClick={onDismiss}><X className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
