'use client';
import { Copy } from 'lucide-react';
import { useState } from 'react';

/** A secret shown one time only, with a copy button. */
export function SecretOnce({ title, value, onDone }: { title: string; value: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => undefined);
  return (
    <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm" role="status">
      <p className="mb-2 font-medium">{title}</p>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 break-all font-mono text-xs">{value}</code>
        <button className="btn-ghost h-7 shrink-0 px-2" aria-label="Copy" onClick={copy}><Copy className="h-3.5 w-3.5" />{copied && <span className="text-xs">Copied</span>}</button>
      </div>
      <button className="mt-2 text-xs text-muted hover:text-ink" onClick={onDone}>I have saved it</button>
    </div>
  );
}
