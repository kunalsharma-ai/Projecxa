import { BadRequestException, Body, Controller, Delete, Get, Module, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { randomToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { redirectSigningSecret } from './redirect-api';
import { ZodPipe } from '../common/zod.pipe';
import { OUTCOME_STATUSES, redirectConfigSchema, REDIRECT_MODES } from './redirect.types';
import { RedirectsService } from './redirects.service';

const draftSchema = z.object({
  mode: z.enum(REDIRECT_MODES),
  config: redirectConfigSchema,
  changeReason: z.string().max(500).optional(),
});
const simulateSchema = z.object({
  status: z.enum(OUTCOME_STATUSES),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  vendorId: z.string().min(1),
  uid: z.string().max(200).optional(),
  versionId: z.string().optional(),
  mode: z.enum(REDIRECT_MODES).optional(),
  config: redirectConfigSchema.optional(),
});
const scheduleSchema = z.object({ at: z.coerce.date() });
const rollbackSchema = z.object({ versionId: z.string().min(1), reason: z.string().max(500).optional() });

@Controller('projects/:projectId/redirects')
export class RedirectsController {
  constructor(private readonly redirects: RedirectsService) {}

  @Get()
  get(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string) {
    return this.redirects.getPolicy(u, projectId);
  }

  @Get('effective')
  effective(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Query('versionId') versionId?: string) {
    return this.redirects.effectiveMatrix(u, projectId, versionId);
  }

  @Post('versions')
  @Roles(...EDITORS)
  saveDraft(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Body(new ZodPipe(draftSchema)) body: z.infer<typeof draftSchema>) {
    return this.redirects.saveDraft(u, projectId, body);
  }

  @Post('versions/:versionId/activate')
  @Roles(...EDITORS)
  activate(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Param('versionId') versionId: string) {
    return this.redirects.activate(u, projectId, versionId);
  }

  @Post('versions/:versionId/schedule')
  @Roles(...EDITORS)
  schedule(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Param('versionId') versionId: string, @Body(new ZodPipe(scheduleSchema)) body: z.infer<typeof scheduleSchema>) {
    return this.redirects.schedule(u, projectId, versionId, body.at);
  }

  @Delete('versions/:versionId/schedule')
  @Roles(...EDITORS)
  cancelSchedule(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Param('versionId') versionId: string) {
    return this.redirects.cancelSchedule(u, projectId, versionId);
  }

  @Get('compare')
  compare(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Query('from') from?: string, @Query('to') to?: string) {
    if (!from || !to) throw new BadRequestException('Pass from and to version ids');
    return this.redirects.compare(u, projectId, from, to);
  }

  @Post('rollback')
  @Roles(...EDITORS)
  rollback(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Body(new ZodPipe(rollbackSchema)) body: z.infer<typeof rollbackSchema>) {
    return this.redirects.rollback(u, projectId, body.versionId, body.reason);
  }

  @Post('simulate')
  simulate(@CurrentUser() u: AuthUser, @Param('projectId') projectId: string, @Body(new ZodPipe(simulateSchema)) body: z.infer<typeof simulateSchema>) {
    return this.redirects.simulate(u, projectId, body);
  }
}

/** The secret API destination endpoints use to check that a request came from PROJEXA. Admins only. */
@Controller('organization/redirect-signing-secret')
@Roles('ADMIN')
export class RedirectSecretController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  async get(@CurrentUser() u: AuthUser) {
    return { secret: await redirectSigningSecret(this.prisma, u.organizationId) };
  }

  @Post('rotate')
  async rotate(@CurrentUser() u: AuthUser) {
    const secret = `rss_${randomToken(32)}`;
    await this.prisma.organization.update({ where: { id: u.organizationId }, data: { redirectSigningSecret: secret } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'redirect.signing-secret-rotate', entityType: 'Organization', entityId: u.organizationId, detail: {} });
    return { secret };
  }
}

@Module({ controllers: [RedirectsController, RedirectSecretController], providers: [RedirectsService], exports: [RedirectsService] })
export class RedirectsModule {}
