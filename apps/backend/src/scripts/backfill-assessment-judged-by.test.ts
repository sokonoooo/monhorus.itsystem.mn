import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ObjectAssessment,
  ObjectRecord,
  ObjectType,
} from '../modules/object-master/object-master.models';
import { Customer, ObjectNode } from '../modules/objects/object.models';
import { PlannedWork, PlannedWorkTask } from '../modules/planned-work/planned-work.models';
import { Report, ReportItem, nextReportNumber } from '../modules/report-record/report-record.model';
import { resetDomainCollections, startTestApp, stopTestApp } from '../test/helpers';
import { backfillAssessmentJudgedBy } from './backfill-assessment-judged-by';

beforeAll(async () => {
  await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

const APPROVER = new Types.ObjectId();
const TECHNICIAN = new Types.ObjectId();

let customerId: Types.ObjectId;
let floorId: Types.ObjectId;
let buildingId: Types.ObjectId;
let typeId: Types.ObjectId;
let sequence = 0;

beforeEach(async () => {
  await resetDomainCollections();
  sequence = 0;

  const customer = await Customer.create({ code: 'JB', name: 'Дүгнэлт ХХК' });
  customerId = customer._id;
  const building = await ObjectNode.create({
    kind: 'BUILDING',
    code: 'JB-B1',
    name: 'Барилга',
    customer: customer._id,
    parent: null,
    ancestors: [],
  });
  buildingId = building._id;
  const floor = await ObjectNode.create({
    kind: 'FLOOR',
    code: 'JB-F1',
    name: '1 давхар',
    customer: customer._id,
    parent: building._id,
    ancestors: [building._id],
  });
  floorId = floor._id;
  const type = await ObjectType.create({ code: 'JBP', name: 'Самбар', category: 'PANEL' });
  typeId = type._id;
});

async function seedObject(): Promise<Types.ObjectId> {
  sequence += 1;
  const record = await ObjectRecord.create({
    code: `JB-OBJ-${sequence}`,
    name: `Тоноглол ${sequence}`,
    category: 'PANEL',
    objectType: typeId,
    customer: customerId,
    floor: floorId,
  });
  return record._id;
}

async function seedWork(): Promise<Types.ObjectId> {
  sequence += 1;
  const work = await PlannedWork.create({
    workNumber: `PW-202607-000${sequence}`,
    building: buildingId,
    customer: customerId,
    title: 'Улирлын үзлэг',
    plannedStartDate: new Date('2026-07-01T00:00:00.000Z'),
    plannedEndDate: new Date('2026-07-20T00:00:00.000Z'),
    originalPlannedEndDate: new Date('2026-07-20T00:00:00.000Z'),
    status: 'COMPLETED',
  });
  return work._id;
}

async function seedTask(
  work: Types.ObjectId,
  options: {
    title: string;
    objects: Types.ObjectId[];
    conclusion: string | null;
    author?: { id: Types.ObjectId; name: string } | null;
  },
): Promise<void> {
  await PlannedWorkTask.create({
    plannedWork: work,
    floor: floorId,
    title: options.title,
    unit: 'PIECE',
    totalQuantity: 1,
    completedQuantity: 1,
    plannedStartDate: new Date('2026-07-01T00:00:00.000Z'),
    plannedEndDate: new Date('2026-07-10T00:00:00.000Z'),
    relatedObjects: options.objects,
    conclusion: options.conclusion,
    conclusionBy: options.author?.id ?? null,
    conclusionByName: options.author?.name ?? null,
    conclusionAt: options.author ? new Date('2026-07-05T00:00:00.000Z') : null,
    score: 80,
  });
}

/**
 * A finding and the history row it produced, as the live path wrote them BEFORE `judgedBy`
 * existed: the approver in `assessedBy` and no author anywhere.
 */
async function legacyRow(options: {
  object: Types.ObjectId;
  work?: Types.ObjectId | null;
  sourceType?: 'PLANNED_WORK' | 'SERVICE_REQUEST';
  conclusion?: string;
}): Promise<{ assessmentId: Types.ObjectId; itemId: Types.ObjectId }> {
  const occurredAt = new Date('2026-07-15T00:00:00.000Z');
  const report = await Report.create({
    reportNumber: await nextReportNumber(occurredAt),
    type: options.sourceType === 'SERVICE_REQUEST' ? 'SERVICE_REQUEST' : 'PLANNED_WORK',
    status: 'APPROVED',
    title: 'Тайлан',
    customer: customerId,
    sourceType: options.sourceType ?? 'PLANNED_WORK',
    sourceId: options.work ?? new Types.ObjectId(),
    sourceReference: 'PW-202607-0001',
    overallScore: 80,
    riskLevel: 'ATTENTION',
    approvedBy: APPROVER,
    approvedByName: 'Батлагч Ажилтан',
    approvedAt: occurredAt,
    occurredAt,
  });

  const item = await ReportItem.create({
    report: report._id,
    object: options.object,
    customer: customerId,
    floor: floorId,
    score: 80,
    riskLevel: 'ATTENTION',
    conclusion: options.conclusion ?? 'Дүгнэлт.',
  });

  const assessment = await ObjectAssessment.create({
    object: options.object,
    previousScore: null,
    newScore: 80,
    riskLevel: 'ATTENTION',
    assessedBy: APPROVER,
    assessedByName: 'Батлагч Ажилтан',
    assessedAt: occurredAt,
    conclusion: options.conclusion ?? 'Дүгнэлт.',
    sourceReport: report._id,
    sourceReportItem: item._id,
  });

  return { assessmentId: assessment._id, itemId: item._id };
}

describe('judging-technician backfill', () => {
  it('traces the sub-task author and writes nothing on a dry run', async () => {
    const object = await seedObject();
    const work = await seedWork();
    await seedTask(work, {
      title: 'Самбарын үзлэг',
      objects: [object],
      conclusion: 'Дүгнэлт.',
      author: { id: TECHNICIAN, name: 'Техникч Ганаа' },
    });
    const { assessmentId } = await legacyRow({ object, work });

    const result = await backfillAssessmentJudgedBy();

    expect(result.dryRun).toBe(true);
    expect(result.examined).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.judgedById).toBe(String(TECHNICIAN));
    expect(result.rows[0]?.judgedByName).toBe('Техникч Ганаа');
    // The sign-off it does NOT touch is reported beside it, so the two can be compared.
    expect(result.rows[0]?.assessedByName).toBe('Батлагч Ажилтан');
    expect(result.rows[0]?.updated).toBe(false);

    const row = await ObjectAssessment.findById(assessmentId);
    expect(row?.judgedBy ?? null).toBeNull();
  });

  it('writes the author onto the history row and its report item with --apply', async () => {
    const object = await seedObject();
    const work = await seedWork();
    await seedTask(work, {
      title: 'Самбарын үзлэг',
      objects: [object],
      conclusion: 'Дүгнэлт.',
      author: { id: TECHNICIAN, name: 'Техникч Ганаа' },
    });
    const { assessmentId, itemId } = await legacyRow({ object, work });

    const result = await backfillAssessmentJudgedBy({ apply: true });
    expect(result.rows[0]?.updated).toBe(true);
    expect(result.rows[0]?.itemUpdated).toBe(true);
    expect(result.failures).toBe(0);

    const row = await ObjectAssessment.findById(assessmentId);
    expect(String(row?.judgedBy)).toBe(String(TECHNICIAN));
    expect(row?.judgedByName).toBe('Техникч Ганаа');
    // Nothing the row ASSERTS moved: only the provenance that was never captured.
    expect(String(row?.assessedBy)).toBe(String(APPROVER));
    expect(row?.assessedByName).toBe('Батлагч Ажилтан');
    expect(row?.newScore).toBe(80);
    expect(row?.assessedAt.toISOString()).toBe('2026-07-15T00:00:00.000Z');

    expect(String((await ReportItem.findById(itemId))?.judgedBy)).toBe(String(TECHNICIAN));

    // A second run has nothing left to do and does not touch the row again.
    const again = await backfillAssessmentJudgedBy({ apply: true });
    expect(again.examined).toBe(0);
    expect(again.alreadyAuthored).toBe(1);
    expect(again.rows).toHaveLength(0);
  });

  /**
   * Two sub-tasks of one work naming the same panel, concluded by different people. There
   * is no honest answer, so no answer is written: an audit row naming the wrong technician
   * is worse than one naming none.
   */
  it('refuses to guess when two sub-tasks with different authors name the equipment', async () => {
    const object = await seedObject();
    const work = await seedWork();
    await seedTask(work, {
      title: 'Өглөөний үзлэг',
      objects: [object],
      conclusion: 'Өөр дүгнэлт.',
      author: { id: TECHNICIAN, name: 'Техникч Ганаа' },
    });
    await seedTask(work, {
      title: 'Оройн үзлэг',
      objects: [object],
      conclusion: 'Бас өөр дүгнэлт.',
      author: { id: new Types.ObjectId(), name: 'Техникч Дорж' },
    });
    // The item's own conclusion matches neither, so the text cannot narrow the pair.
    const { assessmentId } = await legacyRow({ object, work, conclusion: 'Гуравдахь текст.' });

    const result = await backfillAssessmentJudgedBy({ apply: true });

    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe('AMBIGUOUS_TASKS');
    expect((await ObjectAssessment.findById(assessmentId))?.judgedBy ?? null).toBeNull();
  });

  /** The conclusion text is what picks the sub-task apart when several name the panel. */
  it('picks the sub-task whose conclusion the finding actually carries', async () => {
    const object = await seedObject();
    const work = await seedWork();
    await seedTask(work, {
      title: 'Өглөөний үзлэг',
      objects: [object],
      conclusion: 'Энэ дүгнэлт мөрөнд бичигдсэн.',
      author: { id: TECHNICIAN, name: 'Техникч Ганаа' },
    });
    await seedTask(work, {
      title: 'Оройн үзлэг',
      objects: [object],
      conclusion: 'Өөр дүгнэлт.',
      author: { id: new Types.ObjectId(), name: 'Техникч Дорж' },
    });
    await legacyRow({ object, work, conclusion: 'Энэ дүгнэлт мөрөнд бичигдсэн.' });

    const result = await backfillAssessmentJudgedBy({ apply: true });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.judgedByName).toBe('Техникч Ганаа');
  });

  it('leaves a service-request finding alone, because it records no per-object author', async () => {
    const object = await seedObject();
    const { assessmentId } = await legacyRow({ object, sourceType: 'SERVICE_REQUEST' });

    const result = await backfillAssessmentJudgedBy({ apply: true });

    expect(result.rows).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe('NOT_PLANNED_WORK');
    expect((await ObjectAssessment.findById(assessmentId))?.judgedBy ?? null).toBeNull();
  });

  it('leaves a manual assessment alone, because it has no finding behind it', async () => {
    const object = await seedObject();
    const manual = await ObjectAssessment.create({
      object,
      previousScore: null,
      newScore: 95,
      riskLevel: 'NORMAL',
      assessedBy: APPROVER,
      assessedByName: 'Гараар бүртгэсэн',
      assessedAt: new Date('2026-07-02T00:00:00.000Z'),
    });

    const result = await backfillAssessmentJudgedBy({ apply: true });

    expect(result.rows).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe('NO_SOURCE_ITEM');
    expect((await ObjectAssessment.findById(manual._id))?.judgedBy ?? null).toBeNull();
  });

  /**
   * A sub-task that carries a Дүгнэлт written before `conclusionBy` existed has no author
   * to give. Falling back to the work's assignee would be an invention, so the row is
   * reported and left as it is — which is what every row in the dev database does today.
   */
  it('reports a sub-task that carries no author rather than substituting one', async () => {
    const object = await seedObject();
    const work = await seedWork();
    await seedTask(work, {
      title: 'Хуучин үзлэг',
      objects: [object],
      conclusion: 'Дүгнэлт.',
      author: null,
    });
    const { assessmentId } = await legacyRow({ object, work });

    const result = await backfillAssessmentJudgedBy({ apply: true });

    expect(result.rows).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe('TASK_HAS_NO_AUTHOR');
    expect((await ObjectAssessment.findById(assessmentId))?.judgedBy ?? null).toBeNull();
  });
});
