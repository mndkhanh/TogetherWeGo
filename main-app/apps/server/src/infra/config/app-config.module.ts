import { Global, Module } from '@nestjs/common';
import { type AppConfig, loadConfig } from './env.schema.js';

/** Injection token for the validated, typed application config. */
export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: (): AppConfig => loadConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
