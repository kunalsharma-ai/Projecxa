import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    entry: { organizationId: string; actorId?: string | null; action: string; entityType: string; entityId: string; detail?: unknown },
    tx: Tx = this.prisma,
  ) {
    return tx.auditEvent.create({
      data: {
        organizationId: entry.organizationId,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        detail: (entry.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
