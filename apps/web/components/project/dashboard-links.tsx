'use client';
import clsx from 'clsx';
import { Ban, ExternalLink, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CopyIcon } from '@/components/copy';
import { InfoTip } from '@/components/help';
import { Empty, ErrorBox, Field, Loading, Toggle } from '@/components/ui';
import { get, patch, post } from '@/lib/api';
import type { ProjectDetail } from './types';

interface DashboardLink {
  id: string; token: string; label: string | null; showMoney: boolean; showVendors: boolean;
  expiresAt: string | null; revokedAt: string | null; viewCount: number; lastViewedAt: string | null;
  createdAt: string; createdBy: string | null; state: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
}
interface LinkList { projectStatus: string; shareable: boolean; maxActive: number; links: DashboardLink[] }

const when = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
/** The page lives on the web app, at the address the person is using now (so custom domains work). */
export const dashboardUrl = (token: string) => `${typeof window === 'undefined' ? '' : window.location.origin}/live/${token}`;

const STATE_CHIP: Record<DashboardLink['state'], string> = {
  ACTIVE: 'bg-ok/15 text-ok',
  REVOKED: 'bg-bad/15 text-bad',
  EXPIRED: 'bg-sunken text-muted',
};

/**
 * Live client dashboard links (docs/CLIENT_DASHBOARD_LINKS.md): read-only links a client can open
 * without signing in to watch completes and quotas. Money and vendor names only when switched on.
 */
export function DashboardLinksPopup({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const [data, setData] = useState<LinkList | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ label: '', showMoney: false, showVendors: false, expiresOn: '' });

  const load = useCallback(() => get<LinkList>(`/projects/${project.id}/dashboard-links`).then(setData).catch(setError), [project.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  async function create() {
    setError(null);
    setBusy(true);
    try {
      // An end date means the link works through that whole day, in the person's own time zone.
      const expiresAt = form.expiresOn ? new Date(`${form.expiresOn}T23:59:59`).toISOString() : undefined;
      await post(`/projects/${project.id}/dashboard-links`, { label: form.label.trim() || undefined, showMoney: form.showMoney, showVendors: form.showVendors, expiresAt });
      setForm({ label: '', showMoney: false, showVendors: false, expiresOn: '' });
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function change(l: DashboardLink, body: Partial<Pick<DashboardLink, 'showMoney' | 'showVendors'>>) {
    setError(null);
    try {
      await patch(`/projects/${project.id}/dashboard-links/${l.id}`, body);
      await load();
    } catch (e) {
      setError(e);
    }
  }

  async function revoke(l: DashboardLink) {
    if (!window.confirm(`Turn off ${l.label ? `"${l.label}"` : 'this link'}? Anyone who has it will no longer see the dashboard. This cannot be undone; you can make a new link.`)) return;
    setError(null);
    try {
      await post(`/projects/${project.id}/dashboard-links/${l.id}/revoke`);
      await load();
    } catch (e) {
      setError(e);
    }
  }

  const active = data?.links.filter((l) => l.state === 'ACTIVE') ?? [];
  const old = data?.links.filter((l) => l.state !== 'ACTIVE') ?? [];
  const today = new Date().toISOString().slice(0, 10);

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/40 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="dash-links-title" className="card w-full max-w-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 id="dash-links-title" className="text-base font-semibold">Client dashboard links</h2>
            <InfoTip id="project.dashboardLinks" />
          </div>
          <button type="button" className="btn-ghost p-2" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-5 p-5">
          <p className="text-sm text-muted">
            A read-only page where your client watches completes and quotas live, without signing in. Anyone with the link can see it, so send it only to the client team and turn it off when fieldwork ends.
          </p>
          <ErrorBox error={error} />
          {!data ? (
            <Loading />
          ) : (
            <>
              {!data.shareable && (
                <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm" role="status">This project is a draft. Its links start working once the project is in test or live.</div>
              )}

              <div className="rounded-lg border border-line p-4">
                <div className="mb-3 flex items-center gap-1.5 text-sm font-medium">New link <InfoTip id="project.dashboardLinks.new" /></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Who it is for" help="project.dashboardLinks.label">
                    <input className="input" maxLength={120} placeholder={`e.g. ${project.client.name} research team`} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
                  </Field>
                  <Field label="Works until (optional)" help="project.dashboardLinks.expires">
                    <input className="input" type="date" min={today} value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} />
                  </Field>
                </div>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-sm">
                  <span className="inline-flex items-center gap-2"><Toggle checked={form.showMoney} onChange={(v) => setForm({ ...form, showMoney: v })} label="Show CPI and spend" /> Show CPI and spend <InfoTip id="project.dashboardLinks.money" /></span>
                  <span className="inline-flex items-center gap-2"><Toggle checked={form.showVendors} onChange={(v) => setForm({ ...form, showVendors: v })} label="Show vendor names" /> Show vendor names <InfoTip id="project.dashboardLinks.vendors" /></span>
                </div>
                <div className="mt-4 flex justify-end">
                  <button type="button" className="btn-primary" disabled={busy || active.length >= data.maxActive} onClick={create}><Plus className="h-4 w-4" /> Make link</button>
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">Working links ({active.length}) <InfoTip id="project.dashboardLinks.list" /></div>
                {active.length === 0 ? (
                  <Empty>No links yet. Make one above and send it to your client.</Empty>
                ) : (
                  <ul className="space-y-3">
                    {active.map((l) => (
                      <li key={l.id} className="rounded-lg border border-line p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{l.label || 'Client dashboard'}</div>
                            <div className="text-xs text-muted">
                              Made {when(l.createdAt)}{l.createdBy ? ` by ${l.createdBy}` : ''} · {l.viewCount ? `opened ${l.viewCount.toLocaleString()} time${l.viewCount === 1 ? '' : 's'}, last ${when(l.lastViewedAt)}` : 'not opened yet'}
                              {l.expiresAt ? ` · works until ${when(l.expiresAt)}` : ''}
                            </div>
                          </div>
                          <button type="button" className="btn-ghost text-bad" onClick={() => revoke(l)}><Ban className="h-4 w-4" /> Turn off</button>
                        </div>
                        <div className="mt-2 flex min-w-0 items-center gap-1 rounded-md bg-sunken px-2 py-1.5">
                          <span className="min-w-0 flex-1 truncate font-mono text-xs">{dashboardUrl(l.token)}</span>
                          <CopyIcon text={dashboardUrl(l.token)} label="dashboard link" />
                          <a href={dashboardUrl(l.token)} target="_blank" rel="noreferrer" className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-panel hover:text-brand" aria-label="Open dashboard" title="Open dashboard"><ExternalLink className="h-3.5 w-3.5" /></a>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                          <span className="inline-flex items-center gap-2"><Toggle checked={l.showMoney} onChange={(v) => change(l, { showMoney: v })} label="Show CPI and spend" /> CPI and spend</span>
                          <span className="inline-flex items-center gap-2"><Toggle checked={l.showVendors} onChange={(v) => change(l, { showVendors: v })} label="Show vendor names" /> Vendor names</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {old.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted">Turned off and ended ({old.length})</summary>
                  <ul className="mt-2 space-y-1.5">
                    {old.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <span className={clsx('chip', STATE_CHIP[l.state])}>{l.state === 'REVOKED' ? 'Turned off' : 'Ended'}</span>
                        <span className="text-ink">{l.label || 'Client dashboard'}</span>
                        <span>· {l.state === 'REVOKED' ? `off since ${when(l.revokedAt)}` : `ended ${when(l.expiresAt)}`} · opened {l.viewCount.toLocaleString()} time{l.viewCount === 1 ? '' : 's'}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
