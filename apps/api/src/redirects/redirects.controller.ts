import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
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

@Module({ controllers: [RedirectsController], providers: [RedirectsService], exports: [RedirectsService] })
export class RedirectsModule {}
