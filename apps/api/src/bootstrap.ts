import { INestApplication, RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { config } from './common/config';

/** Shared app setup used by main.ts and the e2e tests. */
export function configureApp(app: INestApplication) {
  app.use(cookieParser());
  // Bulk imports (up to 1000 clients or vendors) and pasted client links are bigger than
  // Express's default 100 KB. Files go as multipart with their own limits.
  (app as NestExpressApplication).useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 's/:code', method: RequestMethod.GET },
      { path: 'u/:key', method: RequestMethod.GET },
      { path: 'r/:status', method: RequestMethod.GET },
      { path: 'end/:status', method: RequestMethod.GET },
      { path: 'g/:token', method: RequestMethod.GET },
      { path: 'g/:token', method: RequestMethod.POST },
      { path: 'g/:token/human', method: RequestMethod.POST },
      { path: 'g/:token/captcha.svg', method: RequestMethod.GET },
      { path: 'pa/:id', method: RequestMethod.GET },
      { path: 'brand/:file', method: RequestMethod.GET },
    ],
  });
  app.enableCors({ origin: config.webOrigins, credentials: true, exposedHeaders: ['Content-Disposition', 'X-Features-Version'] });
  const http = app.getHttpAdapter().getInstance();
  http.set('trust proxy', 1);
  http.disable('x-powered-by');
  return app;
}
