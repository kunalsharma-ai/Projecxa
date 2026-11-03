import { Body, Controller, Get, Header, Module, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { Public } from '../auth/decorators';
import { config as appConfig } from '../common/config';
import { PROVIDERS } from './captcha';
import { renderGatePage } from './gate-page';
import { ZodPipe } from '../common/zod.pipe';
import { SurveyService } from './survey.service';
import { AnswersController } from './answers.controller';
import { SecurityController } from './security.controller';
import { TorService } from './tor.service';

const s2sSchema = z.object({
  token: z.string().min(10).max(200),
  status: z.string().min(1).max(40),
  timestamp: z.number().int(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});

const GATE_COOKIE = 'pxg';
const BROWSER_COOKIE = 'pxb';

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
    const geoHeader = appConfig.geoCountryHeader ? req.headers[appConfig.geoCountryHeader] : undefined;
    const r = await this.survey.enter({ code, query, ip: req.ip, userAgent: req.headers['user-agent'], geoCountry: Array.isArray(geoHeader) ? geoHeader[0] : geoHeader });
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

  /** Respondent gate: browser checks, prescreener and start button before the client survey. */
  @Get('g/:token')
  async gate(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const r = await this.survey.gateView(token);
    if ('location' in r) return res.redirect(302, r.location);
    const secure = appConfig.publicBaseUrl.startsWith('https://');
    res.cookie(GATE_COOKIE, this.survey.gateCookieValue(token), { httpOnly: true, sameSite: 'lax', secure, path: '/g' });
    if (!req.cookies?.[BROWSER_COOKIE]) {
      res.cookie(BROWSER_COOKIE, randomBytes(18).toString('base64url'), { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 365 * 86_400_000 });
    }
    const nonce = randomBytes(16).toString('base64');
    const p = r.view.human?.kind === 'widget' ? PROVIDERS[r.view.human.style as 'turnstile' | 'hcaptcha'].csp : { script: [], frame: [], connect: [], style: [] };
    const list = (xs: string[]) => (xs.length ? ' ' + xs.join(' ') : '');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'${list(p.script)}; style-src 'nonce-${nonce}'${list(p.style)}; connect-src 'self'${list(p.connect)}; frame-src${p.frame.length ? list(p.frame) : " 'none'"}; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    );
    res.setHeader('X-Frame-Options', 'DENY');
    res.type('html').send(renderGatePage(r.view, nonce));
  }

  @Post('g/:token/human')
  async human(@Param('token') token: string, @Body() body: { answer?: unknown } | undefined, @Req() req: Request, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(await this.survey.humanCheck(token, body?.answer, req.ip));
  }

  @Get('g/:token/captcha.svg')
  async captcha(@Param('token') token: string, @Res() res: Response) {
    const svg = await this.survey.captchaImage(token);
    res.setHeader('Cache-Control', 'no-store');
    if (!svg) return res.status(404).end();
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.type('image/svg+xml').send(svg);
  }

  @Post('g/:token')
  async gateSubmit(@Param('token') token: string, @Body() body: unknown, @Req() req: Request, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const r = await this.survey.gateSubmit(token, body && typeof body === 'object' ? body : {}, { gate: req.cookies?.[GATE_COOKIE], browserId: req.cookies?.[BROWSER_COOKIE] });
    res.status(200).json(r);
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

@Module({ controllers: [SurveyPublicController, SurveyS2SController, SecurityController, AnswersController], providers: [SurveyService, TorService], exports: [SurveyService, TorService] })
export class SurveyModule {}
