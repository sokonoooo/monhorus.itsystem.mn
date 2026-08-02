import {
  OVERDUE_ELIGIBLE_LIFECYCLE_STATUSES,
  effectivePlannedWorkStatus,
  isOverdueEligible,
  type PlannedWorkEffectiveStatus,
} from '@monhorus/shared';
import { type HydratedDocument } from 'mongoose';

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

export function effectiveStatusOf(
  work: Pick<IPlannedWork, 'status' | 'plannedEndDate'>,
  now: Date = new Date(),
): PlannedWorkEffectiveStatus {
  return effectivePlannedWorkStatus(work.status, work.plannedEndDate, now);
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
  if (work.plannedEndDate.getTime() >= now.getTime()) return false;

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
  if (work.plannedEndDate.getTime() < now.getTime()) return false;

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
    plannedEndDate: { $lt: now },
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
