import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addDaysToToday,
  currentMonthInput,
  monthStartDateInput,
  todayDateInput,
} from './calendar-date';

/**
 * These pin the bug that `toISOString().slice(0, 10)` caused: it formats in UTC, so on a
 * machine running ahead of UTC it names the previous day for the whole of the early
 * morning. Ulaanbaatar is UTC+8, which made that an eight-hour window every day.
 *
 * The runner's own timezone is not pinned anywhere, so rather than hardcode +08 these
 * derive an instant that is guaranteed to straddle the UTC boundary wherever the suite
 * happens to run, and assert the helpers report the *local* calendar date.
 */

/** An instant on 3 Aug 2026 local time whose UTC calendar date is a different day. */
function straddlingInstant(): Date {
  // getTimezoneOffset is negative east of UTC. East of UTC the early hours belong to the
  // previous UTC day; west of it the late hours belong to the next one.
  const offsetMinutes = new Date(2026, 7, 3).getTimezoneOffset();
  const localHour = offsetMinutes < 0 ? 1 : 23;
  return new Date(2026, 7, 3, localHour, 0, 0);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('calendar-date', () => {
  it('reports the local calendar date, not the UTC one', () => {
    const instant = straddlingInstant();
    vi.useFakeTimers();
    vi.setSystemTime(instant);

    expect(todayDateInput()).toBe('2026-08-03');

    // Guard the assertion above actually means something: unless the runner sits exactly
    // on UTC, the old implementation would have produced a different day here.
    if (instant.getTimezoneOffset() !== 0) {
      expect(todayDateInput()).not.toBe(instant.toISOString().slice(0, 10));
    }
  });

  it('reports the local month, so a run on the 1st does not bill the previous period', () => {
    // The month rollover was the costlier half: a bulk invoice run started on the 1st
    // before 08:00 in Ulaanbaatar defaulted its billing period to the month just gone.
    const offsetMinutes = new Date(2026, 7, 1).getTimezoneOffset();
    const instant = new Date(2026, 7, 1, offsetMinutes < 0 ? 1 : 23, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(instant);

    expect(currentMonthInput()).toBe('2026-08');
    expect(monthStartDateInput()).toBe('2026-08-01');

    if (offsetMinutes < 0) {
      expect(currentMonthInput()).not.toBe(instant.toISOString().slice(0, 7));
    }
  });

  it('adds days against the local date and rolls over the month end', () => {
    vi.useFakeTimers();
    vi.setSystemTime(straddlingInstant());

    expect(addDaysToToday(0)).toBe('2026-08-03');
    expect(addDaysToToday(30)).toBe('2026-09-02');
  });

  it('pads single-digit months and days', () => {
    const offsetMinutes = new Date(2026, 0, 5).getTimezoneOffset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, offsetMinutes < 0 ? 1 : 23, 0, 0));

    expect(todayDateInput()).toBe('2026-01-05');
    expect(currentMonthInput()).toBe('2026-01');
  });
});
