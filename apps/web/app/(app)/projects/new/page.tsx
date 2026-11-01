'use client';
import clsx from 'clsx';
import { ClipboardPaste, Copy, Monitor, Smartphone, Tablet, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ErrorBox, Field, PageHeader, Section, Toggle } from '@/components/ui';
import { get, post } from '@/lib/api';
import { COUNTRIES, countryName, flag } from '@/lib/countries';
import { CATEGORIES, RedirectMode, SECURITY_LABELS } from '@/lib/types';

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

export default function CreateProjectPage() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [info, setInfo] = useState({ name: '', workOrderNo: '', generateWorkOrder: true, type: 'AD_HOC', category: '', clientId: '', clientContactId: '', salesPersonId: '', projectManagerId: '', description: '', bidReference: '' });
  const [devices, setDevices] = useState({ desktop: true, mobile: true, tablet: true });
  const [security, setSecurity] = useState<Record<string, boolean>>({ gateSurvey: true, captcha: true });
  const [mode, setMode] = useState<RedirectMode>('HYBRID');
  const [shared, setShared] = useState(SHARED_DEFAULTS);
  const [rows, setRows] = useState<CountryRow[]>([]);
  const [picker, setPicker] = useState('');
  const [paste, setPaste] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<ClientOpt[]>('/clients').then(setClients).catch(setError);
    get<UserOpt[]>('/users').then(setUsers).catch(setError);
  }, []);
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
      const p = await post<{ id: string }>('/projects', {
        ...clean({ ...info, generateWorkOrder: undefined }),
        generateWorkOrder: info.generateWorkOrder && !info.workOrderNo,
        devices,
        security,
        redirectMode: mode,
        defaults: clean(shared),
        countries: rows.map((r) => clean(r)),
      });
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
      <PageHeader title="Create project" subtitle="Set shared settings once, then override them per country where markets differ." />
      <div className="mb-4"><ErrorBox error={error} /></div>
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
