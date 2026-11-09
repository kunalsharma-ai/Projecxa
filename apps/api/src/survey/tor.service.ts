import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { isIP } from 'net';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_LIST_URL = 'https://check.torproject.org/torbulkexitlist';
const REFRESH_MS = 6 * 60 * 60 * 1000;

/**
 * Keeps the TOR exit node list in Postgres so every API instance can check entries.
 * Refreshes on start and every 6 hours. Set TOR_EXIT_LIST_SYNC=false to turn the download off
 * (tests, air-gapped installs); the TOR check then reports "list not loaded" and lets entries through.
 */
@Injectable()
export class TorService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TorService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.TOR_EXIT_LIST_SYNC === 'false' || process.env.NODE_ENV === 'test') return;
    const run = () => this.sync().catch((e) => this.log.warn(`TOR exit list refresh failed: ${(e as Error).message}`));
    setTimeout(run, 5_000).unref();
    this.timer = setInterval(run, REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sync(): Promise<{ count: number }> {
    const url = process.env.TOR_EXIT_LIST_URL ?? DEFAULT_LIST_URL;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ips = [...new Set((await res.text()).split(/\s+/).filter((l) => isIP(l)))];
    if (ips.length < 100) throw new Error(`list looks wrong (${ips.length} addresses); keeping the previous one`);
    await this.replace(ips);
    this.log.log(`TOR exit list refreshed: ${ips.length} addresses`);
    return { count: ips.length };
  }

  /** Replaces the whole list in one transaction. */
  async replace(ips: string[]) {
    await this.prisma.$transaction([
      this.prisma.torExitNode.deleteMany({}),
      this.prisma.torExitNode.createMany({ data: [...new Set(ips)].map((ip) => ({ ip })) }),
    ]);
  }

  async status() {
    const [count, latest] = await Promise.all([
      this.prisma.torExitNode.count(),
      this.prisma.torExitNode.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    ]);
    return { nodes: count, updatedAt: latest?.updatedAt ?? null };
  }

  /** null when the list is empty (cannot tell). */
  async isExitNode(ip: string | undefined): Promise<boolean | null> {
    if (!ip) return null;
    const plain = ip.replace(/^::ffff:/, '');
    const hit = await this.prisma.torExitNode.findUnique({ where: { ip: plain }, select: { ip: true } });
    if (hit) return true;
    return (await this.prisma.torExitNode.findFirst({ select: { ip: true } })) ? false : null;
  }
}
