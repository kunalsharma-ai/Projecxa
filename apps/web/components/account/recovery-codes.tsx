'use client';
import { Copy, Download } from 'lucide-react';
import { useState } from 'react';

/** Recovery codes, shown once, with copy and download. */
export function RecoveryCodes({ codes, account, onDone }: { codes: string[]; account: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = `PROJEXA recovery codes for ${account}\nEach code works once. Keep them somewhere safe, away from your phone.\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'projexa-recovery-codes.txt' });
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };
  return (
    <div className="rounded-lg border border-warn/40 bg-warn/10 p-4" role="status">
      <p className="font-medium">Save your recovery codes</p>
      <p className="mt-1 text-sm text-muted">If you lose your phone, each of these codes lets you sign in once. They will not be shown again.</p>
      <ol className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:max-w-md">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={download}><Download className="h-4 w-4" />Download</button>
        <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(text).then(() => setSaved(true)).catch(() => undefined)}><Copy className="h-4 w-4" />Copy</button>
        <button className="btn-primary" disabled={!saved} title={saved ? undefined : 'Download or copy them first'} onClick={onDone}>I have saved them</button>
      </div>
    </div>
  );
}
