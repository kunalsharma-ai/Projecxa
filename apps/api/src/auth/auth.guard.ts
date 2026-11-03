import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Request } from 'express';
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

    let payload: { sub: string; purpose?: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: config.jwtSecret });
    } catch {
      throw new UnauthorizedException('Session expired, sign in again');
    }
    // Only full sessions; the short-lived token between password and code is not one.
    if (payload.purpose) throw new UnauthorizedException('Finish signing in first');
    // Re-load the user so deactivation and role changes apply immediately.
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, include: { organization: { select: { mfaRequired: true } } } });
    if (!user || !user.active) throw new UnauthorizedException('Account is not active');
    req.user = { id: user.id, organizationId: user.organizationId, role: user.role, email: user.email, name: user.name };

    // Default: staff only. Client/vendor portal roles must be granted explicitly per endpoint.
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets) ?? STAFF;
    if (user.role !== 'ADMIN' && !roles.includes(user.role)) {
      throw new ForbiddenException('Your role cannot do this');
    }
    // Organization requires two-step sign-in: staff without it can only reach the setup routes.
    if (user.organization.mfaRequired && !user.mfaEnabledAt && STAFF.includes(user.role) && !this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_MFA, targets)) {
      throw new ForbiddenException({ statusCode: 403, code: 'MFA_SETUP_REQUIRED', message: 'Your organization requires two-step sign-in. Set it up to continue.' });
    }
    return true;
  }

  private extractToken(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return (req as Request & { cookies?: Record<string, string> }).cookies?.[config.cookieName];
  }
}
