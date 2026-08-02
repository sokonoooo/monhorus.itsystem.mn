/**
 * Calendar-day arithmetic in a named timezone.
 *
 * "Today" on this dashboard means today in Ulaanbaatar, not today wherever the server
 * happens to run. `setHours` would give the server's local day, which is wrong the moment
 * the process runs in UTC, and that is the normal deployment.
 *
 * The zone is resolved through `Intl`, so daylight saving is handled by the platform
 * rather than by an offset constant. Mongolia does not observe it today, but nothing here
 * depends on that staying true.
 */

/** `YYYY-MM-DD` for an instant, as seen in the given timezone. */
export function localDateString(instant: Date, timeZone: string): string {
  // `en-CA` formats as YYYY-MM-DD, which is exactly the shape wanted and avoids
  // assembling the parts by hand.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** The timezone's offset from UTC at a given instant, in minutes. */
function offsetMinutes(instant: Date, timeZone: string): number {
  // Formatting the instant as if it were UTC and diffing against the real instant yields
  // the offset without hardcoding it.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const lookup = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asUtc = Date.UTC(
    lookup('year'),
    lookup('month') - 1,
    lookup('day'),
    // A midnight in some zones formats the hour as 24; normalise it to 0.
    lookup('hour') % 24,
    lookup('minute'),
    lookup('second'),
  );

  return (asUtc - instant.getTime()) / 60_000;
}

export interface DayBounds {
  /** First instant of the local day, as a UTC timestamp. */
  start: Date;
  /** Last instant of the local day, as a UTC timestamp. */
  end: Date;
  /** `YYYY-MM-DD` label for the day. */
  date: string;
}

/** The UTC instants bounding a local calendar day. */
export function dayBounds(instant: Date, timeZone: string): DayBounds {
  const date = localDateString(instant, timeZone);
  const [year, month, day] = date.split('-').map(Number);

  // Midnight local, expressed as UTC: take the naive UTC midnight and shift it back by
  // the zone offset in force at that moment.
  const naiveMidnight = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  const start = new Date(naiveMidnight - offsetMinutes(new Date(naiveMidnight), timeZone) * 60_000);
  const end = new Date(start.getTime() + 86_400_000 - 1);

  return { start, end, date };
}

/** The bounds of the local day `daysAgo` days before the given instant. */
export function dayBoundsAgo(instant: Date, timeZone: string, daysAgo: number): DayBounds {
  return dayBounds(new Date(instant.getTime() - daysAgo * 86_400_000), timeZone);
}

/** Start of the local month containing the instant, as a UTC timestamp. */
export function monthStart(instant: Date, timeZone: string): Date {
  const [year, month] = localDateString(instant, timeZone).split('-').map(Number);
  const naive = Date.UTC(year ?? 1970, (month ?? 1) - 1, 1);
  return new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
}
