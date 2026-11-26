import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { ApiModule } from './api.module.js';
import { configureApp } from './configure-app.js';
import { APP_CONFIG } from './infra/config/app-config.module.js';
import type { AppConfig } from './infra/config/env.schema.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);

  app.useLogger(app.get(Logger));
  configureApp(app, config);

  await app.listen(config.port, '0.0.0.0');
  app.get(Logger).log(`API listening on :${config.port}`);
}

await bootstrap();
