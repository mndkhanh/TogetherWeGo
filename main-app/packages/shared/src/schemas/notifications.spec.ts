import { describe, expect, it } from 'vitest';
import { isTimeZone, LOCALES, toLocale } from '../i18n/locale.js';
import { describeNotification, NOTIFICATION_TYPES } from './notifications.js';

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

describe('describeNotification: language and time zone', () => {
  const data = {
    groupId: 'g1',
    groupName: 'Đà Lạt',
    eventId: 'e1',
    title: 'Lẩu',
    startsAt: '2026-11-28T12:00:00.000Z',
    location: 'Phở 24',
    excerpt: 'Mang bia nhé',
  };

  it('speaks Vietnamese, keeping the currency’s own number format', () => {
    expect(
      plain(
        describeNotification(
          'debt.reminder',
          {
            groupId: 'g1',
            groupName: 'Đà Lạt',
            amount: 150_000,
            currency: 'VND',
            creditorNames: ['An', 'Bình'],
          },
          { locale: 'vi' },
        ).text,
      ),
    ).toBe('Bạn còn nợ 150.000 ₫ cho An và Bình trong Đà Lạt.');
    expect(plain(describeNotification('event.reminder', data, { locale: 'vi' }).text)).toMatch(
      /^Sắp diễn ra: Lẩu trong Đà Lạt, 19:00 Thứ 7, 28 thg 11 tại Phở 24\.$/u,
    );
  });

  it('shows times in the reader’s time zone', () => {
    expect(
      plain(describeNotification('event.reminder', data, { timeZone: 'Europe/London' }).text),
    ).toBe('Coming up: Lẩu in Đà Lạt, Sat, Nov 28, 12:00 PM at Phở 24.');
  });

  it('has a sentence for every type in both languages', () => {
    for (const type of NOTIFICATION_TYPES) {
      for (const locale of LOCALES) {
        const { text } = describeNotification(
          type,
          { ...data, amount: 1, currency: 'VND' },
          { locale },
        );
        expect(text.length, `${type} ${locale}`).toBeGreaterThan(0);
        expect(text, `${type} ${locale}`).not.toContain('undefined');
      }
    }
  });
});

describe('locale helpers', () => {
  it('maps browser languages to the ones we speak', () => {
    expect(toLocale('vi-VN')).toBe('vi');
    expect(toLocale('en-GB')).toBe('en');
    expect(toLocale('fr')).toBe('en');
    expect(toLocale(undefined)).toBe('en');
  });

  it('accepts real time zones only', () => {
    expect(isTimeZone('Asia/Ho_Chi_Minh')).toBe(true);
    expect(isTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('../../etc')).toBe(false);
  });
});
