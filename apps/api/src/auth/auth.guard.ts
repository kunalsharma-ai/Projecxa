import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { BLOCK_MESSAGE, ORG_FEATURES_INCLUDE, userFeatures, userGrants } from '../super-admin/entitlements';
import { featureForRoute } from '../super-admin/features';
import { config } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOW_WITHOUT_MFA, IS_PUBLIC, ROLES, STAFF } from './decorators';
import { AuthUser } from './auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Not signed in');

    let payload: { sub: string; purpose?: string; iat?: number; at?: number };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: config.jwtSecret });
    } catch {
      throw new UnauthorizedException('Session expired, sign in again');
    }
    // Only full sessions; the short-lived token between password and code is not one.
    if (payload.purpose) throw new UnauthorizedException('Finish signing in first');
    // Re-load the user so deactivation and role changes apply immediately.
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { organization: { select: { id: true, mfaRequired: true, status: true, platformOwner: true, ...ORG_FEATURES_INCLUDE } } } });
    if (!user || !user.active) throw new UnauthorizedException('Account is not active');
    // Password changed or reset, or signed out everywhere: older sessions stop working.
    // Compared in milliseconds (`at`); older tokens without it fall back to `iat` in seconds.
    const issuedAt = typeof payload.at === 'number' ? payload.at : (payload.iat ?? 0) * 1000;
    if (user.sessionsValidAfter && issuedAt <= user.sessionsValidAfter.getTime()) throw new UnauthorizedException('Session expired, sign in again');
    const superAdmin = user.superAdmin && user.organization.platformOwner;
    req.user = { id: user.id, organizationId: user.organizationId, role: user.role, email: user.email, name: user.name, ...(superAdmin ? { superAdmin: true } : {}) };

    // Default: staff only. Client/vendor portal roles must be granted explicitly per endpoint.
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets) ?? STAFF;
    if (user.role !== 'ADMIN' && !roles.includes(user.role)) {
      throw new ForbiddenException('Your role cannot do this');
    }
    // Organization requires two-step sign-in: staff without it can only reach the setup routes.
    if (user.organization.mfaRequired && !user.mfaEnabledAt && STAFF.includes(user.role) && !this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA, targets)) {
      throw new ForbiddenException({ statusCode: 403, code: 'MFA_SETUP_REQUIRED', message: 'Your organization requires two-step sign-in. Set it up to continue.' });
    }

    // Super Admin (docs/SUPER_ADMIN.md): subscription, suspension and feature switches.
    const minimal = !!this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA, targets);
    const res = ctx.switchToHttp().getResponse<Response>();
    res.setHeader('X-Features-Version', userFeatures(user.organization, user).version);
    const routePath: string = (req as Request & { route?: { path?: string } }).route?.path ?? req.path;
    const feature = featureForRoute(req.method, routePath, user.role);
    if (feature === 'super-admin') {
      if (!superAdmin) throw new ForbiddenException('Only the Super Admin can do this');
    } else {
      const g = userGrants(user.organization, user);
      // Paying for the plan (billing/) keeps working after the subscription ended, so it can be renewed.
      const billing = feature === 'billing';
      if (g.block && !minimal && !(billing && g.block === 'SUBSCRIPTION_INACTIVE')) throw new ForbiddenException({ statusCode: 403, code: g.block, message: BLOCK_MESSAGE[g.block] });
      const mobile = String(req.headers['x-client'] ?? '').toLowerCase() === 'mobile';
      if (mobile && !g.mobileEnabled && !minimal && !billing) throw new ForbiddenException({ statusCode: 403, code: 'MOBILE_DISABLED', message: 'The mobile app is not part of your access. Use PROJEXA in a web browser, or ask your admin.' });
      if (feature && !billing && !(mobile ? g.mobile : g.web).has(feature)) {
        throw new ForbiddenException({ statusCode: 403, code: 'FEATURE_DISABLED', feature, message: 'This feature is not part of your plan or was turned off for you.' });
      }
    }
    // "Last seen", written at most every 5 minutes.
    if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 300_000) {
      this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    }
    return true;
  }

  private extractToken(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return (req as Request & { cookies?: Record<string, string> }).cookies?.[config.cookieName];
  }
}
