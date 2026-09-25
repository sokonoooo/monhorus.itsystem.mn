/**
 * Build the schema indexes in a production database.
 *
 * `config/database.ts` connects with `autoIndex: !env.isProduction` and the comment
 * beside it says "In production, build indexes via a migration." No such migration
 * existed, so a first boot with NODE_ENV=production created **no indexes at all** --
 * including the unique ones correctness depends on, such as the
 * (customer, sourceType, sourceId) index the report store uses for idempotency, and
 * the unique email on User. Nothing fails loudly; the collections simply scan, and a
 * duplicate that a unique index would have refused is accepted instead.
 *
 * This is that migration. Run it after the first successful boot of a new deployment,
 * and again after any release that adds or changes a schema index:
 *
 *   npm run sync:indexes --workspace @monhorus/backend            # apply
 *   npm run sync:indexes --workspace @monhorus/backend -- --dry-run
 *
 * Models are discovered by walking the compiled tree rather than being listed here.
 * That is deliberate: the codebase uses BOTH `*.model.ts` and `*.models.ts` --
 * planned-work, objects, org, material and object-master all use the plural form --
 * so a hand-written list, or a glob that matched only the singular, would silently
 * skip five modules including planned-work. A walk that matches both cannot drift as
 * models are added.
 *
 * `syncIndexes()` also DROPS indexes that are on the collection but not in the schema.
 * That is what makes the database match the code, but it means an index added by hand
 * from mongosh will be removed. The dropped list is logged per model, and --dry-run
 * shows it without writing.
 */
import fs from 'node:fs';
import path from 'node:path';

import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';

/** Every model file under the backend tree, in both naming conventions. */
function findModelFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'test') walk(full);
      } else if (/\.models?\.(js|ts)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found.sort();
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  // dist/scripts/… at runtime, src/scripts/… under tsx. Either way the models sit
  // under the parent directory.
  const root = path.join(__dirname, '..');
  const files = findModelFiles(root);
  for (const file of files) {
    // Imported for the side effect: each module registers its schemas on the shared
    // mongoose instance at import time.
    require(file);
  }

  await connectDatabase();

  const names = Object.keys(mongoose.models).sort();
  logger.info(
    { dryRun, modelFiles: files.length, models: names.length },
    dryRun
      ? 'DRY RUN — reporting the index diff. Nothing will be written.'
      : 'Synchronising schema indexes',
  );

  if (names.length === 0) {
    logger.error({ root }, 'No models were registered — refusing to continue');
    process.exitCode = 1;
    return;
  }

  let created = 0;
  let dropped = 0;
  let failed = 0;

  for (const name of names) {
    const model = mongoose.models[name];
    if (!model) continue;
    try {
      if (dryRun) {
        // Reports what syncIndexes would do, without touching the collection.
        const { toCreate, toDrop } = await model.diffIndexes();
        if (toDrop.length || toCreate.length) {
          logger.info({ model: name, create: toCreate, drop: toDrop }, `${name}: pending`);
        }
        created += toCreate.length;
        dropped += toDrop.length;
      } else {
        const madeIndexes = await model.syncIndexes();
        if (madeIndexes.length) {
          logger.info({ model: name, dropped: madeIndexes }, `${name}: dropped ${madeIndexes.length}`);
          dropped += madeIndexes.length;
        }
        const live = await model.collection.indexes();
        created += live.length;
      }
    } catch (error) {
      failed += 1;
      logger.error({ err: error, model: name }, `${name}: index sync FAILED`);
    }
  }

  logger.info(
    { dryRun, models: names.length, created, dropped, failed },
    dryRun
      ? 'Dry run complete: nothing written. Re-run without --dry-run to apply.'
      : 'Index synchronisation complete',
  );

  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'sync-indexes failed');
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectDatabase();
  });
