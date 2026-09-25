import type { PlannedWorkTaskMaterialUsageDto, RecordTaskMaterialUsageInput } from '@monhorus/shared';
import { Types } from 'mongoose';

import { ERROR_CODES } from '../../common/errors/error-codes';
import { AppError } from '../../common/errors/app-error';
import type { AuthContext } from '../../common/types/express';
import {
  PlannedWork,
  PlannedWorkMaterialUsage,
  type IPlannedWorkMaterialUsage,
} from './planned-work.models';

/**
 * What a sub-task drew from the materials registered on its parent work.
 *
 * THE POOL IS SHARED. A material registered once for 100 is drawn on by every sub-task
 * under that work until it is gone, which is what makes "prevent usage exceeding the
 * available quantity" a concurrency problem rather than a validation. Two technicians
 * recording 50 against the same 100 at the same moment must not both succeed, and a
 * read-then-check cannot stop them: both reads see 100 free before either write lands.
 *
 * SO THE GUARD IS THE WRITE. `applyDelta` moves the pool with a single conditional
 * `updateOne` whose filter states the invariant it is about to rely on — the row must
 * still have at least this much left — and a `modifiedCount` of zero means somebody else
 * got there first. MongoDB applies that filter and that `$inc` as one atomic operation on
 * one document, so there is no window between the check and the change.
 *
 * WHY NOT A TRANSACTION. `withTransaction` in this codebase probes the topology and, on a
 * standalone mongod, runs the callback with no session at all — deliberately, and it says
 * so. Building this invariant on it would mean it holds in production and silently does
 * not in development, which is the worst possible place for that difference to live.
 * A conditional single-document update is atomic on every topology, including standalone.
 *
 * ORDER OF WRITES, AND WHAT A CRASH BETWEEN THEM COSTS. The pool moves first, the ledger
 * row second. If the second write fails the pool is compensated back in the catch, and if
 * the process dies between them the pool reads as slightly more consumed than the ledger
 * explains — an over-count. That direction is the deliberate one: it refuses a draw that
 * might have been allowed, where the reverse would allow a draw that should have been
 * refused, and this feature exists to prevent the second thing.
 */

/** The maximum a single row may record, mirroring the schema's own bound. */
const MAX_USAGE_QUANTITY = 1_000_000;

export function materialUsageDto(row: IPlannedWorkMaterialUsage & { _id: Types.ObjectId }): PlannedWorkTaskMaterialUsageDto {
  return {
    id: String(row._id),
    taskId: String(row.task),
    materialItemId: String(row.materialItem),
    materialName: row.materialName,
    quantity: row.quantity,
    unit: row.unit,
    recordedByName: row.recordedByName,
    recordedAt: row.createdAt.toISOString(),
  };
}

/** Every usage row on a work, grouped by the sub-task that recorded it. */
export async function usageByTask(
  plannedWorkId: Types.ObjectId | string,
): Promise<Map<string, PlannedWorkTaskMaterialUsageDto[]>> {
  const rows = await PlannedWorkMaterialUsage.find({ plannedWork: plannedWorkId })
    .sort({ materialName: 1 })
    .lean<(IPlannedWorkMaterialUsage & { _id: Types.ObjectId })[]>();

  const byTask = new Map<string, PlannedWorkTaskMaterialUsageDto[]>();
  for (const row of rows) {
    const key = String(row.task);
    const list = byTask.get(key) ?? [];
    list.push(materialUsageDto(row));
    byTask.set(key, list);
  }
  return byTask;
}

/**
 * Moves the pool by `delta` for one registered material, or refuses.
 *
 * A positive delta draws down and is guarded; a negative delta returns stock and cannot
 * fail on availability, but is still expressed as the same conditional update so the two
 * paths cannot drift apart. `remainingQuantity` is compared against a constant because
 * that is the only comparison a filter can make — see the note on the model about why
 * remaining is stored rather than derived.
 *
 * Returns the remaining quantity BEFORE the move when it refuses, so the caller can name
 * the real ceiling in the message rather than saying "not enough".
 */
async function applyDelta(
  plannedWorkId: Types.ObjectId | string,
  materialItemId: Types.ObjectId,
  delta: number,
): Promise<{ ok: true } | { ok: false; remaining: number }> {
  const guard =
    delta > 0
      ? { materialItem: materialItemId, remainingQuantity: { $gte: delta } }
      : { materialItem: materialItemId };

  const moved = await PlannedWork.updateOne(
    { _id: plannedWorkId, plannedMaterials: { $elemMatch: guard } },
    {
      $inc: {
        'plannedMaterials.$.consumedQuantity': delta,
        'plannedMaterials.$.remainingQuantity': -delta,
      },
    },
  );

  if (moved.modifiedCount === 1) return { ok: true };

  // Refused, or the row is gone. Read back to say which, and by how much.
  const current = await PlannedWork.findOne(
    { _id: plannedWorkId },
    { plannedMaterials: 1 },
  ).lean<{ plannedMaterials: { materialItem: Types.ObjectId; remainingQuantity: number }[] } | null>();

  const row = current?.plannedMaterials.find((entry) => String(entry.materialItem) === String(materialItemId));
  return { ok: false, remaining: row?.remainingQuantity ?? 0 };
}

/** The refusal the whole feature exists to produce, naming what is actually left. */
function refuseOverConsumption(remaining: number, unitLabel: string): never {
  throw AppError.badRequest(
    ERROR_CODES.VALIDATION_ERROR,
    `Үлдэгдлээс их материал зарцуулах боломжгүй. Үлдэгдэл: ${remaining.toLocaleString('mn-MN')} ${unitLabel}.`,
    [{ field: 'quantity', message: `Үлдэгдэл ${remaining.toLocaleString('mn-MN')} ${unitLabel}.` }],
  );
}

export interface RecordUsageContext {
  plannedWorkId: Types.ObjectId;
  taskId: Types.ObjectId;
  registered: { materialItem: Types.ObjectId; name: string; unit: string } | undefined;
  unitLabel: string;
}

/**
 * Records what one sub-task consumed of one material, as an absolute figure.
 *
 * ABSOLUTE, NOT AN INCREMENT — the schema comment says why: this write is reachable from
 * a phone on a bad connection, and a retried increment silently doubles a draw. The delta
 * against whatever the row said before is computed here and applied to the pool, so
 * sending 30 twice leaves the pool 30 lighter, not 60.
 *
 * Zero is a legitimate quantity and means "this sub-task consumed none of it after all":
 * the row is deleted and the pool returns to what it was.
 */
export async function recordTaskMaterialUsage(
  context: RecordUsageContext,
  input: RecordTaskMaterialUsageInput,
  actor: AuthContext,
): Promise<void> {
  const { plannedWorkId, taskId, registered, unitLabel } = context;

  if (!registered) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Энэ материал ажилд бүртгэгдээгүй байна.',
      [{ field: 'materialItemId', message: 'Ажилд бүртгэгдээгүй материал.' }],
    );
  }

  if (input.quantity > MAX_USAGE_QUANTITY) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Тоо хэмжээ хэт их байна.', [
      { field: 'quantity', message: 'Тоо хэмжээ хэт их байна.' },
    ]);
  }

  const existing = await PlannedWorkMaterialUsage.findOne({
    task: taskId,
    materialItem: registered.materialItem,
  });
  const previous = existing?.quantity ?? 0;
  const delta = input.quantity - previous;

  if (delta !== 0) {
    const moved = await applyDelta(plannedWorkId, registered.materialItem, delta);
    if (!moved.ok) refuseOverConsumption(moved.remaining, unitLabel);
  }

  try {
    if (input.quantity === 0) {
      // Recorded as none: the row is the claim, so withdrawing the claim removes it
      // rather than leaving a zero that reads like a measurement.
      if (existing) await existing.deleteOne();
      return;
    }

    if (existing) {
      existing.quantity = input.quantity;
      await existing.save();
      return;
    }

    await PlannedWorkMaterialUsage.create({
      plannedWork: plannedWorkId,
      task: taskId,
      materialItem: registered.materialItem,
      materialName: registered.name,
      quantity: input.quantity,
      unit: registered.unit,
      recordedBy: new Types.ObjectId(actor.userId),
      recordedByName: actor.fullName ?? null,
    });
  } catch (error) {
    // The pool moved and the ledger did not. Put it back rather than leaving the work
    // permanently short of a material nothing claims to have used.
    if (delta !== 0) await applyDelta(plannedWorkId, registered.materialItem, -delta);
    throw error;
  }
}

/**
 * Releases everything a sub-task drew, for when the sub-task itself is deleted.
 *
 * Row by row rather than one aggregate write: each material is a separate pool on a
 * separate subdocument, and `$inc` on the positional operator only reaches one of them.
 */
export async function releaseTaskMaterialUsage(
  plannedWorkId: Types.ObjectId | string,
  taskId: Types.ObjectId | string,
): Promise<void> {
  const rows = await PlannedWorkMaterialUsage.find({ task: taskId });
  for (const row of rows) {
    await applyDelta(plannedWorkId, row.materialItem, -row.quantity);
    await row.deleteOne();
  }
}
