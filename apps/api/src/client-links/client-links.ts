/**
 * Client unique links (docs/CLIENT_UNIQUE_LINKS.md).
 *
 * Some clients give one survey link per respondent instead of one shared live link. The project
 * manager uploads them per market; with "Use client unique links" on, each live respondent is
 * sent to the next unused link. Handing a link out is one guarded UPDATE (FOR UPDATE SKIP LOCKED),
 * so two respondents can never get the same link. Test links do not use them up.
 */
import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { toCsv } from '../unique-links/unique-links';
import { claim, createManySkipDuplicates } from '../prisma/mongo-compat';

export const MAX_CLIENT_LINKS_PER_UPLOAD = 50_000;
export const MAX_CLIENT_LINKS_PER_MARKET = 200_000;

/** A link the client made for one respondent: http(s), at most 2048 characters. */
export function checkClientLink(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 2048 || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : null;
  } catch {
    return null;
  }
}

const uploadSchema = z.object({
  countryId: z.string().min(1),
  urls: z.array(z.string().max(4096)).min(1).max(MAX_CLIENT_LINKS_PER_UPLOAD),
  label: z.string().trim().max(200).optional(),
  dryRun: z.boolean().default(false),
});
/** The same as uploadSchema, sent as multipart fields next to a text file of links. */
const fileFieldsSchema = z.object({
  countryId: z.string().min(1),
  label: z.string().trim().max(200).optional(),
  dryRun: z.preprocess((v) => v === true || v === 'true', z.boolean()),
});
export const MAX_CLIENT_LINK_FILE_BYTES = 15 * 1024 * 1024;

/**
 * The links in a text or CSV file: one per line, in any column. Lines without a link (a header,
 * empty lines) are skipped; a line with something else is reported as invalid.
 */
export function linksFromText(text: string): string[] {
  const out: string[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const m = /https?:\/\/[^\s"'<>]+/i.exec(t);
    if (m) out.push(m[0].replace(/[,;]+$/, ''));
    else if (i > 0) out.push(t.split(/[,;\t]/)[0]);
  });
  return out;
}

const modeSchema = z.object({ useClientLinks: z.boolean() });
const removeSchema = z.object({ countryId: z.string().min(1), ids: z.array(z.string()).max(MAX_CLIENT_LINKS_PER_UPLOAD).optional() });
const listSchema = z.object({
  countryId: z.string().optional(),
  status: z.enum(['UNUSED', 'ASSIGNED']).optional(),
  q: z.string().max(200).optional(),
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(500).default(100),
});

type Tx = Prisma.TransactionClient | PrismaService;

/**
 * Gives the session the next unused client link of its market and returns it. A session that
 * already has one gets the same link again. Null when none are left.
 */
export async function claimClientLink(tx: Tx, session: { id: string; projectCountryId: string }): Promise<string | null> {
  const mine = await tx.clientUniqueLink.findUnique({ where: { sessionId: session.id }, select: { url: true } });
  if (mine) return mine.url;
  const [id] = await claim(tx.clientUniqueLink, { projectCountryId: session.projectCountryId, status: 'UNUSED' }, { seq: 'asc' }, 1, {
    status: 'ASSIGNED',
    sessionId: session.id,
    assignedAt: new Date(),
  });
  return id ? ((await tx.clientUniqueLink.findUnique({ where: { id }, select: { url: true } }))?.url ?? null) : null;
}

/** A link a test respondent can try, without using it up (the first unused one). */
export async function peekClientLink(tx: Tx, projectCountryId: string): Promise<string | null> {
  const l = await tx.clientUniqueLink.findFirst({ where: { projectCountryId, status: 'UNUSED' }, orderBy: { seq: 'asc' }, select: { url: true } });
  return l?.url ?? null;
}

@Injectable()
export class ClientLinksService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async project(organizationId: string, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, organizationId }, select: { id: true, projectCode: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private async country(projectId: string, countryId: string) {
    const c = await this.prisma.projectCountry.findFirst({ where: { id: countryId, projectId } });
    if (!c) throw new NotFoundException('Market not found');
    return c;
  }

  async summary(organizationId: string, projectId: string) {
    await this.project(organizationId, projectId);
    const countries = await this.prisma.projectCountry.findMany({
      where: { projectId },
      orderBy: [{ countryCode: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, countryCode: true, language: true, targetGroup: true, status: true, useClientLinks: true, liveSurveyUrl: true, targetCompletes: true, completes: true },
    });
    const counts = await this.prisma.clientUniqueLink.groupBy({ by: ['projectCountryId', 'status'], where: { projectId }, _count: { _all: true } });
    const uploads = await this.prisma.clientUniqueLink.groupBy({ by: ['projectCountryId', 'label'], where: { projectId }, _count: { _all: true }, _min: { createdAt: true } });
    const n = (cid: string, st: string) => counts.find((r) => r.projectCountryId === cid && r.status === st)?._count._all ?? 0;
    return {
      maxPerUpload: MAX_CLIENT_LINKS_PER_UPLOAD,
      markets: countries.map((c) => {
        const unused = n(c.id, 'UNUSED');
        const assigned = n(c.id, 'ASSIGNED');
        const remaining = Math.max(0, c.targetCompletes - c.completes);
        return {
          ...c,
          hasLiveSurveyUrl: !!c.liveSurveyUrl,
          liveSurveyUrl: undefined,
          total: unused + assigned,
          unused,
          assigned,
          // Respondents drop out, so a market needs more links than completes. Warn below 2 × what is left.
          low: c.useClientLinks && unused < remaining * 2,
        };
      }),
      uploads: uploads
        .map((u) => ({ countryId: u.projectCountryId, label: u.label, count: u._count._all, createdAt: u._min.createdAt }))
        .sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0)),
    };
  }

  private where(projectId: string, q: Omit<z.infer<typeof listSchema>, 'skip' | 'take'>): Prisma.ClientUniqueLinkWhereInput {
    return {
      projectId,
      ...(q.countryId ? { projectCountryId: q.countryId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { url: { contains: q.q, mode: 'insensitive' } } : {}),
    };
  }

  private readonly select = {
    id: true, url: true, seq: true, status: true, assignedAt: true, label: true, createdAt: true,
    projectCountry: { select: { countryCode: true, language: true, targetGroup: true } },
    session: { select: { status: true, statusDetail: true, token: true, vendorAllocation: { select: { vendor: { select: { name: true } } } } } },
  } as const;

  async list(organizationId: string, projectId: string, q: z.infer<typeof listSchema>) {
    await this.project(organizationId, projectId);
    const where = this.where(projectId, q);
    const [rows, total] = await Promise.all([
      this.prisma.clientUniqueLink.findMany({ where, orderBy: [{ projectCountryId: 'asc' }, { seq: 'asc' }], skip: q.skip, take: q.take, select: this.select }),
      this.prisma.clientUniqueLink.count({ where }),
    ]);
    return { total, rows };
  }

  async exportCsv(organizationId: string, projectId: string, q: z.infer<typeof listSchema>, res: Response) {
    const p = await this.project(organizationId, projectId);
    const rows = await this.prisma.clientUniqueLink.findMany({ where: this.where(projectId, q), orderBy: [{ projectCountryId: 'asc' }, { seq: 'asc' }], take: MAX_CLIENT_LINKS_PER_MARKET, select: this.select });
    const header = ['Link', 'Market', 'Upload', 'Link status', 'Given out at', 'Respondent UID', 'Vendor', 'Respondent status', 'Respondent detail'];
    const body = rows.map((r) => [
      r.url, [r.projectCountry.countryCode, r.projectCountry.language, r.projectCountry.targetGroup].filter(Boolean).join(' · '), r.label ?? '',
      r.status === 'UNUSED' ? 'Unused' : 'Given out', r.assignedAt?.toISOString() ?? '', r.session?.token ?? '', r.session?.vendorAllocation.vendor.name ?? '', r.session?.status ?? '', r.session?.statusDetail ?? '',
    ]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${p.projectCode}-client-unique-links.csv"`);
    res.end(`﻿${toCsv([header, ...body])}\r\n`);
  }

  /**
   * Adds links to a market. Bad lines and links already uploaded to the market are reported and
   * skipped; dryRun only reports.
   */
  async upload(u: AuthUser, projectId: string, body: z.infer<typeof uploadSchema>) {
    await this.project(u.organizationId, projectId);
    const country = await this.country(projectId, body.countryId);
    const invalid: { line: number; value: string }[] = [];
    const seen = new Set<string>();
    const fresh: string[] = [];
    let repeated = 0;
    body.urls.forEach((raw, i) => {
      if (!raw.trim()) return;
      const url = checkClientLink(raw);
      if (!url) {
        if (invalid.length < 50) invalid.push({ line: i + 1, value: raw.slice(0, 200) });
        else invalid.push({ line: i + 1, value: '' });
        return;
      }
      if (seen.has(url)) {
        repeated++;
        return;
      }
      seen.add(url);
      fresh.push(url);
    });
    // Links this market already has.
    const existing = new Set<string>();
    for (let i = 0; i < fresh.length; i += 5000) {
      const found = await this.prisma.clientUniqueLink.findMany({ where: { projectCountryId: country.id, url: { in: fresh.slice(i, i + 5000) } }, select: { url: true } });
      for (const f of found) existing.add(f.url);
    }
    const toAdd = fresh.filter((x) => !existing.has(x));
    const have = await this.prisma.clientUniqueLink.count({ where: { projectCountryId: country.id } });
    if (have + toAdd.length > MAX_CLIENT_LINKS_PER_MARKET) throw new BadRequestException(`A market can hold up to ${MAX_CLIENT_LINKS_PER_MARKET.toLocaleString('en')} client links; it has ${have.toLocaleString('en')}.`);
    const report = { dryRun: body.dryRun, valid: toAdd.length, added: 0, invalid: invalid.length, invalidSamples: invalid.slice(0, 50), repeatedInFile: repeated, alreadyUploaded: existing.size };
    if (body.dryRun || !toAdd.length) return report;
    const label = body.label?.trim() || `Upload ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    const added = await this.prisma.$transaction(async (tx) => {
      const max = await tx.clientUniqueLink.aggregate({ where: { projectCountryId: country.id }, _max: { seq: true } });
      const start = (max._max.seq ?? 0) + 1;
      let n = 0;
      for (let i = 0; i < toAdd.length; i += 5000) {
        const r = await createManySkipDuplicates(
          tx.clientUniqueLink,
          'ClientUniqueLink',
          toAdd.slice(i, i + 5000).map((url, j) => ({ organizationId: u.organizationId, projectId, projectCountryId: country.id, url, seq: start + i + j, label, createdById: u.id })),
        );
        n += r.count;
      }
      return n;
    }, { timeout: 60_000 });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'client-links.upload', entityType: 'Project', entityId: projectId, detail: { country: country.countryCode, added, label } });
    return { ...report, added };
  }

  async setMode(u: AuthUser, projectId: string, countryId: string, useClientLinks: boolean) {
    await this.project(u.organizationId, projectId);
    const country = await this.country(projectId, countryId);
    if (useClientLinks && country.status === 'LIVE' && !(await this.prisma.clientUniqueLink.count({ where: { projectCountryId: countryId, status: 'UNUSED' } })))
      throw new BadRequestException({ message: 'This market is live and has no unused client links. Upload links first, then turn this on.', code: 'NO_CLIENT_LINKS' });
    const updated = await this.prisma.projectCountry.update({ where: { id: countryId }, data: { useClientLinks }, select: { id: true, useClientLinks: true } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'client-links.mode', entityType: 'ProjectCountry', entityId: countryId, detail: { useClientLinks } });
    return updated;
  }

  /** Removes unused links (all of the market's, or the ones listed). Links given out stay for the record. */
  async removeUnused(u: AuthUser, projectId: string, body: z.infer<typeof removeSchema>) {
    await this.project(u.organizationId, projectId);
    await this.country(projectId, body.countryId);
    const r = await this.prisma.clientUniqueLink.deleteMany({ where: { projectId, projectCountryId: body.countryId, status: 'UNUSED', ...(body.ids ? { id: { in: body.ids } } : {}) } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'client-links.remove', entityType: 'ProjectCountry', entityId: body.countryId, detail: { removed: r.count } });
    return { removed: r.count };
  }
}

@Controller('projects/:id/client-links')
export class ClientLinksController {
  constructor(private readonly svc: ClientLinksService) {}

  @Get('summary')
  summary(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.summary(u.organizationId, id);
  }

  @Get()
  list(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.svc.list(u.organizationId, id, q);
  }

  @Get('export.csv')
  export(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>, @Res() res: Response) {
    return this.svc.exportCsv(u.organizationId, id, q, res);
  }

  @Post()
  @Roles(...EDITORS)
  upload(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(uploadSchema)) body: z.infer<typeof uploadSchema>) {
    return this.svc.upload(u, id, body);
  }

  /** Same as POST, with the links in a text/CSV file (one per line). The web app turns XLSX into this. */
  @Post('file')
  @Roles(...EDITORS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_CLIENT_LINK_FILE_BYTES, files: 1 } }))
  uploadFile(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(fileFieldsSchema)) body: z.infer<typeof fileFieldsSchema>, @UploadedFile() file?: { buffer: Buffer; size: number }) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a file with the links');
    const urls = linksFromText(file.buffer.toString('utf8'));
    if (!urls.length) throw new BadRequestException('No links found. Put one link per line (http:// or https://).');
    if (urls.length > MAX_CLIENT_LINKS_PER_UPLOAD) throw new BadRequestException(`Up to ${MAX_CLIENT_LINKS_PER_UPLOAD.toLocaleString('en')} links per upload. Split the file.`);
    return this.svc.upload(u, id, { ...body, urls });
  }

  @Post('countries/:countryId/mode')
  @Roles(...EDITORS)
  mode(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('countryId') countryId: string, @Body(new ZodPipe(modeSchema)) body: z.infer<typeof modeSchema>) {
    return this.svc.setMode(u, id, countryId, body.useClientLinks);
  }

  @Post('remove')
  @Roles(...EDITORS)
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(removeSchema)) body: z.infer<typeof removeSchema>) {
    return this.svc.removeUnused(u, id, body);
  }
}

@Module({ controllers: [ClientLinksController], providers: [ClientLinksService] })
export class ClientLinksModule {}
