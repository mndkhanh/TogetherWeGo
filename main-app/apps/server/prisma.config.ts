import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Local dev reads apps/server/.env; in AWS the variables come from the ECS task definition.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/**
 * Same rule as the app (src/infra/config/env.schema.ts): use DATABASE_URL if set,
 * otherwise build it from the DB_* parts that ECS injects from Secrets Manager.
 */
function databaseUrl(): string {
  const env = process.env;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.DB_HOST && env.DB_NAME && env.DB_USER && env.DB_PASSWORD) {
    const user = encodeURIComponent(env.DB_USER);
    const password = encodeURIComponent(env.DB_PASSWORD);
    const ssl = env.DB_SSL === 'true' ? '?sslmode=require' : '';
    return `postgresql://${user}:${password}@${env.DB_HOST}:${env.DB_PORT ?? 5432}/${env.DB_NAME}${ssl}`;
  }
  // `prisma generate` doesn't connect to a database, so a placeholder is fine there.
  return 'postgresql://placeholder@localhost:5432/placeholder';
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl(),
  },
});
