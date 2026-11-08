'use client';
import clsx from 'clsx';
import { AlertTriangle, ClipboardPaste, FileStack, LayoutTemplate, Monitor, Plus, Search, Smartphone, Sparkles, Tablet, Trash2, Trophy, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { DateRangePicker } from '@/components/form/date';
import { Combobox, CountrySelect, CurrencySelect } from '@/components/form/combobox';
import { AddableSelect, loadCustomOptions, saveCustomOption, useCustomOptions } from '@/components/form/option-select';
import { BulkFill } from '@/components/project/bulk-fill';
import { cleanQuestion, QuestionBuilder, questionProblems } from '@/components/project/question-builder';
import { BriefBanner, BriefReader, useBriefAvailability, type BriefInfo } from '@/components/project/brief-reader';
import { MobileOsPicker, devicesProblem, withOs, type DeviceSettings } from '@/components/project/mobile-os';
import { ErrorBox, Field, Loading, PageHeader, Section, Toggle } from '@/components/ui';
import { api, get, post } from '@/lib/api';
import { describeTemplate, type ProjectTemplate, type TemplateForm } from '@/lib/templates';
import { COUNTRIES, countryName, flag } from '@/lib/countries';
import { InfoTip } from '@/components/help';
import { ContactPicker, PartyPicker, type ClientOpt, type PartyOpt } from '@/components/parties/quick-add';
import { PartyContact } from '@/components/parties/contact-line';
import { CATEGORIES, RedirectMode, SECURITY_LABELS, type Option, type Question, type WonBid } from '@/lib/types';

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
  testSurveyUrl?: string;
}

/** A vendor added to every market on create; the payout is per complete in the project currency. */
interface VendorRow { vendorId: string; cpi: Num; uidParam: string }

const SHARED_DEFAULTS = { targetGroup: '', loiMinutes: 15 as Num, irPercent: 30 as Num, cpi: '' as Num, targetCompletes: 100 as Num, liveSurveyUrl: '', testSurveyUrl: '' };

function blankRow(code: string): CountryRow {
  const c = COUNTRIES.find((x) => x.code === code);
  return { countryCode: code, language: c?.lang ?? 'en', currency: c?.currency ?? 'USD', targetGroup: '', loiMinutes: '', irPercent: '', cpi: '', targetCompletes: '', liveSurveyUrl: '', testSurveyUrl: '' };
}

const num = (v: string): Num => (v === '' ? '' : Number(v));
const opt = (v: number | string | undefined | null): Num => (v === undefined || v === null || v === '' ? '' : Number(v));

interface DraftRow { id: string; title: string; updatedAt: string }
interface DraftData { info: typeof EMPTY_INFO; devices: DeviceSettings; security: Record<string, boolean>; mode: RedirectMode; shared: typeof SHARED_DEFAULTS; rows: CountryRow[]; templateId: string | null; wonBidId: string | null; brief?: BriefInfo | null; currency?: string; vendors?: VendorRow[]; gateQuestions?: Question[] }
const sameMarket = (a: CountryRow, b: CountryRow, sharedGroup: string) =>
  a.countryCode === b.countryCode && a.language.toLowerCase() === b.language.toLowerCase() && (a.targetGroup || sharedGroup).trim().toLowerCase() === (b.targetGroup || sharedGroup).trim().toLowerCase();
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
  const [devices, setDevices] = useState<DeviceSettings>(withOs(null));
  const [security, setSecurity] = useState<Record<string, boolean>>({ gateSurvey: true, captcha: true });
  const [mode, setMode] = useState<RedirectMode>('HYBRID');
  const [shared, setShared] = useState(SHARED_DEFAULTS);
  const [rows, setRows] = useState<CountryRow[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [vendorOpts, setVendorOpts] = useState<PartyOpt[]>([]);
  const [numbering, setNumbering] = useState<{ nextWorkOrderNo: string; lastWorkOrderNo: string | null } | null>(null);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [rememberVendors, setRememberVendors] = useState(false);
  const [gateQuestions, setGateQuestions] = useState<Question[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [filter, setFilter] = useState('');
  const targetGroups = useCustomOptions('targetGroup');
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
    // Only active clients and vendors can be chosen for a new project.
    get<ClientOpt[]>('/clients?status=ACTIVE').then(setClients).catch(setError);
    get<{ nextWorkOrderNo: string; lastWorkOrderNo: string | null }>('/numbering').then(setNumbering).catch(() => setNumbering(null));
    get<UserOpt[]>('/users').then(setUsers).catch(setError);
    get<ProjectTemplate[]>('/project-templates').then(setTemplates).catch(() => setTemplates([]));
    get<DraftRow[]>('/project-drafts').then(setDrafts).catch(() => setDrafts([]));
    get<PartyOpt[]>('/vendors?status=ACTIVE').then(setVendorOpts).catch(() => setVendorOpts([]));
    const t = params.get('template');
    const d = params.get('draft');
    // Vendors the team chose to preselect on every new project.
    if (!d) loadCustomOptions('defaultVendor').then((r) => r.length && setVendors((v) => (v.length ? v : r.map((x) => ({ vendorId: x.value, cpi: '', uidParam: 'vid' })))));
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
      if (f.countries[0]?.currency) setCurrency(f.countries[0].currency);
      setInfo((i) => ({ ...i, type: f.type, category: f.category, clientId: f.clientId ?? i.clientId, clientContactId: f.clientId ? '' : i.clientContactId, description: i.description || (f.description ?? '') }));
      setDevices(withOs(f.devices));
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
          testSurveyUrl: c.testSurveyUrl ?? '',
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
      if (x.devices) setDevices(withOs(x.devices));
      if (x.security) setSecurity(x.security);
      if (x.mode) setMode(x.mode);
      setShared({ ...SHARED_DEFAULTS, ...x.shared });
      setRows(x.rows ?? []);
      if (x.currency) setCurrency(x.currency);
      if (x.vendors) setVendors(x.vendors);
      if (x.gateQuestions) setGateQuestions(x.gateQuestions);
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
  const draftData: DraftData = { info, devices, security, mode, shared, rows, templateId: template?.id ?? null, wonBidId: wonBid?.status === 'NEW' ? wonBid.id : null, brief, currency, vendors, gateQuestions };
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
        setCurrency(b.currency);
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
      setClients(await get<ClientOpt[]>('/clients?status=ACTIVE'));
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
  const addCountry = (code: string | null) => {
    if (!code) return;
    setRows((rs) => [...rs, blankRow(code)]);
  };
  const removeRows = (idx: number[]) => {
    setRows((rs) => rs.filter((_, n) => !idx.includes(n)));
    setSelected([]);
  };
  // The same country may be added again for another target group; the exact same market twice is flagged.
  const duplicates = useMemo(() => new Set(rows.flatMap((r, i) => (rows.some((o, j) => j !== i && sameMarket(r, o, shared.targetGroup)) ? [i] : []))), [rows, shared.targetGroup]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.map((r, i) => i).filter((i) => !q || `${rows[i].countryCode} ${countryName(rows[i].countryCode)} ${rows[i].targetGroup} ${rows[i].language}`.toLowerCase().includes(q));
  }, [rows, filter]);
  const minCpi = useMemo(() => {
    const cpis = rows.map((r) => Number(r.cpi === '' ? shared.cpi : r.cpi)).filter((n) => n > 0);
    return cpis.length ? Math.min(...cpis) : null;
  }, [rows, shared.cpi]);
  function applyToRows(v: Record<string, string>) {
    const idx = selected.length ? selected : visible;
    const patch: Partial<CountryRow> = {};
    for (const k of ['loiMinutes', 'irPercent', 'cpi', 'targetCompletes'] as const) if (v[k] !== undefined) patch[k] = num(v[k]);
    for (const k of ['targetGroup', 'liveSurveyUrl', 'testSurveyUrl', 'language'] as const) if (v[k] !== undefined) patch[k] = v[k].trim();
    setRows((rs) => rs.map((r, n) => (idx.includes(n) ? { ...r, ...patch } : r)));
  }

  function applyPaste() {
    // Columns: Country (code or name), Language, LOI, IR, CPI, Completes, Target group (tab or comma separated, header optional)
    const parsed: CountryRow[] = [];
    for (const line of (paste ?? '').split(/\r?\n/)) {
      const cols = line.split(/\t|,/).map((s) => s.trim());
      const c = cols[0] ? COUNTRIES.find((x) => x.code === cols[0].toUpperCase() || x.name.toLowerCase() === cols[0].toLowerCase()) : undefined;
      if (!c) continue;
      const r = blankRow(c.code);
      if (cols[1]) r.language = cols[1];
      if (cols[2]) r.loiMinutes = num(cols[2]);
      if (cols[3]) r.irPercent = num(cols[3].replace('%', ''));
      if (cols[4]) r.cpi = num(cols[4]);
      if (cols[5]) r.targetCompletes = num(cols[5]);
      if (cols[6]) r.targetGroup = cols[6];
      parsed.push(r);
    }
    setRows((rs) => [...rs, ...parsed]);
    setPaste(null);
  }

  async function submit() {
    setError(null);
    const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined)) as Partial<T>;
    const chosen = vendors.filter((v) => v.vendorId);
    if (chosen.some((v) => v.cpi === '')) {
      setError({ message: 'Give every vendor a payout CPI, or remove the vendor.' });
      return;
    }
    const above = chosen.filter((v) => minCpi !== null && Number(v.cpi) > minCpi);
    if (above.length && !confirm(`${above.map((v) => vendorOpts.find((o) => o.id === v.vendorId)?.name ?? 'A vendor').join(', ')}: payout is higher than the client CPI (${minCpi} ${currency}) in at least one market. Create the project anyway?`)) return;
    const gate = security.gateSurvey ? gateQuestions.map(cleanQuestion) : [];
    if (gate.some((q) => questionProblems(q).length)) {
      setError({ message: 'Fix the gate survey questions first (they are marked in red).' });
      return;
    }
    setBusy(true);
    try {
      const p = await post<{ id: string; templateSkipped?: string[] }>('/projects', {
        ...clean({ ...info, generateWorkOrder: undefined }),
        generateWorkOrder: info.generateWorkOrder && !info.workOrderNo,
        devices,
        security,
        redirectMode: mode,
        currency,
        defaults: clean({ ...shared, currency }),
        countries: rows.map((r) => clean({ ...r, currency: undefined })),
        vendors: chosen.map((v) => ({ vendorId: v.vendorId, cpi: Number(v.cpi), uidParam: v.uidParam || 'vid', allowAboveCpi: above.includes(v) })),
        ...(gate.length ? { gateQuestions: gate } : {}),
        ...(wonBid?.status === 'NEW' ? { wonBidId: wonBid.id } : {}),
        ...(template ? { templateId: template.id } : {}),
        ...(draftId ? { draftId } : {}),
      });
      lastSaved.current = draftJson;
      // Target groups typed on the form become options for next time.
      for (const g of new Set([shared.targetGroup, ...rows.map((r) => r.targetGroup)].map((x) => x.trim()).filter(Boolean))) saveCustomOption('targetGroup', g);
      if (rememberVendors) await post('/custom-options/replace', { field: 'defaultVendor', values: chosen.map((v) => v.vendorId) }).catch(() => undefined);
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
        subtitle="Fill in the basics (LOI, IR, completes, CPI) once, add your target markets, then change any market that differs."
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
                <div className="text-muted">Name, description, markets, sample sizes, LOI, IR and CPI ({wonBid.currency}) come from SampBidx. Check them, add survey links and save; the bid is then linked to this project.</div>
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
              <Field
                label="Work order no."
                hint={[
                  info.workOrderNo ? 'Typed by hand; must not be used by another project' : info.generateWorkOrder ? `${numbering ? numbering.nextWorkOrderNo : 'The next number'} will be given on save` : 'No work order',
                  numbering?.lastWorkOrderNo ? `last one: ${numbering.lastWorkOrderNo}` : null,
                ].filter(Boolean).join(' · ')}
              >
                <div className="flex gap-2">
                  <input className="input" value={info.workOrderNo} onChange={(e) => setInfo({ ...info, workOrderNo: e.target.value })} placeholder={info.generateWorkOrder && numbering ? `Next: ${numbering.nextWorkOrderNo}` : 'Type one, or tick Generate'} />
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
              <Field label="Category *" hint="Type to search, or add your own">
                <AddableSelect field="category" base={CATEGORIES} value={info.category} onChange={(v) => setInfo({ ...info, category: v })} />
              </Field>
              <Field label="Client *" hint="Active clients only. Type a new name to add one.">
                <PartyPicker<ClientOpt>
                  kind="client"
                  parties={clients}
                  value={info.clientId}
                  taken={clients.map((c) => c.code)}
                  onChange={(id) => setInfo((i) => ({ ...i, clientId: id, clientContactId: clients.find((c) => c.id === id)?.contacts.length === 1 ? clients.find((c) => c.id === id)!.contacts[0].id : '' }))}
                  onAdded={(c) => setClients((cs) => [...cs, { ...c, contacts: c.contacts ?? [] }].sort((a, b) => a.name.localeCompare(b.name)))}
                />
              </Field>
              <Field label="Client contact" hint="Type a new name to add a contact">
                <ContactPicker client={client} value={info.clientContactId} onChange={(id) => setInfo((i) => ({ ...i, clientContactId: id }))} onAdded={(all) => setClients((cs) => cs.map((c) => (c.id === info.clientId ? { ...c, contacts: all } : c)))} />
              </Field>
              {client && (
                <div className="rounded-lg border border-line bg-sunken/40 p-3 sm:col-span-2">
                  <PartyContact name={client.name} logoUrl={client.logoUrl} website={client.website} contact={client.contacts.find((c) => c.id === info.clientContactId) ?? null} />
                </div>
              )}
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
              <Field label="Bid reference (SampBidx)"><input className="input" value={info.bidReference} onChange={(e) => setInfo({ ...info, bidReference: e.target.value })} /></Field>
              <Field label="Fieldwork dates" hint="Used for pacing on the fieldwork monitor">
                <DateRangePicker value={{ from: info.fieldStartAt || null, to: info.fieldEndAt || null }} onChange={(v) => setInfo({ ...info, fieldStartAt: v.from ?? '', fieldEndAt: v.to ?? '' })} placeholder="Start and end" />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Description"><textarea className="input min-h-[96px]" value={info.description} onChange={(e) => setInfo({ ...info, description: e.target.value })} /></Field>
              </div>
            </div>
          </Section>

          <Section title="Basics: LOI, IR, completes and CPI">
            <p className="mb-4 text-sm text-muted">These apply to every market below. Change a single market in its row when it differs.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="LOI (min) *"><input className="input" type="number" min={1} value={shared.loiMinutes} onChange={(e) => setShared({ ...shared, loiMinutes: num(e.target.value) })} /></Field>
              <Field label="IR % *"><input className="input" type="number" min={1} max={100} value={shared.irPercent} onChange={(e) => setShared({ ...shared, irPercent: num(e.target.value) })} /></Field>
              <Field label="Completes *"><input className="input" type="number" min={1} value={shared.targetCompletes} onChange={(e) => setShared({ ...shared, targetCompletes: num(e.target.value) })} /></Field>
              <Field label={`Client CPI (${currency}) *`}><input className="input" type="number" min={0} step="0.01" value={shared.cpi} onChange={(e) => setShared({ ...shared, cpi: num(e.target.value) })} /></Field>
              <div className="sm:col-span-2">
                <Field label="CPI currency" hint="One currency for the whole project">
                  <CurrencySelect value={currency} onChange={(v) => setCurrency(v ?? 'USD')} />
                </Field>
              </div>
              <div className="sm:col-span-3">
                <Field label="Target group" hint="Choose one or type a new one to add it">
                  <AddableSelect field="targetGroup" base={[]} value={shared.targetGroup} onChange={(v) => setShared({ ...shared, targetGroup: v })} placeholder="e.g. Gen Z, IT decision makers" />
                </Field>
              </div>
              <div className="sm:col-span-3" />
              <div className="sm:col-span-3"><Field label="Live survey link" hint="Use {session_token} where the survey expects the respondent ID"><input className="input" value={shared.liveSurveyUrl} placeholder="https://survey.client.com/s?rid={session_token}" onChange={(e) => setShared({ ...shared, liveSurveyUrl: e.target.value })} /></Field></div>
              <div className="sm:col-span-3"><Field label="Test survey link"><input className="input" value={shared.testSurveyUrl} onChange={(e) => setShared({ ...shared, testSurveyUrl: e.target.value })} /></Field></div>
            </div>
          </Section>

          <Section
            help="create.markets"
            title={`Target markets${rows.length ? ` · ${rows.length} ${rows.length === 1 ? 'market' : 'markets'} · ${totalCompletes.toLocaleString()} completes` : ''}`}
            actions={<button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setPaste('')}><ClipboardPaste className="h-3.5 w-3.5" /> Paste from Excel</button>}
          >
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="w-full sm:w-80">
                <CountrySelect value={null} onChange={addCountry} placeholder="Search a country, e.g. Japan" />
              </div>
              <span className="text-xs text-muted">Add the same country again for another target group.</span>
            </div>

            {paste !== null && (
              <div className="mb-4 rounded-lg border border-line p-4">
                <Field label="Paste rows: Country, Language, LOI, IR, CPI, Completes, Target group" hint="Copied Excel cells (tabs) or CSV both work. Country can be a code (JP) or a name (Japan). Empty cells use the basics above.">
                  <textarea className="input min-h-[110px] font-mono text-xs" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'JP\tja\t15\t30\t12.50\t500\tGen Z\nJapan\tja\t15\t25\t11\t300\tParents'} />
                </Field>
                <div className="mt-3 flex gap-2"><button className="btn-primary" onClick={applyPaste}>Add rows</button><button className="btn-ghost" onClick={() => setPaste(null)}>Cancel</button></div>
              </div>
            )}

            {rows.length > 0 && (
              <>
                <datalist id="target-groups">{targetGroups.map((g) => <option key={g} value={g} />)}</datalist>
                <BulkFill
                  selected={selected.length}
                  total={visible.length}
                  onApply={applyToRows}
                  fields={[
                    { key: 'loiMinutes', label: 'LOI', type: 'number', width: 'w-20' },
                    { key: 'irPercent', label: 'IR %', type: 'number', width: 'w-20' },
                    { key: 'cpi', label: `CPI (${currency})`, type: 'number', step: '0.01', width: 'w-24' },
                    { key: 'targetCompletes', label: 'Completes', type: 'number', width: 'w-24' },
                    { key: 'targetGroup', label: 'Target group', width: 'w-40', list: 'target-groups' },
                    { key: 'liveSurveyUrl', label: 'Live link', width: 'w-64', placeholder: 'https://…' },
                    { key: 'testSurveyUrl', label: 'Test link', width: 'w-64', placeholder: 'https://…' },
                  ]}
                  extra={selected.length > 0 && <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs text-bad" onClick={() => removeRows(selected)}><Trash2 className="h-3.5 w-3.5" /> Remove {selected.length}</button>}
                />
                {rows.length > 5 && (
                  <label className="relative mb-3 block w-full sm:w-72">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                    <input className="input py-1.5 pl-8 text-sm" placeholder="Filter markets" aria-label="Filter markets" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  </label>
                )}
                <div className="-mx-5 mb-4 overflow-x-auto">
                  <table className="w-full min-w-[960px]">
                    <thead className="border-y border-line bg-sunken/60">
                      <tr>
                        <th className="th w-8">
                          <input type="checkbox" aria-label="Select all markets" checked={visible.length > 0 && visible.every((i) => selected.includes(i))} onChange={(e) => setSelected(e.target.checked ? visible : [])} />
                        </th>
                        <th className="th">Country</th><th className="th">Language</th><th className="th">Target group</th><th className="th">LOI</th><th className="th">IR %</th><th className="th">CPI ({currency})</th><th className="th">Completes</th><th className="th">Live / test link</th><th className="th" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {visible.map((i) => {
                        const r = rows[i];
                        return (
                          <tr key={i} className={clsx(duplicates.has(i) && 'bg-bad/5', selected.includes(i) && 'bg-brand/5')}>
                            <td className="td"><input type="checkbox" aria-label={`Select ${countryName(r.countryCode)} ${r.targetGroup}`} checked={selected.includes(i)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, i] : s.filter((x) => x !== i)))} /></td>
                            <td className="td whitespace-nowrap">
                              <span className="mr-1.5">{flag(r.countryCode)}</span>{countryName(r.countryCode)}
                              {duplicates.has(i) && <div className="flex items-center gap-1 text-xs text-bad"><AlertTriangle className="h-3 w-3" /> Same market twice: set a different target group</div>}
                            </td>
                            <td className="td"><input className="input w-16 px-2 py-1" value={r.language} onChange={(e) => setRow(i, { language: e.target.value })} /></td>
                            <td className="td"><input className={clsx('input w-40 px-2 py-1', duplicates.has(i) && 'border-bad')} list="target-groups" placeholder={shared.targetGroup || 'Target group'} value={r.targetGroup} onChange={(e) => setRow(i, { targetGroup: e.target.value })} /></td>
                            {(['loiMinutes', 'irPercent', 'cpi'] as const).map((k) => (
                              <td key={k} className="td"><input className={clsx('input w-20 px-2 py-1', r[k] !== '' && 'border-brand/60')} type="number" step={k === 'cpi' ? '0.01' : undefined} placeholder={String(shared[k] ?? '')} value={r[k]} onChange={(e) => setRow(i, { [k]: num(e.target.value) })} /></td>
                            ))}
                            <td className="td"><input className={clsx('input w-20 px-2 py-1', r.targetCompletes !== '' && 'border-brand/60')} type="number" placeholder={String(shared.targetCompletes)} value={r.targetCompletes} onChange={(e) => setRow(i, { targetCompletes: num(e.target.value) })} /></td>
                            <td className="td space-y-1">
                              <input className="input w-56 px-2 py-1" aria-label={`Live link for ${countryName(r.countryCode)}`} placeholder={shared.liveSurveyUrl ? 'same as basics' : 'add link before going live'} value={r.liveSurveyUrl} onChange={(e) => setRow(i, { liveSurveyUrl: e.target.value })} />
                              <input className="input w-56 px-2 py-1 text-xs" aria-label={`Test link for ${countryName(r.countryCode)}`} placeholder={shared.testSurveyUrl ? 'test: same as basics' : 'test link (optional)'} value={r.testSurveyUrl ?? ''} onChange={(e) => setRow(i, { testSurveyUrl: e.target.value })} />
                            </td>
                            <td className="td">
                              <div className="flex gap-1">
                                <button className="btn-ghost p-1.5" title="Add this country again for another target group" aria-label={`Add ${r.countryCode} again`} onClick={() => setRows((rs) => [...rs.slice(0, i + 1), { ...r, targetGroup: '', liveSurveyUrl: '', testSurveyUrl: '' }, ...rs.slice(i + 1)])}><Plus className="h-3.5 w-3.5" /></button>
                                <button className="btn-ghost p-1.5" aria-label={`Remove ${r.countryCode}`} onClick={() => removeRows([i])}><Trash2 className="h-3.5 w-3.5" /></button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!shared.liveSurveyUrl && rows.some((r) => !r.liveSurveyUrl) && (
                  <p className="flex items-center gap-1.5 text-xs text-warn"><AlertTriangle className="h-3.5 w-3.5" /> Markets without a live link can be saved, but they cannot go live until the link is added.</p>
                )}
              </>
            )}
          </Section>

          <Section help="create.vendors" title={<span className="flex items-center gap-2"><Users className="h-4 w-4 text-muted" /> Vendors</span>} actions={<button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setVendors([...vendors, { vendorId: '', cpi: '', uidParam: 'vid' }])}><Plus className="h-3.5 w-3.5" /> Add vendor</button>}>
            <p className="mb-3 text-sm text-muted">Each vendor is added to every market with its own entry link. You can change vendors per market after creating the project.</p>
            {vendors.length > 1 && (
              <BulkFill
                selected={0}
                total={vendors.length}
                noun={['vendor', 'vendors']}
                help="bulk.createVendors"
                hint="Same payout or link variable for every vendor."
                onApply={(v) => setVendors(vendors.map((x) => ({ ...x, ...(v.cpi !== undefined ? { cpi: num(v.cpi) } : {}), ...(v.uidParam !== undefined ? { uidParam: v.uidParam.trim() || 'vid' } : {}) })))}
                fields={[
                  { key: 'cpi', label: `Payout (${currency})`, type: 'number', step: '0.01', width: 'w-24' },
                  { key: 'uidParam', label: 'Link variable', width: 'w-24', placeholder: 'vid' },
                ]}
              />
            )}
            {vendors.length === 0 && <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">No vendors yet. Add the vendors you usually use, and tick “Preselect” to have them here on every new project.</p>}
            <div className="space-y-2">
              {vendors.map((v, i) => {
                const high = v.cpi !== '' && minCpi !== null && Number(v.cpi) > minCpi;
                return (
                  <div key={i} className="grid grid-cols-1 items-start gap-2 rounded-lg bg-sunken/50 p-3 sm:grid-cols-[minmax(0,1fr)_140px_140px_auto]">
                    <Field label="Vendor">
                      <PartyPicker<PartyOpt>
                        kind="vendor"
                        parties={vendorOpts}
                        value={v.vendorId}
                        exclude={vendors.map((x) => x.vendorId).filter(Boolean)}
                        taken={vendorOpts.map((o) => o.code)}
                        onChange={(id) => setVendors((vs) => vs.map((x, n) => (n === i ? { ...x, vendorId: id } : x)))}
                        onAdded={(o) => setVendorOpts((os) => [...os, o].sort((a, b) => a.name.localeCompare(b.name)))}
                        placeholder="Search vendors, or type a new name to add"
                      />
                    </Field>
                    <Field label={`Payout CPI (${currency})`}>
                      <input className={clsx('input', high && 'border-warn')} type="number" min={0} step="0.01" value={v.cpi} onChange={(e) => setVendors(vendors.map((x, n) => (n === i ? { ...x, cpi: num(e.target.value) } : x)))} />
                    </Field>
                    <Field label="Link variable">
                      <AddableSelect field="uidParam" base={['vid', 'uid', 'rid', 'pid', 'id']} value={v.uidParam} onChange={(val) => setVendors((vs) => vs.map((x, n) => (n === i ? { ...x, uidParam: val } : x)))} placeholder="vid" />
                    </Field>
                    <button className="btn-ghost mt-6 p-2" aria-label="Remove vendor" onClick={() => setVendors(vendors.filter((_, n) => n !== i))}><Trash2 className="h-4 w-4" /></button>
                    {high && <p className="flex items-center gap-1.5 text-xs text-warn sm:col-span-4"><AlertTriangle className="h-3.5 w-3.5" /> Higher than the client CPI ({minCpi} {currency}). You will be asked to confirm.</p>}
                  </div>
                );
              })}
            </div>
            {vendors.length > 0 && (
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={rememberVendors} onChange={(e) => setRememberVendors(e.target.checked)} /> Preselect these vendors on every new project</label>
            )}
            <p className="mt-2 text-xs text-muted">The link variable is the name of the respondent ID in the vendor&apos;s entry link, e.g. <code className="rounded bg-sunken px-1">?vid=[UID]</code>.</p>
          </Section>

          <Section title="Gate survey questions">
            {!security.gateSurvey ? (
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
                The gate survey is off for this project.
                <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setSecurity({ ...security, gateSurvey: true })}>Turn it on</button>
              </div>
            ) : (
              <QuestionBuilder value={gateQuestions} onChange={setGateQuestions} editable templatesCurrency={currency} emptyText="No gate questions yet. Pick an audience set (B2B, B2C, parents, teens, healthcare consumers, patients or caregivers), add single profile questions from the library, or build your own. You can also add them later on the Gate & security tab." />
            )}
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
              )).flatMap((row, i) => (i === 1 ? [row, <MobileOsPicker key="os" devices={devices} onChange={setDevices} />] : [row]))}
              {devicesProblem(devices) && <p className="text-xs text-warn">{devicesProblem(devices)}</p>}
            </div>
          </Section>
          <Section title="Security and respondent quality">
            <div className="space-y-3">
              {Object.entries(SECURITY_LABELS).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-1">{label}<InfoTip id={`check:${k}`} label={label} /></span>
                  <Toggle label={label} checked={!!security[k]} onChange={(v) => setSecurity({ ...security, [k]: v })} />
                </div>
              ))}
            </div>
          </Section>
          {duplicates.size > 0 && <p className="text-sm text-bad">Some markets are listed twice. Give each a different target group.</p>}
          <button className="btn-primary w-full py-2.5" onClick={submit} disabled={busy || !rows.length || duplicates.size > 0 || !!devicesProblem(devices)}>
            {busy ? 'Creating…' : rows.length ? `Create project in ${rows.length} ${rows.length === 1 ? 'market' : 'markets'}` : 'Add at least one country'}
          </button>
        </div>
      </div>
    </>
  );
}
