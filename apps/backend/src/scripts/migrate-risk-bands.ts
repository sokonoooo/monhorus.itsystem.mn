/**
 * Carries a configured risk ladder across from the four scalar thresholds it used to be.
 *
 * The bands used to be four integers — `evaluation.normal_min` and friends — with the
 * names, the colours and the count of five compiled in. They are now one structured
 * setting, which is what makes the count and the naming an administrator's decision.
 *
 * Settings are a sparse override store: a key nobody changed has no row, and a row whose
 * key is no longer declared is ignored on read. So an installation that never touched the
 * thresholds needs nothing — the new default already matches the old one. An installation
 * that *did* tune them would silently fall back to the shipped cut points, which is the
 * one outcome worth a migration: their ladder would look untouched while banding
 * differently.
 *
 * Idempotent, and refuses to overwrite a ladder that has already been configured.
 *
 * Run:
 *   npm run migrate:risk-bands --workspace @monhorus/backend -- --dry-run
 *   npm run migrate:risk-bands --workspace @monhorus/backend
 */

import { DEFAULT_RISK_BANDS, SETTING_KEYS, type RiskBandConfig } from '@monhorus/shared';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Setting } from '../modules/settings/setting.model';

/** The retired keys, in the order the bands they bounded run from healthy to worst. */
const LEGACY_KEYS = [
  { key: 'evaluation.normal_min', band: 'NORMAL' },
  { key: 'evaluation.attention_min', band: 'ATTENTION' },
  { key: 'evaluation.schedule_repair_min', band: 'SCHEDULE_REPAIR' },
  { key: 'evaluation.critical_min', band: 'CRITICAL' },
] as const;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  if (env.isProduction && dryRun === false && !process.argv.includes('--yes')) {
    logger.error('Refusing to write in production without --yes.');
    process.exit(1);
  }

  await connectDatabase();

  const existing = await Setting.findOne({ key: SETTING_KEYS.EVAL_RISK_BANDS }).lean();
  if (existing) {
    logger.info('A risk ladder is already configured; leaving it alone.');
    await disconnectDatabase();
    process.exit(0);
  }

  const legacyRows = await Setting.find({
    key: { $in: LEGACY_KEYS.map((entry) => entry.key) },
  }).lean();

  if (legacyRows.length === 0) {
    logger.info('No tuned thresholds found; the shipped default already matches. Nothing to do.');
    await disconnectDatabase();
    process.exit(0);
  }

  const stored = new Map(legacyRows.map((row) => [row.key, Number(row.value)]));

  // Only the minimum moves; a band keeps its name, colour and behaviour, because the old
  // configuration had no way to express those and inventing them here would be a guess.
  const bands: RiskBandConfig[] = DEFAULT_RISK_BANDS.map((band) => {
    const legacy = LEGACY_KEYS.find((entry) => entry.band === band.key);
    const value = legacy ? stored.get(legacy.key) : undefined;
    return value === undefined || Number.isNaN(value) ? band : { ...band, minScore: value };
  });

  logger.info(
    { bands: bands.map((band) => ({ key: band.key, minScore: band.minScore })) },
    dryRun ? 'Would write this ladder' : 'Writing ladder',
  );

  if (!dryRun) {
    await Setting.create({
      key: SETTING_KEYS.EVAL_RISK_BANDS,
      value: bands,
      updatedBy: null,
      updatedByName: 'migrate-risk-bands',
    });
    // The rows the ladder came from are dead weight now: the key is no longer declared,
    // so nothing reads them, and leaving them invites a future reader to trust them.
    const removed = await Setting.deleteMany({
      key: { $in: LEGACY_KEYS.map((entry) => entry.key) },
    });
    logger.info({ removedLegacyRows: removed.deletedCount }, 'Migration complete');
  }

  await disconnectDatabase();
  process.exit(0);
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'migrate-risk-bands failed');
  process.exit(1);
});
