/**
 * Backfills the assessment history rows the report path never wrote.
 *
 * WHAT WAS BROKEN
 *
 * A score reaches a piece of equipment through one of two doors. The manual assessment
 * screen (`recordAssessment`) wrote an `ObjectAssessment` row, pointed the object's
 * denormalised `latestAssessment` head at that row, and then wrote a derived `Report`.
 * Everything arriving through the report store instead — a planned-work conclusion, a
 * service-request conclusion, a consolidated review, all of them Үзлэг ба дүгнэлт —
 * went through `applyReportToEquipment`, which moved the head and wrote NO history row at
 * all. The device detail screen's Үнэлгээний түүх table reads `ObjectAssessment`, so those
 * evaluations were invisible there. Worse, the head it wrote set
 * `latestAssessment.assessment` to `new Types.ObjectId()` — a reference to a document that
 * was never created, dangling by construction.
 *
 * `applyReportToEquipment` now appends through the same writer the manual path uses. This
 * script is for the rows that were lost before it did.
 *
 * WHAT IT CREATES, AND FROM WHAT
 *
 * One history row per `ReportItem` that scored a piece of equipment, where its report has
 * actually settled (`REPORT_EFFECTIVE_STATUSES` — a DRAFT report's score is still a claim
 * and never reached the equipment in the first place, so inventing history for it would
 * assert something that never happened).
 *
 * `OBJECT_ASSESSMENT` reports are skipped in full. That type is only ever the write-through
 * of a manual assessment, which already wrote its own row; backfilling it would give every
 * manual assessment in the database a second one.
 *
 * IDEMPOTENT, by the same key the live path uses: `(sourceReportItem, newScore)`. A second
 * run finds every row already present and writes nothing. A run interleaved with the fixed
 * live path is equally safe — whichever wrote the row first, the other skips it.
 *
 * previousScore IS RECONSTRUCTED, NOT GUESSED
 *
 * Section 10.1 wants the previous figure alongside the new one. It is recovered by merging
 * the rows that already exist for an object with the ones being created, ordering the lot
 * by `assessedAt`, and reading each row's predecessor. That is the same chain the live path
 * would have produced had it been writing all along. Where a row is the earliest thing
 * known about an object, the previous score is null, which is also what the manual path
 * records for a first assessment.
 *
 * THE DANGLING HEAD IS REPAIRED TOO
 *
 * Where an object's `latestAssessment.assessment` points at no document and a backfilled
 * row matches the head's score, the head is repointed at it. This is reported on its own
 * line and counted separately, because it is a repair of a different symptom of the same
 * defect. A head whose reference already resolves is never touched.
 *
 * WHAT IT WILL NOT DO
 *
 *   - It never edits or deletes an existing `ObjectAssessment`. It cannot: the model blocks
 *     every update and delete hook (rule 17.15). Only inserts happen here.
 *   - It never recomputes a rollup or moves an object's score. The head figures were
 *     already written by the live path and are not in question; only the history is.
 *   - It never invents an actor. `approvedBy`/`approvedByName` come from the report, and
 *     fall back to `createdBy`/`createdByName` — never to a placeholder.
 *
 * Usage: npm run backfill:report-assessment-history --workspace @monhorus/backend
 *          -> DRY RUN. Prints every row it would create. Writes nothing.
 *        ... -- --apply
 *          -> Creates them.
 *        ... -- --object <objectId>
 *          -> Restricts the run to one piece of equipment. Combines with --apply.
 *
 * Exits non-zero if `--apply` was given and any row failed to insert.
 */
import { REPORT_EFFECTIVE_STATUSES, type RiskLevel } from '@monhorus/shared';
import { Types, type HydratedDocument } from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { appendAssessmentHistory } from '../modules/object-master/assessment-history.service';
import {
  ObjectAssessment,
  ObjectRecord,
  type IObject,
} from '../modules/object-master/object-master.models';
import {
  Report,
  ReportItem,
  type IReport,
  type IReportItem,
} from '../modules/report-record/report-record.model';

/** One history row that is missing, or was created. */
export interface MissingHistoryRow {
  objectId: string;
  objectCode: string | null;
  objectName: string | null;
  reportItemId: string;
  reportId: string;
  reportNumber: string;
  reportType: string;
  sourceReference: string | null;
  previousScore: number | null;
  newScore: number;
  riskLevel: RiskLevel;
  assessedByName: string | null;
  assessedAt: string;
  /** False on a dry run, and on an insert that threw. */
  created: boolean;
  error: string | null;
}

/** An object whose head points at a history row that does not exist. */
export interface DanglingHead {
  objectId: string;
  objectCode: string | null;
  danglingRef: string;
  headScore: number;
  /** The backfilled row the head was, or would be, repointed at. Null when none matched. */
  repointedTo: string | null;
  repaired: boolean;
}

export interface BackfillResult {
  /** False only when `--apply` was passed. Nothing is written on a dry run. */
  dryRun: boolean;
  /** Report items examined: scored, on a settled, non-OBJECT_ASSESSMENT report. */
  itemsExamined: number;
  /** Items that already had their history row. Untouched. */
  alreadyPresent: number;
  /** Skipped because the report item names equipment that no longer exists. */
  orphanedItems: number;
  rows: MissingHistoryRow[];
  danglingHeads: DanglingHead[];
  failures: number;
}

/** A candidate row, before it is known whether it already exists. */
interface Candidate {
  item: HydratedDocument<IReportItem>;
  report: HydratedDocument<IReport>;
}

export async function backfillReportAssessmentHistory(
  options: { apply?: boolean; objectId?: string } = {},
): Promise<BackfillResult> {
  const dryRun = !(options.apply ?? false);

  const result: BackfillResult = {
    dryRun,
    itemsExamined: 0,
    alreadyPresent: 0,
    orphanedItems: 0,
    rows: [],
    danglingHeads: [],
    failures: 0,
  };

  /**
   * Settled reports only, and never the manual write-through type. Loaded first so the
   * item query can be bounded by it rather than filtering a whole collection in memory.
   */
  const reports = await Report.find({
    status: { $in: REPORT_EFFECTIVE_STATUSES },
    type: { $ne: 'OBJECT_ASSESSMENT' },
  });
  const reportById = new Map(reports.map((report) => [String(report._id), report]));

  const items = await ReportItem.find({
    report: { $in: reports.map((report) => report._id) },
    score: { $ne: null },
    ...(options.objectId ? { object: new Types.ObjectId(options.objectId) } : {}),
  }).sort({ createdAt: 1 });

  // Grouped per object, because `previousScore` is only meaningful in the context of that
  // object's own sequence of findings.
  const byObject = new Map<string, Candidate[]>();
  for (const item of items) {
    const report = reportById.get(String(item.report));
    if (!report || item.score === null || item.riskLevel === null) continue;
    result.itemsExamined += 1;
    const key = String(item.object);
    byObject.set(key, [...(byObject.get(key) ?? []), { item, report }]);
  }

  for (const [objectId, candidates] of byObject) {
    const object = await ObjectRecord.findById(objectId).select('code name latestAssessment');
    if (!object) {
      result.orphanedItems += candidates.length;
      continue;
    }

    const existing = await ObjectAssessment.find({ object: object._id })
      .select('newScore assessedAt sourceReportItem')
      .sort({ assessedAt: 1 });

    const alreadyKeyed = new Set(
      existing
        .filter((row) => row.sourceReportItem)
        .map((row) => `${String(row.sourceReportItem)}:${row.newScore}`),
    );

    const missing = candidates.filter(
      (candidate) =>
        !alreadyKeyed.has(`${String(candidate.item._id)}:${String(candidate.item.score)}`),
    );
    result.alreadyPresent += candidates.length - missing.length;
    if (missing.length === 0) continue;

    /**
     * The merged chain. Every row known about this object, real and pending, in the order
     * it happened — so a backfilled row's predecessor is whatever actually preceded it,
     * including a manual assessment written between two report findings.
     */
    const chain = [
      ...existing.map((row) => ({ at: row.assessedAt, score: row.newScore, pending: null as
        | Candidate
        | null })),
      ...missing.map((candidate) => ({
        at: candidate.report.occurredAt,
        score: candidate.item.score as number,
        pending: candidate,
      })),
    ].sort((left, right) => left.at.getTime() - right.at.getTime());

    for (let index = 0; index < chain.length; index += 1) {
      const entry = chain[index];
      if (!entry?.pending) continue;
      const { item, report } = entry.pending;

      const row: MissingHistoryRow = {
        objectId: String(object._id),
        objectCode: object.code ?? null,
        objectName: object.name ?? null,
        reportItemId: String(item._id),
        reportId: String(report._id),
        reportNumber: report.reportNumber,
        reportType: report.type,
        sourceReference: report.sourceReference,
        previousScore: chain[index - 1]?.score ?? null,
        newScore: item.score as number,
        riskLevel: item.riskLevel as RiskLevel,
        assessedByName: report.approvedByName ?? report.createdByName,
        assessedAt: report.occurredAt.toISOString(),
        created: false,
        error: null,
      };

      if (!dryRun) {
        try {
          const written = await appendAssessmentHistory({
            object: object._id,
            previousScore: row.previousScore,
            newScore: row.newScore,
            riskLevel: row.riskLevel,
            assessedBy: report.approvedBy ?? report.createdBy ?? null,
            assessedByName: row.assessedByName,
            // Whoever wrote THIS finding, where the item records one — a separate question
            // from the sign-off above it. Items written before `judgedBy` existed carry
            // null here and are traced back to their sub-task by
            // `backfill-assessment-judged-by`, which is the script that exists for it.
            judgedBy: item.judgedBy,
            judgedByName: item.judgedByName,
            assessedAt: report.occurredAt,
            photos: [...(item.evidenceAttachments ?? [])],
            conclusion: item.conclusion,
            recommendation: item.recommendation,
            actionTaken: item.observation,
            measuredLoadKw: item.measuredLoadKw,
            sourceLabel: report.sourceReference ?? report.reportNumber,
            sourceReport: report._id,
            sourceReportItem: item._id,
          });
          row.created = true;

          // The head repair, taken only where the reference resolves to nothing AND this
          // row is the figure the head is actually showing.
          await repairHeadIfDangling(object, written._id, row, result, dryRun);
        } catch (error) {
          row.error = error instanceof Error ? error.message : String(error);
          result.failures += 1;
        }
      } else {
        await repairHeadIfDangling(object, null, row, result, dryRun);
      }

      result.rows.push(row);
    }
  }

  return result;
}

/**
 * Repoints a head that references a document that was never written.
 *
 * Only when the head's own score and instant match the row being backfilled: a head
 * showing a later figure belongs to a different finding, and pointing it at this one would
 * make the object claim a history row that is not the one it is displaying.
 */
async function repairHeadIfDangling(
  object: HydratedDocument<IObject> | null,
  writtenId: Types.ObjectId | null,
  row: MissingHistoryRow,
  result: BackfillResult,
  dryRun: boolean,
): Promise<void> {
  const head = object?.latestAssessment;
  if (!object || !head?.assessment) return;
  if (head.score !== row.newScore) return;
  if (head.assessedAt.toISOString() !== row.assessedAt) return;

  const resolves = await ObjectAssessment.countDocuments({ _id: head.assessment });
  if (resolves > 0) return;

  // Reported once per object, even if two candidate rows would qualify.
  if (result.danglingHeads.some((entry) => entry.objectId === String(object._id))) return;

  const record: DanglingHead = {
    objectId: String(object._id),
    objectCode: object.code ?? null,
    danglingRef: String(head.assessment),
    headScore: head.score,
    repointedTo: writtenId ? String(writtenId) : null,
    repaired: false,
  };

  if (!dryRun && writtenId) {
    await ObjectRecord.updateOne(
      { _id: object._id },
      { $set: { 'latestAssessment.assessment': writtenId } },
    );
    record.repaired = true;
  }

  result.danglingHeads.push(record);
}

/**
 * Prints every row, one line each.
 *
 * The same shape in both modes, so a dry run diffs cleanly against the applied run that
 * follows it and the only lines that move are the ones describing the mode.
 */
function report(result: BackfillResult): void {
  logger.info(
    { dryRun: result.dryRun, itemsExamined: result.itemsExamined },
    result.dryRun
      ? 'DRY RUN — listing assessment history rows the report path never wrote. Nothing will be written.'
      : 'APPLYING — writing the missing assessment history rows.',
  );

  for (const row of result.rows) {
    logger.info(
      {
        object: `${row.objectCode ?? '?'} ${row.objectName ?? ''}`.trim(),
        objectId: row.objectId,
        report: row.reportNumber,
        type: row.reportType,
        source: row.sourceReference,
        previousScore: row.previousScore,
        newScore: row.newScore,
        riskLevel: row.riskLevel,
        assessedByName: row.assessedByName,
        assessedAt: row.assessedAt,
        created: row.created,
        error: row.error,
      },
      `${row.objectCode ?? row.objectId}: ${row.reportNumber} → ${row.newScore}/100 (${row.riskLevel})`,
    );
  }

  for (const head of result.danglingHeads) {
    logger.warn(
      {
        objectId: head.objectId,
        objectCode: head.objectCode,
        danglingRef: head.danglingRef,
        headScore: head.headScore,
        repointedTo: head.repointedTo,
        repaired: head.repaired,
      },
      `${head.objectCode ?? head.objectId}: latestAssessment.assessment references no document`,
    );
  }

  logger.info(
    {
      dryRun: result.dryRun,
      itemsExamined: result.itemsExamined,
      missing: result.rows.length,
      created: result.rows.filter((row) => row.created).length,
      alreadyPresent: result.alreadyPresent,
      orphanedItems: result.orphanedItems,
      danglingHeads: result.danglingHeads.length,
      failures: result.failures,
    },
    result.dryRun
      ? 'Dry run complete: nothing written. Re-run with --apply to write these rows.'
      : 'Assessment history backfilled',
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const objectFlag = process.argv.indexOf('--object');
  const objectId = objectFlag >= 0 ? process.argv[objectFlag + 1] : undefined;

  await connectDatabase();

  const result = await backfillReportAssessmentHistory({ apply, objectId });
  report(result);

  await disconnectDatabase();

  if (apply && result.failures > 0) {
    logger.error({ failures: result.failures }, 'Some history rows could not be written.');
    process.exit(1);
  }
}

// Only when run as a script. Importing this file from a test must not open a connection.
if (process.argv[1]?.includes('backfill-report-assessment-history')) {
  main().catch((error: unknown) => {
    logger.error({ error }, 'Assessment history backfill failed');
    process.exit(1);
  });
}
