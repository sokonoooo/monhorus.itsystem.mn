import { logger } from '../../config/logger';

/**
 * The ceilings on unpaged reads, named and in one place.
 *
 * WHY THEY NEEDED NAMES. Each of these was a bare `.limit(500)` / `.limit(100)` / `.limit(50)`
 * sitting on a query. A bare number says how many rows to take but not what it is protecting
 * against or what happens to the rows it drops, so there was no way to tell a deliberate
 * ceiling from a forgotten one — and nothing in the response said a ceiling had been reached.
 *
 * WHAT A READER SEES WHEN ONE BITES. Nothing, which is the actual defect. The calendar simply
 * stops drawing partway through a long window; a device's timeline loses its oldest entries;
 * an employee's status history ends early. Every one of these reads renders as if it were
 * complete, so a gap is indistinguishable from an absence of records.
 *
 * WHAT IS FIXED HERE AND WHAT IS NOT. The limits are named, documented, and now announce
 * themselves through [noteTruncation] when they bite, so a truncated read leaves a trace an
 * operator can find. Telling the *client* is the other half, and it needs a field on each
 * response DTO — `truncatedAt`, the way `ReportResultDto` already does it (see
 * `report.service.ts`, where the web renders the notice). Those DTOs live in
 * `packages/shared`, which this change did not own; see the report accompanying it.
 */

/**
 * Calendar events per source, per window.
 *
 * The window the client may ask for reaches 92 days, and this cap applies to each of the two
 * sources separately, so a busy quarter can genuinely reach it.
 */
export const CALENDAR_EVENTS_PER_SOURCE_LIMIT = 500;

/** Report items on one device's timeline. */
export const OBJECT_TIMELINE_REPORT_ITEM_LIMIT = 100;

/** Audit rows on one device's timeline. */
export const OBJECT_TIMELINE_AUDIT_LIMIT = 100;

/** Status transitions shown on an employee record. */
export const EMPLOYEE_STATUS_HISTORY_LIMIT = 50;

/**
 * Children returned by `GET /objects/nodes`.
 *
 * This route answers a dependent selector one level at a time, and unlike every other list
 * endpoint it returns a bare array with no `total`, so a client cannot detect that it was
 * cut short even in principle. Changing that is a client-visible contract change affecting
 * the web console and both Flutter apps; it is recommended rather than made here.
 */
export const OBJECT_NODE_CHILDREN_DEFAULT_LIMIT = 100;
export const OBJECT_NODE_CHILDREN_MAX_LIMIT = 200;

/**
 * Records that a capped read actually hit its cap.
 *
 * Deliberately a warning rather than an error: a truncated list is a degraded answer, not a
 * failed operation, and failing the request would be worse for the reader than the short list
 * is. It follows the precedent in `notification.service.ts`, which logs rather than throws
 * when a customer notification reaches nobody — the same shape of silent partial failure.
 *
 * `rows === limit` is the only signal available without a second count query. It over-reports
 * by one case, the read whose row count is exactly the cap, which is the right direction to
 * be wrong in: a spurious line in the log costs an operator a moment, a missing one costs
 * them the bug.
 */
export function noteTruncation(
  read: string,
  rows: number,
  limit: number,
  context: Record<string, unknown> = {},
): void {
  if (rows < limit) return;
  logger.warn({ read, limit, ...context }, `Capped read reached its limit: ${read}`);
}
