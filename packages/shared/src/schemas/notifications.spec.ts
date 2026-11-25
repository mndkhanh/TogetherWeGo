import { describe, expect, it } from 'vitest';
import { describeNotification } from './notifications.js';

// Intl puts non-breaking spaces in money and dates; compare as plain spaces.
const plain = (s: string) => s.replace(/\s/gu, ' ');

describe('describeNotification: reminders', () => {
  const base = { groupId: 'g1', groupName: 'Trip', currency: 'VND' as const, amount: 150_000 };

  it('names the one person you owe', () => {
    const { text, link } = describeNotification('debt.reminder', {
      ...base,
      creditorNames: ['An'],
    });
    expect(plain(text)).toBe('You owe An 150.000 ₫ in Trip.');
    expect(link).toBe('/groups/g1?tab=balances');
  });

  it('lists a few people, and counts the rest', () => {
    expect(
      plain(describeNotification('debt.reminder', { ...base, creditorNames: ['An', 'Bình'] }).text),
    ).toBe('You owe 150.000 ₫ to An and Bình in Trip.');
    expect(
      plain(
        describeNotification('debt.reminder', {
          ...base,
          creditorNames: ['An', 'Bình', 'Chi', 'Dũng', 'Em'],
        }).text,
      ),
    ).toBe('You owe 150.000 ₫ to An, Bình and 3 others in Trip.');
  });

  it('gives the event time in Vietnam, and the place when there is one', () => {
    const data = {
      groupId: 'g1',
      groupName: 'Trip',
      eventId: 'e1',
      title: 'Dinner',
      startsAt: '2026-11-28T12:00:00.000Z',
    };
    const without = describeNotification('event.reminder', data);
    expect(plain(without.text)).toBe('Coming up: Dinner in Trip, Sat, Nov 28, 7:00 PM.');
    expect(without.link).toBe('/groups/g1/events/e1');
    expect(
      plain(describeNotification('event.reminder', { ...data, location: 'Phở 24' }).text),
    ).toBe('Coming up: Dinner in Trip, Sat, Nov 28, 7:00 PM at Phở 24.');
  });
});
