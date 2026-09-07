import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { appendAssessmentHistory } from '../modules/object-master/assessment-history.service';
import {
  ObjectAssessment,
  ObjectRecord,
  ObjectType,
} from '../modules/object-master/object-master.models';
import {
  applyReportToEquipment,
  writeReport,
} from '../modules/report-record/report-record.service';
import { invalidateSettingsCache } from '../modules/settings/settings.service';
import {
  createObjectFixture,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../test/helpers';
import {
  INDEX_NAME,
  migrateAssessmentSourceReportIndex,
} from './migrate-assessment-source-report-index';

/**
 * The deploy step for the assessment history's no-duplicate index.
 *
 * Two things have to be true before it can be run at a live database: it must find the
 * duplicates the old `sourceReportItem` key let through, and it must build the index over
 * what is left. The first is what these fixtures reproduce — a report-raised row plus a
 * verbatim second one, which is what a withdrawn-and-re-added planned-work item produced.
 *
 * Every test drops the index first, because the suite runs with `autoIndex: true` and the
 * schema now declares it: with the index in place the duplicate could not be created at all,
 * which is the point of the fix but leaves nothing for the migration to find. Production is
 * the opposite — `autoIndex: false`, index absent, duplicates already written — and dropping
 * it here is what reproduces that starting state.
 */

let objects: ObjectFixture;
let objectSequence = 0;

const WORK_ID = new Types.ObjectId();

async function dropTheIndex(): Promise<void> {
  try {
    await ObjectAssessment.collection.dropIndex(INDEX_NAME);
  } catch {
    // Already absent: that IS the production starting state.
  }
}

async function indexNames(): Promise<string[]> {
  return (await ObjectAssessment.collection.indexes()).map((index) => String(index.name));
}

async function panel() {
  objectSequence += 1;
  const type =
    (await ObjectType.findOne({ code: 'DB' })) ??
    (await ObjectType.create({
      code: 'DB',
      name: 'Түгээх самбар',
      category: 'PANEL',
      showOnPlan: false,
      insidePanel: false,
      generatesConclusion: true,
      icon: 'PANEL',
      isActive: true,
    }));

  return ObjectRecord.create({
    code: `DB-${objectSequence}`,
    name: `Түгээх самбар ${objectSequence}`,
    category: 'PANEL',
    objectType: type._id,
    customer: new Types.ObjectId(objects.customerId),
    floor: new Types.ObjectId(objects.floorId),
    status: 'ACTIVE',
    panel: { capacityKw: 25, location: null, protection: null },
  });
}

async function publish(
  objectId: Types.ObjectId,
  score: number,
  sourceId: Types.ObjectId = WORK_ID,
): Promise<Types.ObjectId> {
  const report = await writeReport({
    type: 'PLANNED_WORK',
    status: 'APPROVED',
    title: 'PW-0001 — Улирлын үзлэг',
    sourceType: 'PLANNED_WORK',
    sourceId,
    sourceReference: 'PW-0001',
    items: [{ object: objectId, score }],
    hierarchy: { customer: new Types.ObjectId(objects.customerId) },
    actor: { id: null, name: 'Б. Энхтөр' },
    occurredAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  await applyReportToEquipment(report._id);
  return report._id;
}

/**
 * The row the old bug wrote: a verbatim copy of an existing finding under a fresh
 * `sourceReportItem`, which is exactly what a re-added report item minted.
 */
async function writeDuplicateOf(id: Types.ObjectId, createdAt: Date): Promise<Types.ObjectId> {
  const original = await ObjectAssessment.findById(id).lean();
  const copyId = new Types.ObjectId();
  await ObjectAssessment.collection.insertOne({
    ...(original as Record<string, unknown>),
    _id: copyId,
    sourceReportItem: new Types.ObjectId(),
    createdAt,
  });
  return copyId;
}

beforeAll(async () => {
  await startTestApp();
}, 60_000);

afterAll(async () => {
  // Left as the schema declares it, so a later file in the run does not inherit a database
  // missing an index it expects. The fixtures are cleared first because the last case
  // deliberately leaves a duplicate behind, and the build would refuse over it — which is
  // itself the thing that case is asserting.
  await resetDomainCollections();
  await ObjectAssessment.createIndexes();
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  invalidateSettingsCache();
  objects = await createObjectFixture();
  await dropTheIndex();
});

describe('migrate-assessment-source-report-index', () => {
  it('reports the duplicate and writes nothing on a dry run', async () => {
    const a = await panel();
    const reportId = await publish(a._id, 40);
    const original = await ObjectAssessment.findOne({ object: a._id });
    await writeDuplicateOf(original!._id, new Date('2026-08-05T00:00:00.000Z'));

    const result = await migrateAssessmentSourceReportIndex({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.rowsScanned).toBe(2);
    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.duplicateGroups[0]).toMatchObject({
      objectId: String(a._id),
      objectCode: a.code,
      sourceReport: String(reportId),
      newScore: 40,
      keptId: String(original!._id),
    });
    expect(result.duplicateGroups[0]?.removed).toHaveLength(1);
    expect(result.rowsRemoved).toBe(0);

    // Nothing written: both rows still there, index still absent.
    expect(await ObjectAssessment.countDocuments({ object: a._id })).toBe(2);
    expect(await indexNames()).not.toContain(INDEX_NAME);
  });

  it('removes the duplicate and builds the index on --apply', async () => {
    const a = await panel();
    await publish(a._id, 40);
    const original = await ObjectAssessment.findOne({ object: a._id });
    const copyId = await writeDuplicateOf(original!._id, new Date('2026-08-05T00:00:00.000Z'));

    const result = await migrateAssessmentSourceReportIndex({ dryRun: false });

    expect(result.rowsRemoved).toBe(1);
    expect(result.indexCreated).toBe(true);
    expect(result.indexError).toBeNull();

    expect(await ObjectAssessment.countDocuments({ object: a._id })).toBe(1);
    expect(await ObjectAssessment.findById(original!._id)).not.toBeNull();
    expect(await ObjectAssessment.findById(copyId)).toBeNull();
    expect(await indexNames()).toContain(INDEX_NAME);
  });

  /**
   * The head is what every list, the plan and the device drawer read. Removing the row it
   * points at would swap one defect for the dangling-reference defect this collection has
   * already suffered once.
   */
  it('keeps the row the object head points at, even when it is not the earliest', async () => {
    const a = await panel();
    await publish(a._id, 40);
    const original = await ObjectAssessment.findOne({ object: a._id });
    const copyId = await writeDuplicateOf(original!._id, new Date('2026-08-05T00:00:00.000Z'));

    // As the bug left it: the second apply pointed the head at the row it had just written.
    await ObjectRecord.updateOne(
      { _id: a._id },
      { $set: { 'latestAssessment.assessment': copyId } },
    );

    const result = await migrateAssessmentSourceReportIndex({ dryRun: false });

    expect(result.duplicateGroups[0]?.keptBecause).toBe('head');
    expect(result.duplicateGroups[0]?.keptId).toBe(String(copyId));
    expect(await ObjectAssessment.findById(copyId)).not.toBeNull();
    expect(await ObjectAssessment.findById(original!._id)).toBeNull();

    // And the head still resolves.
    const reloaded = await ObjectRecord.findById(a._id);
    expect(
      await ObjectAssessment.findById(reloaded!.latestAssessment!.assessment),
    ).not.toBeNull();
  });

  it('removes every extra row when a group holds more than two', async () => {
    const a = await panel();
    await publish(a._id, 40);
    const original = await ObjectAssessment.findOne({ object: a._id });
    await writeDuplicateOf(original!._id, new Date('2026-08-05T00:00:00.000Z'));
    await writeDuplicateOf(original!._id, new Date('2026-08-09T00:00:00.000Z'));

    const result = await migrateAssessmentSourceReportIndex({ dryRun: false });

    expect(result.rowsRemoved).toBe(2);
    expect(result.duplicateGroups[0]?.keptId).toBe(String(original!._id));
    expect(await ObjectAssessment.countDocuments({ object: a._id })).toBe(1);
  });

  /**
   * A manual assessment carries no source report at all. Several of them reaching the same
   * score on the same equipment are several real findings, and the partial filter is what
   * keeps the index — and this script — away from them.
   */
  it('leaves manual history rows alone, however many share a score', async () => {
    const a = await panel();

    for (const _ of [1, 2, 3]) {
      await appendAssessmentHistory({
        object: a._id,
        previousScore: null,
        newScore: 40,
        riskLevel: 'ATTENTION',
        assessedBy: null,
        assessedByName: 'Б. Энхтөр',
        assessedAt: new Date('2026-08-01T00:00:00.000Z'),
        sourceLabel: null,
      });
    }

    const result = await migrateAssessmentSourceReportIndex({ dryRun: false });

    expect(result.rowsScanned).toBe(0);
    expect(result.duplicateGroups).toHaveLength(0);
    expect(result.rowsRemoved).toBe(0);
    expect(result.indexCreated).toBe(true);
    expect(await ObjectAssessment.countDocuments({ object: a._id })).toBe(3);
  });

  it('leaves two different reports that reached the same score alone', async () => {
    const a = await panel();
    await publish(a._id, 40, new Types.ObjectId());
    await publish(a._id, 40, new Types.ObjectId());

    const result = await migrateAssessmentSourceReportIndex({ dryRun: false });

    expect(result.rowsScanned).toBe(2);
    expect(result.duplicateGroups).toHaveLength(0);
    expect(await ObjectAssessment.countDocuments({ object: a._id })).toBe(2);
  });

  it('is idempotent: a second run finds nothing and rebuilds nothing', async () => {
    const a = await panel();
    await publish(a._id, 40);
    const original = await ObjectAssessment.findOne({ object: a._id });
    await writeDuplicateOf(original!._id, new Date('2026-08-05T00:00:00.000Z'));

    await migrateAssessmentSourceReportIndex({ dryRun: false });
    const second = await migrateAssessmentSourceReportIndex({ dryRun: false });

    expect(second.duplicateGroups).toHaveLength(0);
    expect(second.rowsRemoved).toBe(0);
    expect(second.indexAlreadyPresent).toBe(true);
    expect(second.indexCreated).toBe(false);
    expect(second.indexError).toBeNull();
  });

  it('runs clean on a database that has no duplicates at all', async () => {
    const a = await panel();
    await publish(a._id, 40);

    const result = await migrateAssessmentSourceReportIndex({ dryRun: false });

    expect(result.rowsScanned).toBe(1);
    expect(result.duplicateGroups).toHaveLength(0);
    expect(result.indexCreated).toBe(true);
    expect(await indexNames()).toContain(INDEX_NAME);
  });

  /**
   * The whole reason the removal comes first. Left in place, the duplicate makes the build
   * fail — and a migration that reported success with no index would leave the rule
   * unenforced behind a green log line.
   */
  it('could not have built the index over the duplicate', async () => {
    const a = await panel();
    await publish(a._id, 40);
    const original = await ObjectAssessment.findOne({ object: a._id });
    await writeDuplicateOf(original!._id, new Date('2026-08-05T00:00:00.000Z'));

    await expect(
      ObjectAssessment.collection.createIndex(
        { object: 1, sourceReport: 1, newScore: 1 },
        {
          name: INDEX_NAME,
          unique: true,
          partialFilterExpression: { sourceReport: { $type: 'objectId' } },
        },
      ),
    ).rejects.toMatchObject({ code: 11000 });
  });
});
