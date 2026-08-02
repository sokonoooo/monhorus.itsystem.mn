import { describe, expect, it } from 'vitest';

import { dayBounds, dayBoundsAgo, localDateString, monthStart } from './day-bounds.util';

const UB = 'Asia/Ulaanbaatar';

describe('day bounds in a named timezone', () => {
  /**
   * The case that matters: the server runs in UTC, so for eight hours of every day the
   * UTC date and the Ulaanbaatar date disagree. `setHours` would silently pick the wrong
   * one and "today's work" would be yesterday's.
   */
  it('resolves the local date, not the UTC date', () => {
    // 22:30 UTC on the 28th is 06:30 on the 29th in Ulaanbaatar.
    const instant = new Date('2026-07-28T22:30:00.000Z');

    expect(localDateString(instant, UB)).toBe('2026-07-29');
    expect(localDateString(instant, 'UTC')).toBe('2026-07-28');
  });

  it('bounds the local day as UTC instants', () => {
    const { start, end, date } = dayBounds(new Date('2026-07-28T22:30:00.000Z'), UB);

    expect(date).toBe('2026-07-29');
    // Midnight in Ulaanbaatar (UTC+8) is 16:00 UTC the previous day.
    expect(start.toISOString()).toBe('2026-07-28T16:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-29T15:59:59.999Z');
  });

  it('spans exactly one day', () => {
    const { start, end } = dayBounds(new Date('2026-03-15T09:00:00.000Z'), UB);
    expect(end.getTime() - start.getTime()).toBe(86_400_000 - 1);
  });

  it('contains an instant that falls inside the local day', () => {
    const instant = new Date('2026-07-28T22:30:00.000Z');
    const { start, end } = dayBounds(instant, UB);

    expect(instant.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(instant.getTime()).toBeLessThanOrEqual(end.getTime());
  });

  it('walks back whole local days', () => {
    const now = new Date('2026-07-29T06:00:00.000Z');

    expect(dayBoundsAgo(now, UB, 0).date).toBe('2026-07-29');
    expect(dayBoundsAgo(now, UB, 1).date).toBe('2026-07-28');
    expect(dayBoundsAgo(now, UB, 13).date).toBe('2026-07-16');
  });

  it('crosses a month boundary correctly', () => {
    const now = new Date('2026-08-01T06:00:00.000Z');
    expect(dayBoundsAgo(now, UB, 1).date).toBe('2026-07-31');
  });

  /** A zone that does observe daylight saving, to prove no fixed offset is assumed. */
  it('honours a daylight saving shift rather than a fixed offset', () => {
    const winter = dayBounds(new Date('2026-01-15T12:00:00.000Z'), 'Europe/London');
    const summer = dayBounds(new Date('2026-07-15T12:00:00.000Z'), 'Europe/London');

    expect(winter.start.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    // British Summer Time is UTC+1, so local midnight is 23:00 the previous day.
    expect(summer.start.toISOString()).toBe('2026-07-14T23:00:00.000Z');
  });

  it('starts the month at local midnight on the first', () => {
    const start = monthStart(new Date('2026-07-29T06:00:00.000Z'), UB);
    expect(start.toISOString()).toBe('2026-06-30T16:00:00.000Z');
    expect(localDateString(start, UB)).toBe('2026-07-01');
  });
});
