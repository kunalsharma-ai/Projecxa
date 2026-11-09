/**
 * Super Admin "Observe" (docs/SUPER_ADMIN_OBSERVE.md): the Super Admin opens any organisation read-only,
 * even one running on its own domain and name, and sees everything its Admin sees: projects, links,
 * traffic, respondents, clients, vendors, finance, reports and settings. Nothing can be changed while
 * observing, every start is written to that organisation's activity log, and the observe pass lasts 1 hour.
 */
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { config } from '../common/config';

export const OBSERVE_COOKIE = 'projexa_observe';
/** Header alternative for API clients and tests. */
export const OBSERVE_HEADER = 'x-observe-token';
const secret = () => `${config.jwtSecret}:observe`;
const TTL_MS = 3600_000;

@Injectable()
export class ObserveTokens {
  constructor(private readonly jwt: JwtService) {}

  async start(res: Response, superAdminId: string, orgId: string) {
    const token = await this.jwt.signAsync({ sub: superAdminId, observe: orgId, purpose: 'observe' }, { secret: secret(), expiresIn: TTL_MS / 1000 });
    res.cookie(OBSERVE_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: TTL_MS, path: '/' });
    return token;
  }

  stop(res: Response) {
    res.clearCookie(OBSERVE_COOKIE, { path: '/' });
  }

  /** The organisation being observed, if this request carries a valid pass for this Super Admin. */
  async read(req: Request, userId: string): Promise<string | null> {
    const raw = (req.headers[OBSERVE_HEADER] as string | undefined) ?? (req as Request & { cookies?: Record<string, string> }).cookies?.[OBSERVE_COOKIE];
    if (!raw) return null;
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; observe?: string; purpose?: string }>(raw, { secret: secret() });
      return p.purpose === 'observe' && p.sub === userId && p.observe ? p.observe : null;
    } catch {
      return null;
    }
  }
}
