import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addDays,
  addMonthsToMonthStart,
  businessDateKey,
  businessDayEnd,
  businessDayStart,
  currentMonthStartDateKey,
  dayOfMonth,
  daysBetween,
  monthEndDateKey,
  monthStartDateKey,
  sameMonth,
  todayDateKey,
  weekStartDateKey,
} from './business-day';

/**
 * The viewer's own zone must not change any answer here — that is the whole point of the
 * module. Every case therefore runs under a zone that is neither UTC nor UTC+8.
 */
describe('business-day', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'America/New_York');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('businessDayStart / businessDayEnd', () => {
    it('bounds the Ulaanbaatar day, not the UTC one', () => {
      // The bug: `${date}T00:00:00.000Z` framed the UTC day, which starts eight hours late.
      expect(businessDayStart('2026-08-21')).toBe('2026-08-20T16:00:00.000Z');
      expect(businessDayEnd('2026-08-21')).toBe('2026-08-21T15:59:59.999Z');
    });

    it('includes 07:00 of its own day and excludes 07:00 of the next', () => {
      const from = businessDayStart('2026-08-21');
      const to = businessDayEnd('2026-08-21');

      // 07:00 on 21 August in Ulaanbaatar.
      const earlyOnTheDay = '2026-08-20T23:00:00.000Z';
      // 07:00 on 22 August in Ulaanbaatar — the morning the old range swallowed.
      const earlyTheDayAfter = '2026-08-21T23:00:00.000Z';

      expect(earlyOnTheDay >= from && earlyOnTheDay <= to).toBe(true);
      expect(earlyTheDayAfter >= from && earlyTheDayAfter <= to).toBe(false);
    });

    it('makes one day end exactly where the next begins', () => {
      expect(new Date(businessDayEnd('2026-02-28')).getTime() + 1).toBe(
        new Date(businessDayStart('2026-03-01')).getTime(),
      );
    });
  });

  describe('businessDateKey', () => {
    it('reads an instant as Ulaanbaatar sees it', () => {
      // 01:00 UTC is 09:00 the same day in Ulaanbaatar and 21:00 the day before in New York.
      expect(businessDateKey('2026-07-07T01:00:00.000Z')).toBe('2026-07-07');
      // 17:00 UTC is already the next day in Ulaanbaatar.
      expect(businessDateKey('2026-07-07T17:00:00.000Z')).toBe('2026-07-08');
    });

    it('accepts a Date as readily as a string', () => {
      expect(businessDateKey(new Date('2026-07-07T01:00:00.000Z'))).toBe('2026-07-07');
    });
  });

  describe('key arithmetic', () => {
    it('rolls over month and year ends', () => {
      expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
      expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    });

    it('finds the Monday of a week', () => {
      // 7 July 2026 is a Tuesday.
      expect(weekStartDateKey('2026-07-07')).toBe('2026-07-06');
      // A Monday is its own week start.
      expect(weekStartDateKey('2026-07-06')).toBe('2026-07-06');
      // A Sunday belongs to the week that began six days earlier, not the one starting next.
      expect(weekStartDateKey('2026-07-12')).toBe('2026-07-06');
    });

    it('walks months without drifting on a long one', () => {
      expect(monthStartDateKey('2026-07-15')).toBe('2026-07-01');
      expect(monthEndDateKey('2026-07-15')).toBe('2026-07-31');
      expect(monthEndDateKey('2026-02-10')).toBe('2026-02-28');
      expect(addMonthsToMonthStart('2026-01-31', 1)).toBe('2026-02-01');
      expect(addMonthsToMonthStart('2026-12-15', 1)).toBe('2027-01-01');
      expect(addMonthsToMonthStart('2026-01-15', -1)).toBe('2025-12-01');
    });

    it('measures and compares', () => {
      expect(daysBetween('2026-07-06', '2026-07-13')).toBe(7);
      expect(dayOfMonth('2026-07-06')).toBe(6);
      expect(sameMonth('2026-07-01', '2026-07-31')).toBe(true);
      expect(sameMonth('2026-07-31', '2026-08-01')).toBe(false);
    });
  });

  describe('today', () => {
    it('reports the Ulaanbaatar date for an instant that is yesterday in New York', () => {
      expect(todayDateKey()).toBe(businessDateKey(new Date()));
      expect(currentMonthStartDateKey()).toBe(monthStartDateKey(todayDateKey()));
      expect(currentMonthStartDateKey()).toMatch(/^\d{4}-\d{2}-01$/);
    });
  });
});
