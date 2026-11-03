import { VendorsModule } from '../vendors/vendors.controller';
import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { FinanceModule } from '../finance/finance.controller';
import { MonitorModule } from '../monitor/monitor.controller';
import { ProjectsModule } from '../projects/projects.controller';
import { ReportsModule } from '../reports/reports.controller';
import { TasksModule } from '../tasks/tasks.service';
import { aiSettingsSchema, AiService, chatSchema, MAX_DOC_BYTES, voiceSessionSchema, voiceToolSchema, voiceTurnSchema } from './ai.service';

/** AI copilot and voice (docs/AI_COPILOT.md). Staff only; the organisation's AI settings decide who. */
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  status(@CurrentUser() u: AuthUser) {
    return this.ai.status(u);
  }

  @Put('settings')
  @Roles('ADMIN')
  save(@CurrentUser() u: AuthUser, @Body(new ZodPipe(aiSettingsSchema)) b: z.infer<typeof aiSettingsSchema>) {
    return this.ai.saveSettings(u, b);
  }

  @Get('usage')
  @Roles('ADMIN')
  usage(@CurrentUser() u: AuthUser) {
    return this.ai.usageReport(u.organizationId);
  }

  @Post('chat')
  @HttpCode(200)
  chat(@CurrentUser() u: AuthUser, @Body(new ZodPipe(chatSchema)) b: z.infer<typeof chatSchema>) {
    return this.ai.chat(u, b);
  }

  @Get('conversations')
  conversations(@CurrentUser() u: AuthUser) {
    return this.ai.conversations(u);
  }

  @Get('conversations/:id')
  conversation(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.ai.getConversation(u, id);
  }

  @Delete('conversations/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.ai.deleteConversation(u, id);
  }

  @Post('actions/:id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.ai.decide(u, id, true);
  }

  @Post('actions/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.ai.decide(u, id, false);
  }

  @Get('documents')
  documents(@CurrentUser() u: AuthUser) {
    return this.ai.documents(u);
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOC_BYTES + 1, files: 1 } }))
  upload(@CurrentUser() u: AuthUser, @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer }) {
    return this.ai.upload(u, file);
  }

  /** Read a brief (file or pasted text) into a Create project draft. */
  @Post('brief')
  @Roles(...EDITORS)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOC_BYTES + 1, files: 1, fieldSize: 200_000 } }))
  brief(@CurrentUser() u: AuthUser, @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer }, @Body() body?: { text?: unknown }) {
    return this.ai.brief(u, { file, text: typeof body?.text === 'string' ? body.text : undefined });
  }

  @Delete('documents/:id')
  deleteDocument(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.ai.deleteDocument(u, id);
  }

  @Post('voice/session')
  @HttpCode(200)
  voice(@CurrentUser() u: AuthUser, @Body(new ZodPipe(voiceSessionSchema)) b: z.infer<typeof voiceSessionSchema>) {
    return this.ai.voiceSession(u, b);
  }

  @Post('voice/tool')
  @HttpCode(200)
  voiceTool(@CurrentUser() u: AuthUser, @Body(new ZodPipe(voiceToolSchema)) b: z.infer<typeof voiceToolSchema>) {
    return this.ai.voiceTool(u, b);
  }

  @Post('voice/turn')
  @HttpCode(200)
  voiceTurn(@CurrentUser() u: AuthUser, @Body(new ZodPipe(voiceTurnSchema)) b: z.infer<typeof voiceTurnSchema>) {
    return this.ai.voiceTurn(u, b);
  }
}

@Module({ imports: [ProjectsModule, MonitorModule, ReportsModule, FinanceModule, TasksModule, VendorsModule], controllers: [AiController], providers: [AiService], exports: [AiService] })
export class AiModule {}
