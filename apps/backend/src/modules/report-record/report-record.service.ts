import {
  REPORT_EFFECTIVE_STATUSES,
  overallScoreOf,
  riskLevelFor,
  type ReportAttachmentDto,
  type ReportDto,
  type ReportItemDto,
  type ReportListItemDto,
  type ReportSourceType,
  type ReportStatus,
  type ReportType,
  formatAttributeValue,
  type ObjectAttributeValue,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import { logger } from '../../config/logger';
import { appendAssessmentHistory } from '../object-master/assessment-history.service';
import { ObjectRecord } from '../object-master/object-master.models';
import { toObjectTypeAttributeDtos } from '../object-master/object-type.service';
import { ObjectNode } from '../objects/object.models';
import { getRiskBands } from '../settings/settings.service';
import {
  Report,
  ReportItem,
  nextReportNumber,
  type IReport,
  type IReportItem,
} from './report-record.model';
import { recalculateFrom } from './rollup.service';

/**
 * The writer every producer goes through.
 *
 * One report with many items, written once. The hierarchy is resolved here from the
 * equipment the items name — never accepted from a caller — and the idempotency key is a
 * database constraint rather than a check, so a retried completion corrects its report
 * instead of writing a second one.
 */

type Doc<T> = T & { _id: Types.ObjectId };

export interface ResolvedHierarchy {
  customer: Types.ObjectId | null;
  project: Types.ObjectId | null;
  building: Types.ObjectId | null;
  floor: Types.ObjectId | null;
}

const NO_HIERARCHY: ResolvedHierarchy = {
  customer: null,
  project: null,
  building: null,
  floor: null,
};

/**
 * Where a piece of equipment actually sits.
 *
 * Read from the object's own floor and that floor's materialised ancestor chain, matching
 * ancestors by `kind` rather than by position: the chain is linear today, but indexing
 * into it would break silently the first time a level is skipped.
 */
export async function resolveHierarchy(
  objectId: Types.ObjectId | string,
): Promise<ResolvedHierarchy> {
  const object = await ObjectRecord.findById(objectId).select('floor customer');
  if (!object) return { ...NO_HIERARCHY };
  if (!object.floor) return { ...NO_HIERARCHY, customer: object.customer ?? null };

  const floor = await ObjectNode.findById(object.floor).select('customer ancestors');
  if (!floor) return { ...NO_HIERARCHY, customer: object.customer ?? null };

  const ancestors = await ObjectNode.find({ _id: { $in: floor.ancestors } }).select('kind');
  const ofKind = (kind: 'PROJECT' | 'BUILDING'): Types.ObjectId | null =>
    ancestors.find((node) => node.kind === kind)?._id ?? null;

  return {
    customer: floor.customer ?? object.customer ?? null,
    project: ofKind('PROJECT'),
    building: ofKind('BUILDING'),
    floor: object.floor,
  };
}

export interface ReportItemInput {
  object: Types.ObjectId;
  score?: number | null;
  observation?: string | null;
  conclusion?: string | null;
  recommendation?: string | null;
  measuredLoadKw?: number | null;
  evidenceAttachments?: Types.ObjectId[];
  /**
   * The author of this item's judgement, where the producer records one per equipment.
   * Omitted by producers that do not — see `IReportItem.judgedBy`.
   */
  judgedBy?: Types.ObjectId | null;
  judgedByName?: string | null;
  sourceReport?: Types.ObjectId | null;
  sourceReportItem?: Types.ObjectId | null;
}

export interface WriteReportInput {
  type: ReportType;
  status: ReportStatus;
  title: string;
  sourceType: ReportSourceType;
  sourceId?: Types.ObjectId | null;
  sourceReference?: string | null;
  conclusion?: string | null;
  recommendation?: string | null;
  items: readonly ReportItemInput[];
  /** Used only when a report names no equipment and so has no hierarchy of its own. */
  hierarchy?: Partial<ResolvedHierarchy>;
  sourceReportIds?: Types.ObjectId[];
  sourceReportItemIds?: Types.ObjectId[];
  actor?: { id: Types.ObjectId | null; name: string | null };
  occurredAt: Date;
}

/**
 * Creates or corrects the report a source raised.
 *
 * The update path is tried first so the common retry never consumes a report number only
 * to discard it, and the lookup-then-create gap is closed by the unique index itself: a
 * concurrent insert of the same source surfaces as a duplicate key and is folded into the
 * row that won rather than bubbling up as a spurious conflict.
 */
export async function writeReport(input: WriteReportInput): Promise<Doc<IReport>> {
  const bands = await getRiskBands();

  let hierarchy: ResolvedHierarchy = { ...NO_HIERARCHY, ...input.hierarchy };
  const itemHierarchies = new Map<string, ResolvedHierarchy>();

  for (const item of input.items) {
    const resolved = await resolveHierarchy(item.object);
    itemHierarchies.set(String(item.object), resolved);
    if (hierarchy.customer === null && resolved.customer) hierarchy = resolved;
  }

  const overallScore = overallScoreOf(input.items.map((item) => item.score ?? null));
  const fields = {
    type: input.type,
    status: input.status,
    title: input.title,
    customer: hierarchy.customer,
    project: hierarchy.project,
    building: hierarchy.building,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    sourceReference: input.sourceReference ?? null,
    conclusion: input.conclusion ?? null,
    recommendation: input.recommendation ?? null,
    overallScore,
    riskLevel: overallScore === null ? null : riskLevelFor(overallScore, bands),
    sourceReportIds: input.sourceReportIds ?? [],
    sourceReportItemIds: input.sourceReportItemIds ?? [],
    occurredAt: input.occurredAt,
  };

  const dedup = input.sourceId
    ? { customer: hierarchy.customer, sourceType: input.sourceType, sourceId: input.sourceId }
    : null;

  let report: Doc<IReport> | null = null;

  if (dedup) {
    report = await Report.findOneAndUpdate(dedup, { $set: fields }, { new: true });
  }

  if (!report) {
    try {
      report = await Report.create({
        ...fields,
        reportNumber: await nextReportNumber(input.occurredAt),
        createdBy: input.actor?.id ?? null,
        createdByName: input.actor?.name ?? null,
      });
    } catch (error) {
      if (dedup && (error as { code?: number }).code === 11000) {
        report = await Report.findOneAndUpdate(dedup, { $set: fields }, { new: true });
      }
      if (!report) throw error;
    }
  }

  await syncItems(report._id, hierarchy.customer, input.items, itemHierarchies, bands);
  return report;
}

/**
 * Brings a report's items in line with what its source now says.
 *
 * Findings are upserted per object and any object no longer covered has its item removed,
 * so a sub-task that stops naming a panel stops reporting on it. Appending instead would
 * leave the report asserting a finding its source has withdrawn.
 */
/**
 * The equipment type's attributes as they stand right now, resolved for a frozen record.
 *
 * Read at the moment the item is written rather than at the moment it is read, because a
 * report is a dated document: the answers live on the equipment and move as it is corrected,
 * so a report reading them live would rewrite its own history and two printouts of the same
 * document could disagree.
 *
 * The LABEL and the DISPLAYED text are captured alongside the raw value, so the row can print
 * itself with no lookup — an administrator may rename or delete the attribute afterwards, and
 * the report must still be able to say what it recorded.
 *
 * Only answered attributes are captured. A blank is not a finding, and a row reading
 * "Хайлмал: —" would suggest somebody looked and found nothing.
 */
async function snapshotAttributes(
  objectId: Types.ObjectId,
): Promise<
  { key: string; label: string; value: ObjectAttributeValue; display: string }[]
> {
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

async function syncItems(
  reportId: Types.ObjectId,
  customer: Types.ObjectId | null,
  items: readonly ReportItemInput[],
  hierarchies: Map<string, ResolvedHierarchy>,
  bands: Awaited<ReturnType<typeof getRiskBands>>,
): Promise<void> {
  const keep: Types.ObjectId[] = [];

  for (const item of items) {
    const score = item.score ?? null;
    const resolved = hierarchies.get(String(item.object)) ?? NO_HIERARCHY;

    const saved = await ReportItem.findOneAndUpdate(
      { report: reportId, object: item.object },
      {
        $set: {
          customer,
          floor: resolved.floor,
          score,
          // Derived here for the same reason it is derived everywhere else: a caller could
          // otherwise label a 92 as critical.
          riskLevel: score === null ? null : riskLevelFor(score, bands),
          observation: item.observation ?? null,
          conclusion: item.conclusion ?? null,
          recommendation: item.recommendation ?? null,
          measuredLoadKw: item.measuredLoadKw ?? null,
          // Frozen here, beside the score and the narrative, and rewritten only when they
          // are — so the snapshot shares the finding's lifecycle exactly.
          attributes: await snapshotAttributes(item.object),
          evidenceAttachments: item.evidenceAttachments ?? [],
          judgedBy: item.judgedBy ?? null,
          judgedByName: item.judgedByName ?? null,
          sourceReport: item.sourceReport ?? null,
          sourceReportItem: item.sourceReportItem ?? null,
        },
      },
      { new: true, upsert: true },
    );
    keep.push(saved._id);
  }

  await ReportItem.deleteMany({ report: reportId, _id: { $nin: keep } });
}

/**
 * Pushes a settled report's findings onto the equipment it describes.
 *
 * Only ever runs for a report a reviewer has approved: a score is a claim until then, and
 * letting an unreviewed figure move a building's standing would make the hierarchy
 * disagree with the report that produced it. A report naming no equipment reaches nothing,
 * which is the rule for a standalone record.
 *
 * Each scored finding lands in TWO places, and it used to land in only one. The
 * denormalised head on the object is what the lists and the plan read; the
 * `ObjectAssessment` row is the equipment's history, which is what the device detail
 * screen's Үнэлгээний түүх table reads. Writing only the head is what made an evaluation
 * submitted through Үзлэг ба дүгнэлт move the object's score while leaving its history
 * empty — and it also left `latestAssessment.assessment` pointing at a freshly minted
 * ObjectId that referenced no document at all. The head now points at the row that was
 * actually written.
 */
export async function applyReportToEquipment(reportId: Types.ObjectId): Promise<void> {
  const report = await Report.findById(reportId);
  if (!report || !REPORT_EFFECTIVE_STATUSES.includes(report.status)) return;

  /**
   * An OBJECT_ASSESSMENT report is the write-through of a manual assessment that has
   * ALREADY recorded its own history row and pointed the head at it — the row is the
   * record and this report is derived from it, not the other way round. Appending here
   * would give the manual screen two rows for one assessment.
   *
   * Nothing else produces this type: `recordAssessment` and the legacy migration are the
   * only writers, and both create the `ObjectAssessment` first.
   */
  const historyAlreadyWritten = report.type === 'OBJECT_ASSESSMENT';

  const items = await ReportItem.find({ report: reportId });
  const touchedFloors = new Set<string>();

  for (const item of items) {
    if (item.score === null || item.riskLevel === null) continue;

    const object = await ObjectRecord.findById(item.object);
    if (!object) continue;

    // Read before the head is overwritten, so the row records the step it represents.
    const previousScore = object.latestAssessment?.score ?? null;
    // Who signed it off, falling back to who raised it for a report that reaches equipment
    // without a separate approval step. Never invented here. Report-level by nature: one
    // approval covers every finding on the report.
    const assessedBy = report.approvedBy ?? report.createdBy ?? null;
    const assessedByName = report.approvedByName ?? report.createdByName;

    const entry = historyAlreadyWritten
      ? null
      : await appendAssessmentHistory({
          object: object._id,
          previousScore,
          newScore: item.score,
          riskLevel: item.riskLevel,
          assessedBy,
          assessedByName,
          // Per ITEM, not per report: the approval above covers the whole report, but the
          // verdict on this one piece of equipment was written by whoever wrote it, and on
          // a planned work covering several sub-tasks that is not one person. Null where
          // the producer recorded no per-equipment author, which the reader treats as
          // "unknown" rather than as the approver.
          judgedBy: item.judgedBy ?? null,
          judgedByName: item.judgedByName ?? null,
          // The report's own event time, the same instant the head and the timeline row
          // carry, rather than the moment this apply happened to run.
          assessedAt: report.occurredAt,
          photos: [...(item.evidenceAttachments ?? [])],
          conclusion: item.conclusion,
          recommendation: item.recommendation,
          // The item's observation is what was seen on this equipment, which is what the
          // manual path stores as the action taken.
          actionTaken: item.observation,
          measuredLoadKw: item.measuredLoadKw,
          // What the history table shows in its source column: the work or request number
          // when the producer had one, the report number otherwise.
          sourceLabel: report.sourceReference ?? report.reportNumber,
          sourceReport: report._id,
          sourceReportItem: item._id,
        });

    object.latestAssessment = {
      // The row just written — or, for the manual write-through, the one the manual path
      // already pointed at.
      assessment: entry?._id ?? object.latestAssessment?.assessment ?? new Types.ObjectId(),
      score: item.score,
      riskLevel: item.riskLevel,
      assessedAt: report.occurredAt,
      assessedByName,
      conclusion: item.conclusion,
      recommendation: item.recommendation,
      repairRequired: object.latestAssessment?.repairRequired ?? false,
      revisitRequired: object.latestAssessment?.revisitRequired ?? false,
      revisitDate: object.latestAssessment?.revisitDate ?? null,
    };
    await object.save();

    if (object.floor) touchedFloors.add(String(object.floor));
  }

  // Once per affected floor rather than once per item: a report covering forty panels on
  // one floor would otherwise recompute the same chain forty times for one answer.
  for (const floorId of touchedFloors) {
    await recalculateFrom(new Types.ObjectId(floorId));
  }
}

/** Guarded, so a derived-store failure never loses the approval that triggered it. */
export async function applyReportSafely(reportId: Types.ObjectId): Promise<void> {
  try {
    await applyReportToEquipment(reportId);
  } catch (error) {
    logger.error({ err: error, report: String(reportId) }, 'report could not reach its equipment');
  }
}

// -- Mapping -----------------------------------------------------------------

function refName(value: unknown): { id: string | null; name: string | null } {
  if (typeof value !== 'object' || value === null || !('_id' in value)) {
    return { id: value ? String(value) : null, name: null };
  }
  const node = value as { _id: Types.ObjectId; name?: string };
  return { id: String(node._id), name: node.name ?? null };
}

function attachmentDto(value: unknown): ReportAttachmentDto | null {
  if (typeof value !== 'object' || value === null || !('originalName' in value)) return null;
  const file = value as {
    _id: Types.ObjectId;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  };
  return {
    id: String(file._id),
    name: file.originalName,
    downloadUrl: `/files/${String(file._id)}`,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    uploadedAt: file.createdAt.toISOString(),
  };
}

export function toReportItemDto(item: Doc<IReportItem>): ReportItemDto {
  const object = refName(item.object);
  const floor = refName(item.floor);
  const objectRef = item.object as unknown as { code?: string } | null;

  return {
    id: String(item._id),
    reportId: String(item.report),
    objectId: object.id ?? '',
    objectCode:
      objectRef && typeof objectRef === 'object' && 'code' in objectRef
        ? (objectRef.code ?? null)
        : null,
    objectName: object.name,
    floorId: floor.id,
    floorName: floor.name,
    score: item.score,
    riskLevel: item.riskLevel,
    observation: item.observation,
    conclusion: item.conclusion,
    recommendation: item.recommendation,
    measuredLoadKw: item.measuredLoadKw,
    // Frozen when the item was written; an item from before the feature has none, and
    // nothing is back-filled — see the note on `IReportItem.attributes`.
    attributes: (item.attributes ?? []).map((attribute) => ({
      key: attribute.key,
      label: attribute.label,
      value: attribute.value,
      display: attribute.display,
    })),
    evidenceAttachments: (item.evidenceAttachments ?? [])
      .map(attachmentDto)
      .filter((entry): entry is ReportAttachmentDto => entry !== null),
    sourceReportId: item.sourceReport ? String(item.sourceReport) : null,
    sourceReportItemId: item.sourceReportItem ? String(item.sourceReportItem) : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toReportListItemDto(report: Doc<IReport>, itemCount: number): ReportListItemDto {
  const customer = refName(report.customer);
  const project = refName(report.project);
  const building = refName(report.building);

  return {
    id: String(report._id),
    reportNumber: report.reportNumber,
    type: report.type,
    status: report.status,
    title: report.title,
    customerId: customer.id,
    customerName: customer.name,
    projectId: project.id,
    projectName: project.name,
    buildingId: building.id,
    buildingName: building.name,
    sourceType: report.sourceType,
    sourceId: report.sourceId ? String(report.sourceId) : null,
    sourceReference: report.sourceReference,
    conclusion: report.conclusion,
    recommendation: report.recommendation,
    overallScore: report.overallScore,
    riskLevel: report.riskLevel,
    sourceReportIds: (report.sourceReportIds ?? []).map(String),
    sourceReportItemIds: (report.sourceReportItemIds ?? []).map(String),
    itemCount,
    createdByName: report.createdByName,
    submittedByName: report.submittedByName,
    submittedAt: report.submittedAt?.toISOString() ?? null,
    approvedByName: report.approvedByName,
    approvedAt: report.approvedAt?.toISOString() ?? null,
    publishedByName: report.publishedByName,
    publishedAt: report.publishedAt?.toISOString() ?? null,
    returnedByName: report.returnedByName,
    returnedAt: report.returnedAt?.toISOString() ?? null,
    returnReason: report.returnReason,
    occurredAt: report.occurredAt.toISOString(),
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

export function toReportDto(
  report: Doc<IReport>,
  items: readonly Doc<IReportItem>[],
): ReportDto {
  return {
    ...toReportListItemDto(report, items.length),
    items: items.map(toReportItemDto),
  };
}
