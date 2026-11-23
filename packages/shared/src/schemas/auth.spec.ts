import { describe, expect, it } from 'vitest';
import { registerSchema } from './auth.js';

describe('registerSchema', () => {
  it('normalizes email', () => {
    const parsed = registerSchema.parse({
      email: '  Khanh@Example.COM ',
      password: 'correct-horse-battery',
      name: ' Khanh ',
    });
    expect(parsed.email).toBe('khanh@example.com');
    expect(parsed.name).toBe('Khanh');
  });

  it('rejects short passwords', () => {
    const result = registerSchema.safeParse({ email: 'a@b.co', password: 'short', name: 'A' });
    expect(result.success).toBe(false);
  });
});
