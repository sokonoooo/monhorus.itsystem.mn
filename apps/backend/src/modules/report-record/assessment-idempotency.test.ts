import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResolvedCustomerScope } from '../../common/security/customer-scope';
import {
  createObjectFixture,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../../test/helpers';
import { appendAssessmentHistory } from '../object-master/assessment-history.service';
import { ObjectAssessment, ObjectRecord, ObjectType } from '../object-master/object-master.models';
import { invalidateSettingsCache } from '../settings/settings.service';
import { ReportItem } from './report-record.model';
import { getReportById, listObjectReports, listReports } from './report-query.service';
import { applyReportToEquipment, writeReport } from './report-record.service';

/**
 * The assessment history must not gain a second row for a finding it already recorded.
 *
 * `syncItems` withdraws any object a report's source no longer names, and that withdrawal
 * is a HARD delete — correctly, because a report must stop asserting a finding its source
 * has retracted. The withdrawal is also ordinary use: a planned work's report is rebuilt
 * from its sub-tasks on every publish, so a technician correcting which panel they worked
 * on withdraws one item and may well add it back.
 *
 * That made the surrogate `sourceReportItem` id an unusable idempotency key. The re-added
 * item is a NEW document with a NEW `_id`, so a guard keyed on it missed and appended a
 * second, byte-identical history row — and `ObjectAssessment` blocks every update and
 * delete hook, so the duplicate could never be taken out again.
 *
 * The key is now the NATURAL one: `(object, sourceReport, newScore)`. `ReportItem` already
 * declares `{ report, object }` unique, so that triple names exactly the same finding the
 * item id named, and it survives the item being destroyed and re-minted.
 */

let objects: ObjectFixture;
let objectSequence = 0;

const STAFF_SCOPE: ResolvedCustomerScope = { mode: 'STAFF' };

/** A fixed source, so every publish below corrects ONE report rather than writing several. */
const WORK_ID = new Types.ObjectId();

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

/**
 * Republishes the planned work's canonical report naming exactly these objects, and applies
 * it — the same pair `planned-work.transition.service` reaches equipment through.
 */
async function publish(
  entries: readonly { object: Types.ObjectId; score: number }[],
): Promise<Types.ObjectId> {
  const report = await writeReport({
    type: 'PLANNED_WORK',
    status: 'APPROVED',
    title: 'PW-0001 — Улирлын үзлэг',
    sourceType: 'PLANNED_WORK',
    sourceId: WORK_ID,
    sourceReference: 'PW-0001',
    items: entries.map((entry) => ({
      object: entry.object,
      score: entry.score,
      observation: 'Тусгаарлагч элэгдсэн.',
    })),
    hierarchy: { customer: new Types.ObjectId(objects.customerId) },
    actor: { id: null, name: 'Б. Энхтөр' },
    occurredAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  await applyReportToEquipment(report._id);
  return report._id;
}

const rowsFor = (objectId: Types.ObjectId): Promise<number> =>
  ObjectAssessment.countDocuments({ object: objectId });

beforeAll(async () => {
  await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  invalidateSettingsCache();
  objects = await createObjectFixture();
});

describe('assessment history idempotency across a withdrawn and re-added item', () => {
  it('writes no second row when an object is withdrawn from a report and added back at the same score', async () => {
    const a = await panel();
    const b = await panel();

    await publish([
      { object: a._id, score: 40 },
      { object: b._id, score: 40 },
    ]);
    expect(await rowsFor(a._id)).toBe(1);

    // The sub-task stops naming A: `syncItems` deletes its item outright.
    await publish([{ object: b._id, score: 40 }]);
    expect(await ReportItem.countDocuments({ object: a._id })).toBe(0);

    // A is named again, at the same score. A NEW item document, a new `_id` — and the same
    // finding, which the history has already recorded.
    await publish([
      { object: a._id, score: 40 },
      { object: b._id, score: 40 },
    ]);

    expect(await rowsFor(a._id)).toBe(1);
    expect(await rowsFor(b._id)).toBe(1);
  });

  it('appends when the re-added item carries a genuinely different score', async () => {
    const a = await panel();

    await publish([{ object: a._id, score: 40 }]);
    await publish([]);
    await publish([{ object: a._id, score: 60 }]);

    expect(await rowsFor(a._id)).toBe(2);
    const scores = (await ObjectAssessment.find({ object: a._id }).sort({ createdAt: 1 })).map(
      (row) => row.newScore,
    );
    expect(scores).toEqual([40, 60]);
  });

  it('still writes nothing when an unchanged report is simply re-approved', async () => {
    const a = await panel();

    await publish([{ object: a._id, score: 40 }]);
    await publish([{ object: a._id, score: 40 }]);
    await publish([{ object: a._id, score: 40 }]);

    expect(await rowsFor(a._id)).toBe(1);
  });

  it('keeps the object head pointing at the row that survived the re-add', async () => {
    const a = await panel();

    await publish([{ object: a._id, score: 40 }]);
    const original = await ObjectAssessment.findOne({ object: a._id });

    await publish([]);
    await publish([{ object: a._id, score: 40 }]);

    const reloaded = await ObjectRecord.findById(a._id);
    expect(String(reloaded?.latestAssessment?.assessment)).toBe(String(original?._id));
  });

  /**
   * The key must not be so coarse that two reports about the same equipment collapse into
   * one row. A second planned work scoring the same panel 40 is a second finding.
   */
  it('does not deduplicate two different reports that reached the same score', async () => {
    const a = await panel();

    await publish([{ object: a._id, score: 40 }]);

    const other = await writeReport({
      type: 'PLANNED_WORK',
      status: 'APPROVED',
      title: 'PW-0002 — Дараагийн үзлэг',
      sourceType: 'PLANNED_WORK',
      sourceId: new Types.ObjectId(),
      sourceReference: 'PW-0002',
      items: [{ object: a._id, score: 40 }],
      hierarchy: { customer: new Types.ObjectId(objects.customerId) },
      actor: { id: null, name: 'Б. Энхтөр' },
      occurredAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    await applyReportToEquipment(other._id);

    expect(await rowsFor(a._id)).toBe(2);
  });

  /**
   * A manual assessment carries no source report at all and so deduplicates against
   * nothing — recording the same score twice from the drawer is two events, exactly as
   * before. If the new key leaked onto this path it would silently swallow the second.
   */
  it('leaves the manual assessment path appending every time', async () => {
    const a = await panel();

    for (const _ of [1, 2]) {
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

    expect(await rowsFor(a._id)).toBe(2);
  });

  /**
   * The database, not the convention. Production connects with `autoIndex: false`, so this
   * asserts the schema declares it; the migration is what builds it on a live database.
   */
  it('refuses a duplicate history row at the database', async () => {
    await ObjectAssessment.init();
    const a = await panel();
    const report = await publish([{ object: a._id, score: 40 }]);

    // Straight at the driver: the guard above is bypassed on purpose, because the point of
    // the index is that it holds when the guard does not run — a concurrent apply, a future
    // writer, a script.
    const row = await ObjectAssessment.findOne({ object: a._id }).lean();
    await expect(
      ObjectAssessment.collection.insertOne({
        ...(row as Record<string, unknown>),
        _id: new Types.ObjectId(),
        sourceReport: report,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  /**
   * What happens when the index fires against a legitimate caller.
   *
   * The lookup in `appendAssessmentHistory` is check-then-write and loses the race between
   * two concurrent applies of the same report; the index is what actually stops the second
   * row. That must not surface as a failed approval, so the duplicate key is folded into the
   * row that won — the same answer, reached the other way. The lookup is blinded for one
   * call here because a real race is the only other way to reach the branch.
   */
  it('folds a duplicate-key collision into the row that won the race', async () => {
    await ObjectAssessment.init();
    const a = await panel();
    const reportId = await publish([{ object: a._id, score: 40 }]);
    const winner = await ObjectAssessment.findOne({ object: a._id });

    const spy = vi
      .spyOn(ObjectAssessment, 'findOne')
      .mockReturnValueOnce(Promise.resolve(null) as never);

    const entry = await appendAssessmentHistory({
      object: a._id,
      previousScore: null,
      newScore: 40,
      riskLevel: 'ATTENTION',
      assessedBy: null,
      assessedByName: 'Б. Энхтөр',
      assessedAt: new Date('2026-08-01T00:00:00.000Z'),
      sourceLabel: 'PW-0001',
      sourceReport: reportId,
    });

    spy.mockRestore();

    expect(String(entry._id)).toBe(String(winner?._id));
    expect(await rowsFor(a._id)).toBe(1);
  });
});

describe('the reads that list a report’s items after a withdrawal', () => {
  it('returns exactly the objects the report still names', async () => {
    const a = await panel();
    const b = await panel();

    const reportId = await publish([
      { object: a._id, score: 40 },
      { object: b._id, score: 40 },
    ]);

    expect((await getReportById(String(reportId), STAFF_SCOPE)).items).toHaveLength(2);

    await publish([{ object: b._id, score: 40 }]);

    const detail = await getReportById(String(reportId), STAFF_SCOPE);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]?.objectId).toBe(String(b._id));

    // The list's item count, which is a separate aggregate over the same collection.
    const list = await listReports(
      { page: 1, limit: 20, sortBy: 'occurredAt', sortDir: 'desc' } as never,
      STAFF_SCOPE,
    );
    expect(list.items.find((row) => row.id === String(reportId))?.itemCount).toBe(1);

    // The withdrawn object no longer lists the report; the retained one still does.
    expect(await listObjectReports(String(a._id), STAFF_SCOPE)).toHaveLength(0);
    expect(await listObjectReports(String(b._id), STAFF_SCOPE)).toHaveLength(1);
  });

  it('lists the report again once the object is added back', async () => {
    const a = await panel();

    const reportId = await publish([{ object: a._id, score: 40 }]);
    await publish([]);
    expect(await listObjectReports(String(a._id), STAFF_SCOPE)).toHaveLength(0);

    await publish([{ object: a._id, score: 40 }]);

    expect(await listObjectReports(String(a._id), STAFF_SCOPE)).toHaveLength(1);
    expect((await getReportById(String(reportId), STAFF_SCOPE)).items).toHaveLength(1);
  });
});
