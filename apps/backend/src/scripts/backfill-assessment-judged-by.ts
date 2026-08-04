/**
 * Backfills the per-equipment AUTHOR onto history rows that only ever named a signer.
 *
 * WHAT WAS BROKEN
 *
 * `ObjectAssessment.assessedBy` answers "on whose authority does this equipment carry this
 * score" — the approver of the report the finding arrived on. Until `judgedBy` existed it
 * was also the only name the device history had, so a Дүгнэлт written by a technician and
 * approved by their manager showed the manager, and the screen read as though the manager
 * had judged the panel.
 *
 * `judgedBy`/`judgedByName` now carry the technician, per finding, from the planned-work
 * sub-task's `conclusionBy`. This script is for the rows written before that.
 *
 * WHAT IT SETS, AND FROM WHAT
 *
 * Only rows that can be TRACED, and only the two author fields. A row is traced by:
 *
 *   row.sourceReportItem -> ReportItem -> its Report
 *     -> (a consolidated item is followed up its own sourceReportItem chain first, because
 *        a consolidation copies a finding rather than making one, so the author it should
 *        show is the author of the item it copied)
 *     -> Report.sourceType === 'PLANNED_WORK' -> PlannedWorkTask of that work whose
 *        relatedObjects name the item's equipment and which carries a conclusionBy.
 *
 * WHERE THE TRACE IS AMBIGUOUS IT IS ABANDONED, NOT GUESSED. Two sub-tasks of one work may
 * name the same panel. The candidates are narrowed by matching the item's stored conclusion
 * text against the sub-task's, because that text is what the item actually carries; if that
 * still leaves more than one distinguishable author the row is reported as ambiguous and
 * left alone. Naming the wrong technician on an audit row is worse than naming none.
 *
 * Service-request conclusions are never traced: `IWorkReportObjectAssessment` records no
 * author per object, so there is nothing true to write. Their rows keep `judgedBy` null,
 * which reads as "not recorded" rather than as a claim about the approver.
 *
 * WHY THIS IS AN UPDATE AT ALL, ON AN APPEND-ONLY COLLECTION
 *
 * `ObjectAssessment` blocks every update and delete hook (rule 17.15), and rightly: a
 * finding is an assertion and correcting it is a new row, not an edit. This writes through
 * the raw driver to bypass those hooks, which is a deliberate, narrow exception:
 *
 *   - it only ever sets `judgedBy`/`judgedByName`, never a score, band, date, actor,
 *     conclusion or source. Nothing the row asserts changes;
 *   - it only ever writes where the field is currently absent or null, so it cannot
 *     overwrite an author the live path recorded;
 *   - the value is not invented — it is read from the sub-task that produced the finding.
 *
 * It is filling in provenance that was never captured, not rewriting history. Re-raising
 * the rows instead would give every affected object a duplicate finding, which would be a
 * real falsification of the record.
 *
 * IDEMPOTENT: a second run finds the field already populated and reports it as such.
 *
 * THE REPORT ITEM IS UPDATED TOO, when it can be traced and has no author yet, so the
 * report store and the history agree about who wrote a finding. `ReportItem` is an ordinary
 * mutable document — `syncItems` rewrites it on every republish — so that half needs no
 * exception.
 *
 * Usage: npm run backfill:assessment-judged-by --workspace @monhorus/backend
 *          -> DRY RUN. Prints every row it would touch. Writes nothing.
 *        ... -- --apply
 *          -> Writes them.
 *        ... -- --object <objectId>
 *          -> Restricts the run to one piece of equipment. Combines with --apply.
 *
 * Exits non-zero if `--apply` was given and any row failed to update.
 */
import { Types, type HydratedDocument } from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { ObjectAssessment, ObjectRecord } from '../modules/object-master/object-master.models';
import {
  PlannedWorkTask,
  type IPlannedWorkTask,
} from '../modules/planned-work/planned-work.models';
import {
  Report,
  ReportItem,
  type IReportItem,
} from '../modules/report-record/report-record.model';

/** Why a row could not be given an author. Reported, never silently dropped. */
export type SkipReason =
  | 'NO_SOURCE_ITEM'
  | 'ITEM_GONE'
  | 'REPORT_GONE'
  | 'NOT_PLANNED_WORK'
  | 'NO_TASK_MATCH'
  | 'TASK_HAS_NO_AUTHOR'
  | 'AMBIGUOUS_TASKS';

/** One history row the trace could give an author. */
export interface JudgedRow {
  assessmentId: string;
  objectId: string;
  objectCode: string | null;
  reportItemId: string;
  reportNumber: string;
  sourceReference: string | null;
  /** The signer the row already names, kept so the two can be compared in the output. */
  assessedByName: string | null;
  judgedById: string;
  judgedByName: string | null;
  taskTitle: string;
  /** False on a dry run, and on a write that threw. */
  updated: boolean;
  /** The report item also gained the author. */
  itemUpdated: boolean;
  error: string | null;
}

/** One history row the trace could NOT give an author, and why. */
export interface SkippedRow {
  assessmentId: string;
  objectId: string;
  objectCode: string | null;
  reason: SkipReason;
  detail: string | null;
}

export interface JudgedByBackfillResult {
  /** False only when `--apply` was passed. Nothing is written on a dry run. */
  dryRun: boolean;
  /** History rows examined: report-raised and carrying no author yet. */
  examined: number;
  /** Rows that already had one. Untouched, and not examined further. */
  alreadyAuthored: number;
  rows: JudgedRow[];
  skipped: SkippedRow[];
  failures: number;
}

/**
 * Walks a consolidated item back to the finding it was copied from.
 *
 * A consolidation's item carries `sourceReportItem`; the item it points at may itself be a
 * copy. The walk is bounded because a cycle would otherwise hang the script, and a depth
 * beyond a handful means the data is malformed rather than deeply nested.
 */
async function originItem(
  item: HydratedDocument<IReportItem>,
): Promise<HydratedDocument<IReportItem>> {
  let current = item;
  const seen = new Set<string>([String(item._id)]);

  for (let hop = 0; hop < 10; hop += 1) {
    if (!current.sourceReportItem) return current;
    const next = await ReportItem.findById(current.sourceReportItem);
    if (!next || seen.has(String(next._id))) return current;
    seen.add(String(next._id));
    current = next;
  }
  return current;
}

/**
 * The sub-task that produced a finding, or null with the reason it could not be named.
 *
 * Matching is on the equipment the sub-task related to. Where several qualify, the item's
 * own conclusion text is used to narrow them — it is a copy of the sub-task's, so it
 * identifies the one that spoke about this equipment. Candidates that agree on the author
 * are not ambiguous at all, however many sub-tasks they are: the answer is the same person.
 */
function chooseTask(
  tasks: readonly HydratedDocument<IPlannedWorkTask>[],
  item: HydratedDocument<IReportItem>,
): { task: HydratedDocument<IPlannedWorkTask> } | { reason: SkipReason; detail: string | null } {
  const naming = tasks.filter((task) =>
    task.relatedObjects.some((related) => String(related) === String(item.object)),
  );
  if (naming.length === 0) return { reason: 'NO_TASK_MATCH', detail: null };

  const authored = naming.filter((task) => task.conclusionBy);
  if (authored.length === 0) {
    return { reason: 'TASK_HAS_NO_AUTHOR', detail: naming.map((task) => task.title).join(' | ') };
  }
  if (authored.length === 1) return { task: authored[0]! };

  const byText = authored.filter((task) => (task.conclusion ?? '') === (item.conclusion ?? ''));
  if (byText.length === 1) return { task: byText[0]! };

  const pool = byText.length > 0 ? byText : authored;
  const authors = new Set(pool.map((task) => String(task.conclusionBy)));
  if (authors.size === 1) return { task: pool[0]! };

  return {
    reason: 'AMBIGUOUS_TASKS',
    detail: pool.map((task) => `${task.title} → ${task.conclusionByName ?? '?'}`).join(' | '),
  };
}

export async function backfillAssessmentJudgedBy(
  options: { apply?: boolean; objectId?: string } = {},
): Promise<JudgedByBackfillResult> {
  const dryRun = !(options.apply ?? false);

  const result: JudgedByBackfillResult = {
    dryRun,
    examined: 0,
    alreadyAuthored: 0,
    rows: [],
    skipped: [],
    failures: 0,
  };

  const scope = options.objectId ? { object: new Types.ObjectId(options.objectId) } : {};

  result.alreadyAuthored = await ObjectAssessment.countDocuments({
    ...scope,
    judgedBy: { $ne: null },
  });

  // Only rows that came from a report can be traced at all: a manual assessment has no
  // finding behind it, and its recorder is already in `assessedBy`.
  const assessments = await ObjectAssessment.find({
    ...scope,
    judgedBy: null,
  }).sort({ assessedAt: 1 });

  // Cached per planned work: one work fans out to many items, and re-reading its sub-tasks
  // per item would be a query per row for one answer.
  const tasksByWork = new Map<string, HydratedDocument<IPlannedWorkTask>[]>();
  const objectCodes = new Map<string, string | null>();

  const codeOf = async (objectId: Types.ObjectId): Promise<string | null> => {
    const key = String(objectId);
    if (!objectCodes.has(key)) {
      const object = await ObjectRecord.findById(objectId).select('code');
      objectCodes.set(key, object?.code ?? null);
    }
    return objectCodes.get(key) ?? null;
  };

  for (const assessment of assessments) {
    result.examined += 1;

    const skip = async (reason: SkipReason, detail: string | null = null): Promise<void> => {
      result.skipped.push({
        assessmentId: String(assessment._id),
        objectId: String(assessment.object),
        objectCode: await codeOf(assessment.object),
        reason,
        detail,
      });
    };

    if (!assessment.sourceReportItem) {
      await skip('NO_SOURCE_ITEM');
      continue;
    }

    const item = await ReportItem.findById(assessment.sourceReportItem);
    if (!item) {
      await skip('ITEM_GONE');
      continue;
    }

    const traced = await originItem(item);
    const report = await Report.findById(traced.report);
    if (!report) {
      await skip('REPORT_GONE');
      continue;
    }

    if (report.sourceType !== 'PLANNED_WORK' || !report.sourceId) {
      await skip('NOT_PLANNED_WORK', report.sourceType);
      continue;
    }

    const workKey = String(report.sourceId);
    if (!tasksByWork.has(workKey)) {
      tasksByWork.set(workKey, await PlannedWorkTask.find({ plannedWork: report.sourceId }));
    }

    const chosen = chooseTask(tasksByWork.get(workKey) ?? [], traced);
    if ('reason' in chosen) {
      await skip(chosen.reason, chosen.detail);
      continue;
    }

    const row: JudgedRow = {
      assessmentId: String(assessment._id),
      objectId: String(assessment.object),
      objectCode: await codeOf(assessment.object),
      reportItemId: String(item._id),
      reportNumber: report.reportNumber,
      sourceReference: report.sourceReference,
      assessedByName: assessment.assessedByName,
      judgedById: String(chosen.task.conclusionBy),
      judgedByName: chosen.task.conclusionByName,
      taskTitle: chosen.task.title,
      updated: false,
      itemUpdated: false,
      error: null,
    };

    if (!dryRun) {
      try {
        /*
         * Through the raw collection, because the model refuses every update hook. The
         * filter repeats the null guard so a row authored between the read above and this
         * write is left as the live path wrote it.
         */
        const written = await ObjectAssessment.collection.updateOne(
          { _id: assessment._id, $or: [{ judgedBy: null }, { judgedBy: { $exists: false } }] },
          {
            $set: {
              judgedBy: chosen.task.conclusionBy,
              judgedByName: chosen.task.conclusionByName ?? null,
            },
          },
        );
        row.updated = written.modifiedCount === 1;

        // The item the finding lives on, so a later republish does not read as a change.
        const itemWrite = await ReportItem.updateOne(
          { _id: item._id, $or: [{ judgedBy: null }, { judgedBy: { $exists: false } }] },
          {
            $set: {
              judgedBy: chosen.task.conclusionBy,
              judgedByName: chosen.task.conclusionByName ?? null,
            },
          },
        );
        row.itemUpdated = itemWrite.modifiedCount === 1;
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
        result.failures += 1;
      }
    }

    result.rows.push(row);
  }

  return result;
}

/** Prints every row and every skip, one line each, in the same shape in both modes. */
function report(result: JudgedByBackfillResult): void {
  logger.info(
    { dryRun: result.dryRun, examined: result.examined },
    result.dryRun
      ? 'DRY RUN — listing history rows that can be given the technician who judged them. Nothing will be written.'
      : 'APPLYING — writing the judging technician onto the history rows.',
  );

  for (const row of result.rows) {
    logger.info(
      {
        assessmentId: row.assessmentId,
        object: row.objectCode ?? row.objectId,
        report: row.reportNumber,
        source: row.sourceReference,
        task: row.taskTitle,
        signedOffBy: row.assessedByName,
        judgedByName: row.judgedByName,
        judgedById: row.judgedById,
        updated: row.updated,
        itemUpdated: row.itemUpdated,
        error: row.error,
      },
      `${row.objectCode ?? row.objectId}: ${row.reportNumber} judged by ${
        row.judgedByName ?? row.judgedById
      } (signed off by ${row.assessedByName ?? '?'})`,
    );
  }

  for (const entry of result.skipped) {
    logger.warn(
      {
        assessmentId: entry.assessmentId,
        object: entry.objectCode ?? entry.objectId,
        reason: entry.reason,
        detail: entry.detail,
      },
      `${entry.objectCode ?? entry.objectId}: no author can be traced (${entry.reason})`,
    );
  }

  const bySkipReason: Record<string, number> = {};
  for (const entry of result.skipped) {
    bySkipReason[entry.reason] = (bySkipReason[entry.reason] ?? 0) + 1;
  }

  logger.info(
    {
      dryRun: result.dryRun,
      examined: result.examined,
      alreadyAuthored: result.alreadyAuthored,
      traceable: result.rows.length,
      updated: result.rows.filter((row) => row.updated).length,
      skipped: result.skipped.length,
      bySkipReason,
      failures: result.failures,
    },
    result.dryRun
      ? 'Dry run complete: nothing written. Re-run with --apply to write these authors.'
      : 'Judging technician backfilled',
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const objectFlag = process.argv.indexOf('--object');
  const objectId = objectFlag >= 0 ? process.argv[objectFlag + 1] : undefined;

  await connectDatabase();

  const result = await backfillAssessmentJudgedBy({ apply, objectId });
  report(result);

  await disconnectDatabase();

  if (apply && result.failures > 0) {
    logger.error({ failures: result.failures }, 'Some rows could not be given an author.');
    process.exit(1);
  }
}

// Only when run as a script. Importing this file from a test must not open a connection.
if (process.argv[1]?.includes('backfill-assessment-judged-by')) {
  main().catch((error: unknown) => {
    logger.error({ error }, 'Judging-technician backfill failed');
    process.exit(1);
  });
}
