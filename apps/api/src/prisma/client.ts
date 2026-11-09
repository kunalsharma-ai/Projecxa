import { PrismaClient as BaseClient, type Prisma } from '@prisma/client';
import { withMongoCompat } from './compat';

/**
 * The Prisma client for SampTrek's MongoDB database: the generated client plus the PostgreSQL rules
 * in compat.ts (unset optional fields are null, null takes no part in comparisons, money is rounded
 * to its scale, sequences). Use it everywhere instead of `new PrismaClient()` from @prisma/client.
 */
export class PrismaClient extends BaseClient {
  constructor(options?: Prisma.PrismaClientOptions) {
    super(options);
    // The extended client stands in for this one: unknown keys (methods of subclasses too) fall
    // through to this instance.
    return withMongoCompat(this);
  }
}
