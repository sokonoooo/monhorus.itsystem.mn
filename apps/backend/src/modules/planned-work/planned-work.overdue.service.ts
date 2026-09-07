import {
  OVERDUE_ELIGIBLE_LIFECYCLE_STATUSES,
  effectivePlannedWorkStatus,
  isOverdueEligible,
  type PlannedWorkEffectiveStatus,
} from '@monhorus/shared';
import { type HydratedDocument } from 'mongoose';

import { dayBounds } from '../../common/utils/day-bounds.util';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { recordAudit } from '../audit/audit.service';
import { PlannedWork, type IPlannedWork } from './planned-work.models';

/**
 * A loaded Mongoose document. `HydratedDocument` carries both the plain fields and the
 * document methods (`save`, `populate`), which a bare intersection with `_id` does not.
 */
type Doc<T> = HydratedDocument<T>;

/**
 * Overdue reconciliation.
 *
 * OVERDUE is a derived, system-controlled state. No route lets a user set it. The
 * backend is the sole authority: `effectiveStatusOf` computes the value published on
 * every DTO, and `overdueAt` records the first instant a breach was observed so the
 * audit trail and late-completion reporting have a stable anchor.
 *
 * Two mechanisms keep `overdueAt` accurate:
 *   1. an hourly reconciliation job, which is what makes the breach audit event and any
 *      future notification fire close to the moment it happens;
 *   2. a fallback pass on the reads and mutations that touch a work, so a stamp is never
 *      missing just because the job has not run yet.
 */

/**
 * The instant a deadline must fall strictly before to count as breached: the start of
 * today in Ulaanbaatar. A work due yesterday or earlier is overdue; one due today is not.
 *
 * WHY THE `now` SIDE AND NOT THE STORED SIDE. `plannedEndDate` is a calendar date, not an
 * instant. Every surface that writes it uses `<input type="date">`, every surface that
 * reads it back does `iso.slice(0, 10)`, and nothing in the product can express a time of
 * day for a deadline. The web stamps that date at UTC midnight, which is 08:00 in
 * Ulaanbaatar — so comparing the raw stored value against a raw `now` called a work due
 * 10 September overdue at 08:01 on the 10th, with a full working day still to run. It
 * then persisted `overdueAt`, wrote a one-time breach audit event and fired
 * `PLANNED_WORK_OVERDUE`.
 *
 * Normalising `now` down to the start of the local day, rather than rewriting the stored
 * instant, is the fix `invoice.service.ts` already applies to `dueDate` — the sibling
 * field with the sibling bug (see `overdueBoundary` there, reached by the same
 * expression). It is the better half of the trade for three reasons:
 *
 *   1. It is expressible in a Mongo query. `runOverdueReconciliation` filters on
 *      `plannedEndDate` in the database; `dayBounds(plannedEndDate)` cannot be applied to
 *      a stored field without an aggregation, but a normalised `now` is just a value.
 *   2. It repairs every existing row at once. Rewriting stored instants would fix only
 *      the rows a migration reached, and would leave every future client that stamps a
 *      date at UTC midnight — the natural thing to do — silently reintroducing the bug.
 *   3. It keeps one convention for "a calendar date stored as an instant" across the
 *      codebase instead of two.
 *
 * Consequence worth naming: a caller that sends a genuinely precise instant has it
 * rounded out to the end of that local day. That is deliberate — the field means a day —
 * and it matches how an invoice due date behaves.
 */
export function overdueBoundary(now: Date = new Date()): Date {
  return dayBounds(now, env.APP_TIMEZONE).start;
}

/**
 * The last instant of the deadline day, in Ulaanbaatar.
 *
 * The anchor lateness is measured from, so a work completed at 09:00 on its own due date
 * is not "an hour late". Mirrors `dueEndOf` in `invoice.service.ts`.
 */
export function deadlineEndOf(plannedEndDate: Date): Date {
  return dayBounds(plannedEndDate, env.APP_TIMEZONE).end;
}

/**
 * The single funnel for the derived status.
 *
 * Every caller goes through here rather than calling `effectivePlannedWorkStatus`
 * directly, so the boundary is applied by construction instead of by each caller
 * remembering to normalise `now`.
 */
export function effectiveStatusOf(
  work: Pick<IPlannedWork, 'status' | 'plannedEndDate'>,
  now: Date = new Date(),
): PlannedWorkEffectiveStatus {
  return effectivePlannedWorkStatus(work.status, work.plannedEndDate, overdueBoundary(now));
}

/**
 * Stamps `overdueAt` on a work that has just crossed its deadline, and writes the
 * one-time breach audit event.
 *
 * Idempotent: a work that already carries `overdueAt` is left alone, so the audit event
 * is written once per breach rather than once per reconciliation pass. The update is
 * conditional on `overdueAt` still being null, so two concurrent passes cannot both
 * write the event.
 *
 * Returns true when this call was the one that recorded the breach.
 */
export async function markOverdueIfNeeded(
  work: Doc<IPlannedWork>,
  now: Date = new Date(),
): Promise<boolean> {
  if (!isOverdueEligible(work.status)) return false;
  if (work.overdueAt !== null) return false;
  // Framed on the local day, not the raw instant. See `overdueBoundary`.
  if (work.plannedEndDate.getTime() >= overdueBoundary(now).getTime()) return false;

  const claimed = await PlannedWork.updateOne(
    { _id: work._id, overdueAt: null },
    { $set: { overdueAt: now } },
  );

  // Another pass won the race and already recorded the breach.
  if (claimed.modifiedCount === 0) return false;

  work.overdueAt = now;

  await recordAudit({
    entityType: 'PlannedWork',
    entityId: work._id,
    action: 'PLANNED_WORK_BECAME_OVERDUE',
    // System-controlled: there is no human actor for a deadline passing.
    actor: { id: null, role: null, label: 'SYSTEM' },
    reason: 'planned end date passed',
    oldValue: { effectiveStatus: work.status },
    newValue: {
      effectiveStatus: 'OVERDUE',
      plannedEndDate: work.plannedEndDate.toISOString(),
      overdueAt: now.toISOString(),
    },
  });

  return true;
}

/**
 * Clears `overdueAt` when the deadline now sits in the future.
 *
 * Only ever reached from the authorised reschedule path, which supplies a permission
 * check, a mandatory reason and its own audit record. A client sending a different date
 * through an ordinary update cannot get here.
 */
export async function clearOverdueAfterReschedule(
  work: Doc<IPlannedWork>,
  now: Date = new Date(),
): Promise<boolean> {
  if (work.overdueAt === null) return false;
  // Same boundary as `markOverdueIfNeeded`, so a reschedule to today lifts the breach
  // rather than leaving a work stamped for a deadline that has not actually passed.
  if (work.plannedEndDate.getTime() < overdueBoundary(now).getTime()) return false;

  await PlannedWork.updateOne(
    { _id: work._id },
    { $set: { overdueAt: null, overdueNotificationSentAt: null } },
  );
  work.overdueAt = null;
  work.overdueNotificationSentAt = null;
  return true;
}

/** Fallback pass over the works a read is about to return. */
export async function reconcileOverdueForWorks(
  works: readonly Doc<IPlannedWork>[],
  now: Date = new Date(),
): Promise<void> {
  for (const work of works) {
    await markOverdueIfNeeded(work, now);
  }
}

export interface OverdueReconciliationResult {
  scanned: number;
  markedOverdue: number;
}

/**
 * Hourly sweep over every outstanding work whose deadline has passed and which has not
 * yet been stamped. Bounded by the compound index on status, plannedEndDate, overdueAt.
 */
export async function runOverdueReconciliation(
  now: Date = new Date(),
): Promise<OverdueReconciliationResult> {
  const candidates = await PlannedWork.find({
    status: { $in: OVERDUE_ELIGIBLE_LIFECYCLE_STATUSES },
    // The normalised boundary is a plain value, so the local-day framing survives being
    // pushed down into the query and the index still bounds the scan.
    plannedEndDate: { $lt: overdueBoundary(now) },
    overdueAt: null,
  }).limit(1000);

  let markedOverdue = 0;
  for (const work of candidates) {
    if (await markOverdueIfNeeded(work, now)) markedOverdue += 1;
  }

  if (markedOverdue > 0) {
    logger.info({ markedOverdue }, 'Planned work overdue reconciliation marked new breaches');
  }

  return { scanned: candidates.length, markedOverdue };
}
