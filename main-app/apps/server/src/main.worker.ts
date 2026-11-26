import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // On SIGTERM (ECS deploys/scale-in) BullMQ finishes the current job before exiting.
  app.enableShutdownHooks();
  app.get(Logger).log('Worker started');
}

await bootstrap();
