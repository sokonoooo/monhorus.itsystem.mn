/**
 * Builds the no-duplicate index on the assessment history, clearing what has to go first.
 *
 * WHY THIS EXISTS
 *
 * `ObjectAssessment` is append-only and MODEL-LEVEL IMMUTABLE: every update and delete hook
 * on the schema throws (rule 17.15). That is the right shape for an audit record, and it
 * also means a duplicate row that gets written is permanent — the equipment's Үнэлгээний
 * түүх shows the same finding twice, for good, and nothing in the application can take it
 * out again.
 *
 * One got written. `appendAssessmentHistory` keyed its idempotency guard on the report
 * item's `_id`, and `syncItems` hard-deletes any item whose source has stopped naming the
 * object. A planned work's canonical report is rebuilt from its sub-tasks on every publish,
 * so a technician correcting which panel they worked on withdrew an item and, adding it
 * back, minted a brand new id for the same finding. The guard missed and appended a second,
 * byte-identical row.
 *
 * The guard now keys on `(object, sourceReport, newScore)` — the natural key of the same
 * finding, since `ReportItem` declares `{ report, object }` unique — and the schema declares
 * a partial unique index on it. But a lookup-before-write is check-then-write and loses the
 * race between two concurrent applies of the same report, so the INDEX is the actual
 * guarantee, and production connects with `autoIndex: false` (`config/database.ts`). This
 * script is the deploy step.
 *
 * WHAT IT DOES ABOUT THE DUPLICATES ALREADY THERE
 *
 * The index cannot build over them: `createIndex` on a unique key with existing violations
 * fails outright, and every one of those rows was written by the bug this fixes. So the
 * script surveys the collection for groups sharing `(object, sourceReport, newScore)`,
 * removes all but one from each, and only then builds the index.
 *
 * WHICH ROW IT KEEPS
 *
 *   1. The row the object's `latestAssessment.assessment` points at, when it is one of the
 *      group. Removing it would leave the denormalised head — which every list, the plan and
 *      the device drawer read — dangling at an id that resolves to nothing, which is a
 *      SECOND defect this collection has already suffered once.
 *   2. Otherwise the earliest by `(createdAt, _id)`: the row that actually recorded the
 *      event. The later ones are replays of it.
 *
 * DELETING AN IMMUTABLE ROW IS A DECISION, AND THIS IS THE REASONING
 *
 * The immutability hooks exist to stop the APPLICATION rewriting history — a finding, once
 * recorded, is what the record says. They do not make a row sacred in itself. Every row this
 * script removes is a verbatim duplicate of one it keeps: same equipment, same report, same
 * score, and it was never a separate observation by anybody. Keeping it does not preserve a
 * finding, it preserves a double count — in the device's history table, in anything that
 * counts findings per object, and in the operator's reading of what happened. The finding
 * survives in full in the row that stays, so nothing is lost. The removal goes through the
 * raw driver (`Model.collection`), which is what BYPASSES the mongoose middleware; that is
 * deliberate and is the only place in the codebase that does it. Every removal is logged
 * with its id and its `assessedAt`, so an operator can reconcile afterwards.
 *
 * The script is idempotent. A second run finds no group with more than one row, sees the
 * index already present, and writes nothing.
 *
 * Run:
 *   npx tsx src/scripts/migrate-assessment-source-report-index.ts --dry-run
 *   npx tsx src/scripts/migrate-assessment-source-report-index.ts --apply
 *
 * `npm run sync:indexes` is NOT a substitute. It builds every index the schemas declare,
 * including this one, and the build fails outright on the first duplicate it meets —
 * leaving the collection unindexed and the operator holding a driver error rather than a
 * list of what has to go. Run this first; `sync:indexes` then has nothing left to do.
 */

import { Types } from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import {
  ObjectAssessment,
  ObjectRecord,
} from '../modules/object-master/object-master.models';
import { Report } from '../modules/report-record/report-record.model';

export const INDEX_NAME = 'object_1_sourceReport_1_newScore_1';

/** One removed row, listed individually so an operator can reconcile an audit trail. */
export interface RemovedRow {
  id: string;
  assessedAt: string;
  createdAt: string;
  /** The report item it was raised from, which is the id that stopped being stable. */
  sourceReportItem: string | null;
}

/** One `(object, sourceReport, newScore)` group holding more than one row. */
export interface DuplicateGroup {
  objectId: string;
  objectCode: string | null;
  sourceReport: string;
  reportNumber: string | null;
  newScore: number;
  keptId: string;
  /** `head` when the object's denormalised head pointed at it; `earliest` otherwise. */
  keptBecause: 'head' | 'earliest';
  removed: RemovedRow[];
}

export interface MigrationResult {
  dryRun: boolean;
  /** Report-raised rows examined, i.e. those the index will cover. */
  rowsScanned: number;
  duplicateGroups: DuplicateGroup[];
  rowsRemoved: number;
  indexName: string;
  indexAlreadyPresent: boolean;
  indexCreated: boolean;
  /** Set when the build was refused — the operator has to see this, not a silent skip. */
  indexError: string | null;
}

interface GroupKey {
  object: Types.ObjectId;
  sourceReport: Types.ObjectId;
  newScore: number;
}

/**
 * Every key holding more than one row, found by the database rather than in memory.
 *
 * `$type: 'objectId'` matches the index's own partial filter exactly, so the survey scans
 * precisely the rows the build will have to satisfy — a manual assessment carries no source
 * report and several of them at the same score are several real findings.
 */
async function duplicateKeys(): Promise<{ keys: GroupKey[]; rowsScanned: number }> {
  const rows = await ObjectAssessment.aggregate<{
    _id: GroupKey;
    count: number;
  }>([
    { $match: { sourceReport: { $type: 'objectId' } } },
    {
      $group: {
        _id: { object: '$object', sourceReport: '$sourceReport', newScore: '$newScore' },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1, '_id.object': 1 } },
  ]);

  return {
    keys: rows.filter((row) => row.count > 1).map((row) => row._id),
    rowsScanned: rows.reduce((total, row) => total + row.count, 0),
  };
}

/**
 * Clears the duplicate history rows and builds the partial unique index.
 *
 * Exported so the behaviour is asserted by a test against fixture rows rather than only by
 * running it at a live database.
 */
export async function migrateAssessmentSourceReportIndex(
  options: { dryRun?: boolean } = {},
): Promise<MigrationResult> {
  const dryRun = options.dryRun ?? true;

  const { keys, rowsScanned } = await duplicateKeys();

  const result: MigrationResult = {
    dryRun,
    rowsScanned,
    duplicateGroups: [],
    rowsRemoved: 0,
    indexName: INDEX_NAME,
    indexAlreadyPresent: false,
    indexCreated: false,
    indexError: null,
  };

  for (const key of keys) {
    // Re-read rather than trusting an aggregation `$push` for order: which row is earliest
    // decides which one survives, and that is not a detail to leave to pipeline mechanics.
    const rows = await ObjectAssessment.find(key)
      .select('_id assessedAt createdAt sourceReportItem')
      .sort({ createdAt: 1, _id: 1 })
      .lean();
    if (rows.length < 2) continue;

    const [object, report] = await Promise.all([
      ObjectRecord.findById(key.object).select('code latestAssessment').lean(),
      Report.findById(key.sourceReport).select('reportNumber').lean(),
    ]);

    const headId = object?.latestAssessment?.assessment ?? null;
    const head = headId ? rows.find((row) => String(row._id) === String(headId)) : undefined;
    const kept = head ?? rows[0]!;

    const group: DuplicateGroup = {
      objectId: String(key.object),
      objectCode: object?.code ?? null,
      sourceReport: String(key.sourceReport),
      reportNumber: report?.reportNumber ?? null,
      newScore: key.newScore,
      keptId: String(kept._id),
      keptBecause: head ? 'head' : 'earliest',
      removed: rows
        .filter((row) => String(row._id) !== String(kept._id))
        .map((row) => ({
          id: String(row._id),
          assessedAt: row.assessedAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
          sourceReportItem: row.sourceReportItem ? String(row.sourceReportItem) : null,
        })),
    };

    if (!dryRun) {
      for (const row of group.removed) {
        // THE RAW DRIVER, on purpose. `ObjectAssessment.deleteOne` throws: the schema blocks
        // every delete hook so the application cannot rewrite history. See the header — this
        // removes verbatim duplicates of rows it keeps, and it is the only caller that does
        // this.
        await ObjectAssessment.collection.deleteOne({ _id: new Types.ObjectId(row.id) });
        result.rowsRemoved += 1;
      }
    }

    result.duplicateGroups.push(group);
  }

  // -- The index -------------------------------------------------------------
  const live = await ObjectAssessment.collection.indexes();
  result.indexAlreadyPresent = live.some((index) => index.name === INDEX_NAME);

  if (result.indexAlreadyPresent || dryRun) return result;

  try {
    await ObjectAssessment.collection.createIndex(
      { object: 1, sourceReport: 1, newScore: 1 },
      {
        name: INDEX_NAME,
        unique: true,
        partialFilterExpression: { sourceReport: { $type: 'objectId' } },
      },
    );
    result.indexCreated = true;
  } catch (error) {
    // Reported, never swallowed. Without the index the guard is a lookup, and a lookup
    // loses the concurrent-apply race the whole change exists to close.
    result.indexError = error instanceof Error ? error.message : String(error);
  }

  return result;
}

async function main(): Promise<void> {
  // Dry run is the default. Writing removes rows from a collection the application itself
  // is forbidden to touch, and that is the operator's call, not the script's.
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;

  await connectDatabase();

  const result = await migrateAssessmentSourceReportIndex({ dryRun });

  for (const group of result.duplicateGroups) {
    logger.info(
      {
        objectId: group.objectId,
        objectCode: group.objectCode,
        reportNumber: group.reportNumber,
        sourceReport: group.sourceReport,
        newScore: group.newScore,
        keptId: group.keptId,
        keptBecause: group.keptBecause,
        removed: group.removed,
      },
      dryRun
        ? 'Would remove duplicate assessment history rows'
        : 'Removed duplicate assessment history rows',
    );
  }

  logger.info(
    {
      dryRun,
      rowsScanned: result.rowsScanned,
      duplicateGroups: result.duplicateGroups.length,
      rowsRemoved: result.rowsRemoved,
      index: result.indexName,
      indexAlreadyPresent: result.indexAlreadyPresent,
      indexCreated: result.indexCreated,
    },
    dryRun
      ? 'Dry run: no changes written. Re-run with --apply to remove the duplicates and build the index.'
      : 'Assessment history index migration complete',
  );

  if (result.indexError) {
    logger.error(
      { index: result.indexName, err: result.indexError },
      'The no-duplicate index could NOT be built. Nothing is enforcing the rule; investigate before treating this deploy as done.',
    );
    process.exitCode = 1;
  }

  await disconnectDatabase();
}

// Only when run as a script. Importing this file from a test must not open a connection.
if (process.argv[1]?.includes('migrate-assessment-source-report-index')) {
  main().catch((error: unknown) => {
    logger.error({ err: error }, 'migrate-assessment-source-report-index failed');
    process.exit(1);
  });
}
