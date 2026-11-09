/**
 * Redirect health (docs/REDIRECT_HEALTH.md): one place to see whether respondents are being routed
 * correctly, per project and across the organisation.
 *
 * It reads what the redirect engine and the callback outbox already record:
 * - RedirectExecution: every outcome redirect, its latency, whether it fell back and why;
 * - RespondentSession: entries, and sessions that never came back from the client survey;
 * - CallbackDelivery: vendor callbacks by state and by receiving host.
 * Test traffic is excluded. Nothing is stored; the page is computed on request.
 *
 * "Check survey links" makes one GET to each live market's client survey link (with a clearly
 * marked test token) so a broken or expired client link shows up before respondents hit it.
 */
import { Controller, Get, Injectable, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { config as appConfig } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';
import { aggregate, countIf, dateOut, mdate, numOut, percentileCont } from '../prisma/agg';
import { buildSurveyLink } from '../survey/survey.service';

const HOUR = 3_600_000;
export const WINDOWS = { '1h': { ms: HOUR, bucket: 5 * 60_000 }, '24h': { ms: 24 * HOUR, bucket: HOUR }, '7d': { ms: 7 * 24 * HOUR, bucket: 6 * HOUR } } as const;
export type WindowKey = keyof typeof WINDOWS;

/** Thresholds behind the health label. Kept together so the docs and the page can quote them. */
export const THRESHOLDS = {
  /** Fallback share of redirects: watch from 5%, failing from 20% (with at least MIN_REDIRECTS). */
  fallbackWatch: 0.05,
  fallbackFail: 0.2,
  minRedirects: 5,
  /** 95th percentile redirect time. */
  p95WatchMs: 800,
  p95FailMs: 2000,
  /** Expired sessions that never came back from the client survey (share of entries, at least MIN_EXPIRED). */
  noReturnWatch: 0.5,
  minExpired: 10,
} as const;

export type Health = 'healthy' | 'watch' | 'failing' | 'idle';

export interface HealthInput {
  entries: number;
  redirects: number;
  fallbacks: number;
  p95Ms: number | null;
  expired: number;
  callbacksDead: number;
  callbacksRetrying: number;
}

/** The health label and the reasons for it, worst first. */
export function healthOf(x: HealthInput): { health: Health; reasons: string[] } {
  const fail: string[] = [];
  const watch: string[] = [];
  const rate = x.redirects ? x.fallbacks / x.redirects : 0;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (x.redirects >= THRESHOLDS.minRedirects && rate >= THRESHOLDS.fallbackFail) fail.push(`${pct(rate)} of redirects fell back`);
  else if (x.redirects >= THRESHOLDS.minRedirects && rate >= THRESHOLDS.fallbackWatch) watch.push(`${pct(rate)} of redirects fell back`);
  if (x.p95Ms !== null && x.p95Ms >= THRESHOLDS.p95FailMs) fail.push(`Slow redirects (p95 ${Math.round(x.p95Ms)} ms)`);
  else if (x.p95Ms !== null && x.p95Ms >= THRESHOLDS.p95WatchMs) watch.push(`Slow redirects (p95 ${Math.round(x.p95Ms)} ms)`);
  if (x.callbacksDead > 0) fail.push(`${x.callbacksDead} vendor callback${x.callbacksDead === 1 ? '' : 's'} gave up`);
  if (x.callbacksRetrying > 0) watch.push(`${x.callbacksRetrying} vendor callback${x.callbacksRetrying === 1 ? '' : 's'} retrying`);
  if (x.expired >= THRESHOLDS.minExpired && x.entries && x.expired / x.entries >= THRESHOLDS.noReturnWatch) watch.push(`${pct(x.expired / x.entries)} of respondents never came back from the survey`);
  if (fail.length) return { health: 'failing', reasons: [...fail, ...watch] };
  if (watch.length) return { health: 'watch', reasons: watch };
  if (!x.entries && !x.redirects && !x.callbacksDead && !x.callbacksRetrying) return { health: 'idle', reasons: [] };
  return { health: 'healthy', reasons: [] };
}

/** Group blocked reasons that differ only in details (URLs, hosts, numbers) so the list stays short. */
export function reasonKey(reason: string): string {
  return reason
    .split('; ')[0]
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\bDomain \S+ is not/g, 'Domain <host> is not')
    .replace(/\b\d+(\.\d+)?\b/g, 'N')
    .slice(0, 160);
}

/** Private, loopback and link-local addresses: a link check must never reach into the server's own network. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
}

export type LinkFetcher = (url: string, signal: AbortSignal) => Promise<{ status: number; location: string | null }>;
export type Resolver = (host: string) => Promise<string[]>;

export interface LinkCheck {
  projectCountryId: string;
  projectId: string;
  projectCode: string;
  countryCode: string;
  language: string;
  ok: boolean;
  status: number | null;
  ms: number;
  detail: string;
}

const num = (v: unknown) => Number(v ?? 0);

@Injectable()
export class RedirectHealthService {
  fetcher: LinkFetcher = async (url, signal) => {
    const r = await fetch(url, { method: 'GET', redirect: 'manual', signal, headers: { 'user-agent': 'PROJEXA-LinkCheck/1.0', 'x-projexa-link-check': '1' } });
    void r.body?.cancel().catch(() => undefined);
    return { status: r.status, location: r.headers.get('location') };
  };
  resolve: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async overview(org: string, windowKey: WindowKey, projectId?: string, now = new Date()) {
    const w = WINDOWS[windowKey];
    const from = new Date(now.getTime() - w.ms);
    const prevFrom = new Date(from.getTime() - w.ms);
    const [win, prevWin, entries, callbacks, hosts, problems] = await Promise.all([
      this.executions(org, from, now, true, projectId, w.bucket),
      this.executions(org, prevFrom, from, false, projectId, w.bucket),
      // Entries, and sessions that expired without an outcome (never came back from the survey).
      aggregate<{ _id: string; entries: number; expired: number; gateDropped: number }>(this.prisma.respondentSession, [
        { $match: { organizationId: org, isTest: false, startedAt: { $gte: mdate(from), $lte: mdate(now) }, ...(projectId ? { projectId } : {}) } },
        {
          $group: {
            _id: '$projectId',
            entries: { $sum: 1 },
            expired: countIf({ $and: [{ $eq: ['$status', 'STARTED'] }, { $lt: ['$expiresAt', mdate(now)] }, { $gt: ['$expiresAt', null] }, { $or: [{ $ne: ['$gateRequired', true] }, { $gt: ['$gatePassedAt', null] }] }] }),
            gateDropped: countIf({ $and: [{ $eq: ['$status', 'STARTED'] }, { $lt: ['$expiresAt', mdate(now)] }, { $gt: ['$expiresAt', null] }, { $eq: ['$gateRequired', true] }, { $lte: ['$gatePassedAt', null] }] }),
          },
        },
      ]).then((rows) => rows.map((r) => ({ projectId: r._id, entries: numOut(r.entries), expired: numOut(r.expired), gateDropped: numOut(r.gateDropped) }))),
      // Vendor callbacks created in the window, by project and state.
      aggregate<{ _id: { projectId: string | null; state: string }; n: number }>(this.prisma.callbackDelivery, [
        ...this.liveCallbacks({ organizationId: org, createdAt: { $gte: mdate(from), $lte: mdate(now) } }, projectId),
        { $group: { _id: { projectId: '$projectId', state: '$state' }, n: { $sum: 1 } } },
      ]).then((rows) => rows.map((r) => ({ projectId: r._id.projectId ?? null, state: r._id.state, n: numOut(r.n) }))),
      // Callbacks by receiving host.
      aggregate<{ _id: string | null; delivered: number; failing: number; pending: number; errs: { e: string; c: number | null }[] }>(this.prisma.callbackDelivery, [
        ...this.liveCallbacks({ organizationId: org, createdAt: { $gte: mdate(from), $lte: mdate(now) } }, projectId),
        { $sort: { updatedAt: -1 } },
        {
          $group: {
            _id: { $let: { vars: { m: { $regexFind: { input: '$url', regex: '^[a-z]+://([^/:?#]+)' } } }, in: { $cond: [{ $eq: ['$$m', null] }, null, { $arrayElemAt: ['$$m.captures', 0] }] } } },
            delivered: countIf({ $eq: ['$state', 'DELIVERED'] }),
            failing: countIf({ $in: ['$state', ['FAILED', 'DEAD_LETTER']] }),
            pending: countIf({ $in: ['$state', ['PENDING', 'QUEUED', 'SENDING', 'RETRY_SCHEDULED']] }),
            // Newest first (sorted above), so the first entry is the latest error.
            errs: { $push: { $cond: [{ $gt: ['$lastError', null] }, { e: '$lastError', c: '$lastStatusCode' }, '$$REMOVE'] } },
          },
        },
        { $sort: { failing: -1, pending: -1, delivered: -1 } },
        { $limit: 20 },
      ]).then((rows) =>
        rows.map((r) => ({ host: r._id ?? null, delivered: numOut(r.delivered), failing: numOut(r.failing), pending: numOut(r.pending), lastError: r.errs?.[0]?.e ?? null, lastCode: r.errs?.[0]?.c == null ? null : numOut(r.errs[0].c) })),
      ),
      // Callbacks that need a person (any age, so nothing drops off the page while unresolved).
      aggregate<{ _id: string; state: string; url: string; attempts: number; lastStatusCode: number | null; lastError: string | null; updatedAt: unknown; nextAttemptAt: unknown; projectId: string | null; targetType: string }>(this.prisma.callbackDelivery, [
        ...this.liveCallbacks({ organizationId: org, state: { $in: ['FAILED', 'DEAD_LETTER', 'RETRY_SCHEDULED'] } }, projectId),
        { $addFields: { retrying: { $eq: ['$state', 'RETRY_SCHEDULED'] } } },
        { $sort: { retrying: 1, updatedAt: -1 } },
        { $limit: 25 },
      ]).then((rows) =>
        rows.map((c) => ({
          id: c._id,
          state: c.state,
          url: c.url,
          attempts: numOut(c.attempts),
          lastStatusCode: c.lastStatusCode == null ? null : numOut(c.lastStatusCode),
          lastError: c.lastError ?? null,
          updatedAt: dateOut(c.updatedAt)!,
          nextAttemptAt: dateOut(c.nextAttemptAt)!,
          projectId: c.projectId ?? null,
          targetType: c.targetType,
        })),
      ),
    ]);
    const { perProject, timeline, reasons, statuses } = win;
    const prev = [{ redirects: prevWin.total, fallbacks: prevWin.fallbacks, p95: percentileCont(prevWin.durations, 0.95) }];

    // Projects: everything with traffic in the window, plus live projects with none (they show as idle).
    const ids = new Set<string>([...perProject.map((p) => p.projectId), ...entries.map((p) => p.projectId), ...callbacks.map((c) => c.projectId).filter((x): x is string => !!x), ...problems.map((c) => c.projectId).filter((x): x is string => !!x)]);
    const projects = await this.prisma.project.findMany({
      where: { organizationId: org, ...(projectId ? { id: projectId } : { OR: [{ id: { in: [...ids] } }, { status: 'LIVE' }] }) },
      select: { id: true, projectCode: true, name: true, status: true, redirectMode: true },
    });
    if (projectId && !projects.length) throw new NotFoundException('Project not found');
    const byProject = new Map(projects.map((p) => [p.id, p]));

    const rows = projects.map((p) => {
      const r = perProject.find((x) => x.projectId === p.id);
      const e = entries.find((x) => x.projectId === p.id);
      const cb = callbacks.filter((x) => x.projectId === p.id);
      const cbN = (states: string[]) => cb.filter((x) => states.includes(x.state)).reduce((a, x) => a + x.n, 0);
      const stats = {
        entries: e?.entries ?? 0,
        redirects: r?.redirects ?? 0,
        fallbacks: r?.fallbacks ?? 0,
        blocked: r?.blocked ?? 0,
        apiFallbacks: r?.apiFallbacks ?? 0,
        p50Ms: r?.p50 === null || r?.p50 === undefined ? null : Math.round(num(r.p50)),
        p95Ms: r?.p95 === null || r?.p95 === undefined ? null : Math.round(num(r.p95)),
        expired: e?.expired ?? 0,
        gateDropped: e?.gateDropped ?? 0,
        callbacksDelivered: cbN(['DELIVERED']),
        callbacksRetrying: cbN(['RETRY_SCHEDULED', 'PENDING', 'QUEUED', 'SENDING']),
        callbacksDead: cbN(['FAILED', 'DEAD_LETTER']),
        lastRedirectAt: r?.last ?? null,
      };
      const h = healthOf({ ...stats, callbacksRetrying: cbN(['RETRY_SCHEDULED']) });
      return { project: p, ...stats, ...h };
    });
    const rank: Record<Health, number> = { failing: 0, watch: 1, healthy: 2, idle: 3 };
    rows.sort((a, b) => rank[a.health] - rank[b.health] || b.redirects - a.redirects || a.project.projectCode.localeCompare(b.project.projectCode));

    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0);
    const p95All = perProject.length ? Math.round(percentileCont(win.durations, 0.95)!) : null;
    const totals = {
      entries: sum('entries'),
      redirects: sum('redirects'),
      fallbacks: sum('fallbacks'),
      blocked: sum('blocked'),
      apiFallbacks: sum('apiFallbacks'),
      expired: sum('expired'),
      gateDropped: sum('gateDropped'),
      p95Ms: p95All,
      callbacksDelivered: sum('callbacksDelivered'),
      callbacksRetrying: sum('callbacksRetrying'),
      callbacksDead: sum('callbacksDead'),
    };
    const pr = prev[0];
    const previous = { redirects: num(pr?.redirects), fallbacks: num(pr?.fallbacks), p95Ms: pr?.p95 === null || pr?.p95 === undefined ? null : Math.round(num(pr.p95)) };

    // Group reasons, keeping one example and the projects affected.
    const grouped = new Map<string, { key: string; example: string; count: number; lastAt: Date; projects: Set<string> }>();
    for (const r of reasons) {
      const key = reasonKey(r.reason);
      const g = grouped.get(key) ?? { key, example: r.reason, count: 0, lastAt: r.last, projects: new Set<string>() };
      g.count += r.n;
      if (r.last > g.lastAt) g.lastAt = r.last;
      g.projects.add(r.projectId);
      grouped.set(key, g);
    }
    const reasonRows = [...grouped.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map((g) => ({ reason: g.key, example: g.example.split('; ')[0], count: g.count, lastAt: g.lastAt, projects: [...g.projects].map((id) => byProject.get(id)).filter(Boolean).map((p) => ({ id: p!.id, projectCode: p!.projectCode })) }));

    const buckets = Math.ceil(w.ms / w.bucket);
    const series = Array.from({ length: buckets }, (_, i) => {
      const t = timeline.find((x) => x.bucket === i);
      return { at: new Date(from.getTime() + i * w.bucket), ok: t?.ok ?? 0, fallback: t?.fallback ?? 0 };
    });

    return {
      window: { key: windowKey, from, to: now, bucketMinutes: w.bucket / 60_000 },
      thresholds: THRESHOLDS,
      // The organisation is as healthy as its worst project, so one broken study is never averaged away.
      health: rows.length ? rows[0].health : ('idle' as Health),
      reasons: rows.filter((r) => r.health === 'failing' || r.health === 'watch').flatMap((r) => r.reasons.map((x) => `${r.project.projectCode}: ${x}`)).slice(0, 8),
      totals,
      previous,
      outcomes: statuses.map((s) => ({ status: s.status, count: s.n })),
      series,
      fallbackReasons: reasonRows,
      projects: rows,
      callbackHosts: hosts.map((h) => ({ host: h.host ?? '(invalid URL)', delivered: h.delivered, failing: h.failing, pending: h.pending, lastError: h.lastError, lastStatusCode: h.lastCode })),
      callbackProblems: problems.map((c) => ({ ...c, url: redactQuery(c.url), project: c.projectId ? (byProject.get(c.projectId) ? { id: c.projectId, projectCode: byProject.get(c.projectId)!.projectCode } : null) : null })),
    };
  }

  /**
   * Redirects of live (non-test) sessions in [from, to] (or [from, to) when `inclusive` is false):
   * per project, over time, by fallback reason and by outcome, plus every duration for percentiles.
   */
  private async executions(org: string, from: Date, to: Date, inclusive: boolean, projectId: string | undefined, bucket: number) {
    type ByProject = { _id: string; redirects: number; fallbacks: number; blocked: number; apiFallbacks: number; durations: number[]; last: unknown };
    type Out = {
      perProject: ByProject[];
      timeline: { _id: number; ok: number; fallback: number }[];
      reasons: { _id: string; n: number; last: unknown; projectId: string }[];
      statuses: { _id: string; n: number }[];
    };
    const [r] = await aggregate<Out>(this.prisma.redirectExecution, [
      { $match: { createdAt: { $gte: mdate(from), [inclusive ? '$lte' : '$lt']: mdate(to) } } },
      {
        $lookup: {
          from: 'RespondentSession',
          localField: 'sessionId',
          foreignField: '_id',
          pipeline: [{ $match: { organizationId: org, isTest: false, ...(projectId ? { projectId } : {}) } }, { $project: { projectId: 1 } }],
          as: 's',
        },
      },
      { $unwind: '$s' },
      { $addFields: { projectId: '$s.projectId' } },
      {
        $facet: {
          perProject: [
            {
              $group: {
                _id: '$projectId',
                redirects: { $sum: 1 },
                fallbacks: countIf({ $eq: ['$usedFallback', true] }),
                blocked: countIf({ $gt: ['$blockedReason', null] }),
                apiFallbacks: countIf({ $eq: ['$apiFallback', true] }),
                durations: { $push: '$durationMs' },
                last: { $max: '$createdAt' },
              },
            },
          ],
          timeline: [
            {
              $group: {
                _id: { $floor: { $divide: [{ $subtract: ['$createdAt', mdate(from)] }, bucket] } },
                ok: countIf({ $ne: ['$usedFallback', true] }),
                fallback: countIf({ $eq: ['$usedFallback', true] }),
              },
            },
            { $sort: { _id: 1 } },
          ],
          reasons: [
            { $match: { blockedReason: { $type: 'string' } } },
            { $group: { _id: '$blockedReason', n: { $sum: 1 }, last: { $max: '$createdAt' }, projectId: { $min: '$projectId' } } },
            { $sort: { n: -1 } },
            { $limit: 200 },
          ],
          statuses: [{ $group: { _id: '$status', n: { $sum: 1 } } }, { $sort: { n: -1 } }],
        },
      },
    ]);
    const perProject = (r?.perProject ?? []).map((p) => {
      const d = (p.durations ?? []).map(numOut);
      return {
        projectId: p._id,
        redirects: numOut(p.redirects),
        fallbacks: numOut(p.fallbacks),
        blocked: numOut(p.blocked),
        apiFallbacks: numOut(p.apiFallbacks),
        p50: percentileCont(d, 0.5),
        p95: percentileCont(d, 0.95),
        last: dateOut(p.last),
        durations: d,
      };
    });
    return {
      perProject,
      durations: perProject.flatMap((p) => p.durations),
      total: perProject.reduce((a, p) => a + p.redirects, 0),
      fallbacks: perProject.reduce((a, p) => a + p.fallbacks, 0),
      timeline: (r?.timeline ?? []).map((t) => ({ bucket: numOut(t._id), ok: numOut(t.ok), fallback: numOut(t.fallback) })),
      reasons: (r?.reasons ?? []).map((x) => ({ reason: x._id, n: numOut(x.n), last: dateOut(x.last)!, projectId: x.projectId })),
      statuses: (r?.statuses ?? []).map((x) => ({ status: x._id, n: numOut(x.n) })),
    };
  }

  /**
   * Callbacks matching `match`, with the project of their session. Callbacks of test sessions are
   * left out; callbacks without a (remaining) session stay, unless a project is asked for.
   */
  private liveCallbacks(match: Record<string, unknown>, projectId?: string): object[] {
    return [
      { $match: match },
      { $lookup: { from: 'RespondentSession', localField: 'sessionId', foreignField: '_id', pipeline: [{ $project: { projectId: 1, isTest: 1 } }], as: 's' } },
      { $match: { $or: [{ 's.0': { $exists: false } }, { 's.0.isTest': false }] } },
      { $addFields: { projectId: { $ifNull: [{ $arrayElemAt: ['$s.projectId', 0] }, null] } } },
      ...(projectId ? [{ $match: { projectId } }] : []),
      { $project: { s: 0, body: 0 } },
    ];
  }

  /** One GET per live market's client survey link. Redirects are not followed; 2xx and 3xx count as up. */
  async checkLinks(user: AuthUser, projectId?: string): Promise<LinkCheck[]> {
    const markets = await this.prisma.projectCountry.findMany({
      where: { project: { organizationId: user.organizationId, ...(projectId ? { id: projectId } : { status: 'LIVE' }) }, status: { in: projectId ? ['LIVE', 'TEST', 'HOLD', 'DRAFT'] : ['LIVE'] }, liveSurveyUrl: { not: null } },
      select: { id: true, countryCode: true, language: true, liveSurveyUrl: true, project: { select: { id: true, projectCode: true } } },
      orderBy: [{ project: { projectCode: 'asc' } }, { countryCode: 'asc' }],
      take: 100,
    });
    const results: LinkCheck[] = [];
    // A few at a time, so a large organisation does not open 100 connections at once.
    for (let i = 0; i < markets.length; i += 6) {
      results.push(...(await Promise.all(markets.slice(i, i + 6).map((m) => this.checkOne(m)))));
    }
    await this.audit.record({ organizationId: user.organizationId, actorId: user.id, action: 'redirects.links_checked', entityType: projectId ? 'Project' : 'Organization', entityId: projectId ?? user.organizationId, detail: { checked: results.length, failing: results.filter((r) => !r.ok).length } });
    return results;
  }

  private async checkOne(m: { id: string; countryCode: string; language: string; liveSurveyUrl: string | null; project: { id: string; projectCode: string } }): Promise<LinkCheck> {
    const base = { projectCountryId: m.id, projectId: m.project.id, projectCode: m.project.projectCode, countryCode: m.countryCode, language: m.language };
    const started = Date.now();
    const done = (ok: boolean, status: number | null, detail: string): LinkCheck => ({ ...base, ok, status, ms: Date.now() - started, detail });
    let url: URL;
    try {
      url = new URL(buildSurveyLink(m.liveSurveyUrl!, { token: 'projexa-link-check', countryCode: m.countryCode, projectCode: m.project.projectCode }));
    } catch {
      return done(false, null, 'The survey link is not a valid URL');
    }
    if (url.protocol !== 'https:' && !(appConfig.allowHttpRedirects && url.protocol === 'http:')) return done(false, null, `Only https links are checked (${url.protocol})`);
    if (url.username || url.password) return done(false, null, 'Credentials in the link are not allowed');
    // Private addresses are refused unless an operator opts in for an on-premises survey host.
    if (process.env.LINK_CHECK_ALLOW_PRIVATE !== 'true') {
      try {
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(host) ? [host] : await this.resolve(host);
        if (!addresses.length) return done(false, null, 'The host does not resolve');
        if (addresses.some(isPrivateAddress)) return done(false, null, 'The host points to a private network address');
      } catch {
        return done(false, null, `DNS lookup failed for ${url.hostname}`);
      }
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await this.fetcher(url.toString(), ctrl.signal);
      if (r.status >= 200 && r.status < 300) return done(true, r.status, 'Reachable');
      if (r.status >= 300 && r.status < 400) return done(true, r.status, r.location ? `Redirects to ${hostOf(r.location, url)}` : 'Redirects');
      return done(false, r.status, r.status === 404 ? 'Not found: the link may have changed or the survey was closed' : r.status >= 500 ? 'The survey platform returned a server error' : `The survey platform answered ${r.status}`);
    } catch (e) {
      return done(false, null, ctrl.signal.aborted ? 'No answer within 8 seconds' : `Could not connect (${(e as Error).message.slice(0, 80)})`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function hostOf(location: string, base: URL) {
  try {
    return new URL(location, base).host;
  } catch {
    return 'another page';
  }
}

/** Callback URLs often carry respondent IDs and secrets in the query: show the path only. */
export function redactQuery(raw: string) {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}${u.search ? '?…' : ''}`;
  } catch {
    return '(invalid URL)';
  }
}

@Controller('redirect-health')
export class RedirectHealthController {
  constructor(private readonly svc: RedirectHealthService) {}

  @Get()
  overview(@CurrentUser() u: AuthUser, @Query('window') window?: string, @Query('projectId') projectId?: string) {
    const key = (window && window in WINDOWS ? window : '24h') as WindowKey;
    return this.svc.overview(u.organizationId, key, projectId || undefined);
  }

  @Post('check-links')
  @Roles(...EDITORS)
  checkAll(@CurrentUser() u: AuthUser) {
    return this.svc.checkLinks(u);
  }

  @Post('check-links/:projectId')
  @Roles(...EDITORS)
  checkProject(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string) {
    return this.svc.checkLinks(u, projectId);
  }
}

@Module({ controllers: [RedirectHealthController], providers: [RedirectHealthService] })
export class RedirectHealthModule {}
