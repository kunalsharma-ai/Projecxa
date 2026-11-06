'use client';
import { Copy, Eye, KeyRound, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useMe } from '@/components/me';
import { ErrorBox, Section } from '@/components/ui';
import { get, post } from '@/lib/api';

/** How API destination endpoints work, and the signing secret for admins. */
export function RedirectSigning() {
  const me = useMe();
  const admin = me?.user.role === 'ADMIN';
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  async function reveal() {
    try {
      setSecret((await get<{ secret: string }>('/organization/redirect-signing-secret')).secret);
    } catch (e) {
      setError(e);
    }
  }
  async function rotate() {
    if (!confirm('Make a new signing secret? Endpoints that check the old one will reject requests until they are updated, and respondents will be sent to fallback URLs meanwhile.')) return;
    try {
      setSecret((await post<{ secret: string }>('/organization/redirect-signing-secret/rotate')).secret);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Section help="project.apiDestinations" title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> API destinations</span>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          In hybrid mode a status can use type <b>API</b>: SampTrek asks your client&apos;s or vendor&apos;s endpoint where to send each respondent. It POSTs
          <code className="mx-1">{'{status, respondent_uid, vendor_id, country_code, project_code}'}</code>
          and expects <code>{'{"url": "https://…"}'}</code> back. The endpoint and the URL it answers must be on the allowed domains. If it does not answer in time
          (1.5 s by default) or answers something not allowed, the respondent goes to the fallback URL. QA studio asks with <code>&quot;test&quot;: true</code>.
        </p>
        <p className="text-muted">
          Each request carries <code>X-Projexa-Timestamp</code> and <code>X-Projexa-Signature: sha256=…</code>, an HMAC-SHA256 of <code>timestamp.body</code> with your organisation&apos;s signing secret.
        </p>
        <ErrorBox error={error} />
        {admin ? (
          <div className="flex flex-wrap items-center gap-2">
            {secret ? (
              <>
                <code className="min-w-0 break-all rounded bg-sunken px-2 py-1 text-xs">{secret}</code>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => navigator.clipboard?.writeText(secret).then(() => setCopied(true))}><Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}</button>
              </>
            ) : (
              <button className="btn-ghost px-2 py-1 text-xs" onClick={reveal}><Eye className="h-3.5 w-3.5" /> Show signing secret</button>
            )}
            <button className="btn-ghost px-2 py-1 text-xs" onClick={rotate}><RefreshCw className="h-3.5 w-3.5" /> Rotate</button>
          </div>
        ) : (
          <p className="text-xs text-muted">An admin can show or rotate the signing secret.</p>
        )}
      </div>
    </Section>
  );
}
