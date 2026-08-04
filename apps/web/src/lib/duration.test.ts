import { describe, expect, it } from 'vitest';

import { formatMinutes } from './duration';

/**
 * The phrasing is a cross-app contract: it must match `formatMinutes` in the employee
 * app's `features/employee/work/presentation/format.dart` word for word, because the same
 * sub-task duration is read on both. The expectations below are that Dart function's
 * output, not this implementation's.
 */
describe('formatMinutes', () => {
  it('renders hours and minutes together', () => {
    expect(formatMinutes(150)).toBe('2 цаг 30 мин');
  });

  it('drops the minutes on a whole number of hours', () => {
    expect(formatMinutes(180)).toBe('3 цаг');
  });

  it('keeps a sub-hour span visible instead of truncating it to zero', () => {
    // The bug this helper replaces: Math.floor(45 / 60) printed a 45-minute pause as "0ц".
    expect(formatMinutes(45)).toBe('45 мин');
    // And Math.floor(180 / 1440) printed a three-hour delay as "0 өдөр".
    expect(formatMinutes(180)).not.toBe('0 мин');
  });

  it('says nothing rather than zero when the figure is unknown', () => {
    expect(formatMinutes(null)).toBe('-');
    expect(formatMinutes(undefined)).toBe('-');
  });

  it('treats a zero or negative span as zero minutes', () => {
    expect(formatMinutes(0)).toBe('0 мин');
    expect(formatMinutes(-5)).toBe('0 мин');
  });

  it('spans well past a day without changing unit', () => {
    expect(formatMinutes(1500)).toBe('25 цаг');
  });
});
