import { BadRequestException, Body, Controller, Delete, Get, Injectable, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { randomToken, sha256 } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

/** What a key may do. Writes act as the admin who created the key. */
export const API_SCOPES = {
  'projects:read': 'Projects, markets, vendor links and progress.',
  'projects:write': 'Change project, market and vendor link status and targets.',
  'sessions:read': 'Respondent sessions and their outcomes.',
  'quotas:read': 'Quota cells and their fill.',
  'finance:read': 'Client invoices and vendor bills.',
} as const;
export type ApiScope = keyof typeof API_SCOPES;
export const SCOPE_NAMES = Object.keys(API_SCOPES) as ApiScope[];

const MAX_KEYS = 25;
const PREFIX_LEN = 12; // "pjx_" + 8 characters

export const createKeySchema = z.object({
  name: z.string().trim().min(1, 'Give the key a name').max(80),
  scopes: z.array(z.enum(SCOPE_NAMES as [ApiScope, ...ApiScope[]])).min(1, 'Pick at least one permission'),
  /** Days until the key stops working; omit for no expiry. */
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

/** A new key: `pjx_` + 32 random URL-safe characters. Only its SHA-256 is stored. */
export function newApiKey() {
  const key = `pjx_${randomToken(24)}`;
  return { key, prefix: key.slice(0, PREFIX_LEN), keyHash: sha256(key) };
}

export function looksLikeApiKey(v: string | undefined): v is string {
  return !!v && /^pjx_[A-Za-z0-9_-]{20,}$/.test(v);
}

type KeyRow = { id: string; name: string; prefix: string; scopes: string[]; createdById: string; lastUsedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date };
export function keyView(k: KeyRow, creator?: { name: string; email: string } | null) {
  const now = Date.now();
  const state = k.revokedAt ? 'revoked' : k.expiresAt && k.expiresAt.getTime() <= now ? 'expired' : 'active';
  return { id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, state, lastUsedAt: k.lastUsedAt, expiresAt: k.expiresAt, revokedAt: k.revokedAt, createdAt: k.createdAt, createdBy: creator ?? null };
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(org: string) {
    const rows = await this.prisma.apiKey.findMany({ where: { organizationId: org }, orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }] });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true, email: true } });
    const byId = new Map(users.map((x) => [x.id, x]));
    return rows.map((r) => keyView(r, byId.get(r.createdById)));
  }

  async create(u: AuthUser, body: z.infer<typeof createKeySchema>) {
    const active = await this.prisma.apiKey.count({ where: { organizationId: u.organizationId, revokedAt: null } });
    if (active >= MAX_KEYS) throw new BadRequestException(`You can have up to ${MAX_KEYS} keys. Revoke one you no longer use.`);
    const { key, prefix, keyHash } = newApiKey();
    const row = await this.prisma.apiKey.create({
      data: {
        organizationId: u.organizationId,
        name: body.name,
        prefix,
        keyHash,
        scopes: [...new Set(body.scopes)],
        createdById: u.id,
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
      },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'api_key.create', entityType: 'ApiKey', entityId: row.id, detail: { name: row.name, prefix, scopes: row.scopes } });
    return { ...keyView(row, { name: u.name, email: u.email }), key };
  }

  async revoke(u: AuthUser, id: string) {
    const k = await this.prisma.apiKey.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!k) throw new NotFoundException('Key not found');
    if (k.revokedAt) return keyView(k);
    const row = await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'api_key.revoke', entityType: 'ApiKey', entityId: id, detail: { name: k.name, prefix: k.prefix } });
    return keyView(row);
  }
}

@Controller('api-keys')
@Roles('ADMIN')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    return { scopes: SCOPE_NAMES.map((name) => ({ name, description: API_SCOPES[name] })), keys: await this.keys.list(u.organizationId) };
  }

  /** The key itself is returned only in this response. */
  @Post()
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createKeySchema)) body: z.infer<typeof createKeySchema>) {
    return this.keys.create(u, body);
  }

  @Delete(':id')
  revoke(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.keys.revoke(u, id);
  }
}

