/**
 * Retires `requestType` and repairs what referenced it.
 *
 * Two jobs, both of which have to happen or the application misbehaves in ways a code
 * change alone cannot fix:
 *
 *   1. Saved dashboard widgets grouped by REQUEST_TYPE. `DashboardCustomWidget.dimension`
 *      is a mongoose enum, and REQUEST_TYPE is no longer in it - so those rows fail
 *      validation on the next save and the dashboard that owns them cannot be edited.
 *      They are deleted rather than repointed: there is no other dimension that means the
 *      same thing, and silently regrouping somebody's chart by STATUS would leave a widget
 *      whose title no longer matches what it shows.
 *
 *   2. The stored `requestType` field itself, unset from every request. Left in place it
 *      is invisible but not harmless: `sync-indexes` would keep dropping and recreating
 *      the index for a field the schema no longer declares.
 *
 * Reversible only from a backup. Run the backup script first; the deployment notes say so
 * for every migration and this one deletes user-authored configuration.
 *
 *   npx tsx src/scripts/drop-request-type.ts --dry-run
 *   npx tsx src/scripts/drop-request-type.ts --apply
 */
import mongoose from 'mongoose';

import { env } from '../config/env';
import { logger } from '../config/logger';

const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect.');

  const widgets = db.collection('dashboardcustomwidgets');
  const requests = db.collection('servicerequests');

  const staleWidgets = await widgets.countDocuments({ dimension: 'REQUEST_TYPE' });
  const withType = await requests.countDocuments({ requestType: { $exists: true } });

  logger.info(
    { staleWidgets, withType, mode: APPLY ? 'apply' : 'dry-run' },
    'requestType retirement survey',
  );

  if (!APPLY) {
    logger.info(
      'Dry run only. Re-run with --apply to delete the widgets and unset the field.',
    );
    await mongoose.disconnect();
    return;
  }

  const deleted = await widgets.deleteMany({ dimension: 'REQUEST_TYPE' });
  const unset = await requests.updateMany(
    { requestType: { $exists: true } },
    { $unset: { requestType: '' } },
  );

  logger.info(
    { widgetsDeleted: deleted.deletedCount, requestsCleared: unset.modifiedCount },
    'requestType retired',
  );

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'requestType retirement failed');
  process.exitCode = 1;
});
