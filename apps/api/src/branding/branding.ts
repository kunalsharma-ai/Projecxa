/**
 * White-label (docs/WHITE_LABEL.md): each organisation's product name, logo, icon, colours,
 * email sender name and custom web domain. No plans or billing.
 *
 * Logos and icons are public (sign-in pages and emails show them), so only raster images are
 * accepted (PNG, JPEG, WebP), checked by their bytes, and served with a locked-down CSP.
 */
import { promises as dns } from 'dns';
import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Global, HttpCode, Injectable, Module, NotFoundException, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Organization, Prisma } from '@prisma/client';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { THEME_IDS } from '../auth/preferences';
import { config } from '../common/config';
import { randomToken, sha256 } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_APP_NAME = 'PROJEXA';
export const ASSET_KINDS = ['logo', 'logoDark', 'icon'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];
export const MAX_ASSET_BYTES = 512 * 1024;

const plain = (max: number) => z.string().trim().max(max).regex(/^[^<>"\r\n]*$/, 'Avoid < > " and line breaks').nullable().default(null);
export const brandingSchema = z
  .object({
    appName: z.string().trim().min(2, 'Use at least 2 characters').max(40).regex(/^[^<>"\r\n]*$/, 'Avoid < > " and line breaks').nullable().default(null),
    tagline: plain(80),
    brandColor: z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a #rrggbb colour').nullable().default(null),
    theme: z.enum(THEME_IDS).nullable().default(null),
    hidePoweredBy: z.boolean().default(false),
    supportEmail: z.string().trim().email().max(200).nullable().default(null),
    emailFromName: plain(60),
    emailReplyTo: z.string().trim().email().max(200).nullable().default(null),
    loginMessage: z.string().trim().max(300).nullable().default(null),
  })
  .strict();
export type Branding = z.infer<typeof brandingSchema>;

export function brandingOf(v: unknown): Branding {
  const r = brandingSchema.safeParse(v ?? {});
  return r.success ? r.data : brandingSchema.parse({});
}

const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const domainSchema = z.object({ domain: z.string().trim().toLowerCase().transform((d) => d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '')).pipe(z.string().regex(HOST, 'Enter a hostname like research.example.com')) }).strict();

/** Strips the port and lowercases a Host header value. */
export const hostnameOf = (host: string | undefined) => (host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');

type OrgForBrand = Pick<Organization, 'name' | 'slug' | 'branding' | 'customDomain' | 'customDomainVerifiedAt'>;

/** Everything other code needs to show the organisation's brand. */
export interface Brand {
  appName: string;
  /** True when the organisation set its own product name. */
  custom: boolean;
  tagline: string | null;
  brandColor: string | null;
  theme: string | null;
  hidePoweredBy: boolean;
  supportEmail: string | null;
  loginMessage: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  iconUrl: string | null;
  /** Web address for links in emails: the verified custom domain, else the default app address. */
  webBase: string;
  /** For emails: sender display name and reply-to. */
  emailFromName: string | null;
  emailReplyTo: string | null;
}

export function webBaseOf(o: Pick<Organization, 'customDomain' | 'customDomainVerifiedAt'>) {
  if (o.customDomain && o.customDomainVerifiedAt) return `${process.env.NODE_ENV === 'production' || !/^(localhost|127\.|\d+\.\d+\.\d+\.\d+$)/.test(o.customDomain) ? 'https' : 'http'}://${o.customDomain}`;
  return config.webOrigins[0] ?? '';
}

export function brandOf(o: OrgForBrand, assets: { kind: string; hash: string }[] = []): Brand {
  const b = brandingOf(o.branding);
  const url = (k: AssetKind) => {
    const a = assets.find((x) => x.kind === k);
    return a ? `${config.publicBaseUrl}/api/v1/public/branding/${encodeURIComponent(o.slug)}/${k}?v=${a.hash.slice(0, 12)}` : null;
  };
  return {
    appName: b.appName ?? DEFAULT_APP_NAME,
    custom: !!b.appName,
    tagline: b.tagline,
    brandColor: b.brandColor,
    theme: b.theme,
    hidePoweredBy: b.hidePoweredBy,
    supportEmail: b.supportEmail,
    loginMessage: b.loginMessage,
    logoUrl: url('logo'),
    logoDarkUrl: url('logoDark'),
    iconUrl: url('icon'),
    webBase: webBaseOf(o),
    emailFromName: b.emailFromName ?? (b.appName ? `${b.appName}` : null),
    emailReplyTo: b.emailReplyTo,
  };
}

const escHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Top line of an email: the logo, or the product name in small capitals. */
export function emailHeader(b: Brand, color = '#1d4ed8') {
  if (b.logoUrl) return `<p style="margin:0 0 16px"><img src="${escHtml(b.logoUrl)}" alt="${escHtml(b.appName)}" height="32" style="height:32px;max-width:200px;border:0"></p>`;
  return `<p style="font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:${b.brandColor ?? color};font-weight:600">${escHtml(b.custom ? b.appName : 'Sampledge · PROJEXA')}</p>`;
}

/** The image type from its first bytes, or null when it is not a PNG, JPEG or WebP. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** Width and height of a PNG (from its header), else null. */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  return sniffImage(buf) === 'image/png' && buf.length >= 24 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
}

@Injectable()
export class BrandingService {
  /** DNS TXT lookup; swapped in tests. */
  resolveTxt: (name: string) => Promise<string[][]> = (n) => dns.resolveTxt(n);

  constructor(private readonly prisma: PrismaService) {}

  async brand(organizationId: string): Promise<Brand> {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, slug: true, branding: true, customDomain: true, customDomainVerifiedAt: true, brandAssets: { select: { kind: true, hash: true } } } });
    return brandOf(o, o.brandAssets);
  }

  /** The organisation whose verified custom domain is this host, if any. */
  async byHost(host: string) {
    const h = hostnameOf(host);
    if (!h) return null;
    return this.prisma.organization.findFirst({ where: { customDomain: h, customDomainVerifiedAt: { not: null } }, select: { id: true, name: true, slug: true, branding: true, customDomain: true, customDomainVerifiedAt: true, brandAssets: { select: { kind: true, hash: true } } } });
  }

  /** The TXT record an admin adds to prove they control the domain. */
  record(o: Pick<Organization, 'customDomain' | 'customDomainToken'>) {
    return o.customDomain && o.customDomainToken ? { type: 'TXT', name: `_projexa.${o.customDomain}`, value: `projexa-verify=${o.customDomainToken}` } : null;
  }
}

/** Branding as the browser sees it (public: no secrets, no ids). */
const publicView = (o: OrgForBrand, b: Brand) => ({
  organization: { name: o.name, slug: o.slug },
  appName: b.appName, custom: b.custom, tagline: b.tagline, brandColor: b.brandColor, theme: b.theme, hidePoweredBy: b.hidePoweredBy,
  supportEmail: b.supportEmail, loginMessage: b.loginMessage, logoUrl: b.logoUrl, logoDarkUrl: b.logoDarkUrl, iconUrl: b.iconUrl,
});

@Controller('public/branding')
export class PublicBrandingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branding: BrandingService,
  ) {}

  /** Sign-in pages ask with their own host; a verified custom domain gets that organisation's brand. */
  @Get()
  @Public()
  async byHost(@Query('host') host?: string) {
    const o = host ? await this.branding.byHost(host) : null;
    if (!o) return { default: true, appName: DEFAULT_APP_NAME, organization: null };
    return { default: false, ...publicView(o, brandOf(o, o.brandAssets)) };
  }

  @Get(':slug/:kind')
  @Public()
  async asset(@Param('slug') slug: string, @Param('kind') kind: string, @Res() res: Response) {
    if (!(ASSET_KINDS as readonly string[]).includes(kind)) throw new NotFoundException();
    const a = await this.prisma.brandAsset.findFirst({ where: { kind, organization: { slug } } });
    if (!a) throw new NotFoundException();
    res.setHeader('Content-Type', a.contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('ETag', `"${a.hash.slice(0, 32)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(Buffer.from(a.data));
  }
}

@Controller('branding')
export class BrandingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branding: BrandingService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async get(@CurrentUser() u: AuthUser) {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId }, include: { brandAssets: { select: { kind: true, hash: true, contentType: true, updatedAt: true, data: false } } } });
    const brand = brandOf(o, o.brandAssets);
    return {
      branding: brandingOf(o.branding),
      brand: publicView(o, brand),
      assets: Object.fromEntries(ASSET_KINDS.map((k) => [k, brand[`${k}Url` as 'logoUrl']])),
      maxAssetBytes: MAX_ASSET_BYTES,
      domain: o.customDomain
        ? { name: o.customDomain, verified: !!o.customDomainVerifiedAt, verifiedAt: o.customDomainVerifiedAt, record: this.branding.record(o), cname: new URL(config.webOrigins[0] ?? 'http://localhost').hostname }
        : null,
      webBase: brand.webBase,
    };
  }

  @Put()
  @Roles('ADMIN')
  async set(@CurrentUser() u: AuthUser, @Body(new ZodPipe(brandingSchema)) b: Branding) {
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { branding: b as unknown as Prisma.InputJsonValue } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'branding.update', entityType: 'Organization', entityId: u.organizationId, detail: b });
    return this.get(u);
  }

  @Post('assets/:kind')
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ASSET_BYTES + 1, files: 1 } }))
  async upload(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @UploadedFile() file?: { buffer: Buffer; size: number }) {
    if (!(ASSET_KINDS as readonly string[]).includes(kind)) throw new NotFoundException('Unknown image');
    if (!file?.buffer?.length) throw new BadRequestException('Choose an image file');
    if (file.size > MAX_ASSET_BYTES) throw new BadRequestException(`Use an image under ${MAX_ASSET_BYTES / 1024} KB`);
    const type = sniffImage(file.buffer);
    if (!type) throw new BadRequestException('Use a PNG, JPEG or WebP image');
    const size = pngSize(file.buffer);
    if (kind === 'icon' && size && size.width !== size.height) throw new BadRequestException('The icon must be square, for example 256 × 256');
    const hash = sha256(file.buffer.toString('base64'));
    const data = new Uint8Array(file.buffer);
    await this.prisma.brandAsset.upsert({
      where: { organizationId_kind: { organizationId: u.organizationId, kind } },
      create: { organizationId: u.organizationId, kind, contentType: type, data, hash },
      update: { contentType: type, data, hash },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'branding.asset_upload', entityType: 'Organization', entityId: u.organizationId, detail: { kind, type, bytes: file.size } });
    return this.get(u);
  }

  @Delete('assets/:kind')
  @Roles('ADMIN')
  async removeAsset(@CurrentUser() u: AuthUser, @Param('kind') kind: string) {
    await this.prisma.brandAsset.deleteMany({ where: { organizationId: u.organizationId, kind } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'branding.asset_delete', entityType: 'Organization', entityId: u.organizationId, detail: { kind } });
    return this.get(u);
  }

  @Put('domain')
  @Roles('ADMIN')
  async setDomain(@CurrentUser() u: AuthUser, @Body(new ZodPipe(domainSchema)) b: z.infer<typeof domainSchema>) {
    const own = [config.publicHost, ...config.webOrigins.map((w) => new URL(w).host)].map(hostnameOf);
    if (own.includes(b.domain)) throw new BadRequestException('That is the main app address. Use a domain of your own.');
    const taken = await this.prisma.organization.findFirst({ where: { customDomain: b.domain, id: { not: u.organizationId } }, select: { id: true } });
    if (taken) throw new ConflictException('Another organisation already uses that domain');
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { customDomain: b.domain, customDomainToken: randomToken(16), customDomainVerifiedAt: null } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'branding.domain_set', entityType: 'Organization', entityId: u.organizationId, detail: { domain: b.domain } });
    return this.get(u);
  }

  /** Looks up the TXT record. The domain is used only after this succeeds. */
  @Post('domain/verify')
  @Roles('ADMIN')
  @HttpCode(200)
  async verify(@CurrentUser() u: AuthUser) {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: u.organizationId } });
    const rec = this.branding.record(o);
    if (!rec) throw new BadRequestException('Add a domain first');
    let found: string[] = [];
    try {
      found = (await this.branding.resolveTxt(rec.name)).map((parts) => parts.join(''));
    } catch {
      found = [];
    }
    const ok = found.includes(rec.value);
    if (ok && !o.customDomainVerifiedAt) {
      await this.prisma.organization.update({ where: { id: o.id }, data: { customDomainVerifiedAt: new Date() } });
      await this.audit.record({ organizationId: o.id, actorId: u.id, action: 'branding.domain_verified', entityType: 'Organization', entityId: o.id, detail: { domain: o.customDomain } });
    }
    return { verified: ok || !!o.customDomainVerifiedAt, found: found.filter((f) => f.startsWith('projexa-verify=')).length, ...(await this.get(u)) };
  }

  @Delete('domain')
  @Roles('ADMIN')
  async removeDomain(@CurrentUser() u: AuthUser) {
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { customDomain: null, customDomainToken: null, customDomainVerifiedAt: null } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'branding.domain_removed', entityType: 'Organization', entityId: u.organizationId });
    return this.get(u);
  }
}

@Global()
@Module({ controllers: [PublicBrandingController, BrandingController], providers: [BrandingService], exports: [BrandingService] })
export class BrandingModule {}
