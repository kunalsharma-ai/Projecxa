import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Put, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { BackupsService } from './backups.service';

const settingsSchema = z.object({
  schedule: z.enum(['off', 'daily', 'weekly']).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
  keep: z.number().int().min(1).max(365).optional(),
  notifyOnFailure: z.boolean().optional(),
}).strict();
const restoreSchema = z.object({ confirm: z.string().max(40), password: z.string().min(1).max(200) }).strict();

/** Super Admin → Backups (docs/BACKUPS.md). Every super-admin/ route needs the Super Admin (auth.guard.ts). */
@Controller('super-admin/backups')
@Roles('ADMIN')
export class BackupsController {
  constructor(private readonly svc: BackupsService) {}

  @Get() overview() { return this.svc.overview(); }
  @Put('settings') save(@CurrentUser() u: AuthUser, @Body(new ZodPipe(settingsSchema)) b: z.infer<typeof settingsSchema>) { return this.svc.saveSettings(u, b); }
  @Post() @HttpCode(202) start(@CurrentUser() u: AuthUser) { return this.svc.start(u, 'manual'); }
  @Post('rescan') @HttpCode(200) rescan(@CurrentUser() u: AuthUser) { return this.svc.rescan(u); }
  @Post(':id/verify') @HttpCode(200) verify(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.verify(u, id); }
  @Post(':id/restore') @HttpCode(202) restore(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(restoreSchema)) b: z.infer<typeof restoreSchema>) { return this.svc.restore(u, id, b); }
  @Delete(':id') remove(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.remove(u, id); }

  @Get(':id/download')
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query('plain') plain: string | undefined, @Res() res: Response) {
    const f = await this.svc.download(u, id, plain === '1');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(f.size));
    res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`);
    res.setHeader('Cache-Control', 'no-store');
    f.stream.pipe(res);
  }
}

@Module({ providers: [BackupsService], controllers: [BackupsController], exports: [BackupsService] })
export class BackupsModule {}
