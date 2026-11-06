'use client';
import { Check, Pencil, X } from 'lucide-react';
import { useState } from 'react';
import { CopyIcon } from '@/components/copy';
import { PartyContact } from '@/components/parties/contact-line';
import { ContactPicker, type ClientOpt } from '@/components/parties/quick-add';
import { ErrorBox } from '@/components/ui';
import { patch } from '@/lib/api';
import type { ProjectDetail } from './types';

/**
 * The project's client with its logo and the contact person (email masked), with a way to pick
 * or add another contact, and the work order number, editable (docs/WORK_ORDERS_AND_UID_PREFIX.md).
 */
export function ProjectParties({ project, editable, reload }: { project: ProjectDetail; editable: boolean; reload: () => void }) {
  const [editContact, setEditContact] = useState(false);
  const [contacts, setContacts] = useState(project.client.contacts ?? []);
  const [wo, setWo] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const client: ClientOpt = { id: project.client.id, name: project.client.name, code: project.client.code ?? '', logoUrl: project.client.logoUrl, contacts };

  async function save(body: Record<string, unknown>) {
    setError(null);
    try {
      await patch(`/projects/${project.id}`, body);
      reload();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  }

  return (
    <div className="mb-4 space-y-3 border-b border-line pb-4">
      <div className="flex items-start justify-between gap-3">
        <PartyContact name={project.client.name} logoUrl={project.client.logoUrl} website={project.client.website} contact={project.clientContact ?? null} />
        {editable && !editContact && <button className="btn-ghost h-8 shrink-0 px-2.5 text-xs" onClick={() => setEditContact(true)}><Pencil className="h-3.5 w-3.5" /> Contact</button>}
      </div>
      {editContact && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ContactPicker
              client={client}
              value={project.clientContact?.id ?? ''}
              onAdded={setContacts}
              onChange={async (id) => { if (await save({ clientContactId: id || null })) setEditContact(false); }}
            />
          </div>
          <button className="btn-ghost h-9 px-2" aria-label="Close" onClick={() => setEditContact(false)}><X className="h-4 w-4" /></button>
        </div>
      )}
      {project.client.status === 'INACTIVE' && <p className="text-xs text-warn">This client is inactive. The project keeps working; new projects cannot use the client until it is active again.</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="w-[140px] text-muted">Work order</span>
        {wo === null ? (
          <>
            <span className="font-mono">{project.workOrderNo ?? '–'}</span>
            {project.workOrderNo && <CopyIcon text={project.workOrderNo} label="work order number" />}
            {editable && <button className="btn-ghost h-7 px-2 text-xs" aria-label="Edit work order" onClick={() => setWo(project.workOrderNo ?? '')}><Pencil className="h-3.5 w-3.5" /></button>}
          </>
        ) : (
          <form className="flex items-center gap-1.5" onSubmit={async (e) => { e.preventDefault(); if (await save({ workOrderNo: wo.trim() || null })) setWo(null); }}>
            <input className="input h-8 w-40 py-1 font-mono text-sm" aria-label="Work order number" value={wo} onChange={(e) => setWo(e.target.value)} autoFocus maxLength={50} />
            <button className="btn-primary h-8 px-2" aria-label="Save work order"><Check className="h-4 w-4" /></button>
            <button type="button" className="btn-ghost h-8 px-2" aria-label="Cancel" onClick={() => setWo(null)}><X className="h-4 w-4" /></button>
          </form>
        )}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
