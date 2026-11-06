import { BadRequestException, Body, Controller, Delete, Get, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles, STAFF } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

/**
 * "Add +" on dropdowns: options people add themselves are saved per organisation and offered
 * to everyone from then on. `defaultVendor` lists vendors preselected on Create project.
 */
export const CUSTOM_OPTION_FIELDS = ['category', 'targetGroup', 'language', 'uidParam', 'defaultVendor'] as const;

const fieldSchema = z.enum(CUSTOM_OPTION_FIELDS);
const addSchema = z.object({ field: fieldSchema, value: z.string().trim().min(1).max(200) });
const replaceSchema = z.object({ field: fieldSchema, values: z.array(z.string().trim().min(1).max(200)).max(100) });

@Controller('custom-options')
export class CustomOptionsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  @Roles(...STAFF)
  async list(@CurrentUser() u: AuthUser, @Query('field') field?: string) {
    const f = field ? fieldSchema.safeParse(field) : null;
    if (f && !f.success) throw new BadRequestException('Unknown field');
    return this.prisma.customOption.findMany({
      where: { organizationId: u.organizationId, ...(f ? { field: f.data } : {}) },
      orderBy: [{ field: 'asc' }, { value: 'asc' }],
      select: { id: true, field: true, value: true, createdAt: true },
    });
  }

  @Post()
  @Roles(...EDITORS)
  async add(@CurrentUser() u: AuthUser, @Body(new ZodPipe(addSchema)) body: z.infer<typeof addSchema>) {
    const row = await this.prisma.customOption.upsert({
      where: { organizationId_field_value: { organizationId: u.organizationId, field: body.field, value: body.value } },
      create: { organizationId: u.organizationId, field: body.field, value: body.value, createdById: u.id },
      update: {},
      select: { id: true, field: true, value: true, createdAt: true },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'custom-option.add', entityType: 'CustomOption', entityId: row.id, detail: body });
    return row;
  }

  /** Replaces the whole list for one field (used to save the default vendors). */
  @Post('replace')
  @Roles(...EDITORS)
  async replace(@CurrentUser() u: AuthUser, @Body(new ZodPipe(replaceSchema)) body: z.infer<typeof replaceSchema>) {
    const values = [...new Set(body.values)];
    await this.prisma.$transaction([
      this.prisma.customOption.deleteMany({ where: { organizationId: u.organizationId, field: body.field, value: { notIn: values } } }),
      this.prisma.customOption.createMany({ data: values.map((value) => ({ organizationId: u.organizationId, field: body.field, value, createdById: u.id })), skipDuplicates: true }),
    ]);
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'custom-option.replace', entityType: 'CustomOption', entityId: body.field, detail: body });
    return this.list(u, body.field);
  }

  @Delete(':id')
  @Roles(...EDITORS)
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const row = await this.prisma.customOption.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!row) throw new NotFoundException('Option not found');
    await this.prisma.customOption.delete({ where: { id } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'custom-option.remove', entityType: 'CustomOption', entityId: id, detail: { field: row.field, value: row.value } });
    return { ok: true };
  }
}

@Module({ controllers: [CustomOptionsController] })
export class CustomOptionsModule {}
