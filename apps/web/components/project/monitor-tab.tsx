'use client';
import { Bot, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AlertsList, MarketsTable, type MonitorData } from '@/components/monitor/monitor-view';
import { Reallocation } from '@/components/monitor/reallocation';
import type { ProjectDetail } from '@/components/project/types';
import { ErrorBox, Field, Loading, Section, Toggle } from '@/components/ui';
import { get, patch } from '@/lib/api';

const day = (d: string | null | undefined) => (d ? d.slice(0, 10) : '');

/** Field dates and autopilot for one project, with its live markets and active alerts. */
export function MonitorTab({ project, editable, reload }: { project: ProjectDetail; editable: boolean; reload: () => void }) {
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [start, setStart] = useState(day(project.fieldStartAt));
  const [end, setEnd] = useState(day(project.fieldEndAt));
  const [auto, setAuto] = useState({ pauseOnQuality: !!project.autopilot?.pauseOnQuality, closeOnTarget: !!project.autopilot?.closeOnTarget });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  const load = useCallback(() => get<MonitorData>(`/monitor?projectId=${project.id}`).then(setData).catch(setError), [project.id]);
  useEffect(() => {
    load();
  }, [load]);

  const dirty = start !== day(project.fieldStartAt) || end !== day(project.fieldEndAt) || auto.pauseOnQuality !== !!project.autopilot?.pauseOnQuality || auto.closeOnTarget !== !!project.autopilot?.closeOnTarget;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await patch(`/projects/${project.id}`, { fieldStartAt: start || null, fieldEndAt: end || null, autopilot: auto });
      setSaved(true);
      reload();
      load();
    } catch (e) {
      setSaveError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Section title="Field dates">
          <p className="mb-3 text-sm text-muted">The end date sets the daily pace each market needs. Without it, the monitor still watches for stalls, incidence and quality.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Field start"><input type="date" className="input" value={start} disabled={!editable} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Field end"><input type="date" className="input" value={end} min={start || undefined} disabled={!editable} onChange={(e) => setEnd(e.target.value)} /></Field>
          </div>
        </Section>
        <Section help="project.autopilot" title={<span className="flex items-center gap-2"><Bot className="h-4 w-4 text-brand" /> Autopilot</span>}>
          <p className="mb-3 text-sm text-muted">Actions the monitor may take on its own. Each one is logged and raised as an alert.</p>
          <div className="space-y-3">
            {([
              ['pauseOnQuality', 'Pause a vendor link when quality rejects spike', 'Uses the quality threshold from Settings. Reactivate the link from the monitor once the vendor fixes it.'],
              ['closeOnTarget', 'Close a vendor link once it delivers its target', 'Stops paying for overquota traffic from that vendor.'],
            ] as const).map(([k, label, hint]) => (
              <div key={k} className="flex items-start justify-between gap-4">
                <div><div className="text-sm font-medium">{label}</div><div className="text-xs text-muted">{hint}</div></div>
                <span className={editable ? '' : 'pointer-events-none opacity-60'}><Toggle checked={auto[k]} label={label} onChange={(v) => setAuto((a) => ({ ...a, [k]: v }))} /></span>
              </div>
            ))}
          </div>
        </Section>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={!dirty || saving} onClick={save}><Save className="h-4 w-4" /> Save</button>
          {saved && !dirty && <span className="text-sm text-ok" role="status">Saved</span>}
          <ErrorBox error={saveError} />
        </div>
      )}
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <>
          <Section help="project.alerts" title={`Active alerts (${data.alerts.length})`}>
            <AlertsList alerts={data.alerts} editable={editable} onChange={load} showProject={false} />
          </Section>
          <Reallocation projectId={project.id} editable={editable} onApplied={() => { load(); reload(); }} />
          <Section title="Live markets">
            <MarketsTable markets={data.markets} editable={editable} onChange={load} showProject={false} settings={data.settings} />
          </Section>
        </>
      )}
    </div>
  );
}
