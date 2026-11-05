import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Organization, User } from '@prisma/client';
import { Response } from 'express';
import { config } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';
import { BLOCK_MESSAGE } from '../super-admin/entitlements';

/** Cookie that carries the in-between token when sign-in came back from Google, Microsoft or Zoho. */
export const MFA_COOKIE = 'projexa_mfa';
/** The short-lived token between the first step and the code uses its own key, so it can never pass as a session. */
const mfaTokenSecret = () => `${config.jwtSecret}:mfa-step`;
const secure = () => process.env.NODE_ENV === 'production';

export const homeOf = (role: string) => (role === 'CLIENT_USER' ? '/portal/client' : role === 'VENDOR_USER' ? '/portal/vendor' : '/');

@Injectable()
export class SessionService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async start(user: User & { organization: Organization }, res: Response) {
    // Super Admin: organisations waiting for approval or paused cannot sign in (docs/SUPER_ADMIN.md).
    if (!user.organization.platformOwner && user.organization.status !== 'ACTIVE') {
      throw new UnauthorizedException(user.organization.status === 'PENDING' ? BLOCK_MESSAGE.ORG_PENDING : BLOCK_MESSAGE.ORG_SUSPENDED);
    }
    const token = await this.jwt.signAsync({ sub: user.id, org: user.organizationId }, { secret: config.jwtSecret, expiresIn: '12h' });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    // Super Admin → Activity shows sign-ins too.
    await this.prisma.auditEvent.create({ data: { organizationId: user.organizationId, actorId: user.id, action: 'auth.sign_in', entityType: 'User', entityId: user.id } });
    res.cookie(config.cookieName, token, { httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 12 * 3600 * 1000, path: '/' });
    res.clearCookie(MFA_COOKIE, { path: '/' });
    return {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      home: homeOf(user.role),
      organization: { id: user.organization.id, name: user.organization.name, slug: user.organization.slug },
    };
  }

  mfaToken(userId: string) {
    return this.jwt.signAsync({ sub: userId, purpose: 'mfa' }, { secret: mfaTokenSecret(), expiresIn: '5m' });
  }

  /** For SSO: the code step continues on the sign-in page, which sends this cookie back. */
  setMfaCookie(res: Response, token: string) {
    res.cookie(MFA_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secure(), maxAge: 5 * 60 * 1000, path: '/' });
  }

  async readMfaToken(token: string | undefined): Promise<string> {
    try {
      if (!token) throw new Error('missing');
      const p = await this.jwt.verifyAsync<{ sub: string; purpose?: string }>(token, { secret: mfaTokenSecret() });
      if (p.purpose !== 'mfa') throw new Error('wrong token');
      return p.sub;
    } catch {
      throw new UnauthorizedException('This sign-in took too long. Sign in again.');
    }
  }
}
