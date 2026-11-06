'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorBox, Field, Section } from '@/components/ui';
import { post } from '@/lib/api';
import type { ProjectDetail } from './types';

/** Copies this project as a new draft in one step (a template is for setups you reuse many times). */
export function CloneProject({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(`${project.name} (copy)`.slice(0, 300));
  const [include, setInclude] = useState({ includeVendors: true, includeSurveyLinks: true, includeQuotas: true });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function clone() {
    setBusy(true);
    setError(null);
    try {
      const p = await post<{ id: string }>(`/projects/${project.id}/clone`, { name: name.trim(), ...include });
      router.push(`/projects/${p.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const opts: [keyof typeof include, string, string][] = [
    ['includeVendors', 'Vendors and their payouts', 'Each gets a new entry link'],
    ['includeQuotas', 'Quota cells', 'Targets and conditions for each market'],
    ['includeSurveyLinks', 'Client survey links', 'Turn off if the client sends new links'],
  ];
  return (
    <Section title="Clone project" className="mb-6">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Makes a new draft project with the same client, markets ({project.countries.length}), LOI, IR, CPI, completes, devices, security, gate and prescreener questions, respondent pages and redirects. Respondents, completes and money are not copied.
        </p>
        <ErrorBox error={error} />
        <div className="max-w-xl"><Field label="New project name"><input className="input" maxLength={300} value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-muted">Also copy</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {opts.map(([k, label, hint]) => (
              <label key={k} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={include[k]} onChange={(e) => setInclude({ ...include, [k]: e.target.checked })} />
                <span><span className="font-medium">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={clone}>{busy ? 'Cloning…' : 'Clone project'}</button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Section>
  );
}
