import { formatAttributeValue, type ObjectAttributeValue, type RiskLevel } from '@monhorus/shared';
import type { HydratedDocument, Types } from 'mongoose';

import {
  ObjectAssessment,
  type ILoadMeasurement,
  type IObjectAssessment,
} from './object-master.models';
import { ObjectRecord } from './object-master.models';
import { toObjectTypeAttributeDtos } from './object-type.service';

/**
 * THE writer of the append-only assessment history.
 *
 * Every score that lands on a piece of equipment lands here first, whoever produced it:
 * the manual assessment screen, a planned-work conclusion, a service-request conclusion, a
 * consolidated review. Before this existed only the manual screen wrote an
 * `ObjectAssessment`, and a score arriving through the report store moved the denormalised
 * head on the object while adding no history row at all — so the device's history table,
 * which reads this collection, could not show it.
 *
 * The alternative was to repeat the create in the report path. It is deliberately not
 * repeated: two writers of an append-only, model-level-immutable collection is two places
 * for the shape of a history row to drift, and the row is the audit record.
 *
 * This module depends only on the models. `report-record.service` already imports
 * `object-master.models`, and putting the writer in `object-master.service` instead would
 * close a cycle back through `writeReport`.
 */

export interface AppendAssessmentHistoryInput {
  object: Types.ObjectId;
  /** The score this equipment carried before, read from the head before it is overwritten. */
  previousScore: number | null;
  newScore: number;
  riskLevel: RiskLevel;
  /** Who signed the finding off. See `IObjectAssessment.assessedBy`. */
  assessedBy: Types.ObjectId | null;
  assessedByName: string | null;
  /**
   * Who wrote the judgement, where the producer recorded a per-equipment author. Left
   * unset when it did — never quietly filled from `assessedBy`, which is a different
   * question. See `IObjectAssessment.judgedBy`.
   */
  judgedBy?: Types.ObjectId | null;
  judgedByName?: string | null;
  assessedAt: Date;
  photos?: Types.ObjectId[];
  conclusion?: string | null;
  recommendation?: string | null;
  actionTaken?: string | null;
  measuredLoadKw?: number | null;
  /**
   * Readings in their own units. Only the manual assessment screens supply any today; the
   * report-raised paths carry a kW figure alone and leave this empty, which is exactly the
   * grandfathered state — an empty list means "nothing else was read".
   */
  measurements?: ILoadMeasurement[];
  repairRequired?: boolean;
  revisitRequired?: boolean;
  revisitDate?: Date | null;
  revisitOwner?: Types.ObjectId | null;
  revisitOwnerName?: string | null;
  sourceLabel?: string | null;
  sourceReport?: Types.ObjectId | null;
  /**
   * Present only for a report-raised row, and the whole of the idempotency contract — see
   * `IObjectAssessment.sourceReportItem`.
   */
  sourceReportItem?: Types.ObjectId | null;
}

/**
 * Appends one history row, or returns the row that already records this finding.
 *
 * WHY THE GUARD IS (sourceReportItem, newScore) AND NOT sourceReportItem ALONE
 *
 * Re-approving or re-publishing a report re-runs the apply over the same items, so keying
 * on the item id is what stops the history gaining a row per attempt. But a report that
 * was returned, corrected and approved again is a different assertion about the same
 * equipment, and the head moves to the new figure — leaving the history showing only the
 * withdrawn one would make the two disagree. The score is therefore part of the key: an
 * unchanged republish matches and writes nothing, a corrected score does not match and is
 * appended as the new event it is.
 *
 * The report's `occurredAt` is deliberately NOT part of the key. A planned work with no
 * `actualEndDate` writes its canonical report with `occurredAt: new Date()`, so a
 * timestamp in the key would make every republish of that work look like a new finding.
 *
 * `judgedBy` is deliberately NOT part of the key either. It records who wrote the same
 * verdict, not what the verdict was, so a republish that now carries an author matches the
 * row already written and adds nothing — a row's author is fixed at the moment it was
 * appended, and rows written before the field existed are backfilled, not re-raised.
 *
 * A row is never updated in place, because it cannot be: the model blocks every update and
 * delete hook (rule 17.15). Correction is append, which is what an audit record wants.
 */
/**
 * The equipment type's attributes as they stand, resolved for freezing onto a finding.
 *
 * Only ANSWERED attributes are captured: a blank is not a finding, and a row reading
 * "Хайлмал: —" on a signed document would suggest somebody looked and found nothing.
 *
 * Returns nothing at all when the equipment has gone or its type declares none, so an entry
 * for such a piece of kit reads exactly as entries did before this existed.
 */
async function snapshotAttributes(
  objectId: Types.ObjectId,
): Promise<{ key: string; label: string; value: ObjectAttributeValue; display: string }[]> {
  const object = await ObjectRecord.findById(objectId)
    .select('attributeValues objectType')
    .populate({ path: 'objectType', select: 'attributes' });
  if (!object) return [];

  const type = object.objectType as unknown as { attributes?: unknown } | null;
  const defs = toObjectTypeAttributeDtos(
    type && typeof type === 'object' && 'attributes' in type
      ? (type.attributes as never)
      : undefined,
  );
  const values = object.attributeValues ?? {};

  return defs.flatMap((def) => {
    const display = formatAttributeValue(def, values[def.key]);
    if (display === null) return [];
    return [{ key: def.key, label: def.label, value: values[def.key]!, display }];
  });
}

export async function appendAssessmentHistory(
  input: AppendAssessmentHistoryInput,
): Promise<HydratedDocument<IObjectAssessment>> {
  if (input.sourceReportItem) {
    const existing = await ObjectAssessment.findOne({
      sourceReportItem: input.sourceReportItem,
      newScore: input.newScore,
    });
    if (existing) return existing;
  }

  return ObjectAssessment.create({
    object: input.object,
    previousScore: input.previousScore,
    newScore: input.newScore,
    riskLevel: input.riskLevel,
    assessedBy: input.assessedBy,
    assessedByName: input.assessedByName,
    judgedBy: input.judgedBy ?? null,
    judgedByName: input.judgedByName ?? null,
    assessedAt: input.assessedAt,
    photos: input.photos ?? [],
    conclusion: input.conclusion ?? null,
    recommendation: input.recommendation ?? null,
    actionTaken: input.actionTaken ?? null,
    measuredLoadKw: input.measuredLoadKw ?? null,
    measurements: input.measurements ?? [],
    /**
     * The equipment type's attributes, frozen as of this finding (4.1).
     *
     * Read here rather than accepted from the caller: every producer — the manual assessment,
     * the work report, the planned work — would otherwise have to remember to pass them, and
     * one that forgot would write a finding that silently claims nothing was recorded. This
     * is the single writer of the history, so this is the one place it can be guaranteed.
     */
    attributes: await snapshotAttributes(input.object),
    repairRequired: input.repairRequired ?? false,
    revisitRequired: input.revisitRequired ?? false,
    revisitDate: input.revisitDate ?? null,
    revisitOwner: input.revisitOwner ?? null,
    revisitOwnerName: input.revisitOwnerName ?? null,
    sourceLabel: input.sourceLabel ?? null,
    sourceReport: input.sourceReport ?? null,
    sourceReportItem: input.sourceReportItem ?? null,
  });
}
