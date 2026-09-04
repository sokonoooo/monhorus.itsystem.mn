/**
 * Startup index-drift detection.
 *
 * ## Why this exists
 *
 * `database.ts` connects with `autoIndex: !env.isProduction`, and that is deliberate --
 * building indexes on a live production collection is a migration, not a side effect of
 * a restart. The consequence is that **the test suite and production do not share an
 * index configuration**. Every one of the backend tests runs against a database where
 * mongoose built every schema index on the way in; production only has the indexes that
 * somebody remembered to build by running `npm run sync:indexes`.
 *
 * That leaves the one constraint that matters most invisible. The unique index on
 * `Invoice.invoiceNumber` and the partial unique on `(customer, billingPeriod,
 * billingType)` are the only thing standing between two overlapping invoice-generation
 * runs and a customer being billed twice. If a release alters an index and nobody runs
 * the script, that constraint silently does not exist in production, the whole suite
 * still passes, and the first signal anybody gets is a duplicate invoice in a customer's
 * inbox.
 *
 * `rbac.service.ts` already does exactly this for permissions: at boot it compares what
 * the catalogue declares against what the roles actually hold and logs a greppable line
 * when they disagree. There was no equivalent for indexes. This is it, and it logs the
 * phrase "schema indexes" in every drift line so the runbook can grep for it the same way
 * it greps for "default permissions".
 *
 * ## What it does about drift
 *
 * The two kinds of missing index are not the same kind of problem, so they are not
 * treated the same way:
 *
 *  - **A missing UNIQUE index refuses the boot.** It is not a degradation, it is the
 *    silent removal of a correctness invariant. Nothing downstream detects it, the damage
 *    it permits is externally visible (a duplicate invoice reaching a customer) and
 *    largely irreversible, and if the process boots anyway then the process is the thing
 *    that writes the bad data. A log line would compete with every other line in the
 *    journal and only be read by someone who already suspected the problem -- which is
 *    the exact failure mode this codebase keeps rediscovering about itself.
 *
 *  - **A missing ordinary index only warns.** It costs latency, not correctness, and
 *    taking a deployment down over a collection scan would be a worse trade than the one
 *    it prevents.
 *
 *  - **An extra index only warns.** An index that exists but is not declared cannot cause
 *    a wrong answer; `sync:indexes` will drop it when someone next runs it.
 *
 *  - **A model whose diff could not be read only warns.** Failing to READ the index
 *    metadata is not evidence that the index is absent, and refusing to boot on a
 *    transient admin-command error would convert a blip into an outage.
 *
 * The refusal is deliberately narrow, and there is an escape hatch: setting
 * `ALLOW_INDEX_DRIFT=true` downgrades the refusal to an error-level log. It exists so an
 * operator mid-incident can bring a degraded system up on purpose rather than being
 * forced to edit code, and every boot that uses it says so at error level.
 *
 * ## First boot of a brand new database
 *
 * A database that has never had `sync:indexes` run against it will report every unique
 * index as missing and will therefore refuse to boot. That is intended and it is not a
 * deadlock: `scripts/sync-indexes.ts` opens its own connection and does not need the API
 * to be running, so the fix is to run it and start again. The deployment runbook orders
 * the steps that way.
 */
import mongoose, { type Model } from 'mongoose';

import { logger } from './logger';

/** A single index that the schema declares and the database does not have, or vice versa. */
export interface DriftedIndex {
  /** Mongoose model name, e.g. `Invoice`. */
  model: string;
  /** The index key specification, e.g. `{ customer: 1, billingPeriod: 1 }`. */
  keys: Record<string, unknown>;
  /** A readable rendering of the keys, e.g. `customer:1, billingPeriod:1`. */
  spec: string;
  /** Whether the schema declares this index as unique. */
  unique: boolean;
  /** Present when the schema declares a partial filter for the index. */
  partial: boolean;
}

export interface IndexDriftReport {
  /** How many registered models were inspected. */
  models: number;
  /** Declared unique, absent from the database. A correctness hazard. */
  missingUnique: DriftedIndex[];
  /** Declared non-unique, absent from the database. A performance matter. */
  missingOrdinary: DriftedIndex[];
  /** Present in the database, not declared by any schema. `sync:indexes` would drop these. */
  extra: { model: string; name: string }[];
  /** Models whose diff could not be read at all. Absence of evidence, not evidence of absence. */
  failed: { model: string; error: string }[];
}

/**
 * The greppable marker every drift line carries.
 *
 * Exported so the runbook, the tests and the log lines cannot drift apart from each
 * other. Mirrors the role of "default permissions" in the RBAC warning.
 */
export const INDEX_DRIFT_LOG_MARKER = 'schema indexes';

/** Renders an index key spec as a short, stable, log-friendly string. */
function describeKeys(keys: Record<string, unknown>): string {
  return Object.entries(keys)
    .map(([field, direction]) => `${field}:${String(direction)}`)
    .join(', ');
}

/**
 * Diffs every registered model's declared indexes against the ones the database holds.
 *
 * Reads only. It never creates, drops or otherwise touches an index -- deciding what to
 * do about the answer is the caller's job, and actually repairing the database is
 * `sync:indexes`'s job.
 *
 * @param models Defaults to every model registered on the shared mongoose instance. Note
 *   that this is *whatever has been imported so far*, so the caller is responsible for
 *   invoking this only once the full route tree has been loaded. `server.ts` calls it
 *   after `createApp()` for that reason, and `index-drift.test.ts` pins the equivalence.
 */
export async function checkIndexDrift(
  models?: readonly Model<unknown>[],
): Promise<IndexDriftReport> {
  const registered =
    models ??
    (Object.keys(mongoose.models)
      .sort()
      .map((name) => mongoose.models[name])
      .filter((model): model is Model<unknown> => model != null) as readonly Model<unknown>[]);

  const report: IndexDriftReport = {
    models: registered.length,
    missingUnique: [],
    missingOrdinary: [],
    extra: [],
    failed: [],
  };

  for (const model of registered) {
    try {
      // Joins the index build mongoose already kicked off when the model was compiled.
      // With `autoIndex` on (development and the test suite) this is what stops the diff
      // from racing an in-flight build and reporting a false positive; with it off
      // (production) `init()` is effectively a no-op and resolves immediately. It is
      // memoised on the model, so this never *triggers* a rebuild -- which is what lets a
      // test drop an index and still see it reported as missing.
      await model.init();

      // `indexOptionsToCreate` is what makes `toCreate` carry the index OPTIONS and not
      // just the key spec. Without it there is no way to tell a missing unique index from
      // a missing ordinary one, which is the entire distinction this check turns on.
      const { toCreate, toDrop } = await model.diffIndexes({ indexOptionsToCreate: true });

      for (const entry of toCreate as unknown[]) {
        if (!Array.isArray(entry)) continue;
        const [keys, options] = entry as [Record<string, unknown>, Record<string, unknown>?];
        const drifted: DriftedIndex = {
          model: model.modelName,
          keys,
          spec: describeKeys(keys),
          unique: options?.unique === true,
          partial: options?.partialFilterExpression != null,
        };
        if (drifted.unique) {
          report.missingUnique.push(drifted);
        } else {
          report.missingOrdinary.push(drifted);
        }
      }

      for (const name of toDrop as unknown[]) {
        report.extra.push({ model: model.modelName, name: String(name) });
      }
    } catch (error) {
      report.failed.push({
        model: model.modelName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}

/** True when the operator has explicitly asked for a degraded boot. */
function driftIsAllowed(): boolean {
  // Read straight from `process.env` rather than through `config/env.ts`: this is an
  // incident-only escape hatch and does not belong in the environment contract every
  // deployment is validated against.
  return process.env.ALLOW_INDEX_DRIFT === 'true';
}

/** Human-readable one-liner naming the indexes, for the message body of a log line. */
function summarise(indexes: readonly DriftedIndex[]): string {
  return indexes.map((entry) => `${entry.model}(${entry.spec})`).join('; ');
}

/**
 * Runs the diff, logs it, and refuses the boot when a declared UNIQUE index is absent.
 *
 * Returns the report so a caller (or a test) can assert on the detail rather than on the
 * log output alone.
 *
 * @throws when a unique index is missing and `ALLOW_INDEX_DRIFT` is not set.
 */
export async function assertSchemaIndexes(
  models?: readonly Model<unknown>[],
): Promise<IndexDriftReport> {
  const report = await checkIndexDrift(models);

  if (report.failed.length > 0) {
    logger.warn(
      { models: report.failed },
      `Could not read the ${INDEX_DRIFT_LOG_MARKER} for some models; drift is unknown for them`,
    );
  }

  if (report.extra.length > 0) {
    logger.warn(
      { indexes: report.extra },
      `The database holds ${INDEX_DRIFT_LOG_MARKER} the code no longer declares; ` +
        'npm run sync:indexes would drop them',
    );
  }

  if (report.missingOrdinary.length > 0) {
    // Performance, not correctness. Loud enough to act on, not loud enough to block.
    logger.warn(
      { indexes: report.missingOrdinary },
      `Missing non-unique ${INDEX_DRIFT_LOG_MARKER}; affected queries will scan — ` +
        `run npm run sync:indexes: ${summarise(report.missingOrdinary)}`,
    );
  }

  if (report.missingUnique.length > 0) {
    const message =
      `Missing UNIQUE ${INDEX_DRIFT_LOG_MARKER}: uniqueness is NOT enforced in this ` +
      `database — run npm run sync:indexes: ${summarise(report.missingUnique)}`;

    if (driftIsAllowed()) {
      logger.error(
        { indexes: report.missingUnique, allowIndexDrift: true },
        `${message}. Booting anyway because ALLOW_INDEX_DRIFT=true was set.`,
      );
      return report;
    }

    logger.fatal({ indexes: report.missingUnique }, `${message}. Refusing to start.`);
    throw new Error(message);
  }

  logger.info(
    { models: report.models, extra: report.extra.length },
    `Verified ${INDEX_DRIFT_LOG_MARKER} against the database`,
  );

  return report;
}
