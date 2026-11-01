import 'dotenv/config';
import { execSync } from 'child_process';

/** Apply migrations to the test database. Each e2e suite truncates the tables it uses. */
export default function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://projexa:projexa@localhost:5432/projexa_test';
  if (!/_test\b|_test$/.test(new URL(url).pathname)) throw new Error('TEST_DATABASE_URL must name a *_test database');
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
}
