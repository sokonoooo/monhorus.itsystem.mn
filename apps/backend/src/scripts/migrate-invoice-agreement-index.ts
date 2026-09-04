/**
 * Re-keys the invoice no-duplicate index on the agreement.
 *
 * The old index was
 *
 *   { customer: 1, billingPeriod: 1, billingType: 1 }  unique, partial on non-cancelled
 *
 * which reads "one MONTHLY_SERVICE invoice per customer per period". That is wrong for a
 * customer holding two ACTIVE agreements — a head office and a warehouse each owe their
 * own monthly fee. The first agreement's invoice was accepted and the second was then
 * refused permanently, so a real receivable could never be billed for that period. The new
 * index adds `serviceAgreement`:
 *
 *   { customer: 1, serviceAgreement: 1, billingPeriod: 1, billingType: 1 }
 *
 * Production connects with `autoIndex: false` (`config/database.ts`), so shipping the
 * schema change is not enough: the old index survives the deploy and keeps refusing the
 * second agreement. This script is the deploy step.
 *
 * Safe by construction. The new key is strictly finer than the old one, so any data the
 * old unique index accepted also satisfies the new one — the build cannot fail on existing
 * rows, and no invoice is read or written. The window between the drop and the create is
 * the only exposure: for those few seconds nothing enforces the rule, so run it when no
 * monthly generation is in flight.
 *
 *   npx tsx src/scripts/migrate-invoice-agreement-index.ts --dry-run
 *   npx tsx src/scripts/migrate-invoice-agreement-index.ts --apply
 *
 * `npm run sync:indexes` reaches the same end state — it drops every index not in the
 * schema and builds every index that is. This script is the narrower alternative: it
 * touches one index on one collection and says exactly what it did, which is what you want
 * on a live invoicing database.
 */
import { INVOICE_STATUSES } from '@monhorus/shared';
import mongoose from 'mongoose';

import { env } from '../config/env';
import { logger } from '../config/logger';

const APPLY = process.argv.includes('--apply');

const OLD_INDEX = 'customer_1_billingPeriod_1_billingType_1';
const NEW_INDEX = 'customer_1_serviceAgreement_1_billingPeriod_1_billingType_1';

async function main(): Promise<void> {
  await mongoose.connect(env.MONGODB_URI);
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect.');

  const invoices = db.collection('invoices');
  const live = await invoices.indexes();
  const names = live.map((index) => index.name);

  const hasOld = names.includes(OLD_INDEX);
  const hasNew = names.includes(NEW_INDEX);

  logger.info({ hasOld, hasNew, indexes: names, mode: APPLY ? 'apply' : 'dry-run' }, 'invoice index survey');

  if (!hasOld && hasNew) {
    logger.info('Already migrated. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  if (!APPLY) {
    logger.info(
      { willDrop: hasOld ? OLD_INDEX : null, willCreate: hasNew ? null : NEW_INDEX },
      'Dry run only. Re-run with --apply.',
    );
    await mongoose.disconnect();
    return;
  }

  if (!hasNew) {
    await invoices.createIndex(
      { customer: 1, serviceAgreement: 1, billingPeriod: 1, billingType: 1 },
      {
        name: NEW_INDEX,
        unique: true,
        partialFilterExpression: {
          status: { $in: INVOICE_STATUSES.filter((status) => status !== 'CANCELLED') },
        },
      },
    );
    logger.info({ index: NEW_INDEX }, 'created');
  }

  // Dropped last: until the new index exists there is nothing else enforcing the rule.
  if (hasOld) {
    await invoices.dropIndex(OLD_INDEX);
    logger.info({ index: OLD_INDEX }, 'dropped');
  }

  logger.info({ indexes: (await invoices.indexes()).map((index) => index.name) }, 'invoice index migration complete');

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'invoice index migration failed');
  process.exitCode = 1;
});
