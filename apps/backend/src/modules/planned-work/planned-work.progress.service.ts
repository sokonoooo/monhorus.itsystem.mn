import {
  aggregateProgress,
  deriveTaskStatus,
  missingTaskEvidence,
  progressPercentOf,
  taskEvidenceComplete,
  type PlannedWorkFloorProgressDto,
  type PlannedWorkTaskStatus,
  type ProgressSummary,
  type TaskEvidenceState,
} from '@monhorus/shared';
import { Types, type HydratedDocument } from 'mongoose';

import { PlannedWork, PlannedWorkTask, type IPlannedWorkTask } from './planned-work.models';

/**
 * A loaded Mongoose document. `HydratedDocument` carries both the plain fields and the
 * document methods (`save`, `populate`), which a bare intersection with `_id` does not.
 */
type Doc<T> = HydratedDocument<T>;

/**
 * Quantity-based progress.
 *
 * Progress is never the proportion of tasks marked done. It is the ratio of summed
 * completed quantity to summed total quantity, so one large task cannot be drowned out
 * by several trivial ones. Every figure here is computed on the server and published
 * through the DTO; the web client only renders what it is given.
 */

/**
 * Tasks that count toward progress.
 *
 * A deliberately skipped task is excluded from both numerator and denominator, so
 * skipping does not silently depress the percentage of work that was actually done.
 */
export function isIncludedTask(task: Pick<IPlannedWorkTask, 'skipped'>): boolean {
  return !task.skipped;
}

/**
 * The evidence a task currently carries.
 *
 * `hasScore` is grandfathered by TRANSITION, not by date: a task that is already sitting
 * in DONE satisfies the score gate whatever its score, because the rule applies to moving
 * a task INTO DONE. Deciding this on the stored status rather than on `createdAt` keeps
 * in-flight planned works from being pulled back out of completion when the rule lands,
 * and needs no migration. Every task finished from now on must carry its үнэлгээ, since a
 * task that is not yet DONE has to pass the full gate to get there.
 */
export function taskEvidenceOf(
  task: Pick<
    IPlannedWorkTask,
    'beforePhotos' | 'afterPhotos' | 'note' | 'recommendation' | 'score' | 'status'
  >,
): TaskEvidenceState {
  return {
    hasBeforePhoto: task.beforePhotos.length > 0,
    hasAfterPhoto: task.afterPhotos.length > 0,
    hasNote: (task.note ?? '').trim().length > 0,
    hasRecommendation: (task.recommendation ?? '').trim().length > 0,
    hasScore: task.status === 'DONE' || task.score !== null,
  };
}

export function missingTaskEvidenceOf(task: IPlannedWorkTask): string[] {
  return missingTaskEvidence(taskEvidenceOf(task));
}

/**
 * Derives the stored status of a task from its quantity and evidence.
 *
 * This is the only place a task status is produced. No route accepts a task status as
 * input, so a user cannot mark a task DONE by selecting it.
 */
export function derivedTaskState(task: IPlannedWorkTask): {
  status: PlannedWorkTaskStatus;
  completedAt: Date | null;
} {
  const status = deriveTaskStatus({
    totalQuantity: task.totalQuantity,
    completedQuantity: task.completedQuantity,
    evidence: taskEvidenceOf(task),
    explicitlyStarted: task.explicitlyStarted,
    skipped: task.skipped,
  });

  if (status !== 'DONE') return { status, completedAt: null };
  // Preserve the first completion instant across later edits that keep it done.
  return { status, completedAt: task.completedAt ?? new Date() };
}

/**
 * Stamps the two sticky instants the duration is measured between.
 *
 * Both are write-once. Nothing here ever clears or moves a stamp that already exists, and
 * that is the whole point: [derivedTaskState] above nulls `completedAt` the moment a task
 * drops out of DONE and hands out a fresh `new Date()` the next time it re-enters, and it
 * runs on every recalculation — including the one a photo deletion triggers. A duration
 * built on that would jump every time evidence was touched. These two record when the
 * physical work started and when its quantity was finished, so once observed they are
 * facts about the past and are never rewritten.
 *
 * Returns true when it wrote something, so callers that only save on a change can tell.
 */
export function applyStickyTaskTimestamps(
  task: Pick<
    IPlannedWorkTask,
    'explicitlyStarted' | 'completedQuantity' | 'totalQuantity' | 'startedAt' | 'quantityCompletedAt'
  >,
  now: Date = new Date(),
): boolean {
  let stamped = false;

  // Truthiness rather than `=== null`, because a document written before these fields
  // existed carries no value at all on paths a projection left out, and a strict null test
  // would quietly never stamp it.
  if (!task.startedAt && (task.explicitlyStarted || task.completedQuantity > 0)) {
    task.startedAt = now;
    stamped = true;
  }

  // `totalQuantity > 0` guards the same corner `deriveTaskStatus` guards: a zero-total task
  // is not "already complete" the instant it is created.
  const quantityComplete =
    task.totalQuantity > 0 && task.completedQuantity >= task.totalQuantity;
  if (!task.quantityCompletedAt && quantityComplete) {
    task.quantityCompletedAt = now;
    stamped = true;
  }

  return stamped;
}

/**
 * How long the sub-task took, in whole minutes, or null when that cannot be said yet.
 *
 * Null rather than zero while either endpoint is missing — an unfinished sub-task has no
 * duration — and null for a skipped one, which is excluded from every other progress
 * figure too. Paused time is not subtracted: this codebase never nets pause time out of
 * anything, and a duration that silently did would not agree with any other figure on the
 * screen.
 */
export function taskDurationMinutes(
  task: Pick<IPlannedWorkTask, 'skipped' | 'startedAt' | 'quantityCompletedAt'>,
): number | null {
  if (task.skipped) return null;
  if (!task.startedAt || !task.quantityCompletedAt) return null;
  return Math.max(
    0,
    Math.round((task.quantityCompletedAt.getTime() - task.startedAt.getTime()) / 60_000),
  );
}

/** Applies the derivation to a task document in memory. Caller saves. */
export function applyDerivedTaskState(task: Doc<IPlannedWorkTask>): void {
  const derived = derivedTaskState(task);
  task.status = derived.status;
  task.completedAt = derived.completedAt;
  applyStickyTaskTimestamps(task);
}

export function progressOfTasks(tasks: readonly IPlannedWorkTask[]): ProgressSummary {
  return aggregateProgress(
    tasks.filter(isIncludedTask).map((task) => ({
      totalQuantity: task.totalQuantity,
      // Clamp defensively: a stored value above the total must not inflate the rollup.
      completedQuantity: Math.min(task.completedQuantity, task.totalQuantity),
    })),
  );
}

/**
 * Floor rollups, using the same quantity-weighted aggregation as the work total.
 * Tasks with no floor are grouped under a single unassigned bucket.
 */
export function floorProgressOf(
  tasks: readonly Doc<IPlannedWorkTask>[],
  floorNames: ReadonlyMap<string, string>,
): PlannedWorkFloorProgressDto[] {
  const groups = new Map<string, Doc<IPlannedWorkTask>[]>();

  for (const task of tasks) {
    if (!isIncludedTask(task)) continue;
    const key = task.floor ? String(task.floor) : '';
    const bucket = groups.get(key);
    if (bucket) bucket.push(task);
    else groups.set(key, [task]);
  }

  const rows: PlannedWorkFloorProgressDto[] = [];
  for (const [floorId, group] of groups) {
    const summary = progressOfTasks(group);
    rows.push({
      floorId,
      floorName: floorId ? (floorNames.get(floorId) ?? 'Тодорхойгүй давхар') : 'Давхар заагаагүй',
      taskCount: group.length,
      totalQuantity: summary.totalQuantity,
      completedQuantity: summary.completedQuantity,
      remainingQuantity: summary.remainingQuantity,
      progressPercent: summary.progressPercent,
    });
  }

  return rows.sort((left, right) => left.floorName.localeCompare(right.floorName, 'mn'));
}

/**
 * Recalculates and persists the rollup on the parent work.
 *
 * Called after every task mutation so the stored figures never drift from the tasks.
 * Task statuses are re-derived here too, because evidence can be added or removed by a
 * photo upload or deletion that does not otherwise touch the task.
 */
export async function recalculatePlannedWorkProgress(
  plannedWorkId: Types.ObjectId | string,
): Promise<ProgressSummary> {
  const workId = plannedWorkId instanceof Types.ObjectId
    ? plannedWorkId
    : new Types.ObjectId(plannedWorkId);

  const tasks = await PlannedWorkTask.find({ plannedWork: workId });

  for (const task of tasks) {
    const derived = derivedTaskState(task);
    // Never a clear, only a first write, so re-deriving after a photo deletion cannot
    // disturb a stamp that is already there.
    const stamped = applyStickyTaskTimestamps(task);
    if (stamped || task.status !== derived.status || (task.completedAt?.getTime() ?? null) !==
      (derived.completedAt?.getTime() ?? null)) {
      task.status = derived.status;
      task.completedAt = derived.completedAt;
      await task.save();
    }
  }

  const summary = progressOfTasks(tasks);

  await PlannedWork.updateOne(
    { _id: workId },
    {
      $set: {
        totalQuantity: summary.totalQuantity,
        completedQuantity: summary.completedQuantity,
        progressPercent: summary.progressPercent,
        taskCount: tasks.filter(isIncludedTask).length,
      },
    },
  );

  return summary;
}

/**
 * Reasons the work may not be completed yet.
 *
 * An empty array means every completion rule passes. The list is returned to the client
 * so the UI can explain a disabled button instead of silently hiding it.
 */
export function completionBlockersOf(tasks: readonly IPlannedWorkTask[]): string[] {
  const included = tasks.filter(isIncludedTask);
  if (included.length === 0) {
    return ['Дэд ажил бүртгэгдээгүй байна.'];
  }

  const blockers: string[] = [];

  for (const task of included) {
    if (task.completedQuantity < task.totalQuantity) {
      const percent = progressPercentOf(task.totalQuantity, task.completedQuantity);
      blockers.push(`"${task.title}" биелэлт ${percent}% байна.`);
      continue;
    }
    const missing = missingTaskEvidence(taskEvidenceOf(task));
    if (missing.length > 0) {
      blockers.push(`"${task.title}" дутуу: ${missing.join(', ')}.`);
    }
  }

  return blockers;
}

/** True when every included task is genuinely complete, evidence included. */
export function allTasksComplete(tasks: readonly IPlannedWorkTask[]): boolean {
  const included = tasks.filter(isIncludedTask);
  if (included.length === 0) return false;
  return included.every(
    (task) =>
      task.totalQuantity > 0 &&
      task.completedQuantity >= task.totalQuantity &&
      taskEvidenceComplete(taskEvidenceOf(task)),
  );
}
