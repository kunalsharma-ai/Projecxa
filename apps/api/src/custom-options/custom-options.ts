import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, EDITORS, Roles, STAFF } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { createManySkipDuplicates } from '../prisma/mongo-compat';

/**
 * "Add +" on dropdowns: options people add themselves are saved per organisation and offered
 * to everyone from then on. `defaultVendor` lists vendors preselected on Create project.
 */
export const CUSTOM_OPTION_FIELDS = ['category', 'targetGroup', 'language', 'uidParam', 'defaultVendor'] as const;

const fieldSchema = z.enum(CUSTOM_OPTION_FIELDS);
const addSchema = z.object({ field: fieldSchema, value: z.string().trim().min(1).max(200) });
const renameSchema = z.object({ value: z.string().trim().min(1).max(200) });
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
    await this.prisma.$transaction(async (tx) => {
      await tx.customOption.deleteMany({ where: { organizationId: u.organizationId, field: body.field, value: { notIn: values } } });
      await createManySkipDuplicates(tx.customOption, 'CustomOption', values.map((value) => ({ organizationId: u.organizationId, field: body.field, value, createdById: u.id })));
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'custom-option.replace', entityType: 'CustomOption', entityId: body.field, detail: body });
    return this.list(u, body.field);
  }

  /** Fixes a typo in an option. Records that already use the old wording keep it. */
  @Patch(':id')
  @Roles(...EDITORS)
  async rename(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(renameSchema)) body: z.infer<typeof renameSchema>) {
    const row = await this.prisma.customOption.findFirst({ where: { id, organizationId: u.organizationId } });
    if (!row) throw new NotFoundException('Option not found');
    if (row.field === 'defaultVendor') throw new BadRequestException('Default vendors are chosen on Create project');
    const clash = await this.prisma.customOption.findFirst({ where: { organizationId: u.organizationId, field: row.field, value: { equals: body.value, mode: 'insensitive' }, id: { not: id } } });
    if (clash) throw new ConflictException(`“${body.value}” is already in the list`);
    const updated = await this.prisma.customOption.update({ where: { id }, data: { value: body.value }, select: { id: true, field: true, value: true, createdAt: true } });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'custom-option.rename', entityType: 'CustomOption', entityId: id, detail: { field: row.field, from: row.value, to: body.value } });
    return updated;
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
