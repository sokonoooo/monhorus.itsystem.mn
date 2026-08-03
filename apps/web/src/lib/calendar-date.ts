/**
 * Calendar-date helpers for `<input type="date">` and `<input type="month">` values.
 *
 * `Date.prototype.toISOString()` formats in UTC, so slicing it for a `yyyy-mm-dd`
 * value yields the *previous* day whenever local time runs ahead of UTC and the
 * clock reads earlier than the offset. Ulaanbaatar is UTC+8, so every day between
 * 00:00 and 08:00 local an invoice would default to yesterday's issue date, and a
 * monthly run started on the 1st before 08:00 would default to the previous month's
 * billing period.
 *
 * A date input holds a calendar date, not an instant, so these read the local
 * fields instead. Anything that is genuinely an instant — a timestamp sent to the
 * API — should keep using `toISOString()`.
 */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `yyyy-mm-dd` in the viewer's own timezone. */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `yyyy-mm` in the viewer's own timezone. */
export function toMonthInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function todayDateInput(): string {
  return toDateInput(new Date());
}

export function currentMonthInput(): string {
  return toMonthInput(new Date());
}

/**
 * Today plus `days`, as a date-input value.
 *
 * `setDate` past the end of the month rolls over correctly, and it operates on the
 * local fields, which is what keeps this consistent with `todayDateInput`.
 */
export function addDaysToToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

/** First day of the current month, as a date-input value. */
export function monthStartDateInput(): string {
  const date = new Date();
  return toDateInput(new Date(date.getFullYear(), date.getMonth(), 1));
}
