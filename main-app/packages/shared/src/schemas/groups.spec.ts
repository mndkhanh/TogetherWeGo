import { describe, expect, it } from 'vitest';
import { createInviteSchema, roleAtLeast, updateGroupSchema } from './groups.js';

describe('roleAtLeast', () => {
  it('ranks owner > admin > member', () => {
    expect(roleAtLeast('owner', 'admin')).toBe(true);
    expect(roleAtLeast('admin', 'admin')).toBe(true);
    expect(roleAtLeast('member', 'admin')).toBe(false);
    expect(roleAtLeast('admin', 'owner')).toBe(false);
  });
});

describe('createInviteSchema', () => {
  it('accepts the offered expiry options', () => {
    expect(createInviteSchema.safeParse({ expiresInDays: 7, maxUses: null }).success).toBe(true);
    expect(createInviteSchema.safeParse({ expiresInDays: 30, maxUses: 5 }).success).toBe(true);
  });

  it('rejects other expiry values and zero uses', () => {
    expect(createInviteSchema.safeParse({ expiresInDays: 365, maxUses: null }).success).toBe(false);
    expect(createInviteSchema.safeParse({ expiresInDays: 7, maxUses: 0 }).success).toBe(false);
  });
});

describe('updateGroupSchema', () => {
  it('rejects an empty update', () => {
    expect(updateGroupSchema.safeParse({}).success).toBe(false);
  });

  it('trims the name', () => {
    expect(updateGroupSchema.parse({ name: '  Đà Lạt trip ' })).toEqual({ name: 'Đà Lạt trip' });
  });
});
