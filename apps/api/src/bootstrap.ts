import { INestApplication, RequestMethod } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { config } from './common/config';

/** Shared app setup used by main.ts and the e2e tests. */
export function configureApp(app: INestApplication) {
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 's/:code', method: RequestMethod.GET },
      { path: 'r/:status', method: RequestMethod.GET },
      { path: 'end/:status', method: RequestMethod.GET },
      { path: 'g/:token', method: RequestMethod.GET },
      { path: 'g/:token', method: RequestMethod.POST },
      { path: 'g/:token/human', method: RequestMethod.POST },
      { path: 'g/:token/captcha.svg', method: RequestMethod.GET },
      { path: 'pa/:id', method: RequestMethod.GET },
    ],
  });
  app.enableCors({ origin: config.webOrigins, credentials: true });
  const http = app.getHttpAdapter().getInstance();
  http.set('trust proxy', 1);
  http.disable('x-powered-by');
  return app;
}
