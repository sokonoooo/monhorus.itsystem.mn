/**
 * Date and number formatting for the printed reports.
 *
 * THE TEMPLATE DOES NOT SETTLE THIS ON ITS OWN. «Үзлэгийн тайлан.docx» contains exactly
 * two dates: a cover field left blank for someone to write in by hand, and a bare year
 * — "2026 он". It never shows a full date, so there is no house format to copy and one
 * has to be chosen.
 *
 * The choice made here follows the document's register rather than inventing a third
 * style: prose spells the date out the way the cover spells the year, and table cells —
 * where a spelled-out date would wrap a column — use the numeric form. Both are
 * unambiguous to a Mongolian reader, which `DD/MM` versus `MM/DD` would not be.
 */

const MONTH_DAY = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Ulaanbaatar',
});

const PARTS = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'Asia/Ulaanbaatar',
});

/**
 * Rendered in Ulaanbaatar time, not the server's.
 *
 * A report says when work happened, and the reader is standing in Mongolia. A visit
 * logged at 08:30 local is 00:30 UTC, so a server formatting in UTC would print the day
 * before on every early-morning job.
 */
function safeDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `2026.08.11` — the table form, narrow enough for a column. */
export function formatDate(value: string | null | undefined): string {
  const date = safeDate(value);
  if (date === null) return '';
  return MONTH_DAY.format(date).replace(/-/g, '.');
}

/** `2026 оны 8 сарын 11` — the prose form, matching the cover's "2026 он". */
export function formatLongDate(value: string | null | undefined): string {
  const date = safeDate(value);
  if (date === null) return '';
  const parts = PARTS.formatToParts(date);
  const part = (type: string): string =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  // Unpadded, because this is the spoken form: "8 сарын 11", not "08 сарын 11". The
  // `en-CA` locale pads even when asked for `numeric`, so the zero is stripped here.
  const trim = (value: string): string => value.replace(/^0+(?=\d)/, '');
  return `${part('year')} оны ${trim(part('month'))} сарын ${trim(part('day'))}`;
}

/** The bare year the cover carries. */
export function formatYear(value: string | null | undefined): string {
  const date = safeDate(value);
  if (date === null) return '';
  return `${PARTS.formatToParts(date).find((e) => e.type === 'year')?.value ?? ''} он`;
}

/**
 * A quantity without trailing noise: `12` rather than `12.00`, `1.5` kept as `1.5`.
 *
 * Reports are read by people counting sockets, and a whole number printed with decimals
 * reads as a measurement that was taken more precisely than it was.
 */
export function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

/** `0` is a real percentage and prints as one; absent prints as nothing. */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return `${Math.round(value)}%`;
}

/** A score of 0 is a genuine score and must not be blanked by a falsy check. */
export function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/** Minutes as hours and minutes, for the delay and pause figures. */
export function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined || value <= 0) return '';
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  if (hours === 0) return `${minutes} мин`;
  return minutes === 0 ? `${hours} ц` : `${hours} ц ${minutes} мин`;
}

/** Joins the parts of a location or a name list, skipping the ones that are absent. */
export function joinParts(parts: ReadonlyArray<string | null | undefined>): string {
  return parts.filter((part): part is string => part !== null && part !== undefined && part !== '').join(' · ');
}
