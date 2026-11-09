import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { isIP } from 'net';
import { sha256 } from '../common/crypto';
import { IntegrationsService, isPrivateAddress } from '../integrations/integrations.service';
import { PrismaService } from '../prisma/prisma.service';
import { blockListOf, inList } from './fraud';
import type { CheckResult } from './respondent-checks';

/**
 * IP and proxy reputation (docs/FRAUD_CHECKS.md). Free sources only:
 * - public lists of VPN, data centre and abuse ranges, kept in Postgres and refreshed every 12 hours;
 * - optionally proxycheck.io with the organisation's own free key (1,000 lookups a day), cached 7 days;
 * - the organisation's own allow and block lists.
 * Everything is set up in Settings → Integrations → IP and proxy reputation. When a source is
 * unreachable the respondent is let through and the check says why, so fieldwork never stops.
 */
export interface IpListSource {
  id: string;
  category: 'vpn' | 'datacenter' | 'abuse';
  label: string;
  url: string;
}

export const IP_LIST_SOURCES: IpListSource[] = [
  { id: 'x4b-vpn', category: 'vpn', label: 'X4BNet VPN ranges', url: 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt' },
  { id: 'x4b-datacenter', category: 'datacenter', label: 'X4BNet data centre ranges', url: 'https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt' },
  { id: 'firehol-level1', category: 'abuse', label: 'FireHOL Level 1 (attacks and abuse)', url: 'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset' },
];

const REFRESH_MS = 12 * 60 * 60 * 1000;
const CACHE_DAYS = 7;
const CATEGORY_REASON = { vpn: 'PROXY_VPN', datacenter: 'DATACENTER_IP', abuse: 'IP_ABUSE' } as const;

export interface HttpText { status: number; text(): Promise<string> }
export type ReputationHttp = (url: string, timeoutMs: number) => Promise<HttpText>;

/** One list line ("1.2.3.0/24", "1.2.3.4", comments) → a public CIDR, or null. Private and reserved ranges are dropped. */
export function listEntry(line: string): string | null {
  const t = line.split('#')[0].trim();
  if (!t) return null;
  const [ip, bits] = t.split('/');
  const v = isIP(ip);
  if (!v) return null;
  const n = bits === undefined ? (v === 4 ? 32 : 128) : Number(bits);
  if (!Number.isInteger(n) || n < (v === 4 ? 8 : 16) || n > (v === 4 ? 32 : 128)) return null;
  // FireHOL lists bogons such as 10.0.0.0/8; they must never block local or office traffic.
  if (isPrivateAddress(ip)) return null;
  return `${ip}/${n}`;
}

@Injectable()
export class IpReputationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(IpReputationService.name);
  private timer?: NodeJS.Timeout;
  /** Swappable in tests. */
  http: ReputationHttp = (url, timeoutMs) => fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
  ) {}

  onModuleInit() {
    if (process.env.IP_REPUTATION_SYNC === 'false' || process.env.NODE_ENV === 'test') return;
    const run = () => this.syncAll().catch((e) => this.log.warn(`IP list refresh failed: ${(e as Error).message}`));
    setTimeout(run, 15_000).unref();
    this.timer = setInterval(run, REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async syncAll(): Promise<{ id: string; count: number; error: string | null }[]> {
    const out: { id: string; count: number; error: string | null }[] = [];
    for (const s of IP_LIST_SOURCES) {
      try {
        const r = await this.http(s.url, 30_000);
        if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
        const ranges = [...new Set((await r.text()).split(/\r?\n/).map(listEntry).filter((x): x is string => !!x))];
        if (ranges.length < 20) throw new Error(`list looks wrong (${ranges.length} ranges); keeping the previous one`);
        await this.replace(s, ranges);
        out.push({ id: s.id, count: ranges.length, error: null });
      } catch (e) {
        const error = (e as Error).message.slice(0, 300);
        await this.prisma.ipReputationSource.upsert({ where: { id: s.id }, create: { id: s.id, category: s.category, error }, update: { error } });
        out.push({ id: s.id, count: 0, error });
      }
    }
    this.log.log(`IP lists refreshed: ${out.map((o) => `${o.id} ${o.error ? `failed (${o.error})` : o.count}`).join(', ')}`);
    return out;
  }

  /** Replaces one list in a transaction (inserted in chunks; ranges are cast to inet). */
  async replace(source: Pick<IpListSource, 'id' | 'category'>, ranges: string[]) {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.ipReputationRange.deleteMany({ where: { source: source.id } });
        // Raw insert: Prisma's inet mapping takes single addresses only, not ranges.
        for (let i = 0; i < ranges.length; i += 5000) {
          const chunk = ranges.slice(i, i + 5000);
          await tx.$executeRaw`INSERT INTO "IpReputationRange" (id, source, category, "range") SELECT gen_random_uuid()::text, ${source.id}, ${source.category}, x::inet FROM unnest(${chunk}::text[]) AS x`;
        }
        await tx.ipReputationSource.upsert({
          where: { id: source.id },
          create: { id: source.id, category: source.category, count: ranges.length, syncedAt: new Date(), error: null },
          update: { category: source.category, count: ranges.length, syncedAt: new Date(), error: null },
        });
      },
      { timeout: 120_000 },
    );
  }

  async status() {
    const rows = await this.prisma.ipReputationSource.findMany();
    return IP_LIST_SOURCES.map((s) => {
      const r = rows.find((x) => x.id === s.id);
      return { id: s.id, label: s.label, category: s.category, count: r?.count ?? 0, syncedAt: r?.syncedAt ?? null, error: r?.error ?? null };
    });
  }

  /** Categories of the public lists that contain the address. */
  async listHits(ip: string): Promise<('vpn' | 'datacenter' | 'abuse')[]> {
    const rows = await this.prisma.$queryRaw<{ category: string }[]>`SELECT DISTINCT category FROM "IpReputationRange" WHERE "range" >>= ${ip}::inet`;
    return rows.map((r) => r.category as 'vpn' | 'datacenter' | 'abuse');
  }

  /** proxycheck.io (free key). null = could not tell (no key, limit reached, timeout). */
  async proxycheck(key: string, ip: string): Promise<{ proxy: boolean; type: string | null; cached: boolean } | { error: string }> {
    const cacheKey = sha256(`proxycheck:${ip}`);
    const hit = await this.prisma.ipLookupCache.findUnique({ where: { key: cacheKey } });
    if (hit && hit.checkedAt > new Date(Date.now() - CACHE_DAYS * 86_400_000)) return { proxy: hit.proxy, type: hit.type, cached: true };
    try {
      const r = await this.http(`https://proxycheck.io/v2/${encodeURIComponent(ip)}?key=${encodeURIComponent(key)}&vpn=1&risk=0`, 2_500);
      const j = JSON.parse(await r.text()) as Record<string, unknown> & { status?: string; message?: string };
      const row = j[ip] as { proxy?: string; type?: string } | undefined;
      if (!row || (j.status !== 'ok' && j.status !== 'warning')) return { error: String(j.message ?? j.status ?? `HTTP ${r.status}`).slice(0, 200) };
      const proxy = row.proxy === 'yes';
      const type = row.type ? String(row.type).slice(0, 40) : null;
      await this.prisma.ipLookupCache.upsert({ where: { key: cacheKey }, create: { key: cacheKey, proxy, type }, update: { proxy, type, checkedAt: new Date() } });
      return { proxy, type, cached: false };
    } catch (e) {
      return { error: (e as Error).message.slice(0, 200) };
    }
  }

  /** The organisation's settings (Settings → Integrations → IP and proxy reputation). Defaults: public lists on. */
  async settings(organizationId: string) {
    const env = (await this.integrations.resolve(organizationId, 'ip_reputation')).env;
    return {
      lists: (env.IP_LISTS ?? 'on').trim() !== 'off',
      proxycheckKey: env.PROXYCHECK_API_KEY?.trim() || null,
      allow: blockListOf(env.IP_ALLOWLIST),
      block: blockListOf(env.IP_BLOCKLIST),
    };
  }

  /**
   * The entry check. Order: your allow list (passes), your block list, public lists (abuse, then
   * VPN, then data centre), then proxycheck.io. The first hit decides.
   */
  async check(organizationId: string, rawIp: string | undefined): Promise<CheckResult> {
    const ip = rawIp?.replace(/^::ffff:/, '');
    if (!ip || !isIP(ip)) return { check: 'ipReputation', ok: true, note: 'no address' };
    const s = await this.settings(organizationId);
    if (inList(s.allow, ip)) return { check: 'ipReputation', ok: true, note: 'allow list' };
    if (inList(s.block, ip)) return { check: 'ipReputation', ok: false, reason: 'IP_BLOCKED', status: 'SECURITY_REJECT', note: 'block list' };
    if (isPrivateAddress(ip)) return { check: 'ipReputation', ok: true, note: 'private address' };
    const notes: string[] = [];
    if (s.lists) {
      const hits = await this.listHits(ip);
      for (const c of ['abuse', 'vpn', 'datacenter'] as const) {
        if (hits.includes(c)) return { check: 'ipReputation', ok: false, reason: CATEGORY_REASON[c], status: 'SECURITY_REJECT', note: `public list: ${c}` };
      }
      if (!(await this.prisma.ipReputationSource.count({ where: { count: { gt: 0 } } }))) notes.push('public lists not loaded');
    }
    if (s.proxycheckKey) {
      const r = await this.proxycheck(s.proxycheckKey, ip);
      if ('error' in r) notes.push(`proxycheck.io: ${r.error}`);
      else if (r.proxy) return { check: 'ipReputation', ok: false, reason: 'PROXY_VPN', status: 'SECURITY_REJECT', note: `proxycheck.io: ${r.type ?? 'proxy'}` };
    }
    if (!s.lists && !s.proxycheckKey) notes.push('no source turned on');
    return { check: 'ipReputation', ok: true, note: notes.join('; ') || undefined };
  }
}
