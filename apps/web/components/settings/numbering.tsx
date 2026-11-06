'use client';
import { Hash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CopyIcon } from '@/components/copy';
import { ErrorBox, Field, Section } from '@/components/ui';
import { api, get } from '@/lib/api';

interface Numbering {
  projectCodePrefix: string; nextProjectCode: string;
  workOrderPrefix: string; nextWorkOrderNumber: number; nextWorkOrderNo: string; lastWorkOrderNo: string | null;
  uidPrefix: string | null; uidExample: string;
}

/**
 * Settings → Numbering (docs/WORK_ORDERS_AND_UID_PREFIX.md): the work order prefix and next
 * number, the last one generated, and the UID prefix respondents' IDs start with.
 */
export function NumberingSettings({ isAdmin }: { isAdmin: boolean }) {
  const [n, setN] = useState<Numbering | null>(null);
  const [form, setForm] = useState({ workOrderPrefix: '', nextWorkOrderNumber: '', uidPrefix: '' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fill = (x: Numbering) => {
    setN(x);
    setForm({ workOrderPrefix: x.workOrderPrefix, nextWorkOrderNumber: String(x.nextWorkOrderNumber), uidPrefix: x.uidPrefix ?? '' });
  };
  useEffect(() => { get<Numbering>('/numbering').then(fill).catch(setError); }, []);

  async function save() {
    setError(null);
    setSaved(false);
    try {
      fill(await api<Numbering>('/numbering', { method: 'PUT', json: { workOrderPrefix: form.workOrderPrefix.trim(), nextWorkOrderNumber: Number(form.nextWorkOrderNumber), uidPrefix: form.uidPrefix.trim() || null } }));
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  }

  if (!n) return error ? <div className="mb-6"><ErrorBox error={error} /></div> : null;
  const preview = `${form.workOrderPrefix.trim()}${form.nextWorkOrderNumber}`;
  const uidPreview = `${form.uidPrefix.trim()}${n.uidExample.slice((n.uidPrefix ?? '').length)}`;
  return (
    <Section id="numbering" help="settings.numbering" title={<span className="flex items-center gap-2"><Hash className="h-4 w-4 text-muted" /> Work orders and UID prefix</span>} className="mb-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Work order prefix" hint="e.g. FR or WO-">
          <input className="input font-mono" maxLength={12} disabled={!isAdmin} value={form.workOrderPrefix} onChange={(e) => setForm({ ...form, workOrderPrefix: e.target.value })} />
        </Field>
        <Field label="Next number" hint={`The next project gets ${preview}`}>
          <input className="input font-mono" type="number" min={1} disabled={!isAdmin} value={form.nextWorkOrderNumber} onChange={(e) => setForm({ ...form, nextWorkOrderNumber: e.target.value })} />
        </Field>
        <Field label="Last work order given">
          <div className="flex h-10 items-center gap-1 font-mono text-sm">{n.lastWorkOrderNo ?? <span className="font-sans text-muted">None yet</span>}{n.lastWorkOrderNo && <CopyIcon text={n.lastWorkOrderNo} label="last work order" />}</div>
        </Field>
        <Field label="UID prefix" hint="Optional, up to 12 letters, digits, - or _">
          <input className="input font-mono" maxLength={12} placeholder="e.g. SMP-" disabled={!isAdmin} value={form.uidPrefix} onChange={(e) => setForm({ ...form, uidPrefix: e.target.value })} />
        </Field>
        <div className="md:col-span-2">
          <Field label="What the client survey receives">
            <div className="rounded-lg bg-sunken px-3 py-2 font-mono text-xs break-all">https://survey.client.com/s?rid=<strong className="text-brand">{uidPreview}</strong></div>
          </Field>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">
        Project IDs keep the {n.projectCodePrefix} prefix (next: {n.nextProjectCode}). On Create project, people can still type a work order by hand; it must not be used by another project, and when it follows the pattern the counter moves past it.
        The UID prefix applies to respondents who enter from now on.
      </p>
      <ErrorBox error={error} />
      {isAdmin && (
        <div className="mt-3 flex items-center gap-3">
          <button className="btn-primary" onClick={save}>Save numbering</button>
          {saved && <span className="text-sm text-ok" role="status">Saved</span>}
        </div>
      )}
    </Section>
  );
}
