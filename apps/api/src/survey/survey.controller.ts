import { Body, Controller, Get, Header, Module, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { SurveyService } from './survey.service';

const s2sSchema = z.object({
  token: z.string().min(10).max(200),
  status: z.string().min(1).max(40),
  timestamp: z.number().int(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});

const END_MESSAGES: Record<string, string> = {
  complete: 'Thank you for completing the survey.',
  terminate: 'Thank you for your time. You did not qualify for this survey.',
  quota_full: 'Thank you for your interest. This survey is now full.',
  quality_fail: 'Thank you for your time.',
  duplicate: 'It looks like you have already taken part in this survey.',
  security_reject: 'This survey link is not valid.',
  partial: 'Thank you for your time.',
  technical_error: 'Sorry, something went wrong. Please try again later.',
};

/** Public respondent-facing endpoints (no login). Mounted outside the /api/v1 prefix. */
@Controller()
@Public()
export class SurveyPublicController {
  constructor(private readonly survey: SurveyService) {}

  @Get('s/:code')
  async enter(@Param('code') code: string, @Query() query: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const r = await this.survey.enter({ code, query, ip: req.ip, userAgent: req.headers['user-agent'] });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.redirect(302, r.location);
  }

  @Get('r/:status')
  async outcome(@Param('status') status: string, @Query('token') token: string | undefined, @Query('rid') rid: string | undefined, @Res() res: Response) {
    const r = await this.survey.browserOutcome(status, token ?? rid);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.redirect(302, r.location);
  }

  @Get('end/:status')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  end(@Param('status') status: string) {
    const msg = END_MESSAGES[status] ?? 'Thank you for your time.';
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Survey</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f7fb;color:#1f2937}main{max-width:28rem;padding:2rem;text-align:center}</style>
</head><body><main><h1 style="font-size:1.25rem">${msg}</h1><p style="color:#6b7280">You can close this window.</p></main></body></html>`;
  }
}

/** Server-to-server outcome confirmation from client survey platforms (HMAC signed). */
@Controller('s2s')
@Public()
export class SurveyS2SController {
  constructor(private readonly survey: SurveyService) {}

  @Post('outcome')
  async outcome(@Body(new ZodPipe(s2sSchema)) body: z.infer<typeof s2sSchema>, @Res() res: Response) {
    const r = await this.survey.s2sOutcome(body);
    return res.status(r.httpStatus).json(r.body);
  }
}

@Module({ controllers: [SurveyPublicController, SurveyS2SController], providers: [SurveyService], exports: [SurveyService] })
export class SurveyModule {}
