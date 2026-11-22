import { applyDiscount, percentOff } from '../src/checkout/pricing';
import { loadEnv } from '../src/config/env';
import { seatConflict } from '../src/common/errors';
import { chooseBlock } from '../src/holds/best-available';
import { createsNewLoneSeat } from '../src/holds/lone-seat';
import { indexToLabel, parseSeatId } from '../src/seats/seat-id';

describe('seat labels', () => {
  it('numbers rows like a spreadsheet and parses b7', () => {
    expect(indexToLabel(0)).toBe('A');
    expect(indexToLabel(25)).toBe('Z');
    expect(indexToLabel(26)).toBe('AA');
    expect(parseSeatId('b7')).toEqual({ rowIndex: 1, seatNumber: 7, id: 'B7' });
  });
});

describe('best available ranking', () => {
  it('picks the lower start when two blocks are equally central', () => {
    const choice = chooseBlock({
      rows: [
        {
          index: 0,
          cells: ['taken', 'taken', 'taken', 'taken', 'taken', 'taken', 'taken', 'taken'],
          priceAgorot: 15000,
          zoneId: 'stalls',
        },
        {
          index: 1,
          cells: ['free', 'free', 'free', 'taken', 'taken', 'free', 'free', 'free'],
          priceAgorot: 15000,
          zoneId: 'stalls',
        },
      ],
      count: 2,
    });
    expect(choice).toEqual({ rowIndex: 1, startNumber: 2 });
  });

  it('skips a block that would isolate a new seat', () => {
    const row = (index: number, cells: Array<'free' | 'taken'>) => ({
      index,
      cells,
      priceAgorot: 15000,
      zoneId: 'stalls',
    });
    const choice = chooseBlock({
      rows: [
        row(0, ['taken', 'taken', 'taken', 'taken', 'taken', 'taken', 'taken', 'taken']),
        row(1, ['free', 'free', 'free', 'taken', 'taken', 'free', 'free', 'free']),
        row(2, ['free', 'free', 'free', 'free', 'free', 'free', 'free', 'free']),
      ],
      count: 2,
      loneSeatRule: true,
    });
    expect(choice).toEqual({ rowIndex: 2, startNumber: 4 });
    expect(
      createsNewLoneSeat(['free', 'taken', 'free', 'free', 'free', 'free', 'free', 'free'], [7]),
    ).toBe(false);
  });
});

describe('pricing', () => {
  it('rounds 10 percent half up', () => {
    expect(percentOff(34935, 10)).toBe(3494);
    expect(applyDiscount(34935, 'SAVE10')).toEqual({
      discountAgorot: 3494,
      totalAgorot: 31441,
      promoCode: 'SAVE10',
    });
    expect(percentOff(5, 10)).toBe(1);
  });

  it('caps WELCOME20 at 20 shekels', () => {
    expect(applyDiscount(34935, 'WELCOME20')).toEqual({
      discountAgorot: 2000,
      totalAgorot: 32935,
      promoCode: 'WELCOME20',
    });
  });
});

describe('conflict sentences', () => {
  it('names every reason and holds nothing when the request is bigger than one seat', () => {
    const error = seatConflict(
      [
        { id: 'B3', reason: 'sold' },
        { id: 'B4', reason: 'held_by_other' },
      ],
      2,
    );
    expect(error.message).toBe(
      'Nothing was held. B3 is already sold, and someone just took B4.',
    );
    expect(error.seatIds).toEqual(['B3', 'B4']);
  });
});

describe('env', () => {
  const base = { DATABASE_URL: 'postgres://seatrush:seatrush@localhost:5432/seatrush' };

  it('refuses a hold TTL or cap that is not a positive integer', () => {
    expect(() => loadEnv({ ...base, HOLD_TTL_SECONDS: '0', MAX_SEATS_PER_USER: '4' })).toThrow(
      /HOLD_TTL_SECONDS/,
    );
    expect(() => loadEnv({ ...base, HOLD_TTL_SECONDS: '300', MAX_SEATS_PER_USER: 'nope' })).toThrow(
      /MAX_SEATS_PER_USER/,
    );
  });
});
