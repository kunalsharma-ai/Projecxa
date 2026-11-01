import { Body, Controller, Get, HttpCode, Patch, Post, Res, UnauthorizedException } from '@nestjs/common';
import { Organization, Prisma, User } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Response } from 'express';
import { z } from 'zod';
import { config } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { AllowWithoutMfa, CurrentUser, Public, Roles } from './decorators';
import { MfaService, secondFactorSchema } from './mfa.service';
import { AuthUser } from './auth.types';
import { Preferences, preferencesSchema, readPreferences } from './preferences';

const loginSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(1),
  organization: z.string().optional(),
});

const mfaLoginSchema = z.object({ mfaToken: z.string().min(10).max(2000) }).and(secondFactorSchema);
/** The short-lived token between the password and the code uses its own key, so it can never pass as a session. */
const mfaTokenSecret = () => `${config.jwtSecret}:mfa-step`;

@Controller('auth')
@AllowWithoutMfa()
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mfa: MfaService,
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

    // Two-step sign-in: no session yet, only a 5-minute token to send with the code.
    if (user.mfaEnabledAt) {
      const mfaToken = await this.jwt.signAsync({ sub: user.id, purpose: 'mfa' }, { secret: mfaTokenSecret(), expiresIn: '5m' });
      return { mfaRequired: true, mfaToken };
    }
    return this.startSession(user, res);
  }

  /** Second step of sign-in: the code from the authenticator app, or a recovery code. */
  @Public()
  @Post('login/mfa')
  @HttpCode(200)
  async loginMfa(@Body(new ZodPipe(mfaLoginSchema)) body: z.infer<typeof mfaLoginSchema>, @Res({ passthrough: true }) res: Response) {
    let sub: string;
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; purpose?: string }>(body.mfaToken, { secret: mfaTokenSecret() });
      if (p.purpose !== 'mfa') throw new Error('wrong token');
      sub = p.sub;
    } catch {
      throw new UnauthorizedException('This sign-in took too long. Enter your email and password again.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: sub }, include: { organization: true } });
    if (!user || !user.active) throw new UnauthorizedException('Account is not active');
    const used = await this.mfa.verify(user, body);
    const out = await this.startSession(user, res);
    return used === 'recovery' ? { ...out, recoveryCodesLeft: (await this.mfa.status(user.id)).recoveryCodesLeft } : out;
  }

  private async startSession(user: User & { organization: Organization }, res: Response) {
    const token = await this.jwt.signAsync({ sub: user.id, org: user.organizationId }, { secret: config.jwtSecret, expiresIn: '12h' });
    res.cookie(config.cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 3600 * 1000,
      path: '/',
    });
    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      home: user.role === 'CLIENT_USER' ? '/portal/client' : user.role === 'VENDOR_USER' ? '/portal/vendor' : '/',
      organization: { id: user.organization.id, name: user.organization.name, slug: user.organization.slug },
    };
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
      select: { preferences: true, client: { select: { id: true, name: true } }, vendor: { select: { id: true, name: true } } },
    });
    return {
      user,
      organization: { id: org.id, name: org.name, slug: org.slug },
      client: links.client,
      vendor: links.vendor,
      preferences: readPreferences(links.preferences),
      mfa: await this.mfa.status(user.id),
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
