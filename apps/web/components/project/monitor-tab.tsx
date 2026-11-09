'use client';
import { Bot, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AlertsList, MarketsTable, type MonitorData } from '@/components/monitor/monitor-view';
import { Reallocation } from '@/components/monitor/reallocation';
import type { AutoPause, AutoRoute, ProjectDetail } from '@/components/project/types';
import { AutoRouteControl, DEFAULT_AUTO_ROUTE, RoutingPlan, autoRouteProblem } from '@/components/project/auto-route';
import { AutoPauseControl, DEFAULT_AUTO_PAUSE, autoPauseProblem } from '@/components/project/auto-pause';
import { ErrorBox, Field, Loading, Section, Toggle } from '@/components/ui';
import { useMe } from '@/components/me';
import { get, patch } from '@/lib/api';
import { hasFeature } from '@/lib/types';

const day = (d: string | null | undefined) => (d ? d.slice(0, 10) : '');

/** Field dates and autopilot for one project, with its live markets and active alerts. */
export function MonitorTab({ project, editable, reload }: { project: ProjectDetail; editable: boolean; reload: () => void }) {
  const me = useMe();
  const canRoute = hasFeature(me, 'vendor_routing');
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [start, setStart] = useState(day(project.fieldStartAt));
  const [end, setEnd] = useState(day(project.fieldEndAt));
  const [auto, setAuto] = useState({ pauseOnQuality: !!project.autopilot?.pauseOnQuality, closeOnTarget: !!project.autopilot?.closeOnTarget });
  const savedPause: AutoPause = { ...DEFAULT_AUTO_PAUSE, ...(project.autopilot?.autoPause ?? {}) };
  const [pause, setPause] = useState<AutoPause>(savedPause);
  const savedRoute: AutoRoute = { ...DEFAULT_AUTO_ROUTE, ...(project.autopilot?.autoRoute ?? {}), weights: { ...DEFAULT_AUTO_ROUTE.weights, ...(project.autopilot?.autoRoute?.weights ?? {}) } };
  const [route, setRoute] = useState<AutoRoute>(savedRoute);
  const [routeKey, setRouteKey] = useState(0);
  const savedFloor = project.autopilot?.marginFloorPct == null ? '' : String(project.autopilot.marginFloorPct);
  const [floor, setFloor] = useState(savedFloor);
  const floorBad = floor !== '' && !(Number.isInteger(Number(floor)) && Number(floor) >= 0 && Number(floor) <= 95);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  const load = useCallback(() => get<MonitorData>(`/monitor?projectId=${project.id}`).then(setData).catch(setError), [project.id]);
  useEffect(() => {
    load();
  }, [load]);

  const pauseDirty = JSON.stringify(pause) !== JSON.stringify(savedPause);
  const routeDirty = JSON.stringify(route) !== JSON.stringify(savedRoute);
  const dirty = pauseDirty || routeDirty || floor !== savedFloor || start !== day(project.fieldStartAt) || end !== day(project.fieldEndAt) || auto.pauseOnQuality !== !!project.autopilot?.pauseOnQuality || auto.closeOnTarget !== !!project.autopilot?.closeOnTarget;
  // The autopilot can switch the checkpoint off by itself; follow it when nothing is being edited.
  useEffect(() => {
    if (!pauseDirty) setPause(savedPause);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(project.autopilot?.autoPause)]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await patch(`/projects/${project.id}`, { fieldStartAt: start || null, fieldEndAt: end || null, autopilot: { ...auto, autoPause: pause, autoRoute: route, marginFloorPct: floor === '' ? null : Number(floor) } });
      setSaved(true);
      setRouteKey((k) => k + 1);
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
          <AutoPauseControl project={project} value={pause} onChange={setPause} editable={editable} />
          {canRoute && <AutoRouteControl value={route} onChange={setRoute} editable={editable} />}
          <div className="mt-4 border-t border-line pt-3">
            <Field label="Margin alert below (%)" hint={floorBad ? 'Use a whole number from 0 to 95.' : 'Alert when the forecast margin at finish is under this. Leave empty to use the floor from Settings → Fieldwork alerts.'}>
              <input className="input w-32 tabular-nums" type="number" inputMode="numeric" min={0} max={95} placeholder="Default" value={floor} disabled={!editable} onChange={(e) => setFloor(e.target.value)} />
            </Field>
          </div>
        </Section>
      </div>
      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={!dirty || saving || floorBad || !!autoPauseProblem(pause) || !!autoRouteProblem(route)} onClick={save}><Save className="h-4 w-4" /> Save</button>
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
          {canRoute && <RoutingPlan key={routeKey} projectId={project.id} editable={editable} onChanged={() => { load(); reload(); setRouteKey((k) => k + 1); }} />}
          <Reallocation key={`r${routeKey}`} projectId={project.id} editable={editable} onApplied={() => { load(); reload(); setRouteKey((k) => k + 1); }} />
          <Section title="Live markets">
            <MarketsTable markets={data.markets} editable={editable} onChange={load} showProject={false} settings={data.settings} />
          </Section>
        </>
      )}
    </div>
  );
}
