import { IntegrationsService } from '../integrations/integrations.service';
import { BrandingService } from '../branding/branding';
import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AllowWithoutMfa, CurrentUser, Public, Roles } from './decorators';
import { MfaService, secondFactorSchema } from './mfa.service';
import { MFA_COOKIE, SessionService } from './session.service';
import { AuthUser } from './auth.types';
import { Preferences, preferencesSchema, readPreferences } from './preferences';
import { TOUR_VERSION, TourUpdate, tourState, tourUpdateSchema } from './tour';

const loginSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(1),
  organization: z.string().optional(),
});

const mfaLoginSchema = z.object({ mfaToken: z.string().min(10).max(2000).optional() }).and(secondFactorSchema);

/** The organization signs staff in with Google, Microsoft or Zoho only (admins keep their password as a way back in). */
export function passwordBlocked(user: { role: string; organization: { ssoConfig: unknown } }) {
  const c = (user.organization.ssoConfig ?? {}) as { ssoOnly?: boolean };
  return !!c.ssoOnly && ['PROJECT_MANAGER', 'SALES', 'VIEWER'].includes(user.role);
}

@Controller('auth')
@AllowWithoutMfa()
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly session: SessionService,
    private readonly mfa: MfaService,
    private readonly branding: BrandingService,
    private readonly integrations: IntegrationsService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    const users = await this.prisma.user.findMany({
      where: { email: body.email, active: true, ...(body.organization ? { organization: { slug: body.organization } } : {}) },
      include: { organization: true },
    });
    // Same email in several tenants requires the organization slug.
    if (users.length > 1) throw new UnauthorizedException('Enter your organization to sign in');
    const user = users[0];
    const ok = user ? await bcrypt.compare(body.password, user.passwordHash) : await bcrypt.compare(body.password, DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedException('Wrong email or password');
    if (passwordBlocked(user)) throw new UnauthorizedException('Your organization signs in with Google, Microsoft or Zoho. Use the buttons below.');

    // Two-step sign-in: no session yet, only a 5-minute token to send with the code.
    if (user.mfaEnabledAt) return { mfaRequired: true, mfaToken: await this.session.mfaToken(user.id) };
    return this.session.start(user, res);
  }

  /** Second step of sign-in: the code from the authenticator app, or a recovery code. The token comes in the body, or in a cookie after single sign-on. */
  @Public()
  @Post('login/mfa')
  @HttpCode(200)
  async loginMfa(@Body(new ZodPipe(mfaLoginSchema)) body: z.infer<typeof mfaLoginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sub = await this.session.readMfaToken(body.mfaToken ?? (req as Request & { cookies?: Record<string, string> }).cookies?.[MFA_COOKIE]);
    const user = await this.prisma.user.findUnique({ where: { id: sub }, include: { organization: true } });
    if (!user || !user.active) throw new UnauthorizedException('Account is not active');
    const used = await this.mfa.verify(user, body);
    const out = await this.session.start(user, res);
    return used === 'recovery' ? { ...out, recoveryCodesLeft: (await this.mfa.status(user.id)).recoveryCodesLeft } : out;
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(config.cookieName, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER', 'CLIENT_USER', 'VENDOR_USER')
  async me(@CurrentUser() user: AuthUser) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    const links = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { preferences: true, tourVersion: true, tourOutcome: true, tourAt: true, client: { select: { id: true, name: true } }, vendor: { select: { id: true, name: true } } },
    });
    return {
      user,
      organization: { id: org.id, name: org.name, slug: org.slug },
      branding: await this.branding.brand(org.id),
      client: links.client,
      vendor: links.vendor,
      preferences: readPreferences(links.preferences),
      mfa: await this.mfa.status(user.id),
      /** Product tour after sign-in (docs/PRODUCT_TOUR.md). */
      tour: tourState(links),
      /** Links set in Settings → Integrations (staff only). */
      links: { bidzoUrl: user.role === 'CLIENT_USER' || user.role === 'VENDOR_USER' ? null : await this.integrations.bidzoUrl(org.id) },
    };
  }

  /** Merge a partial update into the caller's own interface preferences. */
  @Patch('me/preferences')
  @Roles('ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER', 'CLIENT_USER', 'VENDOR_USER')
  async updatePreferences(@CurrentUser() user: AuthUser, @Body(new ZodPipe(preferencesSchema)) body: Preferences) {
    const current = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { preferences: true } });
    const next = { ...readPreferences(current.preferences), ...body };
    await this.prisma.user.update({ where: { id: user.id }, data: { preferences: next as Prisma.InputJsonValue } });
    return next;
  }

  /** Remember that the caller finished or skipped the product tour, or ask to see it again. Kept apart from preferences so resetting the look does not replay it. */
  @Post('me/tour')
  @HttpCode(200)
  @Roles('ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER', 'CLIENT_USER', 'VENDOR_USER')
  async updateTour(@CurrentUser() user: AuthUser, @Body(new ZodPipe(tourUpdateSchema)) body: TourUpdate) {
    const data =
      body.outcome === 'reset'
        ? { tourVersion: null, tourOutcome: null, tourAt: null }
        : { tourVersion: TOUR_VERSION, tourOutcome: body.outcome, tourAt: new Date() };
    const u = await this.prisma.user.update({ where: { id: user.id }, data, select: { tourVersion: true, tourOutcome: true, tourAt: true } });
    return tourState(u);
  }

  /** Back to the defaults. */
  @Post('me/preferences/reset')
  @HttpCode(200)
  @Roles('ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER', 'CLIENT_USER', 'VENDOR_USER')
  async resetPreferences(@CurrentUser() user: AuthUser) {
    await this.prisma.user.update({ where: { id: user.id }, data: { preferences: Prisma.DbNull } });
    return {};
  }
}

// Constant-time-ish response when the user does not exist.
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.Gz6t9Pp6cXJ5V0n2o0Lw9nV9Wf6K';
