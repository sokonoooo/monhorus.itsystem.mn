import { PERMISSIONS } from '@monhorus/shared';
import { Types } from 'mongoose';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createObjectFixture,
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../../test/helpers';
import { StoredFile } from '../storage/stored-file.model';
import { Employee } from '../employee/employee.model';
import { ServiceRequest, nextRequestNumber } from './service-request.model';
import { WorkReport } from './work-report.model';
import {
  ObjectAssessment,
  ObjectRecord,
  ObjectType,
} from '../object-master/object-master.models';
import { Report, ReportItem } from '../report-record/report-record.model';
import { applyReportToEquipment } from '../report-record/report-record.service';

const API = '/api/v1';

let app: Express;
let token: string;
let fixture: ObjectFixture;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

/** A request parked at IN_PROGRESS, which is where a conclusion is written. */
async function seedRequest(): Promise<string> {
  const created = await ServiceRequest.create({
    requestNumber: await nextRequestNumber(),
    customer: fixture.customerId,
    building: fixture.buildingId,
    floor: fixture.floorId,
    requestType: 'REPAIR',
    isUrgent: false,
    description: 'Гэрэл асахгүй байна.',
    contactName: 'Бат',
    contactPhone: '99112233',
    status: 'IN_PROGRESS',
    slaStartedAt: new Date(),
    slaDueAt: new Date(Date.now() + 3_600_000),
  });
  return String(created._id);
}

let photoSequence = 0;
let technicianSequence = 0;

async function seedPhoto(name: string): Promise<string> {
  photoSequence += 1;
  const file = await StoredFile.create({
    originalName: name,
    storageKey: `test/${photoSequence}-${name}`,
    mimeType: 'image/png',
    sizeBytes: 1024,
    ownerType: 'SERVICE_REQUEST',
    ownerId: fixture.customerId,
    uploadedBy: null,
    uploadedByName: 'Тест',
  });
  return String(file._id);
}

async function fillReport(requestId: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .put(`${API}/service-requests/${requestId}/report`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      score: 78,
      conclusion: 'Холболт сул байсныг чангаллаа.',
      recommendation: '7 хоногийн дараа дахин шалгах.',
      repairRequired: false,
      revisitRequired: false,
      beforePhotoIds: [await seedPhoto('before.png')],
      afterPhotoIds: [await seedPhoto('after.png')],
      ...overrides,
    });
}

async function changeStatus(requestId: string, status: string, bearer = token) {
  return request(app)
    .post(`${API}/service-requests/${requestId}/status`)
    .set('Authorization', `Bearer ${bearer}`)
    .send({ status });
}

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  const superUser = await createSuperUser();
  token = await login(superUser.email, superUser.password);
  fixture = await createObjectFixture();
});

describe('Work conclusion', () => {
  it('creates an empty conclusion on first read', async () => {
    const requestId = await seedRequest();

    const response = await request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('DRAFT');
    expect(response.body.data.isComplete).toBe(false);
  });

  /** Section 10.1: the band follows the score and is never supplied by the caller. */
  it('derives the risk band from the score', async () => {
    const requestId = await seedRequest();
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);

    const saved = await fillReport(requestId, { score: 92 });
    expect(saved.body.data.riskLevel).toBe('NORMAL');

    const lowered = await fillReport(requestId, { score: 18 });
    expect(lowered.body.data.riskLevel).toBe('OUT_OF_SERVICE');
  });

  it('names every missing mandatory field', async () => {
    const requestId = await seedRequest();
    const created = await request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${token}`);

    expect(created.body.data.missing).toEqual(
      expect.arrayContaining(['SCORE', 'CONCLUSION', 'RECOMMENDATION', 'BEFORE_PHOTO', 'AFTER_PHOTO']),
    );
  });

  it('reports complete once every mandatory field is filled', async () => {
    const requestId = await seedRequest();
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);

    const saved = await fillReport(requestId);
    expect(saved.body.data.missing).toEqual([]);
    expect(saved.body.data.isComplete).toBe(true);
  });

  it('refuses to submit while a field is missing, and says which', async () => {
    const requestId = await seedRequest();
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);
    await fillReport(requestId, { recommendation: null, afterPhotoIds: [] });

    const response = await request(app)
      .post(`${API}/service-requests/${requestId}/report/submit`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    const fields = (response.body.issues ?? []).map((i: { field: string }) => i.field);
    expect(fields).toContain('RECOMMENDATION');
    expect(fields).toContain('AFTER_PHOTO');
  });

  it('walks draft to submitted to approved', async () => {
    const requestId = await seedRequest();
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);

    const submitted = await request(app)
      .post(`${API}/service-requests/${requestId}/report/submit`)
      .set('Authorization', `Bearer ${token}`);
    expect(submitted.body.data.status).toBe('SUBMITTED');

    const approved = await request(app)
      .post(`${API}/service-requests/${requestId}/report/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.data.approvedByName).toBeTruthy();
  });

  it('returns a conclusion with a mandatory reason', async () => {
    const requestId = await seedRequest();
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);
    await request(app).post(`${API}/service-requests/${requestId}/report/submit`).set('Authorization', `Bearer ${token}`);

    const noReason = await request(app)
      .post(`${API}/service-requests/${requestId}/report/return`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(noReason.status).toBe(400);

    const returned = await request(app)
      .post(`${API}/service-requests/${requestId}/report/return`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Зураг тодорхойгүй.' });
    expect(returned.body.data.status).toBe('RETURNED');
    expect(returned.body.data.returnReason).toBe('Зураг тодорхойгүй.');
  });

  /** A returned conclusion goes back to draft on edit so it is resubmitted, not left rejected. */
  it('puts a returned conclusion back into draft when it is edited', async () => {
    const requestId = await seedRequest();
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);
    await request(app).post(`${API}/service-requests/${requestId}/report/submit`).set('Authorization', `Bearer ${token}`);
    await request(app)
      .post(`${API}/service-requests/${requestId}/report/return`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Дахин.' });

    const edited = await fillReport(requestId, { conclusion: 'Дахин бичлээ.' });
    expect(edited.body.data.status).toBe('DRAFT');
  });

  it('refuses to edit an approved conclusion', async () => {
    const requestId = await seedRequest();
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);
    await request(app).post(`${API}/service-requests/${requestId}/report/submit`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`${API}/service-requests/${requestId}/report/approve`).set('Authorization', `Bearer ${token}`);

    const response = await fillReport(requestId, { conclusion: 'Өөрчиллөө.' });
    expect(response.status).toBe(400);
  });
});

describe('Completion gate', () => {
  /**
   * Rules 17.6 and 17.7. Before this gate a request could reach COMPLETED with no
   * evaluation, conclusion or recommendation at all.
   */
  it('refuses to submit a request for review with no conclusion', async () => {
    const requestId = await seedRequest();

    const response = await changeStatus(requestId, 'REPORT_SUBMITTED');

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/дүгнэлт/i);
  });

  it('allows review once the conclusion is complete', async () => {
    const requestId = await seedRequest();
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);

    const response = await changeStatus(requestId, 'REPORT_SUBMITTED');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('REPORT_SUBMITTED');
  });

  it('refuses to finish a request whose conclusion is not approved', async () => {
    const requestId = await seedRequest();
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);
    await changeStatus(requestId, 'REPORT_SUBMITTED');
    await changeStatus(requestId, 'VERIFICATION');

    const response = await changeStatus(requestId, 'COMPLETED');

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/батлаагүй/);
  });

  it('finishes a request once the conclusion is approved', async () => {
    const requestId = await seedRequest();
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);
    await request(app).post(`${API}/service-requests/${requestId}/report/submit`).set('Authorization', `Bearer ${token}`);
    await changeStatus(requestId, 'REPORT_SUBMITTED');
    await changeStatus(requestId, 'VERIFICATION');
    await request(app).post(`${API}/service-requests/${requestId}/report/approve`).set('Authorization', `Bearer ${token}`);

    const response = await changeStatus(requestId, 'COMPLETED');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('COMPLETED');
  });

  /** Reviewing is a separate duty from recording, so the two carry separate permissions. */
  it('separates recording a conclusion from approving one', async () => {
    const requestId = await seedRequest();
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);
    await request(app).post(`${API}/service-requests/${requestId}/report/submit`).set('Authorization', `Bearer ${token}`);

    const technician = await createUserWithPermissions('tech@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_VIEW,
      PERMISSIONS.SERVICE_REQUEST_UPDATE,
    ]);
    const techToken = await login(technician.email, technician.password);

    const response = await request(app)
      .post(`${API}/service-requests/${requestId}/report/approve`)
      .set('Authorization', `Bearer ${techToken}`);

    expect(response.status).toBe(403);
  });
});

// -- Per-equipment assessment ------------------------------------------------
//
// The conclusion used to be written once and copied onto every object it named, so a
// report claimed the same score for a healthy panel and a failing one. Each object now
// carries its own finding and becomes its own ReportItem.

describe('Service-request equipment assessment', () => {
  /** A registered object on the fixture's floor, so it can be assessed. */
  async function seedObject(code: string): Promise<string> {
    const objectType =
      (await ObjectType.findOne({ code: 'PANEL' })) ??
      (await ObjectType.create({ code: 'PANEL', name: 'Самбар', category: 'PANEL' }));

    const object = await ObjectRecord.create({
      code,
      name: `Самбар ${code}`,
      objectType: objectType._id,
      category: 'PANEL',
      floor: new Types.ObjectId(fixture.floorId),
      customer: new Types.ObjectId(fixture.customerId),
    });
    return String(object._id);
  }

  async function approvedReportFor(
    requestId: string,
    overrides: Record<string, unknown>,
  ): Promise<void> {
    await request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${token}`);
    await fillReport(requestId, overrides);
    await request(app)
      .post(`${API}/service-requests/${requestId}/report/submit`)
      .set('Authorization', `Bearer ${token}`);
    await request(app)
      .post(`${API}/service-requests/${requestId}/report/approve`)
      .set('Authorization', `Bearer ${token}`);
  }

  /**
   * The completeness rule is VISIT-LEVEL and per-equipment findings do not satisfy it.
   *
   * A technician can fill every equipment card — score, observation, conclusion,
   * recommendation, evidence — and still be refused over the visit's own score and its two
   * photographs, because `workReportCompleteness` reads five report fields and knows
   * nothing about `objectAssessments`. That is the current product rule and this pins it,
   * both so the refusal keeps naming the three fields and so a later change to the rule is
   * a deliberate edit to this expectation rather than a silent drift.
   */
  it('is still incomplete when only the per-equipment findings are filled in', async () => {
    const requestId = await seedRequest();
    const assessed = await seedObject('DB-20');
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);

    const saved = await fillReport(requestId, {
      score: null,
      beforePhotoIds: [],
      afterPhotoIds: [],
      objectIds: [assessed],
      objectAssessments: [
        {
          objectId: assessed,
          score: 91,
          observation: 'Холболт сул байв.',
          conclusion: 'Хэвийн ажиллагаанд орсон.',
          recommendation: 'Тогтмол хяналт.',
          photoIds: [await seedPhoto('device.png')],
        },
      ],
    });

    expect(saved.body.data.objectAssessments).toHaveLength(1);
    expect(saved.body.data.missing).toEqual(['SCORE', 'BEFORE_PHOTO', 'AFTER_PHOTO']);

    const refused = await request(app)
      .post(`${API}/service-requests/${requestId}/report/submit`)
      .set('Authorization', `Bearer ${token}`);

    expect(refused.status).toBe(400);
    expect((refused.body.issues ?? []).map((i: { field: string }) => i.field)).toEqual([
      'SCORE',
      'BEFORE_PHOTO',
      'AFTER_PHOTO',
    ]);
  });

  it('writes one report item per assessed object, each with its own finding', async () => {
    const requestId = await seedRequest();
    const healthy = await seedObject('DB-01');
    const failing = await seedObject('DB-02');

    await approvedReportFor(requestId, {
      objectAssessments: [
        { objectId: healthy, score: 95, observation: 'Хэвийн.', conclusion: 'Асуудалгүй.' },
        { objectId: failing, score: 22, observation: 'Хэт халалт.', conclusion: 'Яаралтай засвар.' },
      ],
    });

    const report = await Report.findOne({ sourceType: 'SERVICE_REQUEST' });
    expect(report).not.toBeNull();

    const items = await ReportItem.find({ report: report?._id }).sort({ score: 1 });
    expect(items).toHaveLength(2);

    // The whole point: two objects on one visit read differently.
    expect(items[0]?.score).toBe(22);
    expect(items[0]?.conclusion).toBe('Яаралтай засвар.');
    expect(items[1]?.score).toBe(95);
    expect(items[1]?.conclusion).toBe('Асуудалгүй.');
    // Bands are derived from each score, never copied from the visit.
    expect(items[0]?.riskLevel).not.toBe(items[1]?.riskLevel);
  });

  it('falls back to the visit figures for an object named without an assessment', async () => {
    const requestId = await seedRequest();
    const listed = await seedObject('DB-03');

    await approvedReportFor(requestId, { score: 78, objectIds: [listed] });

    const report = await Report.findOne({ sourceType: 'SERVICE_REQUEST' });
    const item = await ReportItem.findOne({ report: report?._id });
    expect(item?.score).toBe(78);
  });

  /**
   * The equipment's HISTORY, not just its head.
   *
   * An approved conclusion used to move `latestAssessment` and write no `ObjectAssessment`
   * row, so the evaluation never appeared in the device detail screen's Үнэлгээний түүх
   * table — which reads that collection — even though the score had visibly changed.
   */
  it('writes one history row per assessed object on approval', async () => {
    const requestId = await seedRequest();
    const healthy = await seedObject('DB-10');
    const failing = await seedObject('DB-11');

    await approvedReportFor(requestId, {
      objectAssessments: [
        { objectId: healthy, score: 95, observation: 'Хэвийн.', conclusion: 'Асуудалгүй.' },
        { objectId: failing, score: 22, observation: 'Хэт халалт.', conclusion: 'Яаралтай засвар.' },
      ],
    });

    const report = await Report.findOne({ sourceType: 'SERVICE_REQUEST' });

    const good = await ObjectAssessment.find({ object: healthy });
    const bad = await ObjectAssessment.find({ object: failing });
    expect(good).toHaveLength(1);
    expect(bad).toHaveLength(1);

    expect(good[0]?.newScore).toBe(95);
    expect(good[0]?.riskLevel).toBe('NORMAL');
    expect(good[0]?.conclusion).toBe('Асуудалгүй.');
    // The per-equipment observation, which is what the manual path stores as the action.
    expect(good[0]?.actionTaken).toBe('Хэвийн.');

    // Each object carries its OWN band, from its own score — not the visit's.
    expect(bad[0]?.newScore).toBe(22);
    expect(bad[0]?.riskLevel).not.toBe(good[0]?.riskLevel);

    for (const row of [...good, ...bad]) {
      // WHO and WHEN come from the report, never invented here.
      expect(row.assessedByName).toBe(report?.approvedByName);
      expect(row.assessedAt.toISOString()).toBe(report?.occurredAt.toISOString());
      expect(String(row.sourceReport)).toBe(String(report?._id));
      // The request number, so the history row names the visit it came from.
      expect(row.sourceLabel).toBe(report?.sourceReference);
    }

    // Each head points at the row that was actually written for it.
    const object = await ObjectRecord.findById(failing);
    expect(String(object?.latestAssessment?.assessment)).toBe(String(bad[0]?._id));
  });

  it('does not duplicate the history row when the conclusion is applied again', async () => {
    const requestId = await seedRequest();
    const assessed = await seedObject('DB-12');

    await approvedReportFor(requestId, {
      objectAssessments: [{ objectId: assessed, score: 64, conclusion: 'Ажиглалтад.' }],
    });

    expect(await ObjectAssessment.countDocuments({ object: assessed })).toBe(1);
    const first = await ObjectAssessment.findOne({ object: assessed });

    const report = await Report.findOne({ sourceType: 'SERVICE_REQUEST' });
    // Re-publishing an already-approved conclusion re-runs the apply over the same
    // upserted items. History must not gain a row per attempt.
    await applyReportToEquipment(report!._id);
    await applyReportToEquipment(report!._id);

    const rows = await ObjectAssessment.find({ object: assessed });
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?._id)).toBe(String(first?._id));
  });

  /**
   * A DRAFT conclusion is a claim. It must reach neither the head nor the history — the
   * same rule, applied to both, so the two cannot disagree about what has been settled.
   */
  it('writes no history row before the conclusion is approved', async () => {
    const requestId = await seedRequest();
    const assessed = await seedObject('DB-13');

    await request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${token}`);
    await fillReport(requestId, {
      objectAssessments: [{ objectId: assessed, score: 30, conclusion: 'Шалгах шаардлагатай.' }],
    });
    await request(app)
      .post(`${API}/service-requests/${requestId}/report/submit`)
      .set('Authorization', `Bearer ${token}`);

    expect(await ObjectAssessment.countDocuments({ object: assessed })).toBe(0);
    expect((await ObjectRecord.findById(assessed))?.latestAssessment ?? null).toBeNull();
  });

  /**
   * The equipment list is frozen once the conclusion is approved.
   *
   * Written after discovering that a "withdraw an object and re-approve" test could not
   * exist: the edit is refused, so the second approval had nothing to correct and both
   * items survived. That refusal IS the guarantee worth pinning — an approved finding has
   * already been published onto the equipment, and silently re-writing which objects it
   * covered would leave the equipment history disagreeing with the report that produced
   * it. Withdrawal happens through the return-for-correction path instead.
   */
  it('refuses to change the equipment list once the conclusion is approved', async () => {
    const requestId = await seedRequest();
    const first = await seedObject('DB-04');
    const second = await seedObject('DB-05');

    await approvedReportFor(requestId, { objectIds: [first, second] });
    const report = await Report.findOne({ sourceType: 'SERVICE_REQUEST' });
    expect(await ReportItem.countDocuments({ report: report?._id })).toBe(2);

    const edit = await fillReport(requestId, { objectIds: [first] });
    expect(edit.status).toBe(400);

    // Unchanged, because the edit never landed.
    expect(await ReportItem.countDocuments({ report: report?._id })).toBe(2);
  });

  /** The exclusion rule: a settled request that assessed nothing is not an assessment. */
  it('keeps a request with no equipment out of the inspection feed', async () => {
    const requestId = await seedRequest();
    await approvedReportFor(requestId, { objectIds: [], objectAssessments: [] });

    const report = await Report.findOne({ sourceType: 'SERVICE_REQUEST' });
    // The report still exists for workflow and audit...
    expect(report).not.toBeNull();
    // ...but produces no equipment result, so /inspections shows nothing.
    expect(await ReportItem.countDocuments({ report: report?._id })).toBe(0);

    const feed = await request(app)
      .get(`${API}/inspections`)
      .set('Authorization', `Bearer ${token}`);
    expect(feed.status).toBe(200);
    expect(feed.body.data.items).toHaveLength(0);
  });

  it('shows one row per equipment result in the inspection feed', async () => {
    const requestId = await seedRequest();
    const a = await seedObject('DB-06');
    const b = await seedObject('DB-07');

    await approvedReportFor(requestId, {
      objectAssessments: [
        { objectId: a, score: 90, conclusion: 'A' },
        { objectId: b, score: 30, conclusion: 'B' },
      ],
    });

    const feed = await request(app)
      .get(`${API}/inspections`)
      .set('Authorization', `Bearer ${token}`);

    expect(feed.body.data.items).toHaveLength(2);
    const scores = feed.body.data.items
      .map((row: { score: number }) => row.score)
      .sort((x: number, y: number) => x - y);
    expect(scores).toEqual([30, 90]);
    // Both name the same parent report, so the rows are linkable back to one visit.
    const reportIds = new Set(
      feed.body.data.items.map((row: { reportId: string }) => row.reportId),
    );
    expect(reportIds.size).toBe(1);
    expect(feed.body.data.items[0].siblingCount).toBe(2);
  });

  it('exports the same rows as CSV', async () => {
    const requestId = await seedRequest();
    const a = await seedObject('DB-10');
    const b = await seedObject('DB-11');

    await approvedReportFor(requestId, {
      objectAssessments: [
        { objectId: a, score: 90, conclusion: 'Хэвийн' },
        { objectId: b, score: 30, conclusion: 'Засвар шаардлагатай' },
      ],
    });

    const csv = await request(app)
      .get(`${API}/inspections?format=csv`)
      .set('Authorization', `Bearer ${token}`);

    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.trim().split('\n');
    // Header plus one line per equipment result, not per report.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Тоноглол');
    expect(csv.text).toContain('DB-10');
    expect(csv.text).toContain('DB-11');
  });

  it('filters the feed to one piece of equipment', async () => {
    const requestId = await seedRequest();
    const a = await seedObject('DB-08');
    const b = await seedObject('DB-09');

    await approvedReportFor(requestId, {
      objectAssessments: [
        { objectId: a, score: 90, conclusion: 'A' },
        { objectId: b, score: 30, conclusion: 'B' },
      ],
    });

    const feed = await request(app)
      .get(`${API}/inspections?objectId=${a}`)
      .set('Authorization', `Bearer ${token}`);

    expect(feed.body.data.items).toHaveLength(1);
    expect(feed.body.data.items[0].objectId).toBe(a);
  });
});

/**
 * The two boundaries a conclusion has to survive, both of which were broken on the live
 * database rather than in this suite: the shape of a document written before the schema
 * grew, and the assignment scope the request detail read acquired without its sub-routes.
 */
describe('Work conclusion — boundaries', () => {
  /** A signed-in technician with an ACTIVE employee card linked to their account. */
  async function makeTechnician(
    email: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ token: string; employeeId: Types.ObjectId }> {
    const user = await createUserWithPermissions(email, [
      PERMISSIONS.SERVICE_REQUEST_VIEW,
      PERMISSIONS.SERVICE_REQUEST_UPDATE,
    ]);
    technicianSequence += 1;
    const employee = await Employee.create({
      employeeCode: `WR-E-${technicianSequence}`,
      firstName: 'Тест',
      lastName: 'Мастер',
      registrationNumber: `ЧЧ${String(20_000_000 + technicianSequence)}`,
      status: 'ACTIVE',
      employeeType: 'FULL_TIME',
      employmentStartDate: new Date('2024-01-01'),
      systemUser: user.userId,
      ...overrides,
    });
    return { token: await login(user.email, user.password), employeeId: employee._id };
  }

  async function assign(requestId: string, employeeId: Types.ObjectId): Promise<void> {
    await ServiceRequest.updateOne(
      { _id: new Types.ObjectId(requestId) },
      { $set: { assignedEmployees: [employeeId] } },
    );
  }

  function getReport(requestId: string, bearer: string) {
    return request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${bearer}`);
  }

  /**
   * THE 500 THE APP SHOWED AS "систем алдаа".
   *
   * `.lean()` skips hydration and hydration is what applies a schema `default`, so a
   * conclusion stored before `objectAssessments` existed comes back with the key absent
   * and `toDto` did `undefined.map()`. The unset goes through the driver collection on
   * purpose: mongoose would re-add the defaults and the document under test would not be
   * the one the database actually holds.
   */
  it('reads a conclusion written before the list fields existed', async () => {
    const requestId = await seedRequest();
    const created = await getReport(requestId, token);
    expect(created.status).toBe(200);

    await WorkReport.collection.updateOne(
      { serviceRequest: new Types.ObjectId(requestId) },
      { $unset: { objectAssessments: '', materials: '', objects: '' } },
    );

    const reread = await getReport(requestId, token);

    expect(reread.status).toBe(200);
    expect(reread.body.data.objectAssessments).toEqual([]);
    expect(reread.body.data.materials).toEqual([]);
    expect(reread.body.data.objects).toEqual([]);
  });

  /** The same document reached through the request's own status guard, which also maps it. */
  it('does not fail the status guard on a legacy conclusion', async () => {
    const requestId = await seedRequest();
    await getReport(requestId, token);
    await fillReport(requestId);
    await WorkReport.collection.updateOne(
      { serviceRequest: new Types.ObjectId(requestId) },
      { $unset: { objectAssessments: '', materials: '', objects: '' } },
    );

    const moved = await changeStatus(requestId, 'REPORT_SUBMITTED');

    expect(moved.status).toBe(200);
  });

  it('lets the assigned technician create and save their conclusion', async () => {
    const requestId = await seedRequest();
    const tech = await makeTechnician('assigned.tech@test.mn');
    await assign(requestId, tech.employeeId);

    const opened = await getReport(requestId, tech.token);
    expect(opened.status).toBe(200);
    expect(opened.body.data.status).toBe('DRAFT');

    const saved = await request(app)
      .put(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${tech.token}`)
      .send({
        score: 71,
        conclusion: 'Шалгаж дууслаа.',
        recommendation: 'Дахин шалгах.',
        repairRequired: false,
        revisitRequired: false,
        beforePhotoIds: [],
        afterPhotoIds: [],
      });

    expect(saved.status).toBe(200);
    expect(saved.body.data.score).toBe(71);
    expect(await getReport(requestId, tech.token).then((r) => r.body.data.score)).toBe(71);
  });

  /**
   * The gap this closes: the detail read was assignment-scoped and its conclusion
   * sub-route was not, so a colleague's request answered 404 while its conclusion answered
   * 200 — and because the route is `getOrCreate`, reading it MINTED a draft attributed to
   * the caller on a job that was never theirs.
   */
  it('refuses a colleague conclusion and does not mint a draft on it', async () => {
    const requestId = await seedRequest();
    const owner = await makeTechnician('owner.tech@test.mn');
    const outsider = await makeTechnician('outsider.tech@test.mn');
    await assign(requestId, owner.employeeId);

    const read = await getReport(requestId, outsider.token);
    expect(read.status).toBe(404);

    const written = await request(app)
      .put(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({
        score: 10,
        conclusion: 'Хууль бус',
        recommendation: 'Хууль бус',
        repairRequired: false,
        revisitRequired: false,
        beforePhotoIds: [],
        afterPhotoIds: [],
      });
    expect(written.status).toBe(404);

    expect(
      await WorkReport.countDocuments({ serviceRequest: new Types.ObjectId(requestId) }),
    ).toBe(0);
  });

  /**
   * The open queue stays writable, matching the request detail read: a technician taps an
   * unclaimed request from "Нээлттэй" and the conclusion button on that screen must work.
   */
  it('still admits an unclaimed request', async () => {
    const requestId = await seedRequest();
    const tech = await makeTechnician('queue.tech@test.mn');

    const opened = await getReport(requestId, tech.token);

    expect(opened.status).toBe(200);
  });

  /** Oversight is unaffected: the reviewer never carries an employee card. */
  it('leaves an oversight caller unscoped', async () => {
    const requestId = await seedRequest();
    const owner = await makeTechnician('scoped.owner@test.mn');
    await assign(requestId, owner.employeeId);

    const seen = await getReport(requestId, token);

    expect(seen.status).toBe(200);
  });
});
