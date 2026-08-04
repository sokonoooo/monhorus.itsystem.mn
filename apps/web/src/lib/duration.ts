/**
 * The one phrasing for a span of minutes: `2 цаг 30 мин`.
 *
 * Deliberately identical to `formatMinutes` in the employee app's
 * `features/employee/work/presentation/format.dart`, so the same sub-task reads the same
 * way on a handset and on a desk. If one changes the other has to change with it.
 *
 * It exists because five hand-rolled variants had grown across the planned-work screens
 * and two of them truncated silently: `Math.floor(minutes / 60)` printed a 45-minute pause
 * as `0ц`, and `Math.floor(minutes / 1440)` printed a three-hour delay as `0 өдөр`. Both
 * turned a real figure into a confident zero, which is worse than showing nothing.
 *
 * `null` is not zero: it means the figure cannot be stated yet — an unfinished sub-task has
 * no duration — and prints as the same dash every other unknown on these screens uses.
 */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '-';
  if (minutes <= 0) return '0 мин';

  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;

  if (hours === 0) return `${rest} мин`;
  if (rest === 0) return `${hours} цаг`;
  return `${hours} цаг ${rest} мин`;
}
