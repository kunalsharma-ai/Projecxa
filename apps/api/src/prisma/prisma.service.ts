import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaClient } from './client';

/** Write conflicts between concurrent MongoDB transactions: safe to run the transaction again. */
const isWriteConflict = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    // MongoDB aborts one of two transactions that write the same document at the same time
    // (P2034). PostgreSQL made the second one wait on the row lock; here it runs again.
    const original = this.$transaction.bind(this) as (...a: unknown[]) => Promise<unknown>;
    const retrying = async (arg: unknown, opts?: unknown) => {
      if (typeof arg !== 'function') return original(arg, opts);
      for (let attempt = 1; ; attempt++) {
        try {
          return await original(arg, opts);
        } catch (e) {
          if (!isWriteConflict(e) || attempt >= 8) throw e;
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20 * attempt)));
        }
      }
    };
    (this as unknown as { $transaction: unknown }).$transaction = retrying;
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** A cheap round trip to the database, for health checks. */
  async ping() {
    await this.$runCommandRaw({ ping: 1 });
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
