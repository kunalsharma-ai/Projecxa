import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, EDITORS, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { codeField, codeFromName, emailField, optional, phoneField, websiteField } from '../common/contact-fields';
import { randomToken } from '../common/crypto';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { redirectConfigSchema } from '../redirects/redirect.types';

/** Every contact needs a name and a way to reach them: a valid email, a valid phone, or both. */
const contactSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(1, 'Add the contact’s name').max(200),
    email: optional(emailField),
    phone: optional(phoneField),
  })
  .refine((c) => !!c.email || !!c.phone, { message: 'Add an email or a phone number for each contact', path: ['email'] });
const contactsSchema = z
  .array(contactSchema)
  .max(20)
  .refine((cs) => { const e = cs.map((c) => c.email).filter(Boolean); return new Set(e).size === e.length; }, 'Two contacts use the same email address');

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: codeField,
  website: optional(websiteField),
  contacts: contactsSchema.default([]),
  redirectTemplate: redirectConfigSchema.optional(),
  billingAddress: z.string().trim().max(1000).nullable().optional(),
  taxId: z.string().trim().max(80).nullable().optional(),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  code: codeField.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  website: optional(websiteField),
  /** The full list: contacts with an id are updated, new ones are added and missing ones removed. */
  contacts: contactsSchema.optional(),
  redirectTemplate: redirectConfigSchema.nullable().optional(),
  billingAddress: z.string().trim().max(1000).nullable().optional(),
  taxId: z.string().trim().max(80).nullable().optional(),
});

/** One row of a bulk import (CSV columns, see the template on the Clients page). */
const importRowSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  code: optional(codeField),
  website: optional(websiteField),
  contact_name: z.string().trim().min(1, 'Contact name is required').max(200),
  contact_email: emailField,
  contact_phone: optional(phoneField),
  billing_address: optional(z.string().trim().max(1000)),
  tax_id: optional(z.string().trim().max(80)),
});
const importSchema = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(1000), dryRun: z.boolean().default(false) });

const DETAIL = { id: true, name: true, code: true, status: true, website: true, contacts: { orderBy: { name: 'asc' } }, redirectTemplate: true, billingAddress: true, taxId: true } as const;

@Controller('clients')
export class ClientsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.client.findMany({
      where: { organizationId: u.organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, status: true, website: true, contacts: true, _count: { select: { projects: true } } },
    });
  }

  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const c = await this.prisma.client.findFirst({ where: { id, organizationId: u.organizationId }, select: DETAIL });
    if (!c) throw new NotFoundException();
    return c;
  }

  @Post()
  @Roles(...EDITORS, 'SALES')
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    await this.assertCodeFree(u.organizationId, body.code);
    const c = await this.prisma.client.create({
      data: {
        organizationId: u.organizationId,
        name: body.name,
        code: body.code,
        website: body.website ?? null,
        s2sSecret: randomToken(32),
        redirectTemplate: body.redirectTemplate,
        billingAddress: body.billingAddress || null,
        taxId: body.taxId || null,
        contacts: { create: body.contacts.map((c) => ({ name: c.name, email: c.email ?? null, phone: c.phone ?? null })) },
      },
      include: { contacts: true },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'client.create', entityType: 'Client', entityId: c.id });
    const { s2sSecret: _s, ...rest } = c;
    return rest;
  }

  /** Bulk add from the CSV template. Each row is checked on its own; dryRun only reports. */
  @Post('import')
  @Roles(...EDITORS, 'SALES')
  async import(@CurrentUser() u: AuthUser, @Body(new ZodPipe(importSchema)) body: z.infer<typeof importSchema>) {
    const existing = await this.prisma.client.findMany({ where: { organizationId: u.organizationId }, select: { code: true, name: true } });
    const taken = new Set(existing.map((c) => c.code));
    const names = new Set(existing.map((c) => c.name.trim().toLowerCase()));
    const results: { row: number; ok: boolean; name?: string; code?: string; errors?: string[]; id?: string }[] = [];
    for (const [i, raw] of body.rows.entries()) {
      const p = importRowSchema.safeParse(raw);
      if (!p.success) {
        results.push({ row: i + 1, ok: false, name: String(raw.name ?? ''), errors: p.error.issues.map((x) => `${x.path.join('.') || 'row'}: ${x.message}`) });
        continue;
      }
      const r = p.data;
      const errors: string[] = [];
      if (r.code && taken.has(r.code)) errors.push(`code: ${r.code} is already used`);
      if (names.has(r.name.toLowerCase())) errors.push(`name: a client called ${r.name} already exists`);
      if (errors.length) {
        results.push({ row: i + 1, ok: false, name: r.name, errors });
        continue;
      }
      const code = r.code ?? codeFromName(r.name, taken);
      taken.add(code);
      names.add(r.name.toLowerCase());
      let id: string | undefined;
      if (!body.dryRun) {
        const c = await this.prisma.client.create({
          data: {
            organizationId: u.organizationId, name: r.name, code, website: r.website ?? null, s2sSecret: randomToken(32),
            billingAddress: r.billing_address ?? null, taxId: r.tax_id ?? null,
            contacts: { create: [{ name: r.contact_name, email: r.contact_email, phone: r.contact_phone ?? null }] },
          },
          select: { id: true },
        });
        id = c.id;
      }
      results.push({ row: i + 1, ok: true, name: r.name, code, id });
    }
    const added = results.filter((r) => r.ok).length;
    if (!body.dryRun && added) await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'client.import', entityType: 'Client', entityId: 'bulk', detail: { added, failed: results.length - added } });
    return { dryRun: body.dryRun, added: body.dryRun ? 0 : added, valid: added, failed: results.length - added, results };
  }

  @Patch(':id')
  @Roles(...EDITORS)
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    const found = await this.prisma.client.findFirst({ where: { id, organizationId: u.organizationId }, include: { contacts: { include: { _count: { select: { projects: true } } } } } });
    if (!found) throw new NotFoundException();
    if (body.code && body.code !== found.code) await this.assertCodeFree(u.organizationId, body.code);
    const { redirectTemplate, contacts, ...rest } = body;
    await this.prisma.$transaction(async (tx) => {
      await tx.client.update({
        where: { id },
        data: { ...rest, ...(redirectTemplate !== undefined ? { redirectTemplate: redirectTemplate ?? Prisma.DbNull } : {}) },
      });
      if (contacts) {
        for (const c of contacts) if (c.id && !found.contacts.some((x) => x.id === c.id)) throw new BadRequestException('A contact does not belong to this client');
        // Forms may send contacts without ids: match them to existing ones by email, then by name, so
        // projects that point at a contact keep pointing at it.
        const claimed = new Set(contacts.filter((c) => c.id).map((c) => c.id!));
        for (const c of contacts) {
          if (c.id) continue;
          const same = found.contacts.find((x) => !claimed.has(x.id) && ((c.email && x.email?.toLowerCase() === c.email) || (!c.email && x.name.trim().toLowerCase() === c.name.toLowerCase())));
          if (same) {
            c.id = same.id;
            claimed.add(same.id);
          }
        }
        const keep = claimed;
        const removed = found.contacts.filter((c) => !keep.has(c.id));
        // Projects keep their history: a removed contact is unlinked from them first.
        if (removed.length) {
          await tx.project.updateMany({ where: { clientContactId: { in: removed.map((c) => c.id) } }, data: { clientContactId: null } });
          await tx.clientContact.deleteMany({ where: { id: { in: removed.map((c) => c.id) } } });
        }
        for (const c of contacts) {
          const data = { name: c.name, email: c.email ?? null, phone: c.phone ?? null };
          if (c.id) await tx.clientContact.update({ where: { id: c.id }, data });
          else await tx.clientContact.create({ data: { ...data, clientId: id } });
        }
      }
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'client.update', entityType: 'Client', entityId: id, detail: { ...body, contacts: contacts?.length } });
    return this.get(u, id);
  }

  private async assertCodeFree(organizationId: string, code: string) {
    const clash = await this.prisma.client.findFirst({ where: { organizationId, code }, select: { id: true } });
    if (clash) throw new ConflictException(`Another client already uses the code ${code}`);
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
