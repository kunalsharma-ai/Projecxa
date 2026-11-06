/**
 * Client and vendor logos (docs/CLIENTS_VENDORS_LOGOS_AND_STATUS.md).
 *
 * Any common image format is accepted (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG), checked by its
 * bytes, up to MAX_LOGO_BYTES. The web app shrinks bigger raster images before uploading, so the
 * cap keeps pages light without people having to resize by hand. Logos are served with a
 * locked-down CSP and nosniff; SVGs with scripts or event handlers are refused.
 */
import { BadRequestException, Controller, Delete, Get, Module, NotFoundException, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { sha256 } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';

export const MAX_LOGO_BYTES = 200 * 1024;
export const LOGO_TYPES = ['PNG', 'JPEG', 'GIF', 'WebP', 'AVIF', 'BMP', 'ICO', 'SVG'] as const;

/** The image type from the file's first bytes, or null. */
export function sniffLogo(buf: Buffer): string | null {
  const head = (n: number) => buf.subarray(0, n);
  if (buf.length > 8 && head(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 6 && /^GIF8[79]a$/.test(head(6).toString('latin1'))) return 'image/gif';
  if (buf.length > 12 && head(4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp' && /^avi[fs]$/.test(buf.subarray(8, 12).toString('latin1'))) return 'image/avif';
  if (buf.length > 2 && head(2).toString('latin1') === 'BM') return 'image/bmp';
  if (buf.length > 4 && buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  const text = buf.subarray(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(text)) return 'image/svg+xml';
  return null;
}

/** SVGs may carry script; refuse anything active even though the CSP would block it too. */
export function svgProblem(buf: Buffer): string | null {
  const s = buf.toString('utf8');
  if (/<script|<foreignObject|\son[a-z]+\s*=|javascript:|<iframe|<embed|<object/i.test(s)) return 'This SVG contains scripts or embedded content. Export it again as a plain SVG, or use PNG.';
  if (/(xlink:)?href\s*=\s*["']\s*(https?:)?\/\//i.test(s)) return 'This SVG loads images from the internet. Embed them, or use PNG.';
  return null;
}

type Kind = 'client' | 'vendor';
const logoUrl = (kind: Kind, id: string, hash: string) => `/${kind}s/${id}/logo?v=${hash.slice(0, 12)}`;

/** The URL a page shows the logo from (relative to /api/v1), or null when there is none. */
export function logoUrlOf(kind: Kind, row: { id: string; logo?: { hash: string } | null }): string | null {
  return row.logo ? logoUrl(kind, row.id, row.logo.hash) : null;
}

/** Prisma select that brings just enough to build the logo URL. */
export const LOGO_SELECT = { logo: { select: { hash: true } } } as const;

/** Replaces `logo` with `logoUrl` on a row (and on arrays of rows). */
export function withLogoUrl<T extends { id: string; logo?: { hash: string } | null }>(kind: Kind, row: T): Omit<T, 'logo'> & { logoUrl: string | null } {
  const { logo, ...rest } = row;
  return { ...rest, logoUrl: logo ? logoUrl(kind, row.id, logo.hash) : null };
}

@Controller()
export class PartyLogosController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get('clients/:id/logo')
  clientLogo(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    return this.send(u, 'client', id, res);
  }

  @Get('vendors/:id/logo')
  vendorLogo(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    return this.send(u, 'vendor', id, res);
  }

  @Post('clients/:id/logo')
  @Roles(...EDITORS, 'SALES')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES + 1, files: 1 } }))
  uploadClient(@CurrentUser() u: AuthUser, @Param('id') id: string, @UploadedFile() file?: { buffer: Buffer; size: number }) {
    return this.upload(u, 'client', id, file);
  }

  @Post('vendors/:id/logo')
  @Roles(...EDITORS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_LOGO_BYTES + 1, files: 1 } }))
  uploadVendor(@CurrentUser() u: AuthUser, @Param('id') id: string, @UploadedFile() file?: { buffer: Buffer; size: number }) {
    return this.upload(u, 'vendor', id, file);
  }

  @Delete('clients/:id/logo')
  @Roles(...EDITORS, 'SALES')
  removeClient(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.remove(u, 'client', id);
  }

  @Delete('vendors/:id/logo')
  @Roles(...EDITORS)
  removeVendor(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.remove(u, 'vendor', id);
  }

  private async owner(u: AuthUser, kind: Kind, id: string) {
    const found = kind === 'client'
      ? await this.prisma.client.findFirst({ where: { id, organizationId: u.organizationId }, select: { id: true } })
      : await this.prisma.vendor.findFirst({ where: { id, organizationId: u.organizationId }, select: { id: true } });
    if (!found) throw new NotFoundException(`${kind === 'client' ? 'Client' : 'Vendor'} not found`);
  }

  private async send(u: AuthUser, kind: Kind, id: string, res: Response) {
    const logo = await this.prisma.partyLogo.findFirst({ where: { organizationId: u.organizationId, ...(kind === 'client' ? { clientId: id } : { vendorId: id }) } });
    if (!logo) throw new NotFoundException();
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('ETag', `"${logo.hash.slice(0, 32)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.end(Buffer.from(logo.data));
  }

  private async upload(u: AuthUser, kind: Kind, id: string, file?: { buffer: Buffer; size: number }) {
    await this.owner(u, kind, id);
    if (!file?.buffer?.length) throw new BadRequestException('Choose an image file');
    if (file.size > MAX_LOGO_BYTES) throw new BadRequestException(`Use an image up to ${MAX_LOGO_BYTES / 1024} KB`);
    const type = sniffLogo(file.buffer);
    if (!type) throw new BadRequestException(`Use an image: ${LOGO_TYPES.join(', ')}`);
    if (type === 'image/svg+xml') {
      const p = svgProblem(file.buffer);
      if (p) throw new BadRequestException(p);
    }
    const hash = sha256(file.buffer.toString('base64'));
    const data = new Uint8Array(file.buffer);
    const where = kind === 'client' ? { clientId: id } : { vendorId: id };
    await this.prisma.partyLogo.upsert({
      where,
      create: { organizationId: u.organizationId, ...where, contentType: type, data, hash, bytes: file.size },
      update: { contentType: type, data, hash, bytes: file.size },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: `${kind}.logo_upload`, entityType: kind === 'client' ? 'Client' : 'Vendor', entityId: id, detail: { type, bytes: file.size } });
    return { logoUrl: logoUrl(kind, id, hash), contentType: type, bytes: file.size };
  }

  private async remove(u: AuthUser, kind: Kind, id: string) {
    await this.owner(u, kind, id);
    await this.prisma.partyLogo.deleteMany({ where: { organizationId: u.organizationId, ...(kind === 'client' ? { clientId: id } : { vendorId: id }) } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: `${kind}.logo_delete`, entityType: kind === 'client' ? 'Client' : 'Vendor', entityId: id });
    return { logoUrl: null };
  }
}

@Module({ controllers: [PartyLogosController] })
export class PartyLogosModule {}
