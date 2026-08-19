/**
 * Moves a planned work's material rows from free text onto the material catalogue.
 *
 * Sub-tasks can now draw against the materials registered on their parent work, and the
 * running totals live on the row itself. That needs two things the old rows do not have:
 * an identity that survives a rename — `materialItem`, since a name is not an identity —
 * and the `consumedQuantity` / `remainingQuantity` pair the over-consumption guard moves
 * atomically.
 *
 * A row written before this change has a `name` and nothing else. Left alone it would be
 * unusable: `plannedWorkMaterialsOf` would report `undefined` for every figure, the
 * detail screen would show blanks where Registered / Used / Remaining belong, and the
 * guard's filter — which matches on `materialItem` — would never find the row, so every
 * attempt to record consumption against it would be refused as "not registered on this
 * work". This is therefore required before serving the new build, not cleanup.
 *
 * WHAT IT DOES WITH A NAME IT DOES NOT RECOGNISE. It creates a catalogue entry for it.
 * The alternative — skipping the row, or pointing it at some nearest match — would either
 * leave the work broken or silently claim two different materials are the same one. A
 * created entry is marked `OTHER` and given a generated code, so it is obvious in the
 * catalogue which entries arrived this way and want a human to tidy them.
 *
 * Names are matched case-insensitively after trimming, because the old free-text field
 * collected "Кабель 3x2.5" and "кабель 3x2.5" as different rows on different works.
 *
 * Usage: npm run migrate:planned-materials --workspace @monhorus/backend
 *        npm run migrate:planned-materials --workspace @monhorus/backend -- --dry-run
 *
 * Safe to run more than once: a row that already carries `materialItem` is not matched.
 */
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { MaterialItem } from '../modules/material/material.models';

const COLLECTION = 'plannedworks';

interface LegacyMaterial {
  name?: string;
  quantity?: number;
  unit?: string;
  materialItem?: mongoose.Types.ObjectId;
}

/** A code no human would have typed, so migrated entries are identifiable later. */
function generatedCode(index: number): string {
  return `MIG-${String(index).padStart(4, '0')}`;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  await connectDatabase();

  const db = mongoose.connection.db;
  if (!db) {
    logger.error('No database handle after connecting');
    process.exit(1);
  }

  const works = db.collection(COLLECTION);

  // Only works holding at least one row that has not been migrated yet.
  const filter = { 'plannedMaterials.0': { $exists: true }, 'plannedMaterials.materialItem': { $exists: false } };
  const pending = await works.countDocuments(filter);
  logger.info({ pending, dryRun }, 'Planned material catalogue migration scan');

  if (pending === 0) {
    logger.info('Nothing to migrate');
    await disconnectDatabase();
    return;
  }

  // Every distinct name across every unmigrated row, resolved once rather than per work.
  const cursor = works.find(filter, { projection: { plannedMaterials: 1 } });
  const documents = await cursor.toArray();

  const namesNeeded = new Set<string>();
  for (const doc of documents) {
    for (const row of (doc.plannedMaterials ?? []) as LegacyMaterial[]) {
      if (row.materialItem) continue;
      const name = (row.name ?? '').trim();
      if (name) namesNeeded.add(name);
    }
  }

  const existing = await MaterialItem.find({}).select('name').lean<{ _id: mongoose.Types.ObjectId; name: string }[]>();
  const byLowerName = new Map(existing.map((item) => [item.name.trim().toLocaleLowerCase('mn'), item._id]));

  let created = 0;
  for (const name of namesNeeded) {
    const key = name.toLocaleLowerCase('mn');
    if (byLowerName.has(key)) continue;

    if (dryRun) {
      created += 1;
      logger.info({ name }, 'Would create a catalogue entry');
      continue;
    }

    const item = await MaterialItem.create({
      code: generatedCode(existing.length + created + 1),
      name,
      category: 'OTHER',
      defaultUnit: 'PIECE',
      description: 'Төлөвлөгөөт ажлын хуучин жагсаалтаас шилжсэн.',
    });
    byLowerName.set(key, item._id);
    created += 1;
  }

  let updatedWorks = 0;
  let updatedRows = 0;
  let dropped = 0;

  for (const doc of documents) {
    const rows = (doc.plannedMaterials ?? []) as LegacyMaterial[];
    const next: Record<string, unknown>[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      if (row.materialItem) {
        next.push(row as unknown as Record<string, unknown>);
        seen.add(String(row.materialItem));
        continue;
      }

      const name = (row.name ?? '').trim();
      const id = name ? byLowerName.get(name.toLocaleLowerCase('mn')) : undefined;
      if (!id) {
        // A row with no name at all. Nothing identifies it, so it cannot be carried over.
        dropped += 1;
        continue;
      }

      /*
       * The catalogue reference is the row's identity now, and two rows for one material
       * would split a pool that is meant to be shared. Old free-text lists could hold
       * "Кабель" and "кабель" side by side, so the quantities are added rather than the
       * second row being dropped: the work really did plan for that much in total.
       */
      const key = String(id);
      const quantity = typeof row.quantity === 'number' ? row.quantity : 0;
      const merged = next.find((entry) => String(entry.materialItem) === key);
      if (merged) {
        merged.quantity = (merged.quantity as number) + quantity;
        merged.remainingQuantity = merged.quantity as number;
        continue;
      }

      next.push({
        materialItem: id,
        name,
        quantity,
        // Nothing was ever consumed before this feature existed, so the whole registered
        // amount is what remains. This is the only defensible starting point.
        consumedQuantity: 0,
        remainingQuantity: quantity,
        unit: row.unit ?? 'PIECE',
      });
      seen.add(key);
      updatedRows += 1;
    }

    if (dryRun) {
      updatedWorks += 1;
      continue;
    }

    await works.updateOne({ _id: doc._id }, { $set: { plannedMaterials: next } });
    updatedWorks += 1;
  }

  logger.info(
    { created, updatedWorks, updatedRows, dropped, dryRun },
    dryRun ? 'Dry run complete, nothing written' : 'Planned material catalogue migration complete',
  );

  if (dropped > 0) {
    logger.warn({ dropped }, 'Rows with no name were removed; they identified no material');
  }

  await disconnectDatabase();
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Planned material catalogue migration failed');
  process.exit(1);
});
