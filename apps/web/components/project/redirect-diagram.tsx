'use client';
import { useMemo, useState } from 'react';
import { Empty } from '@/components/ui';
import { flag } from '@/lib/countries';
import { OUTCOME_STATUSES, OutcomeStatus, STATUS_LABEL } from '@/lib/types';

export interface RouteRow {
  countryCode: string;
  vendor: { id: string; name: string };
  status: OutcomeStatus;
  source: string | null;
  type: string | null;
  destination: string;
  usedFallback: boolean;
  blockedReason: string | null;
  callbackRequired: boolean;
  apiEndpoint: string | null;
}

const W = 1000;
const ROW = 50;
const TOP = 34;
const COL = { vendor: 10, checks: 200, survey: 390, outcome: 580, dest: 760 };
const NODE_W = { vendor: 160, checks: 160, survey: 160, outcome: 150, dest: 230 };
/** Outcomes that PROJEXA decides before the respondent reaches the client survey. */
const PRE_SURVEY: OutcomeStatus[] = ['DUPLICATE', 'SECURITY_REJECT'];
const TONE: Record<string, string> = { COMPLETE: 'ok', TERMINATE: 'muted', QUOTA_FULL: 'warn', QUALITY_FAIL: 'bad', DUPLICATE: 'bad', SECURITY_REJECT: 'bad', PARTIAL: 'warn', TECHNICAL_ERROR: 'warn' };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
function shortUrl(u: string) {
  try {
    const x = new URL(u);
    return `${x.host}${x.pathname === '/' ? '' : x.pathname}`;
  } catch {
    return u;
  }
}
const SOURCE_LABEL: Record<string, string> = {
  'project:vendor+country': 'project · vendor + market',
  'project:vendor': 'project · vendor',
  'project:country': 'project · market',
  project: 'project',
  'client-template': 'client template',
  'organization-default': 'organization default',
};

/** A curved connector from the right edge of one node to the left edge of the next. */
function Edge({ x1, y1, x2, y2, tone = 'line', dashed }: { x1: number; y1: number; x2: number; y2: number; tone?: string; dashed?: boolean }) {
  const mid = (x1 + x2) / 2;
  return <path d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`} fill="none" strokeWidth={1.5} strokeDasharray={dashed ? '4 4' : undefined} style={{ stroke: `rgb(var(--${tone}) / ${tone === 'line' ? 1 : 0.7})` }} />;
}

function Node({ x, y, w, h = 38, title, sub, tone = 'line', fill = 'panel', tip }: { x: number; y: number; w: number; h?: number; title: string; sub?: string; tone?: string; fill?: string; tip?: string }) {
  return (
    <g>
      {tip && <title>{tip}</title>}
      <rect x={x} y={y - h / 2} width={w} height={h} rx={8} style={{ fill: `rgb(var(--${fill}))`, stroke: `rgb(var(--${tone}))` }} strokeWidth={1.25} />
      <text x={x + 10} y={sub ? y - 3 : y + 4} className="fill-ink" fontSize={11.5} fontWeight={600}>{title}</text>
      {sub && <text x={x + 10} y={y + 12} className="fill-muted" fontSize={10.5}>{sub}</text>}
    </g>
  );
}

/**
 * The respondent journey for one market and vendor: entry link, PROJEXA's checks (security,
 * gate survey), the client survey, each outcome and where it sends the respondent, with the
 * rule that decided it. Built from the effective routing of the active redirect version.
 */
export function RedirectDiagram({ rows, checks, gate }: { rows: RouteRow[]; checks: string[]; gate: boolean }) {
  const markets = useMemo(() => [...new Set(rows.map((r) => r.countryCode))], [rows]);
  const [market, setMarket] = useState(markets[0] ?? '');
  const vendors = useMemo(() => [...new Map(rows.filter((r) => r.countryCode === market).map((r) => [r.vendor.id, r.vendor])).values()], [rows, market]);
  const [vendorId, setVendorId] = useState('');
  const vendor = vendors.find((v) => v.id === vendorId) ?? vendors[0];
  if (!rows.length || !vendor) return <Empty>Add vendors to see the routing diagram.</Empty>;

  const routes = OUTCOME_STATUSES.map((s) => rows.find((r) => r.countryCode === market && r.vendor.id === vendor.id && r.status === s)).filter(Boolean) as RouteRow[];
  const H = TOP + routes.length * ROW + 10;
  const midY = TOP + ((routes.length - 1) * ROW) / 2;
  const yOf = (i: number) => TOP + i * ROW;
  const checksSub = [checks.length ? `${checks.length} security check${checks.length === 1 ? '' : 's'}` : 'No security checks', gate ? 'gate survey' : null].filter(Boolean).join(' · ');
  const problems = routes.filter((r) => r.usedFallback).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5 text-muted">
          Market
          <select className="input w-auto py-1.5" value={market} onChange={(e) => { setMarket(e.target.value); setVendorId(''); }}>
            {markets.map((m) => <option key={m} value={m}>{flag(m)} {m}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-muted">
          Vendor
          <select className="input w-auto py-1.5" value={vendor.id} onChange={(e) => setVendorId(e.target.value)}>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        <span className={problems ? 'text-warn' : 'text-muted'}>{problems ? `${problems} outcome${problems === 1 ? '' : 's'} fall back to the default page` : 'Every outcome has a destination'}</span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[760px]" role="img" aria-label={`Redirect flow for ${vendor.name} in ${market}`}>
          {['Vendor entry', 'PROJEXA checks', 'Client survey', 'Outcome', 'Sent to'].map((t, i) => (
            <text key={t} x={[COL.vendor, COL.checks, COL.survey, COL.outcome, COL.dest][i]} y={12} fontSize={10} className="fill-muted" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>{t}</text>
          ))}
          <Edge x1={COL.vendor + NODE_W.vendor} y1={midY} x2={COL.checks} y2={midY} tone="brand" />
          <Edge x1={COL.checks + NODE_W.checks} y1={midY} x2={COL.survey} y2={midY} tone="brand" />
          {routes.map((r, i) => {
            const pre = PRE_SURVEY.includes(r.status);
            const from = pre ? COL.checks + NODE_W.checks : COL.survey + NODE_W.survey;
            const tone = TONE[r.status] ?? 'line';
            return (
              <g key={r.status}>
                {pre ? (
                  <path d={`M${COL.checks + NODE_W.checks / 2},${midY + 19} C${COL.checks + NODE_W.checks / 2},${yOf(i)} ${COL.outcome - 80},${yOf(i)} ${COL.outcome},${yOf(i)}`} fill="none" strokeWidth={1.5} strokeDasharray="4 4" style={{ stroke: `rgb(var(--${tone}) / 0.7)` }} />
                ) : (
                  <Edge x1={from} y1={midY} x2={COL.outcome} y2={yOf(i)} tone={tone} />
                )}
                <Edge x1={COL.outcome + NODE_W.outcome} y1={yOf(i)} x2={COL.dest} y2={yOf(i)} tone={r.usedFallback ? 'warn' : 'line'} dashed={!!r.apiEndpoint} />
              </g>
            );
          })}
          <Node x={COL.vendor} y={midY} w={NODE_W.vendor} title={cut(vendor.name, 20)} sub="entry link /s/…" tone="brand" />
          <Node x={COL.checks} y={midY} w={NODE_W.checks} title="Checks" sub={checksSub} tip={checks.join(', ') || 'No security checks are on'} />
          <Node x={COL.survey} y={midY} w={NODE_W.survey} title={`${flag(market)} ${market} survey`} sub="client's live link" />
          {routes.map((r, i) => {
            const tone = TONE[r.status] ?? 'line';
            const dest = r.usedFallback ? `Default page: ${r.blockedReason ?? 'no rule'}` : r.apiEndpoint ? `Asks ${shortUrl(r.apiEndpoint)}` : shortUrl(r.destination);
            const sub = r.usedFallback ? 'fallback' : `${SOURCE_LABEL[r.source ?? ''] ?? r.source ?? ''}${r.type ? ` · ${r.type.toLowerCase()}` : ''}${r.callbackRequired ? ' · callback' : ''}`;
            const tip = r.usedFallback ? `${r.blockedReason ?? 'No rule'}; the respondent sees ${r.destination}` : r.apiEndpoint ? `Asked from ${r.apiEndpoint}; if it fails: ${r.destination}` : r.destination;
            return (
              <g key={r.status}>
                <Node x={COL.outcome} y={yOf(i)} w={NODE_W.outcome} h={30} title={STATUS_LABEL[r.status] ?? r.status} tone={tone} />
                <Node x={COL.dest} y={yOf(i)} w={NODE_W.dest} h={40} title={cut(dest, 31)} sub={cut(sub, 38)} tone={r.usedFallback ? 'warn' : r.apiEndpoint ? 'info' : 'line'} fill={r.usedFallback ? 'sunken' : 'panel'} tip={tip} />
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-2 text-xs text-muted">Dashed lines: outcomes PROJEXA decides before the survey, and destinations asked from your API at outcome time. Hover a box for the full address. Sample values fill the macros.</p>
    </div>
  );
}
