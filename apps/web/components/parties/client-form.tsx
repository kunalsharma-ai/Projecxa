'use client';
import { SmartForm, type FormSchema, type Values } from '@/components/form/smart-form';
import { checkPhone, checkWebsite, normaliseWebsite } from '@/lib/contact-rules';
import { suggestCode } from '@/lib/suggest';

export interface ClientDetail {
  id: string; name: string; code: string; status: string; website: string | null;
  contacts: { id: string; name: string; email: string | null; phone: string | null }[];
  billingAddress: string | null; taxId: string | null; logoUrl?: string | null;
}

/** Add or edit a client. The same checks run on the server (contact-fields.ts). */
export function ClientForm({ client, taken, onSubmit, onCancel }: { client?: ClientDetail; taken: string[]; onSubmit: (body: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const others = taken.filter((c) => c !== client?.code);
  const schema: FormSchema = {
    sections: [
      {
        columns: client ? 3 : 2,
        fields: [
          { name: 'name', type: 'text', label: 'Name', required: true, maxLength: 200, placeholder: 'e.g. Acme Research' },
          {
            name: 'code', type: 'text', label: 'Code', required: true, pattern: [/^[A-Za-z0-9_-]{2,20}$/, 'Use 2–20 letters, digits, - or _.'], hint: 'Short and unique; used in project codes and reports',
            validate: (v) => (others.includes(String(v).trim().toUpperCase()) ? 'Another client already uses this code.' : null),
            suggest: client ? undefined : (v) => { const c = suggestCode(String(v.name ?? ''), others); return c ? { value: c, reason: 'from the name, not used yet' } : null; },
          },
          ...(client ? [{ name: 'status', type: 'segmented' as const, label: 'Status', options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }] }] : []),
          {
            name: 'website', type: 'text', label: 'Website', span: 'full', placeholder: 'acme.com', maxLength: 300,
            hint: 'We add https:// for you.', validate: checkWebsite,
            suggest: (v) => {
              const w = normaliseWebsite(String(v.website ?? ''));
              if (w && w !== String(v.website).trim()) return { value: w, reason: 'full address' };
              const mail = ((v.contacts as { email?: string }[]) ?? []).map((c) => c.email?.split('@')[1]).find((d) => d && !/gmail|yahoo|outlook|hotmail|icloud|proton/i.test(d));
              return !String(v.website ?? '').trim() && mail ? { value: `https://${mail}`, reason: 'from the contact’s email' } : null;
            },
          },
        ],
      },
      {
        title: 'Contacts',
        description: 'At least one person, with an email. Phone numbers are optional.',
        fields: [{ name: 'contacts', type: 'group', label: 'Contacts', itemLabel: 'Contact', minItems: 1, maxItems: 20, fields: [
          { name: 'name', type: 'text', label: 'Name', required: true, maxLength: 200 },
          { name: 'email', type: 'email', label: 'Email', required: true },
          { name: 'phone', type: 'text', label: 'Phone', placeholder: '+44 20 7946 0000', validate: checkPhone },
        ], validate: (v) => {
          const emails = ((v as { email?: string }[]) ?? []).map((c) => c.email?.trim().toLowerCase()).filter(Boolean);
          return new Set(emails).size !== emails.length ? 'Two contacts use the same email address.' : null;
        }, props: { columns: 3, hideLabel: true } }],
      },
      {
        title: 'Billing',
        description: 'Printed under “Bill to” on invoice PDFs.',
        columns: 3,
        fields: [
          { name: 'billingAddress', type: 'textarea', label: 'Billing address', span: 2, maxLength: 1000 },
          { name: 'taxId', type: 'text', label: 'Tax ID', hint: 'VAT, GST or similar', maxLength: 80 },
        ],
      },
    ],
  };
  const initial: Values | undefined = client
    ? {
        name: client.name, code: client.code, status: client.status, website: client.website ?? '',
        contacts: client.contacts.map((c) => ({ name: c.name, email: c.email ?? '', phone: c.phone ?? '' })),
        billingAddress: client.billingAddress ?? '', taxId: client.taxId ?? '',
      }
    : undefined;

  async function submit(v: Values) {
    const contacts = (v.contacts as { name: string; email: string; phone: string }[]).map((c) => ({ name: c.name, email: c.email || null, phone: c.phone || null }));
    await onSubmit({
      name: v.name, code: v.code, ...(client ? { status: v.status } : {}),
      website: normaliseWebsite(String(v.website ?? '')) ?? null,
      billingAddress: v.billingAddress || null, taxId: v.taxId || null, contacts,
    });
  }
  return <SmartForm key={client?.id ?? 'new'} schema={schema} initial={initial} onSubmit={submit} submitLabel={client ? 'Save changes' : 'Save client'} onCancel={onCancel} draftKey={client ? undefined : 'client-new'} />;
}
