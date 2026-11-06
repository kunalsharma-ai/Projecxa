'use client';
import { Building2, Globe2, Smartphone, Users } from 'lucide-react';
import { useState } from 'react';
import { Segmented } from '@/components/form/choice';
import { FormField } from '@/components/form/field';
import { RichTextView } from '@/components/form/rich-text';
import { SmartForm, type FormSchema, type Values } from '@/components/form/smart-form';
import { InlineEdit } from '@/components/form/tags';
import { PageHeader, Section } from '@/components/ui';
import { COUNTRIES } from '@/lib/countries';
import { emailDomain } from '@/lib/suggest';

const CLIENTS = ['Acme Insights', 'Blue Harbour Research', 'Cobalt Analytics', 'Delta Consumer Lab', 'Evergreen Health Panel', 'Fjord Mobility'].map((n) => ({ value: n, label: n }));
const searchClients = async (q: string) => { await new Promise((r) => setTimeout(r, 250)); return CLIENTS.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())); };

/** A demo brief that uses every control. Nothing here is saved. */
const SCHEMA: FormSchema = {
  sections: [
    {
      title: 'Study',
      description: 'Floating labels, searchable and server-backed selects, and a suggestion from the email you type.',
      columns: 2,
      fields: [
        { name: 'title', type: 'text', label: 'Study name', required: true, floating: true, minLength: 3, maxLength: 120 },
        { name: 'client', type: 'select', label: 'Client', required: true, onSearch: searchClients, options: [], creatable: true, placeholder: 'Search clients…', help: 'Options come from the server as you type. Choose “Add …” for a new one.' },
        { name: 'contactEmail', type: 'email', label: 'Client contact email', floating: true },
        { name: 'domain', type: 'text', label: 'Client website domain', placeholder: 'acme.com', suggest: (v) => { const d = emailDomain(String(v.contactEmail ?? '')); return d ? { value: d, reason: 'from the contact email' } : null; } },
        {
          name: 'audience', type: 'radiocards', label: 'Audience', required: true, props: { columns: 3 },
          options: [
            { value: 'B2C', label: 'Consumers', description: 'General population and boosts', icon: <Users className="h-5 w-5" /> },
            { value: 'B2B', label: 'Business', description: 'Decision makers and IT', icon: <Building2 className="h-5 w-5" /> },
            { value: 'HC', label: 'Healthcare', description: 'Patients and physicians', icon: <Globe2 className="h-5 w-5" /> },
          ],
        },
        { name: 'roles', type: 'checkboxes', label: 'Job roles', required: (v) => v.audience === 'B2B', showIf: (v) => v.audience === 'B2B', props: { columns: 3, selectAll: true },
          options: ['C-level', 'IT decision maker', 'Finance', 'HR', 'Marketing', 'Operations'].map((r) => ({ value: r, label: r })) },
        { name: 'specialties', type: 'multiselect', label: 'Physician specialties', showIf: (v) => v.audience === 'HC', creatable: true, max: 5,
          options: ['Cardiology', 'Oncology', 'Dermatology', 'General practice', 'Neurology', 'Paediatrics'].map((s) => ({ value: s, label: s })) },
      ],
    },
    {
      title: 'Markets and money',
      columns: 3,
      fields: [
        { name: 'markets', type: 'countries', label: 'Markets', required: true, span: 2, max: 12 },
        { name: 'currency', type: 'currency', label: 'Quote currency', required: true, suggest: (v) => { const m = (v.markets as string[])?.[0]; const c = COUNTRIES.find((x) => x.code === m)?.currency; return c ? { value: c, reason: `the currency of ${m}` } : null; } },
        { name: 'completes', type: 'number', label: 'Completes', required: true, integer: true, min: 1, max: 100000, props: { suffix: 'n' } },
        { name: 'loi', type: 'number', label: 'Interview length', required: true, min: 1, max: 90, props: { suffix: 'min' } },
        { name: 'cpi', type: 'number', label: 'Target CPI', min: 0, props: { suffix: 'each' }, hint: 'Per complete, in the quote currency' },
        { name: 'device', type: 'segmented', label: 'Devices', options: [{ value: 'any', label: 'Any' }, { value: 'desktop', label: 'Desktop' }, { value: 'mobile', label: 'Mobile', icon: <Smartphone className="h-3.5 w-3.5" /> }] },
        { name: 'fieldDates', type: 'daterange', label: 'Fieldwork dates', required: true, span: 2 },
        { name: 'kickoff', type: 'date', label: 'Kick-off call', placeholder: 'e.g. tomorrow or +3', hint: 'Try “tomorrow”, “+7” or 30/11/2026' },
        { name: 'tags', type: 'tags', label: 'Tags', span: 2, max: 8, props: { suggestions: ['tracker', 'wave 2', 'urgent'] } },
        { name: 'trackers', type: 'switch', label: 'Repeat waves', props: { switchLabel: 'This is a tracker', description: 'Asks for the wave schedule' } },
        { name: 'waves', type: 'group', label: 'Waves', itemLabel: 'Wave', showIf: (v) => !!v.trackers, minItems: 1, maxItems: 12, props: { columns: 2 },
          fields: [{ name: 'name', type: 'text', label: 'Name', required: true }, { name: 'start', type: 'date', label: 'Starts', required: true }] },
      ],
    },
    {
      title: 'Brief',
      fields: [
        { name: 'brief', type: 'richtext', label: 'Notes for the team', maxLength: 4000, placeholder: 'Objectives, quotas, anything unusual…', hint: 'Bold, italic, headings, lists and links. Ctrl+B, Ctrl+I, Ctrl+K.' },
        { name: 'files', type: 'file', label: 'Questionnaire', props: { accept: '.pdf,.docx,.xlsx', maxSizeMb: 20, multiple: true } },
        { name: 'agree', type: 'switch', label: 'Confirmation', required: true, props: { switchLabel: 'The client approved this brief' } },
      ],
    },
  ],
};

export default function FormGalleryPage() {
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable');
  const [values, setValues] = useState<Values>({});
  const [sent, setSent] = useState<Values | null>(null);
  const [inline, setInline] = useState('Wave 3 · UK and Germany');
  const [note, setNote] = useState('Quotas: **50/50 gender**, age 18–65.\n\n- Exclude market research employees\n- Soft launch at 10%');
  return (
    <>
      <PageHeader title="Form gallery" subtitle="The smart form controls every SampTrek form uses. Try the keyboard: Tab, arrows, Enter, Escape, Ctrl+Enter. Nothing here is saved." />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Section title="Example: study brief" actions={<Segmented size="sm" value={density} onChange={(v) => setDensity(v as typeof density)} items={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }]} />}>
          <SmartForm key={density} schema={SCHEMA} density={density} draftKey="gallery-brief" submitLabel="Check and submit" onChange={setValues}
            initial={{ device: 'any', markets: ['GB', 'DE'] }}
            onSubmit={(v) => { setSent(v); }} />
          {sent && <p className="mt-3 rounded-lg bg-ok/10 p-3 text-sm text-ok" role="status">Everything checks out. These values would be sent (see the panel).</p>}
        </Section>
        <div className="min-w-0 space-y-6">
          <Section title="Inline edit">
            <div className="space-y-4">
              <FormField label="Wave name"><InlineEdit label="wave name" value={inline} onSave={async (v) => { await new Promise((r) => setTimeout(r, 400)); if (!v.trim()) throw new Error('A name is required'); setInline(v); }} /></FormField>
              <FormField label="Field note"><InlineEdit label="field note" multiline value={note} onSave={setNote} display={(v) => <RichTextView value={v} />} /></FormField>
            </div>
          </Section>
          <Section title={sent ? 'Submitted values' : 'Live values'}>
            <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-all rounded-md bg-sunken/60 p-3 font-mono text-[11px] leading-relaxed">{JSON.stringify(sent ?? values, (_k, v) => (typeof File !== 'undefined' && v instanceof File ? `${v.name} (${v.size} bytes)` : v), 2)}</pre>
          </Section>
        </div>
      </div>
    </>
  );
}
