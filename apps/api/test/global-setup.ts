import 'dotenv/config';
import { PrismaClient } from '../src/prisma/client';
import { syncIndexes } from '../src/prisma/indexes';

export const DEFAULT_TEST_DATABASE_URL = 'mongodb://127.0.0.1:27017/projexa_test?replicaSet=rs0';

/** Create the test database's collections and indexes. Each e2e suite clears the data it uses. */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  if (!/_test$/.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL must name a *_test database');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await syncIndexes(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
