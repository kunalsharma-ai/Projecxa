'use client';
import { SmartForm, type FieldDef, type FormSchema, type Values } from '@/components/form/smart-form';
import { checkPhone, checkRedirectUrl, checkWebsite, guessFromComplete, normaliseWebsite, VENDOR_REDIRECTS } from '@/lib/contact-rules';
import { hostOf, suggestCode } from '@/lib/suggest';

export interface VendorDetail {
  id: string; name: string; code: string; status: string; website: string | null;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  redirectAllowedDomains: string[]; callbackUrlTemplate: string | null; redirectUrls: Record<string, string> | null;
}

const DOMAIN = /^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$|^localhost$/i;
const key = (s: string) => `r_${s}`;

/**
 * Add or edit a vendor, with every redirect the vendor gives (complete, terminate, quota full,
 * security, and the rarer ones) next to the server-to-server callback.
 */
export function VendorForm({ vendor, taken, onSubmit, onCancel }: { vendor?: VendorDetail; taken: string[]; onSubmit: (body: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const others = taken.filter((c) => c !== vendor?.code);
  const redirectField = (r: (typeof VENDOR_REDIRECTS)[number]): FieldDef => ({
    name: key(r.status), type: 'text', label: r.label, span: 'full', hint: r.hint, validate: checkRedirectUrl,
    placeholder: r.status === 'COMPLETE' ? 'https://panel.example.com/end?status=complete&uid={respondent_uid}' : undefined,
    suggest: r.main && r.status !== 'COMPLETE'
      ? (v) => {
          if (String(v[key(r.status)] ?? '').trim()) return null;
          const g = guessFromComplete(String(v[key('COMPLETE')] ?? ''))[r.status];
          return g ? { value: g, reason: 'from the complete URL; check it with the vendor' } : null;
        }
      : undefined,
  });
  const schema: FormSchema = {
    sections: [
      {
        columns: vendor ? 3 : 2,
        fields: [
          { name: 'name', type: 'text', label: 'Name', required: true, maxLength: 200, placeholder: 'e.g. Nordic Panels' },
          {
            name: 'code', type: 'text', label: 'Code', required: true, pattern: [/^[A-Za-z0-9_-]{2,20}$/, 'Use 2–20 letters, digits, - or _.'],
            hint: 'Sent to redirects as the vendor ID ({vendor_id})',
            validate: (v) => (others.includes(String(v).trim().toUpperCase()) ? 'Another vendor already uses this code.' : null),
            suggest: vendor ? undefined : (v) => { const c = suggestCode(String(v.name ?? ''), others); return c ? { value: c, reason: 'from the name, not used yet' } : null; },
          },
          ...(vendor ? [{ name: 'status', type: 'segmented' as const, label: 'Status', options: [{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }] }] : []),
        ],
      },
      {
        title: 'Contact',
        columns: 2,
        fields: [
          { name: 'contactName', type: 'text', label: 'Contact name', maxLength: 200 },
          { name: 'contactEmail', type: 'email', label: 'Contact email' },
          { name: 'contactPhone', type: 'text', label: 'Phone', placeholder: '+44 20 7946 0000', validate: checkPhone },
          { name: 'website', type: 'text', label: 'Website', placeholder: 'panel.example.com', validate: checkWebsite },
        ],
      },
      {
        id: 'redirects',
        title: 'Redirects',
        description: (
          <>
            Where SampTrek sends this vendor’s respondents after the survey. Every project uses these automatically (they are prebuilt into each project’s Redirects tab), and a project can still change them.
            {' '}Macros: <code>{'{respondent_uid}'}</code> <code>{'{vendor_id}'}</code> <code>{'{country_code}'}</code> <code>{'{project_code}'}</code> <code>{'{status}'}</code>.
          </>
        ),
        fields: VENDOR_REDIRECTS.filter((r) => r.main).map(redirectField),
      },
      {
        title: 'More statuses (optional)',
        description: 'Leave empty to reuse the security or terminate URL above.',
        fields: VENDOR_REDIRECTS.filter((r) => !r.main).map(redirectField),
      },
      {
        title: 'Callback and domains',
        fields: [
          {
            name: 'callback', type: 'text', label: 'Callback URL (server to server)', span: 'full', placeholder: 'https://panel.example.com/cb?uid={uid}&status={status}',
            hint: 'Optional. Called in the background when a respondent finishes. Macros: {uid} {status} {vendor_id} {country_code} {project_code}',
            validate: (v) => {
              const s = String(v ?? '').trim();
              if (!s) return null;
              try { const u = new URL(s.replace(/\{[a-z_]+\}/g, 'x')); if (!/^https?:$/.test(u.protocol)) throw 0; } catch { return 'Use a full address starting with https://'; }
              return null;
            },
          },
          {
            name: 'domains', type: 'tags', label: 'Extra redirect domains', span: 'full', placeholder: 'panel.example.com, then Enter',
            hint: 'The hosts of the redirect URLs above are added for you. Add others this vendor may use.',
            props: { normalise: (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), validateTag: (t: string) => (DOMAIN.test(t) ? null : 'use a hostname like example.com or *.example.com') },
            suggest: (v) => { const h = hostOf(String(v.callback ?? '')); return h && !(v.domains as string[]).includes(h) ? { value: [...(v.domains as string[]), h], label: h, reason: 'the callback URL’s host' } : null; },
          },
        ],
      },
    ],
  };
  const initial: Values | undefined = vendor
    ? {
        name: vendor.name, code: vendor.code, status: vendor.status,
        contactName: vendor.contactName ?? '', contactEmail: vendor.contactEmail ?? '', contactPhone: vendor.contactPhone ?? '', website: vendor.website ?? '',
        callback: vendor.callbackUrlTemplate ?? '', domains: vendor.redirectAllowedDomains,
        ...Object.fromEntries(VENDOR_REDIRECTS.map((r) => [key(r.status), vendor.redirectUrls?.[r.status] ?? ''])),
      }
    : undefined;

  async function submit(v: Values) {
    await onSubmit({
      name: v.name, code: v.code, ...(vendor ? { status: v.status } : {}),
      contactName: v.contactName || null, contactEmail: v.contactEmail || null, contactPhone: v.contactPhone || null,
      website: normaliseWebsite(String(v.website ?? '')) ?? null,
      callbackUrlTemplate: v.callback || null,
      redirectAllowedDomains: v.domains,
      redirectUrls: Object.fromEntries(VENDOR_REDIRECTS.map((r) => [r.status, String(v[key(r.status)] ?? '').trim() || null])),
    });
  }
  return <SmartForm key={vendor?.id ?? 'new'} schema={schema} initial={initial} onSubmit={submit} submitLabel={vendor ? 'Save changes' : 'Save vendor'} onCancel={onCancel} draftKey={vendor ? undefined : 'vendor-new'} />;
}
