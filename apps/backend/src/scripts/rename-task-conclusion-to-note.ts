/**
 * Renames the planned-work sub-task field `conclusion` to `note`.
 *
 * Requirement 6 separated the two words that the first build had conflated: a sub-task now
 * carries a Тайлбар describing what was done, and Дүгнэлт exists only on the consolidated
 * report. The Mongoose schema changed with it, which leaves documents written before the
 * change holding a `conclusion` key the application no longer reads and a `note` that is
 * absent. Those sub-tasks would quietly fall out of DONE, because the evidence check looks
 * for a note, and their parent works would stop being completable.
 *
 * The rename is therefore not optional cleanup. Run it once against each environment that
 * has planned-work data, before serving the new build.
 *
 * Usage: npm run migrate:task-note --workspace @monhorus/backend
 *        npm run migrate:task-note --workspace @monhorus/backend -- --dry-run
 *
 * Safe to run more than once: documents already carrying `note` are not matched.
 */
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';

const COLLECTION = 'plannedworktasks';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  await connectDatabase();

  const db = mongoose.connection.db;
  if (!db) {
    logger.error('No database handle after connecting');
    process.exit(1);
  }

  const collection = db.collection(COLLECTION);

  // Only documents that still carry the old key and have not already been migrated. A
  // document holding both would mean a partial earlier run, so `note` absent is the
  // condition that makes this safe to repeat.
  const filter = { conclusion: { $exists: true }, note: { $exists: false } };
  const pending = await collection.countDocuments(filter);

  // Written by the new code before anyone thought to migrate. Renaming would overwrite a
  // real note with a stale value, so these are reported and left alone.
  const conflicts = await collection.countDocuments({
    conclusion: { $exists: true },
    note: { $exists: true },
  });

  logger.info({ pending, conflicts, dryRun }, 'Sub-task note migration scan');

  if (conflicts > 0) {
    logger.warn(
      { conflicts },
      'Documents hold both conclusion and note. Left untouched: renaming would discard the newer note. Inspect these by hand.',
    );
  }

  if (pending === 0) {
    logger.info('Nothing to migrate');
    await disconnectDatabase();
    return;
  }

  if (dryRun) {
    logger.info({ pending }, 'Dry run: no changes written');
    await disconnectDatabase();
    return;
  }

  const result = await collection.updateMany(filter, { $rename: { conclusion: 'note' } });
  logger.info({ matched: result.matchedCount, modified: result.modifiedCount }, 'Migration complete');

  await disconnectDatabase();
}

main().catch((error: unknown) => {
  logger.error({ error }, 'Sub-task note migration failed');
  process.exit(1);
});
