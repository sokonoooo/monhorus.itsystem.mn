/**
 * Clears the overdue stamps and late-completion marks that the UTC-day framing wrote.
 *
 * WHY THIS EXISTS
 *
 * `plannedEndDate` is a calendar date. The web writes it with `<input type="date">` and
 * stamps that date at UTC midnight, which is 08:00 in Ulaanbaatar. The overdue comparison
 * used to run against that raw instant, so a work due 10 September breached at 08:00 on
 * the 10th with a full working day still to run.
 *
 * The comparison is now framed on the local day — `overdueBoundary` in
 * `planned-work.overdue.service.ts`, the same expression `invoice.service.ts` uses for a
 * due date. That repairs the DERIVED status everywhere on its own: `effectiveStatusOf`
 * recomputes on every read, so no stored date has to move and this script does not touch
 * one.
 *
 * What it cannot repair is the state the old comparison PERSISTED before it was fixed:
 *
 *   1. `overdueAt` — stamped once and then never cleared except by an authorised
 *      reschedule. `markOverdueIfNeeded` skips any work that already carries a stamp, so a
 *      work wrongly marked at 08:00 on its own due date stays marked for good. It anchors
 *      late-completion reporting and the audit trail.
 *   2. `overdueNotificationSentAt` — the marker `sweepPlannedWorkOverdue` keys off. It is
 *      cleared alongside `overdueAt` so a work that later breaches for real is announced.
 *   3. `completedLate` / `delayMinutes` — written at COMPLETE from the same raw comparison,
 *      so a work finished at 09:00 on its own due date was recorded as an hour late,
 *      permanently, in reporting history.
 *
 * HOW IT TELLS A WRONGLY-STAMPED ROW FROM A GENUINELY LATE ONE
 *
 * It does not try to guess which client wrote a row, and deliberately does NOT key off the
 * `T00:00:00.000Z` shape. That test would be both unsound and unnecessary: unsound because
 * a row legitimately carrying midnight UTC is indistinguishable from one the buggy form
 * produced, and unnecessary because the corrected predicate answers the question directly.
 * Every candidate is re-evaluated with the SAME functions the application now uses —
 * `overdueBoundary` for the stamps, `deadlineEndOf` for the late marks — and a row is only
 * touched when the corrected answer disagrees with what is stored. A row that is genuinely
 * overdue, whatever instant it carries, is left exactly as it is.
 *
 * That also makes the script idempotent: a second run re-evaluates the same predicate,
 * finds nothing in disagreement, and writes nothing.
 *
 * Run:
 *   npm run repair:planned-work-overdue-day --workspace @monhorus/backend -- --dry-run
 *   npm run repair:planned-work-overdue-day --workspace @monhorus/backend -- --apply
 */

import { OVERDUE_ELIGIBLE_LIFECYCLE_STATUSES } from '@monhorus/shared';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { PlannedWork } from '../modules/planned-work/planned-work.models';
import {
  deadlineEndOf,
  overdueBoundary,
} from '../modules/planned-work/planned-work.overdue.service';

/** A work whose overdue stamp the corrected comparison does not support. */
export interface ClearedStamp {
  workId: string;
  workNumber: string;
  plannedEndDate: string;
  overdueAt: string;
  /** True when a breach notification had already gone out for this false positive. */
  notificationAlreadySent: boolean;
}

/** A completed work whose lateness the corrected comparison does not support. */
export interface ClearedLateMark {
  workId: string;
  workNumber: string;
  plannedEndDate: string;
  actualEndDate: string;
  /** What the UTC framing recorded. */
  previousDelayMinutes: number | null;
}

export interface RepairResult {
  /** Stamped works examined. */
  scannedStamped: number;
  /** Completed-late works examined. */
  scannedLate: number;
  clearedStamps: ClearedStamp[];
  clearedLateMarks: ClearedLateMark[];
  dryRun: boolean;
}

/**
 * Re-evaluates every persisted overdue stamp and late mark against the local-day framing.
 *
 * Exported so the behaviour is asserted by a test rather than only by running it against a
 * real database.
 */
export async function repairPlannedWorkOverdueDay(
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<RepairResult> {
  const dryRun = options.dryRun ?? true;
  const now = options.now ?? new Date();
  const boundary = overdueBoundary(now);

  const result: RepairResult = {
    scannedStamped: 0,
    scannedLate: 0,
    clearedStamps: [],
    clearedLateMarks: [],
    dryRun,
  };

  // -- 1. Overdue stamps ------------------------------------------------------
  //
  // Only works still in an overdue-eligible lifecycle status. A stamp on a completed or
  // cancelled work is history that the lifecycle has already moved past, and the late
  // marks below are the surface that actually reports on it.
  const stamped = await PlannedWork.find({
    status: { $in: OVERDUE_ELIGIBLE_LIFECYCLE_STATUSES },
    overdueAt: { $ne: null },
  })
    .select('_id workNumber plannedEndDate overdueAt overdueNotificationSentAt')
    .lean();

  result.scannedStamped = stamped.length;

  for (const work of stamped) {
    // The corrected predicate, reached by the same expression the application uses.
    const stillOverdue = work.plannedEndDate.getTime() < boundary.getTime();
    if (stillOverdue) continue;

    result.clearedStamps.push({
      workId: String(work._id),
      workNumber: work.workNumber,
      plannedEndDate: work.plannedEndDate.toISOString(),
      overdueAt: (work.overdueAt as Date).toISOString(),
      notificationAlreadySent: work.overdueNotificationSentAt !== null,
    });

    if (!dryRun) {
      // Guarded on the stamp still being present, so a concurrent reschedule that already
      // cleared it is not written over.
      await PlannedWork.updateOne(
        { _id: work._id, overdueAt: { $ne: null } },
        { $set: { overdueAt: null, overdueNotificationSentAt: null } },
      );
    }
  }

  // -- 2. Late completion marks ----------------------------------------------
  const late = await PlannedWork.find({
    completedLate: true,
    actualEndDate: { $ne: null },
  })
    .select('_id workNumber plannedEndDate actualEndDate delayMinutes')
    .lean();

  result.scannedLate = late.length;

  for (const work of late) {
    const actualEnd = work.actualEndDate as Date;
    // Lateness is measured from the end of the deadline DAY, not from the stored instant.
    const stillLate = actualEnd.getTime() > deadlineEndOf(work.plannedEndDate).getTime();
    if (stillLate) continue;

    result.clearedLateMarks.push({
      workId: String(work._id),
      workNumber: work.workNumber,
      plannedEndDate: work.plannedEndDate.toISOString(),
      actualEndDate: actualEnd.toISOString(),
      previousDelayMinutes: work.delayMinutes,
    });

    if (!dryRun) {
      await PlannedWork.updateOne(
        { _id: work._id, completedLate: true },
        { $set: { completedLate: false, delayMinutes: null } },
      );
    }
  }

  return result;
}

async function main(): Promise<void> {
  // Dry run is the default. Writing takes an explicit --apply, because this clears audit
  // anchors and reporting history and that is the operator's call, not the script's.
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;

  await connectDatabase();

  const result = await repairPlannedWorkOverdueDay({ dryRun });

  logger.info(
    {
      dryRun,
      scannedStamped: result.scannedStamped,
      scannedLate: result.scannedLate,
      clearedStamps: result.clearedStamps.length,
      clearedLateMarks: result.clearedLateMarks.length,
    },
    result.clearedStamps.length === 0 && result.clearedLateMarks.length === 0
      ? 'Nothing to repair; every stored stamp agrees with the local-day framing'
      : dryRun
        ? 'Dry run: no changes written. Re-run with --apply to write.'
        : 'Repair complete',
  );

  // Listed individually as well as counted: an operator reconciling an audit trail needs
  // to see exactly which works lost a stamp, and the list is bounded by how many were
  // wrongly marked.
  for (const entry of result.clearedStamps) {
    logger.info(
      {
        workId: entry.workId,
        workNumber: entry.workNumber,
        plannedEndDate: entry.plannedEndDate,
        overdueAt: entry.overdueAt,
        notificationAlreadySent: entry.notificationAlreadySent,
      },
      dryRun ? 'Would clear false overdue stamp' : 'Cleared false overdue stamp',
    );
  }

  for (const entry of result.clearedLateMarks) {
    logger.info(
      {
        workId: entry.workId,
        workNumber: entry.workNumber,
        plannedEndDate: entry.plannedEndDate,
        actualEndDate: entry.actualEndDate,
        previousDelayMinutes: entry.previousDelayMinutes,
      },
      dryRun ? 'Would clear false late-completion mark' : 'Cleared false late-completion mark',
    );
  }

  // The breach audit events themselves are deliberately left in place. They are an
  // append-only record of what the system observed and announced at the time; deleting
  // them would erase the evidence that the false alarm happened, which is the opposite of
  // what an audit trail is for.
  if (result.clearedStamps.some((entry) => entry.notificationAlreadySent)) {
    logger.warn(
      { count: result.clearedStamps.filter((entry) => entry.notificationAlreadySent).length },
      'Some cleared works had already announced a breach. The PLANNED_WORK_BECAME_OVERDUE audit events and the sent notifications are left in place on purpose; they record what was observed at the time.',
    );
  }

  await disconnectDatabase();
}

// Only when run as a script. Importing this file from a test must not open a connection.
if (process.argv[1]?.includes('repair-planned-work-overdue-day')) {
  main().catch((error: unknown) => {
    logger.error({ err: error }, 'repair-planned-work-overdue-day failed');
    process.exit(1);
  });
}
