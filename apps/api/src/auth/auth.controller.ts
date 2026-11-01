import { Body, Controller, Get, HttpCode, Post, Res, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Response } from 'express';
import { z } from 'zod';
import { config } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, Public, Roles } from './decorators';
import { AuthUser } from './auth.types';

const loginSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(1),
  organization: z.string().optional(),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

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
    return { user, organization: { id: org.id, name: org.name, slug: org.slug } };
  }
}

// Constant-time-ish response when the user does not exist.
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.Gz6t9Pp6cXJ5V0n2o0Lw9nV9Wf6K';
