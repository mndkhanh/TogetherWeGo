import { describe, expect, it } from 'vitest';
import { createCommentSchema, createEventSchema, updateEventSchema } from './events.js';

const base = { title: 'Hotpot', startsAt: '2026-12-24T12:00:00.000Z' };

describe('event schemas', () => {
  it('trims text and turns empty optional fields into null', () => {
    const parsed = createEventSchema.parse({ ...base, title: '  Hotpot ', location: '  ' });
    expect(parsed).toMatchObject({
      title: 'Hotpot',
      location: null,
      description: null,
      endsAt: null,
    });
  });

  it('accepts times with an offset', () => {
    expect(
      createEventSchema.safeParse({ ...base, startsAt: '2026-12-24T19:00:00+07:00' }).success,
    ).toBe(true);
    expect(createEventSchema.safeParse({ ...base, startsAt: '2026-12-24 19:00' }).success).toBe(
      false,
    );
  });

  it('needs the end after the start, within 30 days', () => {
    const at = (endsAt: string) => createEventSchema.safeParse({ ...base, endsAt });
    expect(at('2026-12-24T12:00:00.000Z').success).toBe(false);
    expect(at('2026-12-24T15:00:00.000Z').success).toBe(true);
    expect(at('2027-01-23T12:00:00.000Z').success).toBe(true);
    expect(at('2027-01-23T12:00:01.000Z').success).toBe(false);
  });

  it('edits need a version', () => {
    expect(updateEventSchema.safeParse(base).success).toBe(false);
    expect(updateEventSchema.safeParse({ ...base, version: 1 }).success).toBe(true);
  });

  it('comments are trimmed, non-empty and at most 1000 characters', () => {
    expect(createCommentSchema.parse({ body: '  hi  ' }).body).toBe('hi');
    expect(createCommentSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(createCommentSchema.safeParse({ body: 'x'.repeat(1001) }).success).toBe(false);
  });
});
