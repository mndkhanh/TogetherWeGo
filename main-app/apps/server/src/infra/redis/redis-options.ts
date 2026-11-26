import type { RedisOptions } from 'ioredis';

/**
 * Converts a redis:// or rediss:// URL into ioredis options.
 * rediss:// enables TLS (ElastiCache with in-transit encryption).
 */
export function redisOptionsFromUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isNaN(db) ? 0 : db,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
  };
}
