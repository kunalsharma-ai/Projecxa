'use client';
import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Empty, Field, Section } from '@/components/ui';
import { get } from '@/lib/api';
import type { FraudRules, ProjectDetail } from './types';

/** Cross-project rules and the risk threshold (docs/FRAUD_CHECKS.md). Saved with the rest of Gate & security. */
export const DEFAULT_FRAUD_RULES: FraudRules = { crossProject: { scope: 'all', projectIds: [], days: 90, outcomes: 'any' }, riskThreshold: null };

export function fraudRulesOf(r: ProjectDetail['fraudRules']): FraudRules {
  return { crossProject: { ...DEFAULT_FRAUD_RULES.crossProject, ...(r?.crossProject ?? {}) }, riskThreshold: r?.riskThreshold ?? null };
}

export function fraudRulesProblem(r: FraudRules, crossOn: boolean): string | null {
  const d = r.crossProject.days;
  if (!Number.isInteger(d) || d < 1 || d > 365) return 'Days back must be a whole number from 1 to 365.';
  if (r.riskThreshold != null && (!Number.isInteger(r.riskThreshold) || r.riskThreshold < 10 || r.riskThreshold > 100)) return 'The risk score must be a whole number from 10 to 100, or empty.';
  if (crossOn && r.crossProject.scope === 'listed' && !r.crossProject.projectIds.length) return 'Pick at least one project, or choose another option for Projects that count.';
  return null;
}

interface ProjectRef { id: string; projectCode: string; name: string }

export function FraudRulesSection({ project, value, onChange, editable, crossOn }: { project: ProjectDetail; value: FraudRules; onChange: (r: FraudRules) => void; editable: boolean; crossOn: boolean }) {
  const [projects, setProjects] = useState<ProjectRef[] | null>(null);
  const cp = value.crossProject;
  const setCp = (patch: Partial<FraudRules['crossProject']>) => onChange({ ...value, crossProject: { ...cp, ...patch } });
  useEffect(() => {
    if (cp.scope === 'listed' && !projects) get<{ items: ProjectRef[] }>('/projects?pageSize=100').then((r) => setProjects(r.items.filter((p) => p.id !== project.id))).catch(() => setProjects([]));
  }, [cp.scope, projects, project.id]);
  const problem = fraudRulesProblem(value, crossOn);

  return (
    <Section title="Fraud rules" help="section:Fraud rules">
      <div className="space-y-4">
        <div className={clsx('space-y-3', !crossOn && 'opacity-60')}>
          {!crossOn && <p className="text-sm text-muted">Turn on “Across projects” under Duplicates to use these.</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Projects that count">
              <select className="input" disabled={!editable} value={cp.scope} onChange={(e) => setCp({ scope: e.target.value as FraudRules['crossProject']['scope'] })}>
                <option value="all">All my projects</option>
                <option value="client">This client’s projects</option>
                <option value="listed">Only the projects I pick</option>
              </select>
            </Field>
            <Field label="Days back">
              <input className="input" type="number" min={1} max={365} disabled={!editable} value={Number.isFinite(cp.days) ? cp.days : ''} onChange={(e) => setCp({ days: e.target.value === '' ? NaN : Number(e.target.value) })} />
            </Field>
            <Field label="Who counts">
              <select className="input" disabled={!editable} value={cp.outcomes} onChange={(e) => setCp({ outcomes: e.target.value as 'any' | 'completes' })}>
                <option value="any">Anyone who entered</option>
                <option value="completes">Only completes</option>
              </select>
            </Field>
          </div>
          {cp.scope === 'listed' && (
            <div className="rounded-lg border border-line p-3">
              {!projects ? <p className="text-sm text-muted">Loading projects…</p> : projects.length === 0 ? <p className="text-sm text-muted">No other projects yet.</p> : (
                <ul className="max-h-56 space-y-1 overflow-y-auto">
                  {projects.map((p) => (
                    <li key={p.id}>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" disabled={!editable} checked={cp.projectIds.includes(p.id)}
                          onChange={(e) => setCp({ projectIds: e.target.checked ? [...cp.projectIds, p.id].slice(0, 50) : cp.projectIds.filter((x) => x !== p.id) })} />
                        <span className="font-mono text-xs text-muted">{p.projectCode}</span> <span className="min-w-0 truncate">{p.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="border-t border-line pt-4">
          <Field label="Reject at risk score" hint="Every respondent gets a fraud risk score from 0 to 100 from the checks that ran. Empty = record the score only.">
            <input className="input max-w-[10rem]" type="number" min={10} max={100} placeholder="Off" disabled={!editable} value={value.riskThreshold ?? ''}
              onChange={(e) => onChange({ ...value, riskThreshold: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
        </div>
        {editable && problem && <p className="text-xs text-warn">{problem}</p>}
      </div>
    </Section>
  );
}

interface LinkedSession { id: string; here: boolean; projectId: string; projectCode: string; projectName: string; vendor: string; vendorCode: string; respondentId: string; status: string; statusDetail: string | null; outcome: string; startedAt: string; riskScore: number | null }
interface Group { projects: number; vendors: number; matchedBy: string[]; sessions: LinkedSession[] }

const day = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** Respondents here whose device or browser also came in through another vendor or project. */
export function LinkedPeople({ projectId }: { projectId: string }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    get<{ groups: Group[] }>(`/projects/${projectId}/fraud/linked`).then((r) => setGroups(r.groups)).catch(() => setFailed(true));
  }, [projectId]);
  const shown = open ? groups ?? [] : (groups ?? []).slice(0, 5);
  return (
    <Section title="Same person elsewhere" help="section:Same person elsewhere">
      {failed ? <p className="text-sm text-muted">Could not load.</p> : !groups ? <p className="text-sm text-muted">Loading…</p> : groups.length === 0 ? (
        <Empty>No one here has come in through another vendor or project.</Empty>
      ) : (
        <>
          <ul className="space-y-3">
            {shown.map((g, i) => (
              <li key={i} className="rounded-lg border border-line p-3">
                <div className="mb-2 text-xs text-muted">
                  {g.projects > 1 ? `${g.projects} projects` : 'This project'} · {g.vendors > 1 ? `${g.vendors} vendors` : '1 vendor'}{g.matchedBy.length ? ` · same ${g.matchedBy.join(', ')}` : ''}
                </div>
                <ul className="space-y-2">
                  {g.sessions.map((s) => (
                    <li key={s.id} className="text-sm">
                      <div className="flex min-w-0 items-baseline gap-1">
                        {s.here ? <span className="font-medium">Here</span> : <Link className="font-medium underline" href={`/projects/${s.projectId}`} title={s.projectName}>{s.projectCode}</Link>}
                        <span className="text-muted">·</span><span className="shrink-0">{s.vendorCode}</span>
                        <span className="text-muted">·</span><span className="min-w-0 truncate font-mono text-xs">{s.respondentId}</span>
                      </div>
                      <div className="text-xs text-muted">{s.outcome} · {day(s.startedAt)}{s.riskScore != null ? ` · risk ${s.riskScore}` : ''}</div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {groups.length > 5 && <button type="button" className="btn-ghost mt-3 w-full justify-center text-xs" onClick={() => setOpen(!open)}>{open ? 'Show fewer' : `Show all ${groups.length}`}</button>}
        </>
      )}
    </Section>
  );
}
