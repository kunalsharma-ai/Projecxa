'use client';
import { Mail, Phone, UserRound } from 'lucide-react';
import { maskEmail, maskPhone } from '@/lib/mask';
import { PartyLogo } from './logo';

/**
 * A client or vendor with its logo, and the contact person with the email masked so only the
 * first and last letter and the domain show (docs/CLIENTS_VENDORS_LOGOS_AND_STATUS.md).
 */
export function PartyContact({ name, logoUrl, website, contact, size = 40 }: {
  name: string;
  logoUrl?: string | null;
  website?: string | null;
  contact?: { name: string; email?: string | null; phone?: string | null } | null;
  size?: number;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <PartyLogo url={logoUrl} name={name} size={size} />
      <div className="min-w-0 text-sm">
        <div className="truncate font-medium">{name}</div>
        {website && <div className="truncate text-xs text-muted">{website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</div>}
        {contact ? (
          <div className="mt-1 space-y-0.5 text-xs">
            <div className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5 text-muted" aria-hidden /> {contact.name}</div>
            {contact.email && <div className="flex items-center gap-1.5 text-muted" title="Masked: the full address is on the Clients page"><Mail className="h-3.5 w-3.5" aria-hidden /> <span className="font-mono">{maskEmail(contact.email)}</span></div>}
            {contact.phone && <div className="flex items-center gap-1.5 text-muted"><Phone className="h-3.5 w-3.5" aria-hidden /> <span className="font-mono">{maskPhone(contact.phone)}</span></div>}
          </div>
        ) : (
          <div className="mt-1 text-xs text-muted">No contact person chosen</div>
        )}
      </div>
    </div>
  );
}
