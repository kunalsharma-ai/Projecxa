import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuthUser } from '../auth/auth.types';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const createSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  name: z.string().min(1),
  password: z.string().min(10, 'Use at least 10 characters'),
  role: z.enum(['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER']),
});

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.user.findMany({
      where: { organizationId: u.organizationId, active: true, role: { in: ['ADMIN', 'PROJECT_MANAGER', 'SALES', 'VIEWER'] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    });
  }

  @Post()
  @Roles('ADMIN')
  async create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>) {
    const created = await this.prisma.user.create({
      data: { organizationId: u.organizationId, email: body.email, name: body.name, role: body.role, passwordHash: await bcrypt.hash(body.password, 10) },
      select: { id: true, name: true, email: true, role: true },
    });
    await this.audit.record({ organizationId: u.organizationId, actorId: u.id, action: 'user.create', entityType: 'User', entityId: created.id });
    return created;
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
