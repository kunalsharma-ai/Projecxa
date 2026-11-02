'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorBox, Field, Section } from '@/components/ui';
import { post } from '@/lib/api';
import type { ProjectTemplate } from '@/lib/templates';
import type { ProjectDetail } from './types';

/** Saves this project's setup as a reusable template. */
export function SaveTemplate({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const [name, setName] = useState(project.name.replace(/\b(wave|w)\s*\d+\b/i, '').trim().slice(0, 120) || project.name.slice(0, 120));
  const [description, setDescription] = useState('');
  const [include, setInclude] = useState({ quotas: true, vendors: true, client: false, surveyLinks: false });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<ProjectTemplate | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setSaved(await post<ProjectTemplate>(`/projects/${project.id}/template`, { name: name.trim(), description: description.trim() || undefined, include }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const opts: [keyof typeof include, string, string][] = [
    ['quotas', 'Quota cells', 'Targets and conditions for each market'],
    ['vendors', 'Vendors and their CPI', 'New entry links are made for each new project'],
    ['client', `Client (${project.client.name})`, 'Leave off to reuse the setup for any client'],
    ['surveyLinks', 'Survey links', 'Usually different for every project'],
  ];
  return (
    <Section title="Save as template" className="mb-6">
      {saved ? (
        <div className="space-y-3 text-sm" role="status">
          <p>Template “{saved.name}” saved. Pick it under <strong>Start from</strong> when you create a project.</p>
          <div className="flex flex-wrap gap-2">
            <Link className="btn-primary" href={`/projects/new?template=${saved.id}`}>Create a project from it</Link>
            <Link className="btn-ghost" href="/projects/templates">All templates</Link>
            <button className="btn-ghost" onClick={onClose}>Close</button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">Keeps the project type, category, devices, security, gate and prescreener questions, respondent page design, autopilot, redirect rules and every market&apos;s LOI, IR, CPI and completes.</p>
          <ErrorBox error={error} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Template name"><input className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Description"><input className="input" maxLength={2000} value={description} placeholder="When to use it" onChange={(e) => setDescription(e.target.value)} /></Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-muted">Also keep</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {opts.map(([k, label, hint]) => (
                <label key={k} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={include[k]} onChange={(e) => setInclude({ ...include, [k]: e.target.checked })} />
                  <span>{label}<span className="block text-xs text-muted">{hint}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={!name.trim() || busy} onClick={save}>{busy ? 'Saving…' : 'Save template'}</button>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      )}
    </Section>
  );
}
