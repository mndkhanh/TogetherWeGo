import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { AppConfig } from './infra/config/env.schema.js';

/** HTTP setup shared by main.api.ts and the e2e tests, so tests exercise the real configuration. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  // Behind CloudFront + ALB: trust exactly that many hops so req.ip is the real client IP.
  app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('v1');
  // No CORS: the web app and API share one origin (Vite proxy locally, CloudFront in AWS).
  app.enableShutdownHooks();
}
