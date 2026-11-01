import { Body, Controller, Get, Module, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { randomToken } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const domain = z.string().regex(/^(\*\.)?[a-z0-9.-]+\.[a-z]{2,}$|^localhost$/i, 'Use a hostname like example.com or *.example.com');
const createSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().regex(/^[A-Z0-9_-]{2,20}$/i).transform((s) => s.toUpperCase()),
  redirectAllowedDomains: z.array(domain).default([]),
  callbackUrlTemplate: z.string().url().optional(),
});
const updateSchema = createSchema.partial().omit({ code: true }).extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });

const PUBLIC_FIELDS = {
  id: true, name: true, code: true, status: true, redirectAllowedDomains: true, callbackUrlTemplate: true, createdAt: true,
} as const;

@Controller('vendors')
export class VendorsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.vendor.findMany({
      where: { organizationId: u.organizationId },
      orderBy: { name: 'asc' },
      select: { ...PUBLIC_FIELDS, _count: { select: { allocations: true } } },
    });
  }

  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const v = await this.prisma.vendor.findFirst({ where: { id, organizationId: u.organizationId }, select: PUBLIC_FIELDS });
    if (!v) throw new NotFoundException();
    return v;
  }

  @Post()
  @Roles(...EDITORS)
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    const v = await this.prisma.vendor.create({
      data: { organizationId: u.organizationId, ...body, callbackSecret: randomToken(32) },
      select: PUBLIC_FIELDS,
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'vendor.create', entityType: 'Vendor', entityId: v.id });
    return v;
  }

  @Patch(':id')
  @Roles(...EDITORS)
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    const found = await this.prisma.vendor.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!found) throw new NotFoundException();
    await this.prisma.vendor.update({ where: { id }, data: body });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'vendor.update', entityType: 'Vendor', entityId: id, detail: body });
    return this.get(u, id);
  }

  @Get(':id/callback-secret')
  @Roles('ADMIN')
  async secret(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const v = await this.prisma.vendor.findFirst({ where: { id, organizationId: u.organizationId }, select: { callbackSecret: true } });
    if (!v) throw new NotFoundException();
    return v;
  }
}

@Module({ controllers: [VendorsController] })
export class VendorsModule {}
