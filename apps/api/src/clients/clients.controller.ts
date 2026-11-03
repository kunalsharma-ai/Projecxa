import { Body, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { randomToken } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { redirectConfigSchema } from '../redirects/redirect.types';

const contactSchema = z.object({ name: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional() });
const createSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().regex(/^[A-Z0-9_-]{2,20}$/i).transform((s) => s.toUpperCase()),
  contacts: z.array(contactSchema).default([]),
  redirectTemplate: redirectConfigSchema.optional(),
  billingAddress: z.string().trim().max(1000).nullable().optional(),
  taxId: z.string().trim().max(80).nullable().optional(),
});
const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  redirectTemplate: redirectConfigSchema.nullable().optional(),
  billingAddress: z.string().trim().max(1000).nullable().optional(),
  taxId: z.string().trim().max(80).nullable().optional(),
});

@Controller('clients')
export class ClientsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.client.findMany({
      where: { organizationId: u.organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, status: true, contacts: true, _count: { select: { projects: true } } },
    });
  }

  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const c = await this.prisma.client.findFirst({
      where: { id, organizationId: u.organizationId },
      select: { id: true, name: true, code: true, status: true, contacts: true, redirectTemplate: true, billingAddress: true, taxId: true },
    });
    if (!c) throw new NotFoundException();
    return c;
  }

  @Post()
  @Roles(...EDITORS, 'SALES')
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    const c = await this.prisma.client.create({
      data: {
        organizationId: u.organizationId,
        name: body.name,
        code: body.code,
        s2sSecret: randomToken(32),
        redirectTemplate: body.redirectTemplate,
        billingAddress: body.billingAddress || null,
        taxId: body.taxId || null,
        contacts: { create: body.contacts },
      },
      include: { contacts: true },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'client.create', entityType: 'Client', entityId: c.id });
    const { s2sSecret: _s, ...rest } = c;
    return rest;
  }

  @Patch(':id')
  @Roles(...EDITORS)
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    const found = await this.prisma.client.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!found) throw new NotFoundException();
    const { redirectTemplate, ...rest } = body;
    await this.prisma.client.update({
      where: { id },
      data: { ...rest, ...(redirectTemplate !== undefined ? { redirectTemplate: redirectTemplate ?? undefined } : {}) },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'client.update', entityType: 'Client', entityId: id, detail: body });
    return this.get(u, id);
  }

  /** Secret the client survey platform uses to sign S2S outcome postbacks. Admin only. */
  @Get(':id/s2s-secret')
  @Roles('ADMIN')
  async secret(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const c = await this.prisma.client.findFirst({ where: { id, organizationId: u.organizationId }, select: { s2sSecret: true } });
    if (!c) throw new NotFoundException();
    return c;
  }
}

@Module({ controllers: [ClientsController] })
export class ClientsModule {}
