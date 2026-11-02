import { ProjectHistoryService } from '../projects/project-history';
import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Put, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, EDITORS, Public, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { config } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { renderGatePage } from './gate-page';
import { DEFAULT_DESIGN, designOf, END_STATUSES, FONTS, PALETTES, pageDesignSchema, renderEndPage, STATUS_DEFAULTS, TEMPLATES } from './page-design';

export const MAX_ASSET_BYTES = 1_500_000;
const IMAGE_TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/gif': (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')),
};

const previewSchema = z.object({
  design: pageDesignSchema,
  page: z.enum([...END_STATUSES, 'gate'] as [string, ...string[]]),
  interstitial: z.boolean().default(false),
});

interface UploadedImage { buffer: Buffer; size: number; mimetype: string }

/** Respondent page design per project: settings, live preview and image uploads. */
@Controller()
export class PageDesignController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly history: ProjectHistoryService,
  ) {}

  private async project(u: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, organizationId: u.organizationId }, select: { id: true, pageDesign: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  @Get('projects/:id/page-design')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.project(u, id);
    return {
      design: p.pageDesign ? designOf(p.pageDesign) : DEFAULT_DESIGN,
      custom: !!p.pageDesign,
      templates: TEMPLATES,
      fonts: FONTS,
      palettes: PALETTES,
      statuses: END_STATUSES,
      defaults: STATUS_DEFAULTS,
      assetBase: `${config.publicBaseUrl}/pa/`,
    };
  }

  @Put('projects/:id/page-design')
  @Roles(...EDITORS)
  async save(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(pageDesignSchema)) design: z.infer<typeof pageDesignSchema>) {
    await this.project(u, id);
    // Images must belong to this tenant.
    const ids = [design.logoAssetId, design.heroAssetId].filter((x): x is string => !!x);
    if (ids.length) {
      const owned = await this.prisma.pageAsset.count({ where: { id: { in: ids }, organizationId: u.organizationId } });
      if (owned !== new Set(ids).size) throw new BadRequestException('Unknown image');
    }
    const before = await this.history.snapshot(id);
    await this.prisma.project.update({ where: { id }, data: { pageDesign: design as unknown as Prisma.InputJsonValue } });
    await this.history.record(u, id, before);
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'project.page-design', entityType: 'Project', entityId: id, detail: { template: design.template } });
    return this.get(u, id);
  }

  /** Renders a page exactly as respondents will see it, from an unsaved design. */
  @Post('projects/:id/page-design/preview')
  async preview(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(previewSchema)) body: z.infer<typeof previewSchema>, @Res() res: Response) {
    await this.project(u, id);
    const nonce = randomBytes(12).toString('base64');
    const html =
      body.page === 'gate'
        ? renderGatePage(
            {
              token: 'preview',
              human: { style: 'logic', kind: 'choice', question: 'Which of these is a fruit?', options: ['chair', 'mango', 'river', 'pencil'], attemptsLeft: 3 },
              captcha: null,
              collect: { languages: false, timezone: false, fingerprint: false },
              gateQuestions: [],
              prescreen: [],
              consent: null,
              design: body.design,
              base: config.publicBaseUrl,
              preview: true,
            },
            nonce,
          )
        : renderEndPage(body.design, body.page as (typeof END_STATUSES)[number], {
            base: config.publicBaseUrl,
            nonce,
            continueUrl: body.interstitial ? 'https://vendor.example.com/return' : undefined,
            seconds: body.interstitial ? body.design.interstitial.seconds : undefined,
            preview: true,
          });
    res.json({ html });
  }

  @Post('projects/:id/page-assets')
  @Roles(...EDITORS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ASSET_BYTES, files: 1 } }))
  async upload(@CurrentUser() u: AuthUser, @Param('id') id: string, @UploadedFile() file?: UploadedImage) {
    await this.project(u, id);
    if (!file) throw new BadRequestException('Choose an image (PNG, JPEG, WebP or GIF, up to 1.5 MB)');
    const type = Object.keys(IMAGE_TYPES).find((t) => IMAGE_TYPES[t](file.buffer));
    if (!type) throw new BadRequestException('Only PNG, JPEG, WebP or GIF images are allowed');
    const a = await this.prisma.pageAsset.create({ data: { organizationId: u.organizationId, projectId: id, contentType: type, size: file.size, data: new Uint8Array(file.buffer) } });
    return { id: a.id, url: `${config.publicBaseUrl}/pa/${a.id}`, contentType: type, size: file.size };
  }

  /** Public: respondent pages load these images. Type comes from the file's own bytes, never the upload. */
  @Public()
  @Get('pa/:id')
  async asset(@Param('id') id: string, @Res() res: Response) {
    const a = /^[a-z0-9]{20,40}$/.test(id) ? await this.prisma.pageAsset.findUnique({ where: { id }, select: { contentType: true, data: true } }) : null;
    if (!a) return res.status(404).end();
    res.setHeader('Content-Type', a.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.end(Buffer.from(a.data));
  }
}
