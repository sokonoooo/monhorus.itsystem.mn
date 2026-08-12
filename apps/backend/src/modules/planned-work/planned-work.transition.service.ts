import {
  PLANNED_WORK_ACTIONS,
  PLANNED_WORK_ACTION_RULES,
  PLANNED_WORK_STATUS_LABELS,
  resumeTargetStatus,
  type PlannedWorkAction,
  type PlannedWorkAvailableActionDto,
  type PlannedWorkLifecycleStatus,
  type PlannedWorkTransitionInput,
} from '@monhorus/shared';
import { Types, type ClientSession, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { withTransaction } from '../../common/utils/transaction.util';
import { logger } from '../../config/logger';
import { hasPermission } from '../../middlewares/authorize.middleware';
import { recordAudit } from '../audit/audit.service';
import {
  writeReport,
  type ReportItemInput,
} from '../report-record/report-record.service';
import {
  PlannedWork,
  PlannedWorkReport,
  PlannedWorkTask,
  type IPlannedWork,
} from './planned-work.models';
import { allTasksComplete, completionBlockersOf } from './planned-work.progress.service';
import { assertPlannedWorkAssignmentScope } from './planned-work.scope';

/**
 * A loaded Mongoose document. `HydratedDocument` carries both the plain fields and the
 * document methods (`save`, `populate`), which a bare intersection with `_id` does not.
 */
type Doc<T> = HydratedDocument<T>;

/**
 * The single authority for planned-work lifecycle changes.
 *
 * No other module writes `status`, and no generic PATCH endpoint accepts it. Every
 * change passes through here so the transition matrix, the permission gate, the reason
 * requirement and the audit record can never be bypassed.
 *
 * OVERDUE is absent from this matrix on purpose: it is a derived effective status, not a
 * lifecycle state, and is therefore not reachable by any action.
 *
 * ARCHIVE is also absent as a user action. Archiving happens only as the tail of report
 * approval, through `archiveAfterReportApproval`.
 */

/** Target lifecycle status for an action against a specific record. */
export function targetStatusFor(
  action: PlannedWorkAction,
  work: Pick<IPlannedWork, 'actualStartDate'>,
): PlannedWorkLifecycleStatus {
  if (action === 'RESUME') return resumeTargetStatus(work.actualStartDate !== null);
  const configured = PLANNED_WORK_ACTION_RULES[action].to;
  // RESUME is the only rule with a dynamic target, and it is handled above.
  return configured as PlannedWorkLifecycleStatus;
}

/**
 * Actions the caller may perform on this record right now.
 *
 * The web client builds its buttons exclusively from this list, so the frontend never
 * needs to reimplement the matrix and cannot drift from it.
 */
export function availableActionsFor(
  work: Doc<IPlannedWork>,
  actor: AuthContext,
  completionAllowed: boolean,
  /**
   * Whether assignment scope permits acting on this record at all. Passed in because the
   * scope policy is a database read and this mapper is synchronous; `loadDetail` resolves
   * it once per detail response. Defaults to true so that an unrelated caller of this
   * helper cannot silently *widen* the list — the value has to be supplied to narrow it.
   */
  assignmentAllowed = true,
): PlannedWorkAvailableActionDto[] {
  const actions: PlannedWorkAvailableActionDto[] = [];

  for (const action of PLANNED_WORK_ACTIONS) {
    const rule = PLANNED_WORK_ACTION_RULES[action];
    if (!rule.from.includes(work.status)) continue;
    if (!hasPermission(actor, rule.permission)) continue;
    // Never offer a button the assignment-scope policy will refuse. The refusal in
    // `transitionPlannedWork` is the authority; this only keeps the client honest.
    if (!assignmentAllowed) continue;
    // COMPLETE is offered only when every completion rule already passes.
    if (action === 'COMPLETE' && !completionAllowed) continue;

    actions.push({
      action,
      label: rule.label,
      requiresReason: rule.requiresReason,
      targetStatus: targetStatusFor(action, work),
    });
  }

  return actions;
}

function assertTransitionAllowed(
  action: PlannedWorkAction,
  work: Doc<IPlannedWork>,
  actor: AuthContext,
  reason: string | null,
): void {
  const rule = PLANNED_WORK_ACTION_RULES[action];

  if (!hasPermission(actor, rule.permission)) {
    throw AppError.forbidden(ERROR_CODES.FORBIDDEN, 'Энэ үйлдлийг хийх эрх байхгүй байна.');
  }

  if (!rule.from.includes(work.status)) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      `"${PLANNED_WORK_STATUS_LABELS[work.status]}" төлөвөөс "${rule.label}" үйлдэл хийх боломжгүй.`,
      [{ field: 'action', message: 'Төлөвийн шилжилт зөвшөөрөгдөөгүй.' }],
    );
  }

  if (rule.requiresReason && (reason ?? '').trim().length < 5) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Шалтгаан заавал бөглөнө.', [
      { field: 'reason', message: 'Шалтгаан дор хаяж 5 тэмдэгттэй байна.' },
    ]);
  }
}

export interface TransitionResult {
  previousStatus: PlannedWorkLifecycleStatus;
  newStatus: PlannedWorkLifecycleStatus;
  /** True when a consolidated report was created as part of completion. */
  reportCreated: boolean;
}

/**
 * Applies one lifecycle action.
 *
 * Completion touches the work, its report and the audit trail together, so the whole
 * action runs inside a transaction.
 */
export async function transitionPlannedWork(
  work: Doc<IPlannedWork>,
  input: PlannedWorkTransitionInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<TransitionResult> {
  const reason = input.reason?.trim() ? input.reason.trim() : null;
  assertTransitionAllowed(input.action, work, actor, reason);

  /**
   * Assignment scope, checked AFTER the permission gate and independently of it.
   *
   * Holding the action's permission answers "may this caller ever do this"; it says nothing
   * about whose job this is. Both PLAN, START, PAUSE, RESUME and COMPLETE (all keyed on
   * `planned_work.change_status`) and CANCEL come through here, so this one call is what
   * closes the whole endpoint. CANCEL is keyed on `planned_work.cancel`, which is an
   * oversight permission, so a legitimate canceller is unscoped and unaffected.
   */
  await assertPlannedWorkAssignmentScope(work._id, actor);

  const previousStatus = work.status;
  const newStatus = targetStatusFor(input.action, work);
  const now = new Date();

  // Completion is gated on the quantity and evidence rules, not on a user's opinion.
  if (input.action === 'COMPLETE') {
    const tasks = await PlannedWorkTask.find({ plannedWork: work._id });
    if (!allTasksComplete(tasks)) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Бүх дэд ажил бүрэн биелээгүй байна.',
        completionBlockersOf(tasks).map((message) => ({ field: 'tasks', message })),
      );
    }
  }

  let reportCreated = false;

  await withTransaction(async (session) => {
    const options = session ? { session } : {};
    const update: Record<string, unknown> = { status: newStatus };

    switch (input.action) {
      case 'START': {
        // Only stamp the first start; a resumed work keeps its original start.
        if (work.actualStartDate === null) update.actualStartDate = now;
        break;
      }

      case 'PAUSE': {
        // Pausing never rewrites the schedule: the original deadline stays in force and
        // the work can therefore still become overdue while paused.
        update.currentPauseStartedAt = now;
        await PlannedWork.updateOne(
          { _id: work._id },
          {
            $push: {
              pauseHistory: {
                pausedAt: now,
                pausedBy: new Types.ObjectId(actor.userId),
                pausedByName: actor.fullName,
                reason,
                resumedAt: null,
                resumedBy: null,
                resumedByName: null,
              },
            },
          },
          options,
        );
        break;
      }

      case 'RESUME': {
        const pausedSince = work.currentPauseStartedAt;
        const pausedMinutes = pausedSince
          ? Math.max(0, Math.round((now.getTime() - pausedSince.getTime()) / 60_000))
          : 0;

        update.currentPauseStartedAt = null;
        update.totalPausedMinutes = work.totalPausedMinutes + pausedMinutes;

        // Close the open pause episode. The paused duration is recorded but is never
        // added to plannedEndDate: extending a deadline requires an explicit reschedule.
        const openIndex = work.pauseHistory.findIndex((entry) => entry.resumedAt === null);
        if (openIndex >= 0) {
          await PlannedWork.updateOne(
            { _id: work._id },
            {
              $set: {
                [`pauseHistory.${openIndex}.resumedAt`]: now,
                [`pauseHistory.${openIndex}.resumedBy`]: new Types.ObjectId(actor.userId),
                [`pauseHistory.${openIndex}.resumedByName`]: actor.fullName,
              },
            },
            options,
          );
        }
        break;
      }

      case 'COMPLETE': {
        update.actualEndDate = now;
        // Lateness is preserved in reporting history even though the work is finished.
        const late = now.getTime() > work.plannedEndDate.getTime();
        update.completedLate = late;
        update.delayMinutes = late
          ? Math.round((now.getTime() - work.plannedEndDate.getTime()) / 60_000)
          : null;
        break;
      }

      case 'CANCEL':
      /**
       * REJECT shares CANCEL's bookkeeping because it shares its destination: refusing a
       * customer's request ends the record, and the reason it ends is the thing the
       * customer needs to read. Falling through rather than repeating the four writes keeps
       * the two from drifting — a reason recorded on one and not the other would be a
       * cancelled work with no explanation on somebody's portal screen.
       */
      case 'REJECT': {
        update.cancelReason = reason;
        update.cancelledBy = new Types.ObjectId(actor.userId);
        update.cancelledByName = actor.fullName;
        update.cancelledAt = now;
        break;
      }

      case 'PLAN':
        break;
    }

    await PlannedWork.updateOne({ _id: work._id }, { $set: update }, options);

    // The consolidated report is created in DRAFT the moment the work completes, so the
    // author has something to fill in and the workflow has a single entry point.
    //
    // An UPSERT rather than a read-then-create: the crew can now author the write-up while
    // the job runs (`updateReport` in planned-work.report.service.ts opens the same row),
    // so by the time COMPLETE arrives the row often already exists. `plannedWork` is
    // uniquely indexed, so a blind create would fail the whole completion on a duplicate
    // key, and a read-then-create would still lose a race with a concurrent first PATCH.
    if (input.action === 'COMPLETE') {
      const result = await PlannedWorkReport.updateOne(
        { plannedWork: work._id },
        {
          $setOnInsert: {
            plannedWork: work._id,
            status: 'DRAFT',
            conclusion: null,
            recommendation: null,
            createdBy: new Types.ObjectId(actor.userId),
            createdByName: actor.fullName,
          },
        },
        { ...options, upsert: true },
      );

      // Only a genuine insert is the completion's own doing; an existing draft keeps its
      // original author and its original REPORT_CREATED audit row.
      reportCreated = (result.upsertedCount ?? 0) > 0;
    }
  });

  await recordAudit({
    entityType: 'PlannedWork',
    entityId: work._id,
    action: input.action === 'CANCEL' ? 'Cancelled' : 'StatusChanged',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason,
    oldValue: { status: previousStatus },
    newValue: { status: newStatus, action: input.action },
  });

  if (reportCreated) {
    await recordAudit({
      entityType: 'PlannedWorkReport',
      entityId: work._id,
      action: 'REPORT_CREATED',
      actor: { id: actor.userId, role: actor.role, label: actor.fullName },
      meta,
      reason: 'planned work completed',
      newValue: { status: 'DRAFT' },
    });
  }

  // The canonical report is derived from the completion, never part of it: the work is
  // COMPLETED once the transaction above commits, and a failure to mirror that into the
  // central store must not read as a failed completion the caller would retry.
  if (input.action === 'COMPLETE') {
    try {
      await writeCanonicalPlannedWorkReport(work, 'DRAFT', actor);
    } catch (error) {
      logger.error(
        { err: error, plannedWork: String(work._id) },
        'completed planned work could not reach the report store',
      );
    }
  }

  return { previousStatus, newStatus, reportCreated };
}

/**
 * Creates or corrects THE report a planned work raises in the central store.
 *
 * One report per work, per (customer, sourceType, sourceId): the unique index on Report
 * is what makes a retried completion or a re-approval correct this row rather than write
 * a second, so no lookup happens here. Items are one per sub-task related object, carrying
 * that sub-task's score, note, Дүгнэлт and Зөвлөмж — one score fanned to all its objects,
 * never a score per object. The consolidated report keeps its own conclusion and
 * recommendation alongside these. A sub-task naming no equipment contributes no item, and
 * a work with none still gets a searchable report carrying its own
 * customer/project/building.
 *
 * Written in DRAFT at COMPLETE and corrected to APPROVED by report approval; the scores
 * only reach equipment and rollups once `applyReportSafely` runs on the approved row.
 * Object tenancy is enforced at input time (`assertRelatedObjects` refuses a sub-task
 * naming another customer's equipment), so everything read here already belongs to the
 * work's customer.
 */
export async function writeCanonicalPlannedWorkReport(
  work: Doc<IPlannedWork>,
  status: 'DRAFT' | 'APPROVED',
  actor: AuthContext,
): Promise<Types.ObjectId> {
  const [tasks, report] = await Promise.all([
    PlannedWorkTask.find({ plannedWork: work._id }).sort({ plannedStartDate: 1, title: 1 }),
    PlannedWorkReport.findOne({ plannedWork: work._id }).select('conclusion recommendation'),
  ]);

  const items: ReportItemInput[] = [];
  for (const task of tasks) {
    for (const objectId of task.relatedObjects) {
      items.push({
        object: objectId,
        score: task.score,
        // The sub-task's Тайлбар is what was seen on this piece of equipment; its Дүгнэлт
        // is the verdict drawn from it. Both travel to the item, which is what fills the
        // Ажиглалт and Дүгнэлт columns of Үзлэг ба дүгнэлт for a planned-work row.
        observation: task.note,
        conclusion: task.conclusion,
        recommendation: task.recommendation,
        // The technician who wrote that Дүгнэлт, stamped on the sub-task when its text
        // last changed. It travels with the verdict so the equipment's history can name
        // the person who judged it instead of only the manager who approved the report —
        // and one work's sub-tasks may have been concluded by different technicians, which
        // is exactly why this is per item and not per report. Null on a sub-task whose
        // conclusion was never written.
        judgedBy: task.conclusionBy,
        judgedByName: task.conclusionByName,
        evidenceAttachments: [...task.beforePhotos, ...task.afterPhotos],
      });
    }
  }

  const canonical = await writeReport({
    type: 'PLANNED_WORK',
    status,
    title: `${work.workNumber} — ${work.title}`.slice(0, 200),
    sourceType: 'PLANNED_WORK',
    sourceId: work._id,
    sourceReference: work.workNumber,
    conclusion: report?.conclusion ?? null,
    recommendation: report?.recommendation ?? null,
    items,
    // Only for a work naming no equipment: with items, the hierarchy is resolved from the
    // equipment itself, which is what lets a job with no project still roll all the way up.
    hierarchy:
      items.length === 0
        ? { customer: work.customer, project: work.project, building: work.building }
        : undefined,
    actor: { id: new Types.ObjectId(actor.userId), name: actor.fullName },
    occurredAt: work.actualEndDate ?? new Date(),
  });

  return canonical._id;
}

/**
 * Archives a completed work once its report is approved.
 *
 * Reachable only from the report approval flow. Archiving before approval is not
 * possible, which is what keeps an unapproved report out of the customer's view.
 */
export async function archiveAfterReportApproval(
  work: Doc<IPlannedWork>,
  actor: AuthContext,
  meta: RequestMeta,
  session: ClientSession | null,
): Promise<void> {
  if (work.status !== 'COMPLETED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Зөвхөн дууссан ажлыг архивлана.',
    );
  }

  const now = new Date();
  await PlannedWork.updateOne(
    { _id: work._id },
    {
      $set: {
        status: 'ARCHIVED',
        archivedBy: new Types.ObjectId(actor.userId),
        archivedByName: actor.fullName,
        archivedAt: now,
      },
    },
    session ? { session } : {},
  );

  await recordAudit({
    entityType: 'PlannedWork',
    entityId: work._id,
    action: 'PLANNED_WORK_ARCHIVED',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'report approved',
    oldValue: { status: 'COMPLETED' },
    newValue: { status: 'ARCHIVED', archivedAt: now.toISOString() },
  });
}
