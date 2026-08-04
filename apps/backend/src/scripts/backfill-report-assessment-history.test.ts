import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ObjectAssessment,
  ObjectRecord,
  ObjectType,
} from '../modules/object-master/object-master.models';
import { Customer, ObjectNode } from '../modules/objects/object.models';
import { Report, ReportItem, nextReportNumber } from '../modules/report-record/report-record.model';
import { resetDomainCollections, startTestApp, stopTestApp } from '../test/helpers';
import { backfillReportAssessmentHistory } from './backfill-report-assessment-history';

beforeAll(async () => {
  await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

let customerId: Types.ObjectId;
let floorId: Types.ObjectId;
let typeId: Types.ObjectId;
let sequence = 0;

beforeEach(async () => {
  await resetDomainCollections();
  sequence = 0;

  const customer = await Customer.create({ code: 'BF', name: 'Бэкфилл ХХК' });
  customerId = customer._id;
  const floor = await ObjectNode.create({
    kind: 'FLOOR',
    code: 'BF-F1',
    name: '1 давхар',
    customer: customer._id,
    parent: null,
    ancestors: [],
  });
  floorId = floor._id;
  const type = await ObjectType.create({ code: 'BFP', name: 'Самбар', category: 'PANEL' });
  typeId = type._id;
});

async function seedObject(): Promise<Types.ObjectId> {
  sequence += 1;
  const record = await ObjectRecord.create({
    code: `BF-OBJ-${sequence}`,
    name: `Тоноглол ${sequence}`,
    category: 'PANEL',
    objectType: typeId,
    customer: customerId,
    floor: floorId,
  });
  return record._id;
}

/**
 * A report and one item, written straight to the collections.
 *
 * This is what the database looked like BEFORE the fix: the report path moved the head and
 * wrote no `ObjectAssessment` at all, so the rows are created here exactly as the broken
 * path left them — including the fabricated `latestAssessment.assessment` reference that
 * pointed at no document.
 */
async function legacyFinding(options: {
  object: Types.ObjectId;
  score: number;
  riskLevel: 'NORMAL' | 'ATTENTION' | 'CRITICAL';
  occurredAt: Date;
  status?: 'APPROVED' | 'DRAFT';
  type?: 'PLANNED_WORK' | 'SERVICE_REQUEST' | 'OBJECT_ASSESSMENT';
  writeDanglingHead?: boolean;
}): Promise<{ reportId: Types.ObjectId; itemId: Types.ObjectId }> {
  const report = await Report.create({
    reportNumber: await nextReportNumber(options.occurredAt),
    type: options.type ?? 'PLANNED_WORK',
    status: options.status ?? 'APPROVED',
    title: 'Тайлан',
    customer: customerId,
    sourceType: options.type === 'OBJECT_ASSESSMENT' ? 'MANUAL' : 'PLANNED_WORK',
    sourceId: options.type === 'OBJECT_ASSESSMENT' ? null : new Types.ObjectId(),
    sourceReference: 'PW-202608-0001',
    overallScore: options.score,
    riskLevel: options.riskLevel,
    approvedByName: 'Батлагч Ажилтан',
    approvedBy: new Types.ObjectId(),
    approvedAt: options.occurredAt,
    createdByName: 'Бүртгэсэн Ажилтан',
    occurredAt: options.occurredAt,
  });

  const item = await ReportItem.create({
    report: report._id,
    object: options.object,
    customer: customerId,
    floor: floorId,
    score: options.score,
    riskLevel: options.riskLevel,
    observation: 'Ажиглалт.',
    conclusion: 'Дүгнэлт.',
    recommendation: 'Зөвлөмж.',
  });

  if (options.writeDanglingHead !== false) {
    await ObjectRecord.updateOne(
      { _id: options.object },
      {
        $set: {
          latestAssessment: {
            // The bug in one line: a reference minted for a document that is never created.
            assessment: new Types.ObjectId(),
            score: options.score,
            riskLevel: options.riskLevel,
            assessedAt: options.occurredAt,
            assessedByName: 'Батлагч Ажилтан',
            conclusion: 'Дүгнэлт.',
            recommendation: 'Зөвлөмж.',
          },
        },
      },
    );
  }

  return { reportId: report._id, itemId: item._id };
}

describe('assessment history backfill', () => {
  it('reports the missing rows and writes nothing on a dry run', async () => {
    const object = await seedObject();
    await legacyFinding({
      object,
      score: 80,
      riskLevel: 'ATTENTION',
      occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    const result = await backfillReportAssessmentHistory();

    expect(result.dryRun).toBe(true);
    expect(result.itemsExamined).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.newScore).toBe(80);
    expect(result.rows[0]?.riskLevel).toBe('ATTENTION');
    expect(result.rows[0]?.assessedByName).toBe('Батлагч Ажилтан');
    expect(result.rows[0]?.created).toBe(false);
    // The dangling head is reported, not repaired.
    expect(result.danglingHeads).toHaveLength(1);
    expect(result.danglingHeads[0]?.repaired).toBe(false);

    // A dry run is a dry run.
    expect(await ObjectAssessment.countDocuments({})).toBe(0);
  });

  it('creates the missing row and repoints the dangling head with --apply', async () => {
    const object = await seedObject();
    const { reportId, itemId } = await legacyFinding({
      object,
      score: 80,
      riskLevel: 'ATTENTION',
      occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    const result = await backfillReportAssessmentHistory({ apply: true });
    expect(result.rows[0]?.created).toBe(true);
    expect(result.failures).toBe(0);

    const rows = await ObjectAssessment.find({ object });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.newScore).toBe(80);
    expect(rows[0]?.riskLevel).toBe('ATTENTION');
    // Attribution and time come from the report, not from the moment the script ran.
    expect(rows[0]?.assessedByName).toBe('Батлагч Ажилтан');
    expect(rows[0]?.assessedAt.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(String(rows[0]?.sourceReportItem)).toBe(String(itemId));
    expect(String(rows[0]?.sourceReport)).toBe(String(reportId));

    // The head now resolves to a document that exists.
    const object_ = await ObjectRecord.findById(object);
    expect(String(object_?.latestAssessment?.assessment)).toBe(String(rows[0]?._id));
    expect(result.danglingHeads[0]?.repaired).toBe(true);
  });

  it('writes nothing on a second applied run', async () => {
    const object = await seedObject();
    await legacyFinding({
      object,
      score: 80,
      riskLevel: 'ATTENTION',
      occurredAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    await backfillReportAssessmentHistory({ apply: true });
    const second = await backfillReportAssessmentHistory({ apply: true });

    expect(second.rows).toHaveLength(0);
    expect(second.alreadyPresent).toBe(1);
    expect(await ObjectAssessment.countDocuments({ object })).toBe(1);
  });

  it('chains previousScore across an object’s findings in the order they happened', async () => {
    const object = await seedObject();
    await legacyFinding({
      object,
      score: 90,
      riskLevel: 'NORMAL',
      occurredAt: new Date('2026-05-01T00:00:00.000Z'),
      writeDanglingHead: false,
    });
    await legacyFinding({
      object,
      score: 60,
      riskLevel: 'ATTENTION',
      occurredAt: new Date('2026-06-01T00:00:00.000Z'),
    });

    await backfillReportAssessmentHistory({ apply: true });

    const rows = await ObjectAssessment.find({ object }).sort({ assessedAt: 1 });
    expect(rows).toHaveLength(2);
    // The earliest thing known about this equipment has nothing before it.
    expect(rows[0]?.previousScore).toBeNull();
    expect(rows[0]?.newScore).toBe(90);
    // The later finding reports the figure it replaced.
    expect(rows[1]?.previousScore).toBe(90);
    expect(rows[1]?.newScore).toBe(60);
  });

  it('leaves DRAFT findings alone', async () => {
    const object = await seedObject();
    await legacyFinding({
      object,
      score: 50,
      riskLevel: 'CRITICAL',
      occurredAt: new Date('2026-07-01T00:00:00.000Z'),
      status: 'DRAFT',
      writeDanglingHead: false,
    });

    const result = await backfillReportAssessmentHistory({ apply: true });

    // A DRAFT score never reached the equipment, so inventing history for it would assert
    // something that did not happen.
    expect(result.itemsExamined).toBe(0);
    expect(await ObjectAssessment.countDocuments({ object })).toBe(0);
  });

  it('never backfills an OBJECT_ASSESSMENT report, which already has its row', async () => {
    const object = await seedObject();
    await legacyFinding({
      object,
      score: 88,
      riskLevel: 'NORMAL',
      occurredAt: new Date('2026-07-01T00:00:00.000Z'),
      type: 'OBJECT_ASSESSMENT',
      writeDanglingHead: false,
    });

    const result = await backfillReportAssessmentHistory({ apply: true });

    // That type is only ever the write-through of a manual assessment. Backfilling it
    // would give every manual assessment in the database a second row.
    expect(result.itemsExamined).toBe(0);
    expect(await ObjectAssessment.countDocuments({ object })).toBe(0);
  });
});
