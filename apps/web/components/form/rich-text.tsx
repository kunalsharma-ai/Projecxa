'use client';
import clsx from 'clsx';
import { Bold, FileUp, Heading2, Italic, Link2, List, ListOrdered, Trash2, UploadCloud } from 'lucide-react';
import { DragEvent, Fragment, ReactNode, useRef, useState } from 'react';
import { Segmented } from './choice';
import { useFieldIds } from './field';

// ───────────── Rich text (light Markdown) ─────────────

/** Inline Markdown: **bold**, _italic_, [link](https://…). Rendered as React nodes, never as HTML. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|_(.+?)_|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] !== undefined) out.push(<strong key={k}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<em key={k}>{m[2]}</em>);
    else out.push(<a key={k} href={m[4]} target="_blank" rel="noopener noreferrer" className="text-brand underline">{m[3]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Renders the light Markdown the RichText field writes: headings, lists, paragraphs, inline marks. */
export function RichTextView({ value, className }: { value: string; className?: string }) {
  const blocks = value.replace(/\r/g, '').split(/\n{2,}/).filter((b) => b.trim());
  return (
    <div className={clsx('space-y-2 text-sm leading-relaxed', className)}>
      {blocks.map((b, bi) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*[-*] /.test(l))) return <ul key={bi} className="list-disc space-y-0.5 pl-5">{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*[-*] /, ''), `${bi}-${li}`)}</li>)}</ul>;
        if (lines.every((l) => /^\s*\d+[.)] /.test(l))) return <ol key={bi} className="list-decimal space-y-0.5 pl-5">{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*\d+[.)] /, ''), `${bi}-${li}`)}</li>)}</ol>;
        if (/^#{1,3} /.test(b)) return <h4 key={bi} className="pt-1 font-semibold">{inline(b.replace(/^#{1,3} /, ''), `${bi}`)}</h4>;
        return <p key={bi}>{lines.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l, `${bi}-${li}`)}</Fragment>)}</p>;
      })}
    </div>
  );
}

/**
 * Rich text field that stores light Markdown. The toolbar (and Ctrl+B / Ctrl+I / Ctrl+K) wraps the
 * selection; Preview shows how it will look. Safe by construction: nothing is rendered as HTML.
 */
export function RichText({ value, onChange, placeholder, rows = 6, maxLength }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; maxLength?: number }) {
  const f = useFieldIds();
  const [mode, setMode] = useState('write');
  const ta = useRef<HTMLTextAreaElement>(null);
  function wrap(before: string, after = before, fallback = 'text') {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = value.slice(s, e) || fallback;
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + before.length, s + before.length + sel.length); });
  }
  function prefix(p: (i: number) => string) {
    const el = ta.current;
    if (!el) return;
    const s = value.lastIndexOf('\n', el.selectionStart - 1) + 1;
    const e = el.selectionEnd;
    const lines = value.slice(s, e).split('\n');
    const block = lines.map((l, i) => p(i) + l.replace(/^(\s*[-*] |\s*\d+[.)] |#{1,3} )/, '')).join('\n');
    onChange(value.slice(0, s) + block + value.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s, s + block.length); });
  }
  const link = () => { const url = prompt('Link address (https://…)'); if (url && /^https?:\/\//.test(url)) wrap('[', `](${url})`, 'link text'); };
  const tools: [string, ReactNode, () => void][] = [
    ['Bold (Ctrl+B)', <Bold key="b" className="h-4 w-4" />, () => wrap('**')],
    ['Italic (Ctrl+I)', <Italic key="i" className="h-4 w-4" />, () => wrap('_')],
    ['Heading', <Heading2 key="h" className="h-4 w-4" />, () => prefix(() => '## ')],
    ['Bulleted list', <List key="l" className="h-4 w-4" />, () => prefix(() => '- ')],
    ['Numbered list', <ListOrdered key="o" className="h-4 w-4" />, () => prefix((i) => `${i + 1}. `)],
    ['Link (Ctrl+K)', <Link2 key="k" className="h-4 w-4" />, link],
  ];
  return (
    <div className={clsx('overflow-hidden rounded-[calc(var(--radius)*0.66)] border bg-panel focus-within:border-brand focus-within:shadow-[0_0_0_3px_rgb(var(--brand)/0.2)]', f.invalid ? 'border-bad' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-sunken/50 px-1.5 py-1">
        {mode === 'write' && tools.map(([name, icon, fn]) => <button key={name} type="button" className="rounded p-1.5 text-muted hover:bg-panel hover:text-ink" title={name} aria-label={name} onClick={fn}>{icon}</button>)}
        <div className="ml-auto"><Segmented size="sm" value={mode} onChange={setMode} items={[{ value: 'write', label: 'Write' }, { value: 'preview', label: 'Preview' }]} /></div>
      </div>
      {mode === 'write' ? (
        <textarea ref={ta} id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid || undefined} rows={rows} maxLength={maxLength} placeholder={placeholder}
          className="block w-full resize-y border-0 bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus-visible:outline-none" value={value} onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (!(e.ctrlKey || e.metaKey)) return; const k = e.key.toLowerCase(); if (k === 'b') { e.preventDefault(); wrap('**'); } else if (k === 'i') { e.preventDefault(); wrap('_'); } else if (k === 'k') { e.preventDefault(); link(); } }} />
      ) : (
        <div className="min-h-[8rem] px-3 py-2">{value.trim() ? <RichTextView value={value} /> : <p className="text-sm text-muted">Nothing to preview yet.</p>}</div>
      )}
      {maxLength && <div className="border-t border-line px-3 py-1 text-right text-[11px] text-muted tabular-nums">{value.length.toLocaleString()} / {maxLength.toLocaleString()}</div>}
    </div>
  );
}

// ───────────── Drag-and-drop upload ─────────────

const size = (b: number) => (b < 1024 ? `${b} B` : b < 1_048_576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1_048_576).toFixed(1)} MB`);
const accepts = (file: File, accept?: string) => !accept || accept.split(',').map((a) => a.trim().toLowerCase()).some((a) => (a.startsWith('.') ? file.name.toLowerCase().endsWith(a) : a.endsWith('/*') ? file.type.startsWith(a.slice(0, -1)) : file.type === a));

/** Drop zone (or click / Enter to browse). Checks type and size before accepting a file. */
export function FileDrop({ value, onChange, accept, maxSizeMb = 10, multiple, hint }: { value: File[]; onChange: (f: File[]) => void; accept?: string; maxSizeMb?: number; multiple?: boolean; hint?: string }) {
  const f = useFieldIds();
  const [over, setOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  function take(list: FileList | null) {
    if (!list) return;
    const ok: File[] = [];
    const bad: string[] = [];
    for (const file of Array.from(list)) {
      if (!accepts(file, accept)) bad.push(`${file.name}: this type of file is not accepted`);
      else if (file.size > maxSizeMb * 1_048_576) bad.push(`${file.name}: larger than ${maxSizeMb} MB`);
      else ok.push(file);
    }
    setErrors(bad);
    if (ok.length) onChange(multiple ? [...value, ...ok.filter((n) => !value.some((v) => v.name === n.name && v.size === n.size))] : ok.slice(0, 1));
  }
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); };
  return (
    <div>
      <button type="button" id={f.id} aria-describedby={f.describedBy} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
        className={clsx('flex w-full flex-col items-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors duration-[var(--dur)]', over ? 'border-brand bg-brand/5' : f.invalid ? 'border-bad' : 'border-line hover:border-muted/70 hover:bg-sunken/40')}>
        <UploadCloud className={clsx('h-6 w-6', over ? 'text-brand' : 'text-muted')} />
        <span className="text-sm"><span className="font-medium text-brand">Choose {multiple ? 'files' : 'a file'}</span> or drag {multiple ? 'them' : 'it'} here</span>
        <span className="text-xs text-muted">{hint ?? `${accept ? accept.replace(/,/g, ', ') + ' · ' : ''}up to ${maxSizeMb} MB`}</span>
      </button>
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      {errors.map((e) => <p key={e} className="mt-1 text-xs text-bad" role="alert">{e}</p>)}
      {value.length > 0 && (
        <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
          {value.map((file) => (
            <li key={`${file.name}-${file.size}`} className="flex items-center gap-2 px-3 py-2 text-sm">
              <FileUp className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-muted tabular-nums">{size(file.size)}</span>
              <button type="button" className="rounded p-1 text-muted hover:text-bad" aria-label={`Remove ${file.name}`} onClick={() => onChange(value.filter((v) => v !== file))}><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
