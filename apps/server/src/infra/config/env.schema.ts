import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === '' ? undefined : value));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    APP_ORIGIN: z.url(),

    // Either DATABASE_URL, or the individual parts (what ECS injects from Secrets Manager).
    DATABASE_URL: optionalString,
    DB_HOST: optionalString,
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_NAME: optionalString,
    DB_USER: optionalString,
    DB_PASSWORD: optionalString,
    DB_SSL: booleanString.default(false),

    REDIS_URL: z.string().regex(/^rediss?:\/\//, 'REDIS_URL must start with redis:// or rediss://'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    COOKIE_SECURE: booleanString.default(true),

    /** Number of proxies in front of the app (CloudFront + ALB = 2). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    /** When set, requests must carry `x-origin-verify: <secret>` (added by CloudFront). */
    ORIGIN_VERIFY_SECRET: optionalString,

    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GOOGLE_REDIRECT_URI: optionalString,
  })
  .transform((env, ctx) => {
    let databaseUrl = env.DATABASE_URL;
    if (!databaseUrl) {
      if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER || !env.DB_PASSWORD) {
        ctx.addIssue({
          code: 'custom',
          message: 'Set DATABASE_URL, or all of DB_HOST, DB_NAME, DB_USER, DB_PASSWORD',
        });
        return z.NEVER;
      }
      const user = encodeURIComponent(env.DB_USER);
      const password = encodeURIComponent(env.DB_PASSWORD);
      const ssl = env.DB_SSL ? '?sslmode=require' : '';
      databaseUrl = `postgresql://${user}:${password}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}${ssl}`;
    }

    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env;
    if (Boolean(GOOGLE_CLIENT_ID) !== Boolean(GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Google sign-in needs both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or neither)',
      });
      return z.NEVER;
    }
    const appOrigin = new URL(env.APP_ORIGIN).origin;

    if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
      ctx.addIssue({ code: 'custom', message: 'COOKIE_SECURE must be true in production' });
      return z.NEVER;
    }

    return {
      nodeEnv: env.NODE_ENV,
      isProduction: env.NODE_ENV === 'production',
      port: env.PORT,
      logLevel: env.LOG_LEVEL,
      appOrigin,
      databaseUrl,
      redisUrl: env.REDIS_URL,
      jwt: {
        accessSecret: env.JWT_ACCESS_SECRET,
        accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      },
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      cookieSecure: env.COOKIE_SECURE,
      trustProxyHops: env.TRUST_PROXY_HOPS,
      originVerifySecret: env.ORIGIN_VERIFY_SECRET,
      google:
        GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
          ? {
              clientId: GOOGLE_CLIENT_ID,
              clientSecret: GOOGLE_CLIENT_SECRET,
              // The callback goes through the web origin (Vite proxy / CloudFront) so cookies stay same-origin.
              redirectUri: env.GOOGLE_REDIRECT_URI ?? `${appOrigin}/v1/auth/google/callback`,
            }
          : undefined,
    };
  });

export type AppConfig = z.output<typeof envSchema>;

/** Parses and validates process.env. Throws a readable error listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(env)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}
