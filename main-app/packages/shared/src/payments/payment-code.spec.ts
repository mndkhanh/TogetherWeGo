import { describe, expect, it } from 'vitest';
import { bankByBin, sepayQrUrl } from './banks.js';
import { findPaymentCodes, PAYMENT_CODE_PATTERN } from './payment-code.js';

describe('findPaymentCodes', () => {
  it('finds a code surrounded by bank text, in any case', () => {
    expect(findPaymentCodes('MBVCB.3278907687.twg8k3f2qhn.CT tu 0123 toi 456')).toEqual([
      'TWG8K3F2QHN',
    ]);
  });

  it('finds a code with no spaces around it', () => {
    expect(findPaymentCodes('NguyenVanATWG8K3F2QHNchuyen tien')).toEqual(['TWG8K3F2QHN']);
  });

  it('ignores look-alikes with characters the alphabet leaves out', () => {
    expect(findPaymentCodes('TWG0K3F2QHN TWG8K3F2QH')).toEqual([]);
  });

  it('returns each distinct code once', () => {
    expect(findPaymentCodes('TWG8K3F2QHN TWG8K3F2QHN TWGAAAAAAAA')).toEqual([
      'TWG8K3F2QHN',
      'TWGAAAAAAAA',
    ]);
  });

  it('matches the exact pattern', () => {
    expect(PAYMENT_CODE_PATTERN.test('TWG8K3F2QHN')).toBe(true);
    expect(PAYMENT_CODE_PATTERN.test('TWG8K3F2QHNX')).toBe(false);
  });
});

describe('sepayQrUrl', () => {
  it('builds the SePay QR link with the bank short name', () => {
    const url = sepayQrUrl({
      bin: '970422',
      accountNumber: '0123456789',
      amount: 150000,
      description: 'TWG8K3F2QHN',
    });
    expect(url).toBe(
      'https://qr.sepay.vn/img?acc=0123456789&bank=MBBank&amount=150000&des=TWG8K3F2QHN',
    );
  });

  it('returns null for an unknown bank', () => {
    expect(bankByBin('000000')).toBeUndefined();
    expect(
      sepayQrUrl({ bin: '000000', accountNumber: '1', amount: 1, description: 'x' }),
    ).toBeNull();
  });
});
