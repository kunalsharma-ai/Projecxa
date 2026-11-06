'use client';
import clsx from 'clsx';
import { ClipboardPaste, Copy, FileStack, LayoutTemplate, Monitor, Smartphone, Sparkles, Tablet, Trash2, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { DateRangePicker } from '@/components/form/date';
import { BriefBanner, BriefReader, useBriefAvailability, type BriefInfo } from '@/components/project/brief-reader';
import { ErrorBox, Field, Loading, PageHeader, Section, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { describeTemplate, type ProjectTemplate, type TemplateForm } from '@/lib/templates';
import { COUNTRIES, countryName, flag } from '@/lib/countries';
import { CATEGORIES, RedirectMode, SECURITY_LABELS, type WonBid } from '@/lib/types';

interface ClientOpt { id: string; name: string; contacts: { id: string; name: string }[] }
interface UserOpt { id: string; name: string; role: string }

type Num = number | '';
interface CountryRow {
  countryCode: string;
  language: string;
  targetGroup: string;
  loiMinutes: Num;
  irPercent: Num;
  cpi: Num;
  currency: string;
  targetCompletes: Num;
  liveSurveyUrl: string;
}

const SHARED_DEFAULTS = { targetGroup: '', loiMinutes: 15 as Num, irPercent: 30 as Num, cpi: '' as Num, targetCompletes: 100 as Num, liveSurveyUrl: '', testSurveyUrl: '' };

function blankRow(code: string): CountryRow {
  const c = COUNTRIES.find((x) => x.code === code);
  return { countryCode: code, language: c?.lang ?? 'en', currency: c?.currency ?? 'USD', targetGroup: '', loiMinutes: '', irPercent: '', cpi: '', targetCompletes: '', liveSurveyUrl: '' };
}

const num = (v: string): Num => (v === '' ? '' : Number(v));
const opt = (v: number | string | undefined | null): Num => (v === undefined || v === null || v === '' ? '' : Number(v));

interface DraftRow { id: string; title: string; updatedAt: string }
interface DraftData { info: typeof EMPTY_INFO; devices: Record<'desktop' | 'mobile' | 'tablet', boolean>; security: Record<string, boolean>; mode: RedirectMode; shared: typeof SHARED_DEFAULTS; rows: CountryRow[]; templateId: string | null; wonBidId: string | null; brief?: BriefInfo | null }
const EMPTY_INFO = { name: '', workOrderNo: '', generateWorkOrder: true, type: 'AD_HOC', category: '', clientId: '', clientContactId: '', salesPersonId: '', projectManagerId: '', description: '', bidReference: '', fieldStartAt: '', fieldEndAt: '' };
const time = (d: string | Date) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <CreateProjectPage />
    </Suspense>
  );
}

/** Wizard rows from a won bid's market lines (LOI rounded up, IR rounded to whole percent). */
function rowsFromBid(b: WonBid): CountryRow[] {
  return b.countries.map((c) => {
    const r = blankRow(c.countryCode);
    return {
      ...r,
      language: c.language ?? r.language,
      currency: b.currency,
      loiMinutes: Math.max(1, Math.ceil(c.loiMinutes)),
      irPercent: Math.min(100, Math.max(1, Math.round(c.incidencePct))),
      cpi: c.cpi ?? '',
      targetCompletes: c.sampleSize,
    };
  });
}

function CreateProjectPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [wonBidId, setWonBidId] = useState(params.get('wonBid'));
  const [wonBid, setWonBid] = useState<(WonBid & { suggestedClient: { id: string; name: string } | null }) | null>(null);
  const [addingClient, setAddingClient] = useState(false);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [info, setInfo] = useState(EMPTY_INFO);
  const [devices, setDevices] = useState({ desktop: true, mobile: true, tablet: true });
  const [security, setSecurity] = useState<Record<string, boolean>>({ gateSurvey: true, captcha: true });
  const [mode, setMode] = useState<RedirectMode>('HYBRID');
  const [shared, setShared] = useState(SHARED_DEFAULTS);
  const [rows, setRows] = useState<CountryRow[]>([]);
  const [picker, setPicker] = useState('');
  const [paste, setPaste] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [template, setTemplate] = useState<ProjectTemplate | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const briefAvailable = useBriefAvailability();
  const [reading, setReading] = useState(params.get('brief') === '1');
  const [brief, setBrief] = useState<BriefInfo | null>(null);
  const [draftId, setDraftId] = useState<string | null>(params.get('draft'));
  const [draftState, setDraftState] = useState<{ status: 'idle' | 'saving' | 'saved' | 'error'; at?: string }>({ status: 'idle' });
  const lastSaved = useRef<string>('');
  const ready = useRef(false);
  const fromDraft = useRef(false);
  const draftRef = useRef<string | null>(draftId);
  const inflight = useRef<Promise<unknown>>(Promise.resolve());
  draftRef.current = draftId;

  useEffect(() => {
    get<ClientOpt[]>('/clients').then(setClients).catch(setError);
    get<UserOpt[]>('/users').then(setUsers).catch(setError);
    get<ProjectTemplate[]>('/project-templates').then(setTemplates).catch(() => setTemplates([]));
    get<DraftRow[]>('/project-drafts').then(setDrafts).catch(() => setDrafts([]));
    const t = params.get('template');
    const d = params.get('draft');
    if (d) loadDraft(d);
    else if (t) applyTemplate(t);
    else ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setUrl(q: Record<string, string | null>) {
    const u = new URL(window.location.href);
    for (const [k, v] of Object.entries(q)) (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
    window.history.replaceState(null, '', u.toString());
  }

  async function applyTemplate(id: string) {
    setError(null);
    if (!id) {
      setTemplate(null);
      setUrl({ template: null });
      return;
    }
    try {
      const t = await get<ProjectTemplate & { form: TemplateForm }>(`/project-templates/${id}`);
      const f = t.form;
      const d = f.defaults;
      setTemplate(t);
      setInfo((i) => ({ ...i, type: f.type, category: f.category, clientId: f.clientId ?? i.clientId, clientContactId: f.clientId ? '' : i.clientContactId, description: i.description || (f.description ?? '') }));
      setDevices({ desktop: !!f.devices.desktop, mobile: !!f.devices.mobile, tablet: !!f.devices.tablet });
      setSecurity(f.security);
      setMode(f.redirectMode as RedirectMode);
      setShared({ targetGroup: d.targetGroup ?? '', loiMinutes: opt(d.loiMinutes), irPercent: opt(d.irPercent), cpi: opt(d.cpi), targetCompletes: opt(d.targetCompletes), liveSurveyUrl: d.liveSurveyUrl ?? '', testSurveyUrl: d.testSurveyUrl ?? '' });
      setRows(
        f.countries.map((c) => ({
          ...blankRow(c.countryCode),
          language: c.language,
          currency: c.currency,
          targetGroup: c.targetGroup ?? '',
          loiMinutes: opt(c.loiMinutes),
          irPercent: opt(c.irPercent),
          cpi: opt(c.cpi),
          targetCompletes: opt(c.targetCompletes),
          liveSurveyUrl: c.liveSurveyUrl ?? '',
        })),
      );
      setUrl({ template: id });
    } catch (e) {
      setError(e);
    } finally {
      ready.current = true;
    }
  }

  async function loadDraft(id: string) {
    setError(null);
    try {
      const d = await get<{ id: string; data: DraftData; updatedAt: string }>(`/project-drafts/${id}`);
      const x = d.data;
      fromDraft.current = true;
      lastSaved.current = JSON.stringify(x);
      setInfo({ ...EMPTY_INFO, ...x.info });
      if (x.devices) setDevices(x.devices);
      if (x.security) setSecurity(x.security);
      if (x.mode) setMode(x.mode);
      setShared({ ...SHARED_DEFAULTS, ...x.shared });
      setRows(x.rows ?? []);
      setWonBidId(x.wonBidId ?? null);
      setBrief(x.brief ?? null);
      setTemplate(x.templateId ? templates.find((t) => t.id === x.templateId) ?? (await get<ProjectTemplate>(`/project-templates/${x.templateId}`).catch(() => null)) : null);
      setDraftId(d.id);
      setDraftState({ status: 'saved', at: d.updatedAt });
      setUrl({ draft: d.id, template: null, wonBid: null });
    } catch (e) {
      setError(e);
      setDraftId(null);
      setUrl({ draft: null });
    } finally {
      ready.current = true;
    }
  }

  async function discardDraft(id: string) {
    if (!confirm('Delete this draft? This cannot be undone.')) return;
    await api(`/project-drafts/${id}`, { method: 'DELETE' }).catch(setError);
    setDrafts((ds) => ds.filter((d) => d.id !== id));
    if (id === draftId) {
      draftRef.current = null;
      setDraftId(null);
      setDraftState({ status: 'idle' });
      lastSaved.current = '';
      setUrl({ draft: null });
    }
  }

  // Save the form as a draft a moment after each change, once it has a name or a market.
  const draftData: DraftData = { info, devices, security, mode, shared, rows, templateId: template?.id ?? null, wonBidId: wonBid?.status === 'NEW' ? wonBid.id : null, brief };
  const draftJson = JSON.stringify(draftData);
  useEffect(() => {
    if (!ready.current || busy) return;
    if (!info.name.trim() && !rows.length) return;
    if (draftJson === lastSaved.current) return;
    const timer = setTimeout(() => {
      // One save at a time, so a slow first save cannot create two drafts.
      inflight.current = inflight.current.then(async () => {
        if (draftJson === lastSaved.current) return;
        setDraftState({ status: 'saving' });
        try {
          const body = { title: info.name.trim() || `Untitled project (${rows.map((r) => r.countryCode).join(', ')})`.slice(0, 300), data: JSON.parse(draftJson) };
          const id = draftRef.current;
          const saved = id ? await api<DraftRow>(`/project-drafts/${id}`, { method: 'PUT', json: body }) : await post<DraftRow>('/project-drafts', body);
          lastSaved.current = draftJson;
          if (!id) {
            draftRef.current = saved.id;
            setDraftId(saved.id);
            setUrl({ draft: saved.id });
          }
          setDrafts((ds) => [saved, ...ds.filter((d) => d.id !== saved.id)]);
          setDraftState({ status: 'saved', at: saved.updatedAt });
        } catch {
          setDraftState({ status: 'error' });
        }
      });
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson]);

  // Prefill from a won bid (Won bids › Set up project).
  useEffect(() => {
    if (!wonBidId) return;
    get<WonBid & { suggestedClient: { id: string; name: string } | null }>(`/won-bids/${wonBidId}`)
      .then((b) => {
        setWonBid(b);
        if (b.status !== 'NEW' || fromDraft.current) return;
        const category = CATEGORIES.find((c) => c.toLowerCase() === (b.projectCategory ?? '').toLowerCase()) ?? '';
        setInfo((i) => ({ ...i, name: b.projectName, description: b.description ?? '', bidReference: b.bidNumber, category, clientId: b.suggestedClient?.id ?? '', clientContactId: '' }));
        setShared((sh) => ({ ...sh, loiMinutes: '', irPercent: '', targetCompletes: '' }));
        setRows(rowsFromBid(b));
      })
      .catch(setError);
  }, [wonBidId]);

  async function addBidClient() {
    if (wonBid) await addClientNamed(wonBid.clientName);
  }

  async function addClientNamed(clientName: string) {
    setAddingClient(true);
    setError(null);
    try {
      const base = clientName.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 14) || 'CLIENT';
      const code = `${base.length < 2 ? `${base}X` : base}${Math.floor(Math.random() * 900 + 100)}`;
      const c = await post<ClientOpt>('/clients', { name: clientName, code });
      setClients(await get<ClientOpt[]>('/clients'));
      setInfo((i) => ({ ...i, clientId: c.id, clientContactId: '' }));
    } catch (e) {
      setError(e);
    } finally {
      setAddingClient(false);
    }
  }
  const client = clients.find((c) => c.id === info.clientId);
  const totalCompletes = useMemo(() => rows.reduce((a, r) => a + Number(r.targetCompletes || shared.targetCompletes || 0), 0), [rows, shared]);

  const setRow = (i: number, patch: Partial<CountryRow>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const addCountry = (code: string) => {
    if (!code) return;
    setRows((rs) => [...rs, blankRow(code)]);
    setPicker('');
  };

  function applyPaste() {
    // Columns: Country code, Language, LOI, IR, CPI, Completes (tab or comma separated, header optional)
    const parsed: CountryRow[] = [];
    for (const line of (paste ?? '').split(/\r?\n/)) {
      const cols = line.split(/\t|,/).map((s) => s.trim());
      if (!cols[0] || !/^[A-Za-z]{2}$/.test(cols[0])) continue;
      const r = blankRow(cols[0].toUpperCase());
      if (cols[1]) r.language = cols[1];
      if (cols[2]) r.loiMinutes = num(cols[2]);
      if (cols[3]) r.irPercent = num(cols[3].replace('%', ''));
      if (cols[4]) r.cpi = num(cols[4]);
      if (cols[5]) r.targetCompletes = num(cols[5]);
      parsed.push(r);
    }
    setRows((rs) => [...rs, ...parsed]);
    setPaste(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined)) as Partial<T>;
    try {
      const p = await post<{ id: string; templateSkipped?: string[] }>('/projects', {
        ...clean({ ...info, generateWorkOrder: undefined }),
        generateWorkOrder: info.generateWorkOrder && !info.workOrderNo,
        devices,
        security,
        redirectMode: mode,
        defaults: clean(shared),
        countries: rows.map((r) => clean(r)),
        ...(wonBid?.status === 'NEW' ? { wonBidId: wonBid.id } : {}),
        ...(template ? { templateId: template.id } : {}),
        ...(draftId ? { draftId } : {}),
      });
      lastSaved.current = draftJson;
      if (p.templateSkipped?.length) {
        try {
          sessionStorage.setItem(`projexa:template-skipped:${p.id}`, JSON.stringify(p.templateSkipped));
        } catch {}
      }
      router.push(`/projects/${p.id}`);
    } catch (e) {
      setError(e);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Create project"
        subtitle="Set shared settings once, then override them per country where markets differ."
        actions={<Link href="/projects/templates" className="btn-ghost"><LayoutTemplate className="h-4 w-4" /> Templates</Link>}
      />
      <div className="mb-4"><ErrorBox error={error} /></div>
      <div className="card mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm">
        <label className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
          <LayoutTemplate className="h-4 w-4 shrink-0 text-muted" />
          <span className="shrink-0 text-muted">Start from</span>
          <select className="input min-w-0 flex-1 py-1.5 sm:max-w-xs" aria-label="Start from template" value={template?.id ?? ''} onChange={(e) => (e.target.value === '' || !rows.length || confirm('Replace the markets and settings in this form with the template?')) && applyTemplate(e.target.value)}>
            <option value="">Blank project</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        {briefAvailable && !reading && (
          <button type="button" className="btn-ghost h-8 px-2.5 text-xs" onClick={() => setReading(true)}><Sparkles className="h-3.5 w-3.5 text-brand" /> Read a brief</button>
        )}
        <span className="text-xs text-muted" role="status" aria-live="polite">
          {draftState.status === 'saving' && 'Saving draft…'}
          {draftState.status === 'saved' && draftState.at && `Draft saved ${time(draftState.at)}`}
          {draftState.status === 'error' && <span className="text-bad">Draft not saved. Check your connection.</span>}
          {draftState.status === 'idle' && 'Your work is saved as a draft as you type.'}
        </span>
        {draftId && <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => discardDraft(draftId)}><Trash2 className="h-3.5 w-3.5" /> Discard draft</button>}
      </div>
      {reading && briefAvailable && (
        <BriefReader
          files={briefAvailable.files}
          onClose={() => { setReading(false); setUrl({ brief: null }); }}
          onRead={async (id) => {
            if (draftId && draftId !== id) {
              // The form had its own draft; it stays in "Continue where you left off".
              draftRef.current = null;
            }
            setReading(false);
            setUrl({ brief: null });
            await loadDraft(id);
            get<DraftRow[]>('/project-drafts').then(setDrafts).catch(() => undefined);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}
      {brief && <BriefBanner brief={brief} clientChosen={!!info.clientId} onAddClient={addClientNamed} addingClient={addingClient} onDismiss={() => setBrief(null)} />}
      {template && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-brand/30 bg-brand/5 p-4 text-sm" role="status">
          <LayoutTemplate className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <div className="font-medium">From template “{template.name}”</div>
            <div className="text-muted">{describeTemplate(template)} Check the markets below and add the survey links{template.include.surveyLinks ? ' if they changed' : ''}.</div>
          </div>
        </div>
      )}
      {!draftId && !wonBidId && drafts.length > 0 && (
        <div className="mb-5 rounded-lg border border-line p-4 text-sm">
          <div className="mb-2 flex items-center gap-2 font-medium"><FileStack className="h-4 w-4 text-muted" /> Continue where you left off</div>
          <ul className="divide-y divide-line">
            {drafts.slice(0, 5).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{d.title}</span>
                <span className="text-xs text-muted">{time(d.updatedAt)}</span>
                <button className="btn-ghost h-8 px-2.5 text-xs" onClick={() => loadDraft(d.id)}>Continue</button>
                <button className="btn-ghost h-8 px-2 text-xs" aria-label={`Delete draft ${d.title}`} onClick={() => discardDraft(d.id)}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {wonBid && (
        <div className={clsx('mb-5 flex flex-wrap items-start gap-3 rounded-lg border p-4 text-sm', wonBid.status === 'NEW' ? 'border-brand/30 bg-brand/5' : 'border-warn/40 bg-warn/10')} role="status">
          <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            {wonBid.status === 'NEW' ? (
              <>
                <div className="font-medium">Prefilled from won bid {wonBid.bidNumber}</div>
                <div className="text-muted">Name, description, markets, sample sizes, LOI, IR and CPI ({wonBid.currency}) come from Bidzo. Check them, add survey links and save; the bid is then linked to this project.</div>
                {!wonBid.suggestedClient && !info.clientId && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span>Client “{wonBid.clientName}” is not in SampTrek yet.</span>
                    <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={addBidClient} disabled={addingClient}>{addingClient ? 'Adding…' : 'Add it as a client'}</button>
                    <span className="text-muted">or choose an existing client below.</span>
                  </div>
                )}
              </>
            ) : (
              <div>Won bid {wonBid.bidNumber} {wonBid.status === 'PROJECT_CREATED' ? 'already has a project' : 'was dismissed'}, so this form is not linked to it.</div>
            )}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Section title="Project information">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Project name *"><input className="input" value={info.name} onChange={(e) => setInfo({ ...info, name: e.target.value })} /></Field>
              <Field label="Work order no." hint={info.workOrderNo ? undefined : info.generateWorkOrder ? 'Will be generated on save' : undefined}>
                <div className="flex gap-2">
                  <input className="input" value={info.workOrderNo} onChange={(e) => setInfo({ ...info, workOrderNo: e.target.value })} placeholder="Leave empty to generate" />
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    <input type="checkbox" checked={info.generateWorkOrder} onChange={(e) => setInfo({ ...info, generateWorkOrder: e.target.checked })} /> Generate
                  </label>
                </div>
              </Field>
              <Field label="Project type *">
                <select className="input" value={info.type} onChange={(e) => setInfo({ ...info, type: e.target.value })}>
                  <option value="AD_HOC">Ad-hoc</option><option value="TRACKER">Tracker</option><option value="LONGITUDINAL">Longitudinal</option><option value="QUALITATIVE">Qualitative</option>
                </select>
              </Field>
              <Field label="Category *">
                <select className="input" value={info.category} onChange={(e) => setInfo({ ...info, category: e.target.value })}>
                  <option value="">Choose…</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Client *">
                <select className="input" value={info.clientId} onChange={(e) => setInfo({ ...info, clientId: e.target.value, clientContactId: '' })}>
                  <option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Client contact">
                <select className="input" value={info.clientContactId} onChange={(e) => setInfo({ ...info, clientContactId: e.target.value })} disabled={!client}>
                  <option value="">None</option>{client?.contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Sales person">
                <select className="input" value={info.salesPersonId} onChange={(e) => setInfo({ ...info, salesPersonId: e.target.value })}>
                  <option value="">None</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Project manager" hint="Defaults to you">
                <select className="input" value={info.projectManagerId} onChange={(e) => setInfo({ ...info, projectManagerId: e.target.value })}>
                  <option value="">Me</option>{users.filter((u) => ['ADMIN', 'PROJECT_MANAGER'].includes(u.role)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <Field label="Bid reference (Bidzo)"><input className="input" value={info.bidReference} onChange={(e) => setInfo({ ...info, bidReference: e.target.value })} /></Field>
              <Field label="Fieldwork dates" hint="Used for pacing on the fieldwork monitor">
                <DateRangePicker value={{ from: info.fieldStartAt || null, to: info.fieldEndAt || null }} onChange={(v) => setInfo({ ...info, fieldStartAt: v.from ?? '', fieldEndAt: v.to ?? '' })} placeholder="Start and end" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Description"><textarea className="input min-h-[96px]" value={info.description} onChange={(e) => setInfo({ ...info, description: e.target.value })} /></Field>
              </div>
            </div>
          </Section>

          <Section
            title={`Countries${rows.length ? ` · ${rows.length} markets · ${totalCompletes.toLocaleString()} completes` : ''}`}
            actions={<button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setPaste('')}><ClipboardPaste className="h-3.5 w-3.5" /> Paste from Excel</button>}
          >
            <div className="mb-5 rounded-lg bg-sunken/60 p-4">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Shared settings (used by every country unless overridden)</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Field label="LOI (min)"><input className="input" type="number" min={1} value={shared.loiMinutes} onChange={(e) => setShared({ ...shared, loiMinutes: num(e.target.value) })} /></Field>
                <Field label="IR %"><input className="input" type="number" min={1} max={100} value={shared.irPercent} onChange={(e) => setShared({ ...shared, irPercent: num(e.target.value) })} /></Field>
                <Field label="CPI"><input className="input" type="number" min={0} step="0.01" value={shared.cpi} onChange={(e) => setShared({ ...shared, cpi: num(e.target.value) })} /></Field>
                <Field label="Completes"><input className="input" type="number" min={1} value={shared.targetCompletes} onChange={(e) => setShared({ ...shared, targetCompletes: num(e.target.value) })} /></Field>
                <div className="sm:col-span-2"><Field label="Target group"><input className="input" value={shared.targetGroup} onChange={(e) => setShared({ ...shared, targetGroup: e.target.value })} /></Field></div>
                <div className="sm:col-span-3"><Field label="Live survey link" hint="Use {session_token} where the survey expects the respondent ID"><input className="input" value={shared.liveSurveyUrl} placeholder="https://survey.client.com/s?rid={session_token}" onChange={(e) => setShared({ ...shared, liveSurveyUrl: e.target.value })} /></Field></div>
                <div className="sm:col-span-3"><Field label="Test survey link"><input className="input" value={shared.testSurveyUrl} onChange={(e) => setShared({ ...shared, testSurveyUrl: e.target.value })} /></Field></div>
              </div>
            </div>

            {paste !== null && (
              <div className="mb-4 rounded-lg border border-line p-4">
                <Field label="Paste rows: Country code, Language, LOI, IR, CPI, Completes" hint="Copied Excel cells (tabs) or CSV both work. Empty cells use the shared settings.">
                  <textarea className="input min-h-[110px] font-mono text-xs" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'US\ten\t15\t30\t12.50\t500\nGB\ten\t15\t25\t11\t300'} />
                </Field>
                <div className="mt-3 flex gap-2"><button className="btn-primary" onClick={applyPaste}>Add rows</button><button className="btn-ghost" onClick={() => setPaste(null)}>Cancel</button></div>
              </div>
            )}

            {rows.length > 0 && (
              <div className="-mx-5 mb-4 overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead className="border-y border-line bg-sunken/60">
                    <tr><th className="th">Country</th><th className="th">Language</th><th className="th">Target group</th><th className="th">LOI</th><th className="th">IR %</th><th className="th">CPI</th><th className="th">Currency</th><th className="th">Completes</th><th className="th">Live link override</th><th className="th" /></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td className="td"><span className="mr-1.5">{flag(r.countryCode)}</span>{countryName(r.countryCode)}</td>
                        <td className="td"><input className="input w-16 px-2 py-1" value={r.language} onChange={(e) => setRow(i, { language: e.target.value })} /></td>
                        <td className="td"><input className="input w-40 px-2 py-1" placeholder={shared.targetGroup || 'shared'} value={r.targetGroup} onChange={(e) => setRow(i, { targetGroup: e.target.value })} /></td>
                        {(['loiMinutes', 'irPercent', 'cpi'] as const).map((k) => (
                          <td key={k} className="td"><input className={clsx('input w-20 px-2 py-1', r[k] !== '' && 'border-brand/60')} type="number" placeholder={String(shared[k] ?? '')} value={r[k]} onChange={(e) => setRow(i, { [k]: num(e.target.value) })} /></td>
                        ))}
                        <td className="td"><input className="input w-16 px-2 py-1" value={r.currency} onChange={(e) => setRow(i, { currency: e.target.value.toUpperCase() })} /></td>
                        <td className="td"><input className={clsx('input w-20 px-2 py-1', r.targetCompletes !== '' && 'border-brand/60')} type="number" placeholder={String(shared.targetCompletes)} value={r.targetCompletes} onChange={(e) => setRow(i, { targetCompletes: num(e.target.value) })} /></td>
                        <td className="td"><input className="input w-56 px-2 py-1" placeholder="shared link" value={r.liveSurveyUrl} onChange={(e) => setRow(i, { liveSurveyUrl: e.target.value })} /></td>
                        <td className="td">
                          <div className="flex gap-1">
                            
                            <button className="btn-ghost p-1.5" aria-label={`Remove ${r.countryCode}`} onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <select className="input max-w-xs" value={picker} onChange={(e) => addCountry(e.target.value)} aria-label="Add country">
                <option value="">Add a country…</option>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{flag(c.code)} {c.name}</option>)}
              </select>
              {rows.length > 0 && (
                <button
                  className="btn-ghost text-xs"
                  title="Copy the shared settings into every row so you can edit them individually"
                  onClick={() => setRows((rs) => rs.map((r) => ({ ...r, loiMinutes: r.loiMinutes || shared.loiMinutes, irPercent: r.irPercent || shared.irPercent, cpi: r.cpi || shared.cpi, targetCompletes: r.targetCompletes || shared.targetCompletes })))}
                >
                  <Copy className="h-3.5 w-3.5" /> Fill rows from shared settings
                </button>
              )}
            </div>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Survey redirects">
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-sunken p-1" role="radiogroup" aria-label="Redirect mode">
              {(['STATIC', 'DYNAMIC', 'HYBRID'] as const).map((m) => (
                <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={clsx('rounded-md py-1.5 text-xs font-semibold', mode === m ? 'bg-panel text-brand shadow-sm' : 'text-muted')}>
                  {m.charAt(0) + m.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              {mode === 'STATIC' && 'Each status goes to a fixed URL.'}
              {mode === 'DYNAMIC' && 'Each URL gets the respondent UID, vendor ID and country code added.'}
              {mode === 'HYBRID' && 'Choose static or dynamic per status. UID, vendor ID and country code mappings are on by default.'}{' '}
              You set the URLs on the project page after adding vendors.
            </p>
          </Section>
          <Section title="Devices">
            <div className="space-y-3">
              {([['desktop', Monitor], ['mobile', Smartphone], ['tablet', Tablet]] as const).map(([k, Icon]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-muted" /> {k.charAt(0).toUpperCase() + k.slice(1)}</span>
                  <Toggle label={k} checked={devices[k]} onChange={(v) => setDevices({ ...devices, [k]: v })} />
                </div>
              ))}
            </div>
          </Section>
          <Section title="Security and respondent quality">
            <div className="space-y-3">
              {Object.entries(SECURITY_LABELS).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span>{label}</span>
                  <Toggle label={label} checked={!!security[k]} onChange={(v) => setSecurity({ ...security, [k]: v })} />
                </div>
              ))}
            </div>
          </Section>
          <button className="btn-primary w-full py-2.5" onClick={submit} disabled={busy || !rows.length}>
            {busy ? 'Creating…' : rows.length ? `Create project in ${rows.length} ${rows.length === 1 ? 'country' : 'countries'}` : 'Add at least one country'}
          </button>
        </div>
      </div>
    </>
  );
}
