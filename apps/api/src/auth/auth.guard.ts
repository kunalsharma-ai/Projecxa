import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { config } from '../common/config';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC, ROLES, STAFF } from './decorators';
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

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: config.jwtSecret });
    } catch {
      throw new UnauthorizedException('Session expired, sign in again');
    }
    // Re-load the user so deactivation and role changes apply immediately.
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active) throw new UnauthorizedException('Account is not active');
    req.user = { id: user.id, organizationId: user.organizationId, role: user.role, email: user.email, name: user.name };

    // Default: staff only. Client/vendor portal roles must be granted explicitly per endpoint.
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets) ?? STAFF;
    if (user.role !== 'ADMIN' && !roles.includes(user.role)) {
      throw new ForbiddenException('Your role cannot do this');
    }
    return true;
  }

  private extractToken(req: Request): string | undefined {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return (req as Request & { cookies?: Record<string, string> }).cookies?.[config.cookieName];
  }
}
