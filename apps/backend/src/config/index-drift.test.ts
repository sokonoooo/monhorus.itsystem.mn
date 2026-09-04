import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import mongoose, { Schema, type Model } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { logger } from './logger';
import { startTestApp, stopTestApp } from '../test/helpers';
import { INDEX_DRIFT_LOG_MARKER, assertSchemaIndexes, checkIndexDrift } from './index-drift';

/**
 * The check exists because production and the test suite do not share an index
 * configuration: `autoIndex: !env.isProduction` means every one of these tests runs
 * against a database where mongoose built every index on the way in, while production
 * only has whatever `npm run sync:indexes` last put there.
 *
 * So the interesting case cannot be reached by asserting on the real models — in this
 * database they are, by construction, always correct. A throwaway model is used instead:
 * its collection is created without indexes, which is exactly the state a production
 * database is in after a release that added one and before anyone ran the script.
 */
const PROBE_MODEL = 'IndexDriftProbe';

const probeSchema = new Schema(
  {
    code: { type: String, required: true },
    scanned: { type: Number },
  },
  { collection: 'index_drift_probes', autoIndex: false, autoCreate: false },
);
// One of each kind, because the whole point of the check is that it tells them apart.
probeSchema.index({ code: 1 }, { unique: true });
probeSchema.index({ scanned: 1 });

let Probe: Model<unknown>;

beforeAll(async () => {
  await startTestApp();
  Probe = mongoose.model(PROBE_MODEL, probeSchema) as unknown as Model<unknown>;
  await Probe.createCollection();
  // Start from a bare collection: no schema index has ever been built on it.
  await Probe.collection.dropIndexes().catch(() => undefined);
});

afterAll(async () => {
  await Probe.collection.drop().catch(() => undefined);
  delete mongoose.models[PROBE_MODEL];
  await stopTestApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('schema index drift', () => {
  it('separates a missing unique index from a missing ordinary one', async () => {
    const report = await checkIndexDrift([Probe]);

    expect(report.models).toBe(1);
    // A missing unique index is a correctness hazard; a missing ordinary one is latency.
    // Collapsing them into one "missing indexes" count is what makes the signal unusable.
    expect(report.missingUnique).toHaveLength(1);
    expect(report.missingUnique[0]).toMatchObject({
      model: PROBE_MODEL,
      spec: 'code:1',
      unique: true,
    });
    expect(report.missingOrdinary).toHaveLength(1);
    expect(report.missingOrdinary[0]).toMatchObject({ spec: 'scanned:1', unique: false });
    expect(report.failed).toEqual([]);
  });

  it('refuses to start while a declared unique index is absent', async () => {
    const fatal = vi.spyOn(logger, 'fatal').mockImplementation(() => logger);

    await expect(assertSchemaIndexes([Probe])).rejects.toThrow(/UNIQUE/);

    // The runbook greps the journal for this the same way it greps for the RBAC drift
    // warning, so the marker has to be in the line and not only in the structured field.
    expect(fatal).toHaveBeenCalledTimes(1);
    const [context, message] = fatal.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toContain(INDEX_DRIFT_LOG_MARKER);
    expect(message).toContain('sync:indexes');
    expect(message).toContain(`${PROBE_MODEL}(code:1)`);
    expect(context).toMatchObject({ indexes: [{ model: PROBE_MODEL, unique: true }] });
  });

  it('boots with an explicit override, and says at error level that it did', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    vi.stubEnv('ALLOW_INDEX_DRIFT', 'true');
    try {
      const report = await assertSchemaIndexes([Probe]);
      expect(report.missingUnique).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }

    // A degraded boot has to be visible in the journal, or the escape hatch becomes the
    // permanent state that nobody remembers choosing.
    expect(error).toHaveBeenCalled();
    const [context, message] = error.mock.calls[0] as [Record<string, unknown>, string];
    expect(context).toMatchObject({ allowIndexDrift: true });
    expect(message).toContain('ALLOW_INDEX_DRIFT=true');
  });

  it('goes quiet once the indexes are built', async () => {
    await Probe.syncIndexes();

    const report = await checkIndexDrift([Probe]);
    expect(report.missingUnique).toEqual([]);
    expect(report.missingOrdinary).toEqual([]);
    await expect(assertSchemaIndexes([Probe])).resolves.toMatchObject({ missingUnique: [] });
  });

  it('reports a unique index that was dropped after the model was initialised', async () => {
    // The production failure this stands in for: a release changes an index, `sync:indexes`
    // is not run, and the constraint the code believes in is not in the database. Dropping
    // it by hand after `init()` has already run reproduces that exactly — and proves the
    // check reads the live collection rather than trusting a cached model state.
    await Probe.syncIndexes();
    await Probe.collection.dropIndex('code_1');

    const report = await checkIndexDrift([Probe]);
    expect(report.missingUnique).toHaveLength(1);
    expect(report.missingUnique[0]).toMatchObject({ spec: 'code:1', unique: true });
    // The ordinary one is still there, so the check is discriminating, not just noisy.
    expect(report.missingOrdinary).toEqual([]);

    vi.spyOn(logger, 'fatal').mockImplementation(() => logger);
    await expect(assertSchemaIndexes([Probe])).rejects.toThrow(/UNIQUE/);

    await Probe.syncIndexes();
  });

  it('warns, without refusing, about an index the schemas no longer declare', async () => {
    await Probe.syncIndexes();
    await Probe.collection.createIndex({ scanned: 1, code: -1 }, { name: 'handmade_1' });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    try {
      const report = await checkIndexDrift([Probe]);
      expect(report.extra).toContainEqual({ model: PROBE_MODEL, name: 'handmade_1' });

      // An index that exists but is undeclared cannot produce a wrong answer, so it must
      // never be able to take a deployment down.
      await expect(assertSchemaIndexes([Probe])).resolves.toMatchObject({ missingUnique: [] });
      expect(warn).toHaveBeenCalled();
      const messages = warn.mock.calls.map(([, message]) => String(message));
      expect(messages.some((message) => message.includes(INDEX_DRIFT_LOG_MARKER))).toBe(true);
    } finally {
      await Probe.collection.dropIndex('handmade_1').catch(() => undefined);
    }
  });

  /**
   * The false-positive budget for refusing to boot.
   *
   * Refusing to start is only a defensible response to a missing unique index if the
   * check does not invent them. Every real schema in the application is diffed here
   * against a database where autoIndex built them all; anything reported missing would be
   * the checker misreading a partial, TTL or collation index rather than genuine drift,
   * and would take production down on the next deploy.
   */
  it('reports no drift at all across every real model', async () => {
    const models = Object.keys(mongoose.models)
      .filter((name) => name !== PROBE_MODEL)
      .map((name) => mongoose.models[name] as unknown as Model<unknown>);

    const report = await checkIndexDrift(models);

    expect(report.missingUnique).toEqual([]);
    expect(report.missingOrdinary).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(report.models).toBeGreaterThan(40);
  });

  /**
   * `checkIndexDrift` inspects whatever has been imported, and `server.ts` calls it after
   * `createApp()` precisely so that "whatever has been imported" is everything. That is an
   * ordering assumption living in a comment, which is the kind that rots. This pins it: a
   * module added with a model but never reached from the route tree would fail here rather
   * than quietly go unchecked in production.
   */
  it('sees every model file on disk, not merely the ones the route tree happens to load', async () => {
    const registeredViaApp = new Set(Object.keys(mongoose.models));

    const modelFiles: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== 'test') walk(full);
        } else if (/\.models?\.ts$/.test(entry.name)) {
          modelFiles.push(full);
        }
      }
    };
    walk(path.join(__dirname, '..'));
    expect(modelFiles.length).toBeGreaterThan(0);

    for (const file of modelFiles) {
      await import(pathToFileURL(file).href);
    }

    const missed = Object.keys(mongoose.models).filter(
      (name) => name !== PROBE_MODEL && !registeredViaApp.has(name),
    );
    expect(missed).toEqual([]);
  });
});
