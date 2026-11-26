import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.schema.js';

const base = {
  APP_ORIGIN: 'http://localhost:5173/',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('builds DATABASE_URL from parts and URL-encodes the password', () => {
    const config = loadConfig({
      ...base,
      DB_HOST: 'db.internal',
      DB_NAME: 'twg',
      DB_USER: 'app',
      DB_PASSWORD: 'p@ss/w:rd',
      DB_SSL: 'true',
    });
    expect(config.databaseUrl).toBe(
      'postgresql://app:p%40ss%2Fw%3Ard@db.internal:5432/twg?sslmode=require',
    );
    expect(config.appOrigin).toBe('http://localhost:5173');
  });

  it('fails with a readable message when the database is not configured', () => {
    expect(() => loadConfig(base)).toThrow(/DATABASE_URL/);
  });

  it('rejects a short JWT secret', () => {
    expect(() =>
      loadConfig({ ...base, DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'short' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects partial Google config', () => {
    expect(() =>
      loadConfig({ ...base, DATABASE_URL: 'postgresql://x', GOOGLE_CLIENT_ID: 'abc' }),
    ).toThrow(/Google sign-in/);
  });

  it('derives the Google redirect URI from APP_ORIGIN', () => {
    const config = loadConfig({
      ...base,
      DATABASE_URL: 'postgresql://x',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
    });
    expect(config.google?.redirectUri).toBe('http://localhost:5173/v1/auth/google/callback');
  });

  it('refuses insecure cookies in production', () => {
    expect(() =>
      loadConfig({
        ...base,
        DATABASE_URL: 'postgresql://x',
        NODE_ENV: 'production',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow(/COOKIE_SECURE/);
  });
});
