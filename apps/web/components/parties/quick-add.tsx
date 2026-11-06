'use client';
import { X } from 'lucide-react';
import { FormEvent, ReactNode, useMemo, useState } from 'react';
import { Combobox, type Option } from '@/components/form/combobox';
import { ErrorBox, Field } from '@/components/ui';
import { patch, post } from '@/lib/api';
import { EMAIL } from '@/lib/contact-rules';
import { maskEmail } from '@/lib/mask';
import { suggestCode } from '@/lib/suggest';
import { LogoPicker, PartyLogo, uploadLogo } from './logo';

export interface PartyOpt { id: string; name: string; code: string; status?: string; logoUrl?: string | null }
export interface ContactOpt { id: string; name: string; email: string | null; phone: string | null }
export type ClientOpt = PartyOpt & { contacts: ContactOpt[]; website?: string | null };

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal aria-label={title} onMouseDown={onClose}>
      <div className="card my-10 w-full max-w-lg p-5" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="btn-ghost h-8 px-2" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * "Add +" for clients and vendors inside other forms: the essentials (name, code, a contact and
 * a logo) without leaving the page. The full details can be added later on the Clients or Vendors page.
 */
export function QuickAddParty<T extends PartyOpt>({ kind, initialName, taken, onCreated, onClose }: { kind: 'client' | 'vendor'; initialName: string; taken: string[]; onCreated: (p: T) => void; onClose: () => void }) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(() => suggestCode(initialName, taken) ?? '');
  const [codeTouched, setCodeTouched] = useState(false);
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [logo, setLogo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const noun = kind === 'client' ? 'client' : 'vendor';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (kind === 'client' && (!contactName.trim() || !EMAIL.test(email.trim()))) {
      setError({ message: 'Add the contact’s name and a valid email.' });
      return;
    }
    if (email.trim() && !EMAIL.test(email.trim())) {
      setError({ message: 'Check the email address.' });
      return;
    }
    setBusy(true);
    try {
      const body = kind === 'client'
        ? { name: name.trim(), code: code.trim(), contacts: [{ name: contactName.trim(), email: email.trim() }] }
        : { name: name.trim(), code: code.trim(), contactName: contactName.trim() || undefined, contactEmail: email.trim() || undefined };
      const created = await post<T>(`/${kind}s`, body);
      let logoUrl: string | null = null;
      if (logo) logoUrl = (await uploadLogo(kind, created.id, logo).catch(() => null))?.logoUrl ?? null;
      onCreated({ ...created, status: 'ACTIVE', logoUrl });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Add a new ${noun}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
          <Field label="Name *"><input className="input" autoFocus value={name} onChange={(e) => { setName(e.target.value); if (!codeTouched) setCode(suggestCode(e.target.value, taken) ?? ''); }} /></Field>
          <Field label="Code *" hint="Short and unique"><input className="input" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeTouched(true); }} /></Field>
          <Field label={kind === 'client' ? 'Contact name *' : 'Contact name'}><input className="input" value={contactName} onChange={(e) => setContactName(e.target.value)} /></Field>
          <Field label={kind === 'client' ? 'Contact email *' : 'Contact email'}><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        </div>
        <LogoPicker name={name} file={logo} onChange={setLogo} />
        <ErrorBox error={error} />
        <p className="text-xs text-muted">Saved to your {noun} list right away. Add the rest (website, {kind === 'client' ? 'billing' : 'redirects'}) later on the {kind === 'client' ? 'Clients' : 'Vendors'} page.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !name.trim() || !/^[A-Za-z0-9_-]{2,20}$/.test(code.trim())}>{busy ? 'Saving…' : `Save ${noun}`}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Adds a contact to a client from inside another form (keeps the client's other contacts). */
export function QuickAddContact({ client, initialName, onCreated, onClose }: { client: ClientOpt; initialName: string; onCreated: (contact: ContactOpt, all: ContactOpt[]) => void; onClose: () => void }) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!EMAIL.test(email.trim())) {
      setError({ message: 'Add a valid email.' });
      return;
    }
    setBusy(true);
    try {
      const keep = client.contacts.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone }));
      const r = await patch<{ contacts: ContactOpt[] }>(`/clients/${client.id}`, { contacts: [...keep, { name: name.trim(), email: email.trim(), phone: phone.trim() || null }] });
      const added = r.contacts.find((c) => c.email?.toLowerCase() === email.trim().toLowerCase());
      if (added) onCreated(added, r.contacts);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Add a contact at ${client.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name *"><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email *"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Phone"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 20 7946 0000" /></Field>
        </div>
        <ErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save contact'}</button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Searchable client or vendor picker with logos. Only active ones are offered (pass `parties`
 * already filtered); typing a new name offers “+ Add …”, which opens the quick-add form.
 */
export function PartyPicker<T extends PartyOpt>({ kind, parties, value, onChange, onAdded, exclude = [], taken, placeholder, disabled }: {
  kind: 'client' | 'vendor';
  parties: T[];
  value: string;
  onChange: (id: string) => void;
  onAdded: (p: T) => void;
  exclude?: string[];
  taken: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const options: Option[] = useMemo(
    () => parties.filter((p) => p.id === value || !exclude.includes(p.id)).map((p) => ({ value: p.id, label: p.name, hint: p.code, icon: <PartyLogo url={p.logoUrl} name={p.name} size={20} /> })),
    [parties, value, exclude],
  );
  return (
    <>
      <Combobox
        options={options}
        value={value || null}
        creatable
        disabled={disabled}
        placeholder={placeholder ?? `Search ${kind}s, or type a new name to add`}
        emptyText={`No active ${kind} matches. Type the name to add it.`}
        onChange={(v) => {
          if (v && !parties.some((p) => p.id === v)) setAdding(v);
          else onChange(v ?? '');
        }}
      />
      {adding !== null && (
        <QuickAddParty<T>
          kind={kind}
          initialName={adding}
          taken={taken}
          onClose={() => setAdding(null)}
          onCreated={(p) => {
            setAdding(null);
            onAdded(p);
            onChange(p.id);
          }}
        />
      )}
    </>
  );
}

/** Client contact picker: name with the masked email; typing a new name offers “+ Add …”. */
export function ContactPicker({ client, value, onChange, onAdded }: { client: ClientOpt | undefined; value: string; onChange: (id: string) => void; onAdded: (contacts: ContactOpt[]) => void }) {
  const [adding, setAdding] = useState<string | null>(null);
  const options: Option[] = (client?.contacts ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.email ? maskEmail(c.email) : undefined, keywords: c.email ?? '' }));
  return (
    <>
      <Combobox
        options={options}
        value={value || null}
        creatable={!!client}
        clearable
        disabled={!client}
        placeholder={client ? 'Choose, or type a name to add a contact' : 'Choose the client first'}
        onChange={(v) => {
          if (v && client && !client.contacts.some((c) => c.id === v)) setAdding(v);
          else onChange(v ?? '');
        }}
      />
      {adding !== null && client && (
        <QuickAddContact
          client={client}
          initialName={adding}
          onClose={() => setAdding(null)}
          onCreated={(c, all) => {
            setAdding(null);
            onAdded(all);
            onChange(c.id);
          }}
        />
      )}
    </>
  );
}
