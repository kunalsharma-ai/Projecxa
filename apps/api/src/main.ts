import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function main() {
  // rawBody: signed webhooks (Bidzo) are verified against the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`PROJEXA API listening on http://localhost:${port}/api/v1`);
}
main();
