import { EntitlementsService } from '../super-admin/entitlements';
import { CanActivate, ExecutionContext, ForbiddenException, HttpException, HttpStatus, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { sha256 } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ApiScope, looksLikeApiKey } from './api-keys';

export const API_SCOPE = 'apiScope';
/** The permission a public API route needs. Routes without it only need a valid key. */
export const Scope = (scope: ApiScope) => SetMetadata(API_SCOPE, scope);

export interface ApiKeyContext { id: string; organizationId: string; scopes: string[]; createdById: string; name: string; prefix: string; expiresAt: Date | null }
export type ApiRequest = Request & { apiKey?: ApiKeyContext };

/** Requests per key per minute. Counted per API instance (see docs/PUBLIC_API.md). */
export const RATE_LIMIT = Number(process.env.PUBLIC_API_RATE_LIMIT ?? 120);
const WINDOW_MS = 60_000;

/** Fixed one-minute windows per key. Small and in memory; enough to stop a runaway integration. */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit = RATE_LIMIT, private readonly windowMs = WINDOW_MS) {}

  hit(key: string, now = Date.now()) {
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(key, w);
      if (this.windows.size > 10_000) for (const [k, v] of this.windows) if (now - v.start >= this.windowMs) this.windows.delete(k);
    }
    w.count++;
    return { ok: w.count <= this.limit, limit: this.limit, remaining: Math.max(0, this.limit - w.count), resetAt: w.start + this.windowMs };
  }

  reset() {
    this.windows.clear();
  }
}

/**
 * Authenticates public API calls with `Authorization: Bearer pjx_...` or `X-API-Key: pjx_...`.
 * The routes are @Public() for the staff JWT guard, so this guard is the only one that applies.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  static limiter = new RateLimiter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const header = req.headers.authorization;
    const raw = header?.startsWith('Bearer ') ? header.slice(7).trim() : (req.headers['x-api-key'] as string | undefined)?.trim();
    if (!looksLikeApiKey(raw)) throw new UnauthorizedException('Send an API key as "Authorization: Bearer pjx_..." or "X-API-Key: pjx_..."');

    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: sha256(raw) } });
    if (!key || key.revokedAt) throw new UnauthorizedException('This API key is not valid or was revoked');
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('This API key has expired');

    // Super Admin: a paused organisation, or one whose plan has no API, cannot use its keys.
    if (!(await this.entitlements.orgAllows(key.organizationId, 'developers'))) {
      throw new ForbiddenException({ statusCode: 403, code: 'FEATURE_DISABLED', feature: 'developers', message: 'The public API is not part of this organisation’s plan, or its access is paused.' });
    }
    const rl = ApiKeyGuard.limiter.hit(key.id);
    res.setHeader('X-RateLimit-Limit', String(rl.limit));
    res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(rl.resetAt / 1000)));
    if (!rl.ok) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000))));
      throw new HttpException(`Rate limit reached: ${rl.limit} requests a minute per key`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const scope = this.reflector.getAllAndOverride<ApiScope | undefined>(API_SCOPE, [ctx.getHandler(), ctx.getClass()]);
    if (scope && !key.scopes.includes(scope)) throw new ForbiddenException(`This key needs the ${scope} permission`);

    // Cheap "last used": write at most once a minute per key.
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
      await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    }
    req.apiKey = { id: key.id, organizationId: key.organizationId, scopes: key.scopes, createdById: key.createdById, name: key.name, prefix: key.prefix, expiresAt: key.expiresAt };
    return true;
  }
}
