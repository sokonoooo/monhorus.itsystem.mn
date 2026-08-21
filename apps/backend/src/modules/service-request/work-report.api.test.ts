import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
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
  createCallableObjectType,
} from '../../test/helpers';
import { StoredFile } from '../storage/stored-file.model';
import { Employee } from '../employee/employee.model';
import { Notification } from '../notification/notification.model';
import { Customer } from '../objects/object.models';
import { User } from '../user/user.model';
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
let callableTypeId: string;
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
    objectTypeId: callableTypeId,
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
  // After the reset: object types are domain data and are wiped with everything else.
  callableTypeId = await createCallableObjectType();
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

  /**
   * APPROVAL NOW FINISHES THE REQUEST ITSELF. This used to walk the status by hand —
   * submit, REPORT_SUBMITTED, VERIFICATION, approve, COMPLETED — and assert the last step
   * was permitted. Approving the conclusion IS the verification, so the walk is gone and
   * the assertion is stronger: nobody has to remember to move it.
   */
  it('finishes a request once the conclusion is approved', async () => {
    const requestId = await seedRequest();
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);
    await request(app).post(`${API}/service-requests/${requestId}/report/submit`).set('Authorization', `Bearer ${token}`);

    // Submitting the conclusion moved it on its own.
    const submitted = await request(app)
      .get(`${API}/service-requests/${requestId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(submitted.body.data.status).toBe('REPORT_SUBMITTED');

    const approved = await request(app)
      .post(`${API}/service-requests/${requestId}/report/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect(approved.status).toBe(200);

    const finished = await request(app)
      .get(`${API}/service-requests/${requestId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(finished.body.data.status).toBe('COMPLETED');
    expect(finished.body.data.completedAt).not.toBeNull();
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
   * The equipment type's own attributes (requirements 4.1), answered on the Ажлын тайлан.
   *
   * They land on the EQUIPMENT, never on the finding: the score and the narrative are what
   * this visit observed, while "this breaker is fused" is true between visits. A copy per
   * report would create as many answers as there are visits with no way to say which is
   * current.
   */
  describe('per-type attributes on an equipment row', () => {
    const FUSE = {
      key: 'fuse',
      label: 'Хайлмал хамгаалалт',
      type: 'SELECT' as const,
      required: true,
      options: [
        { value: 'FUSED', label: 'Хайлмалтай' },
        { value: 'NOT_FUSED', label: 'Хайлмалгүй' },
      ],
    };

    /** A panel whose type declares the worked example from the brief. */
    async function seedBreaker(code: string): Promise<string> {
      const objectType = await ObjectType.create({
        code: `MCB-${code}`,
        name: 'Автомат таслуур',
        category: 'PANEL',
        attributes: [FUSE],
      });
      const object = await ObjectRecord.create({
        code,
        name: `Таслуур ${code}`,
        objectType: objectType._id,
        category: 'PANEL',
        floor: new Types.ObjectId(fixture.floorId),
        customer: new Types.ObjectId(fixture.customerId),
      });
      return String(object._id);
    }

    it('writes an answered attribute onto the equipment, not onto the finding', async () => {
      const requestId = await seedRequest();
      const assessed = await seedBreaker('MCB-30');
      await request(app)
        .get(`${API}/service-requests/${requestId}/report`)
        .set('Authorization', `Bearer ${token}`);

      const saved = await fillReport(requestId, {
        objectIds: [assessed],
        objectAssessments: [
          { objectId: assessed, score: 91, attributeValues: { fuse: 'FUSED' } },
        ],
      });

      expect(saved.status).toBe(200);
      // The report reads it back off the object, beside the definitions that describe it.
      const row = saved.body.data.objectAssessments[0];
      expect(row.attributeValues).toEqual({ fuse: 'FUSED' });
      expect(row.objectTypeAttributes.map((a: { key: string }) => a.key)).toEqual(['fuse']);

      const object = await ObjectRecord.findById(assessed);
      expect(object?.attributeValues).toEqual({ fuse: 'FUSED' });
    });

    it('refuses a value the type does not offer, naming the row it is on', async () => {
      const requestId = await seedRequest();
      const assessed = await seedBreaker('MCB-31');
      await request(app)
        .get(`${API}/service-requests/${requestId}/report`)
        .set('Authorization', `Bearer ${token}`);

      const refused = await fillReport(requestId, {
        objectIds: [assessed],
        objectAssessments: [
          { objectId: assessed, score: 91, attributeValues: { fuse: 'MELTED' } },
        ],
      });

      expect(refused.status).toBe(400);
      // The row index is what puts the message on the right card: a report may list four.
      expect(
        (refused.body.issues as { field: string }[]).map((issue) => issue.field),
      ).toEqual(['objectAssessments.0.attributeValues.fuse']);
    });

    it('leaves the equipment untouched when a row omits the key', async () => {
      /**
       * ABSENT MEANS "NOT ASKED", NEVER "THE ANSWER IS NOTHING".
       *
       * This is what lets a draft saved from a client that has not been updated, or before
       * the fields were filled in, save without clearing answers it never showed.
       */
      const requestId = await seedRequest();
      const assessed = await seedBreaker('MCB-32');
      await request(app)
        .get(`${API}/service-requests/${requestId}/report`)
        .set('Authorization', `Bearer ${token}`);
      await ObjectRecord.updateOne(
        { _id: assessed },
        { $set: { attributeValues: { fuse: 'NOT_FUSED' } } },
      );

      const saved = await fillReport(requestId, {
        objectIds: [assessed],
        objectAssessments: [{ objectId: assessed, score: 91 }],
      });

      expect(saved.status).toBe(200);
      const object = await ObjectRecord.findById(assessed);
      expect(object?.attributeValues).toEqual({ fuse: 'NOT_FUSED' });
    });
  });

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
   * A save that does not mention the office-entered fields must not erase them.
   *
   * The employee mobile client omits `materials` and `revisitDate` entirely and used to
   * hardcode both follow-up flags to false. While the schema defaulted those fields, an
   * omission was indistinguishable from "clear", so a technician tapping Save wiped the
   * material list a dispatcher had entered on the web (requirements 19.2), reset both
   * flags and dropped the revisit date — silently, in one direction, with no warning on
   * either client. The fields are now absent-means-untouched.
   */
  it('preserves office-entered fields when a save omits them', async () => {
    const requestId = await seedRequest();
    // The conclusion route is getOrCreate; the draft has to exist before it can be saved.
    await getReport(requestId, token);

    const seeded = await fillReport(requestId, {
      actionTaken: 'Автомат таслуур сольсон.',
      repairRequired: true,
      revisitRequired: true,
      revisitDate: '2026-09-01T00:00:00.000Z',
      materials: [
        { name: 'Автомат таслуур 16A', quantity: 2, unit: 'PIECE' },
        { name: 'Кабель 2.5мм', quantity: 12.5, unit: 'METRE' },
      ],
    });
    expect(seeded.status).toBe(200);

    // A naive client: every field it manages, and none of the five it does not.
    const naive = await request(app)
      .put(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        score: 90,
        conclusion: 'Утсаар шинэчиллээ.',
        recommendation: 'Хэвийн.',
        beforePhotoIds: [],
        afterPhotoIds: [],
      });

    expect(naive.status).toBe(200);
    expect(naive.body.data.score).toBe(90);

    const after = await getReport(requestId, token);
    expect(after.body.data.actionTaken).toBe('Автомат таслуур сольсон.');
    expect(after.body.data.repairRequired).toBe(true);
    expect(after.body.data.revisitRequired).toBe(true);
    expect(after.body.data.revisitDate).toBe('2026-09-01T00:00:00.000Z');
    expect(after.body.data.materials).toHaveLength(2);
    expect(after.body.data.materials[0]).toMatchObject({
      name: 'Автомат таслуур 16A',
      quantity: 2,
      unit: 'PIECE',
    });
  });

  /**
   * The other half of the same rule: absent is untouched, but an explicitly sent empty
   * list or false still clears. Without this the fix would have made the web editor unable
   * to remove a material it had added by mistake.
   */
  it('still clears office-entered fields when they are sent explicitly', async () => {
    const requestId = await seedRequest();
    await getReport(requestId, token)

    await fillReport(requestId, {
      repairRequired: true,
      revisitRequired: true,
      revisitDate: '2026-09-01T00:00:00.000Z',
      actionTaken: 'Түр засвар.',
      materials: [{ name: 'Гэрэл', quantity: 1, unit: 'PIECE' }],
    });

    const cleared = await fillReport(requestId, {
      repairRequired: false,
      revisitRequired: false,
      revisitDate: null,
      actionTaken: null,
      materials: [],
    });
    expect(cleared.status).toBe(200);

    const after = await getReport(requestId, token);
    expect(after.body.data.repairRequired).toBe(false);
    expect(after.body.data.revisitRequired).toBe(false);
    expect(after.body.data.revisitDate).toBeNull();
    expect(after.body.data.actionTaken).toBeNull();
    expect(after.body.data.materials).toEqual([]);
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
   * THE OPEN QUEUE IS NO LONGER WRITABLE, and this test used to assert the opposite.
   *
   * Reading an unclaimed request is still fine; authoring a conclusion on one is not.
   * Opening the editor MINTS A DRAFT attributed to the caller, so the old behaviour let any
   * technician who tapped an unclaimed request become the author of a conclusion on work
   * nobody had taken. The claim flow exists precisely so authorship is never ambiguous —
   * a technician claims it, and then it is theirs to conclude.
   */
  it('refuses a conclusion on an unclaimed request until it is claimed', async () => {
    const requestId = await seedRequest();
    const tech = await makeTechnician('queue.tech@test.mn');

    const opened = await getReport(requestId, tech.token);

    expect(opened.status).toBe(404);
    // And nothing was written on the way out.
    expect(await WorkReport.countDocuments({ serviceRequest: requestId })).toBe(0);
  });


  /**
   * P0: a conclusion records what was found ON SITE, so it cannot be written from the road.
   *
   * Asserted against a request that has NOT arrived. `seedRequest` opens at IN_PROGRESS,
   * which is already past arrival, so each of these walks the request back to a
   * pre-arrival status first — otherwise the gate would never be exercised and the test
   * would pass whether or not it existed.
   */
  describe('arrival gate', () => {
    async function setStatus(requestId: string, status: string): Promise<void> {
      await ServiceRequest.updateOne(
        { _id: new Types.ObjectId(requestId) },
        { $set: { status, statusHistory: [] } },
      );
    }

    it.each(['ASSIGNED', 'ACCEPTED', 'ON_THE_WAY'])(
      'refuses a conclusion while the request is only %s',
      async (status) => {
        const requestId = await seedRequest();
        const tech = await makeTechnician(`before.${status}@test.mn`);
        await assign(requestId, tech.employeeId);
        await setStatus(requestId, status);

        const opened = await getReport(requestId, tech.token);

        expect(opened.status).toBe(400);
        // Refused before anything was written: no draft is minted on the way out.
        expect(await WorkReport.countDocuments({ serviceRequest: requestId })).toBe(0);
      },
    );

    /** WAITING is reachable from ON_THE_WAY, so waiting is not the same as having arrived. */
    it('refuses a conclusion from a technician waiting who never arrived', async () => {
      const requestId = await seedRequest();
      const tech = await makeTechnician('waiting.tech@test.mn');
      await assign(requestId, tech.employeeId);
      await setStatus(requestId, 'WAITING');

      expect((await getReport(requestId, tech.token)).status).toBe(400);
    });

    it('admits a conclusion once the technician is on site', async () => {
      const requestId = await seedRequest();
      const tech = await makeTechnician('onsite.tech@test.mn');
      await assign(requestId, tech.employeeId);
      await setStatus(requestId, 'ON_SITE');

      expect((await getReport(requestId, tech.token)).status).toBe(200);
    });

    /**
     * Arrival is a thing that happened, not a status you are currently in: a request that
     * was visited and then sent back must not lock its own conclusion away.
     */
    it('remembers an earlier arrival when the request has moved back', async () => {
      const requestId = await seedRequest();
      const tech = await makeTechnician('revisit.tech@test.mn');
      await assign(requestId, tech.employeeId);
      await ServiceRequest.updateOne(
        { _id: new Types.ObjectId(requestId) },
        {
          $set: {
            status: 'ASSIGNED',
            statusHistory: [
              {
                _id: new Types.ObjectId(),
                fromStatus: 'ON_THE_WAY',
                toStatus: 'ON_SITE',
                reason: null,
                changedBy: null,
                changedByName: null,
                changedAt: new Date(),
              },
            ],
          },
        },
      );

      expect((await getReport(requestId, tech.token)).status).toBe(200);
    });

    /** The rule is about the person doing the visit; an office reviewer is not one. */
    it('does not hold an oversight caller to the arrival rule', async () => {
      const requestId = await seedRequest();
      await setStatus(requestId, 'ASSIGNED');

      expect((await getReport(requestId, token)).status).toBe(200);
    });
  });

  /**
   * P0: writing and submitting are both bounded, not just opening the editor. A client that
   * skipped the GET must not be able to save or submit either.
   */
  describe('every conclusion write is bounded, not only the first', () => {
    it('refuses save and submit on an unclaimed request', async () => {
      const requestId = await seedRequest();
      const tech = await makeTechnician('unclaimed.writer@test.mn');

      const saved = await request(app)
        .put(`${API}/service-requests/${requestId}/report`)
        .set('Authorization', `Bearer ${tech.token}`)
        .send({
          score: 71,
          conclusion: 'Гараар бичсэн.',
          repairRequired: false,
          revisitRequired: false,
          beforePhotoIds: [],
          afterPhotoIds: [],
          materials: [],
          objectIds: [],
          objectAssessments: [],
        });
      expect(saved.status).toBe(404);

      const submitted = await request(app)
        .post(`${API}/service-requests/${requestId}/report/submit`)
        .set('Authorization', `Bearer ${tech.token}`);
      expect(submitted.status).toBe(404);
    });
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

/**
 * GET /service-requests/:requestId/report/customer — the finished verdict, read by the
 * organisation that raised the request.
 *
 * Two things had to be true at once and neither was: a customer could not see the answer
 * to their own request at all, and the only read that existed could not be opened to them
 * because it CREATES. `GET /:id/report` is `getOrCreateWorkReport`, so a portal key on it
 * would have stamped the customer's name onto an empty DRAFT the moment they opened the
 * tab — which is why this is a separate route over `findWorkReport`, and why the count
 * assertion below is the one that matters most in this file.
 */
describe('Work conclusion — the customer read', () => {
  let customerToken: string;
  let foreignCustomerId: Types.ObjectId;

  let portalSequence = 0;

  /**
   * A signed-in `customer` account holding the portal key and nothing else.
   *
   * The organisation link lives on the USER, which is the whole point: `resolveCustomerScope`
   * reads it from the authenticated account and discards anything the request carries, so
   * no test here can accidentally prove the scope by passing the right id.
   */
  async function makeCustomer(
    email: string,
    linkedCustomerId: string,
    permissions: readonly PermissionKey[] = [PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW],
  ): Promise<string> {
    portalSequence += 1;
    const user = await createUserWithPermissions(email, permissions);
    await User.updateOne(
      { _id: new Types.ObjectId(user.userId) },
      { $set: { role: 'customer', customer: new Types.ObjectId(linkedCustomerId) } },
    );
    return login(user.email, user.password);
  }

  /** A request belonging to somebody else entirely. */
  async function seedForeignRequest(): Promise<string> {
    const created = await ServiceRequest.create({
      requestNumber: await nextRequestNumber(),
      customer: foreignCustomerId,
      building: new Types.ObjectId(),
      requestType: 'REPAIR',
      isUrgent: false,
      description: 'Өөр байгууллагын хүсэлт.',
      contactName: 'Дорж',
      contactPhone: '99887766',
      status: 'IN_PROGRESS',
      slaStartedAt: new Date(),
      slaDueAt: new Date(Date.now() + 3_600_000),
    });
    return String(created._id);
  }

  /** Drives a request's conclusion to APPROVED through the real staff routes. */
  async function approve(requestId: string): Promise<void> {
    await request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);
    await request(app)
      .post(`${API}/service-requests/${requestId}/report/submit`)
      .set('Authorization', `Bearer ${token}`);
    await request(app)
      .post(`${API}/service-requests/${requestId}/report/approve`)
      .set('Authorization', `Bearer ${token}`);
  }

  function readAsCustomer(requestId: string, bearer = customerToken) {
    return request(app)
      .get(`${API}/service-requests/${requestId}/report/customer`)
      .set('Authorization', `Bearer ${bearer}`);
  }

  beforeEach(async () => {
    const foreign = await Customer.create({ code: 'FGN', name: 'Өөр байгууллага ХХК' });
    foreignCustomerId = foreign._id;
    customerToken = await makeCustomer('portal.reader@test.mn', fixture.customerId);
  });

  it('serves an approved conclusion to the customer who raised the request', async () => {
    const requestId = await seedRequest();
    await approve(requestId);

    const response = await readAsCustomer(requestId);

    expect(response.status).toBe(200);
    expect(response.body.data.conclusion).toBe('Холболт сул байсныг чангаллаа.');
    expect(response.body.data.recommendation).toBe('7 хоногийн дараа дахин шалгах.');
    expect(response.body.data.score).toBe(78);
    // Derived from the score against the bands in force, never sent by the caller.
    expect(response.body.data.riskLevel).toBe('ATTENTION');
    expect(response.body.data.approvedByName).toBeTruthy();
    expect(response.body.data.approvedAt).toBeTruthy();
    expect(response.body.data.beforePhotos).toHaveLength(1);
    expect(response.body.data.afterPhotos).toHaveLength(1);
  });

  /**
   * The response is the WHOLE contract, not a superset of it.
   *
   * Asserted as an exact key set rather than field by field, because the failure this
   * guards against is a field ARRIVING: `WorkReportDto` is the technician's working
   * document and the next internal note added to it must not reach a customer because
   * somebody reused the staff mapper.
   */
  it('sends exactly the customer fields and no more', async () => {
    const requestId = await seedRequest();
    await approve(requestId);

    const response = await readAsCustomer(requestId);

    expect(Object.keys(response.body.data).sort()).toEqual(
      [
        'afterPhotos',
        'approvedAt',
        'approvedByName',
        'beforePhotos',
        'conclusion',
        'recommendation',
        'repairRequired',
        'revisitDate',
        'revisitRequired',
        'riskLevel',
        'score',
      ].sort(),
    );
  });

  /**
   * The two named withheld fields, pinned individually because each leaks something
   * different: `returnReason` is one colleague's verdict on another's work, and
   * `createdByName` is not the author at all — `getOrCreateWorkReport` stamps whoever
   * opened the form first, so publishing it would attribute the conclusion to the wrong
   * person on the customer's own screen.
   */
  it('withholds the review conversation and the draft opener name', async () => {
    const requestId = await seedRequest();
    await approve(requestId);

    const response = await readAsCustomer(requestId);

    expect(response.body.data).not.toHaveProperty('returnReason');
    expect(response.body.data).not.toHaveProperty('createdByName');
    expect(response.body.data).not.toHaveProperty('createdBy');
    expect(response.body.data).not.toHaveProperty('status');
    expect(response.body.data).not.toHaveProperty('submittedByName');
    expect(response.body.data).not.toHaveProperty('returnedByName');
    expect(response.body.data).not.toHaveProperty('returnedAt');
    expect(response.body.data).not.toHaveProperty('missing');
    expect(response.body.data).not.toHaveProperty('isComplete');
    expect(response.body.data).not.toHaveProperty('actionTaken');
    expect(response.body.data).not.toHaveProperty('materials');
    expect(response.body.data).not.toHaveProperty('objects');
    expect(response.body.data).not.toHaveProperty('objectAssessments');
  });

  /**
   * THE REGRESSION THAT MATTERS MOST.
   *
   * The trap this endpoint exists to avoid is `getOrCreateWorkReport`: had the portal key
   * simply been added to `GET /:id/report`, every customer opening the tab on a request
   * with no conclusion would have become the recorded author of an empty DRAFT on it.
   */
  it('creates nothing when the request has no conclusion', async () => {
    const requestId = await seedRequest();
    const before = await WorkReport.countDocuments({});

    const response = await readAsCustomer(requestId);

    expect(response.status).toBe(404);
    expect(await WorkReport.countDocuments({})).toBe(before);
    expect(
      await WorkReport.countDocuments({ serviceRequest: new Types.ObjectId(requestId) }),
    ).toBe(0);
  });

  /**
   * A draft, a submission and a return are all answered as nothing at all, so a customer
   * cannot watch the internal review of their own request progress — nor learn that a
   * technician has written something nobody has yet stood behind.
   */
  it.each([
    ['DRAFT', async (id: string) => { await fillReport(id); }],
    [
      'SUBMITTED',
      async (id: string) => {
        await fillReport(id);
        await request(app)
          .post(`${API}/service-requests/${id}/report/submit`)
          .set('Authorization', `Bearer ${token}`);
      },
    ],
    [
      'RETURNED',
      async (id: string) => {
        await fillReport(id);
        await request(app)
          .post(`${API}/service-requests/${id}/report/submit`)
          .set('Authorization', `Bearer ${token}`);
        await request(app)
          .post(`${API}/service-requests/${id}/report/return`)
          .set('Authorization', `Bearer ${token}`)
          .send({ reason: 'Зураг тодорхойгүй.' });
      },
    ],
  ])('answers 404 for a %s conclusion', async (status, drive) => {
    const requestId = await seedRequest();
    await request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${token}`);
    await drive(requestId);

    const stored = await WorkReport.findOne({
      serviceRequest: new Types.ObjectId(requestId),
    }).select('status');
    expect(stored?.status).toBe(status);

    const response = await readAsCustomer(requestId);
    expect(response.status).toBe(404);
    // No shape at all, so nothing can be inferred from an empty object either.
    expect(response.body.data).toBeNull();
  });

  /**
   * Another tenant's request is MISSING, not forbidden. The predicate is in
   * `requestIdInScope`'s query rather than a check on a loaded document, so the id never
   * resolves at all — a "forbidden" reply would confirm it is real and turn this into a
   * probe for other organisations' request ids.
   */
  it('reports another organisation request as not found', async () => {
    const foreignRequestId = await seedForeignRequest();
    await approve(foreignRequestId);

    const response = await readAsCustomer(foreignRequestId);

    expect(response.status).toBe(404);
    expect(response.body.data).toBeNull();
  });

  /** The endpoint is staff-readable too, so an administrator can see what the portal shows. */
  it('serves the same view to staff', async () => {
    const requestId = await seedRequest();
    await approve(requestId);

    const response = await request(app)
      .get(`${API}/service-requests/${requestId}/report/customer`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).not.toHaveProperty('returnReason');
  });

  /** A portal account without the view key is refused before any of the above is reached. */
  it('refuses a customer holding no portal view key', async () => {
    const requestId = await seedRequest();
    await approve(requestId);
    const bare = await makeCustomer('portal.bare@test.mn', fixture.customerId, [
      PERMISSIONS.PORTAL_PROFILE_VIEW,
    ]);

    const response = await readAsCustomer(requestId, bare);

    expect(response.status).toBe(403);
  });

  /** The staff routes are untouched: the conclusion still creates on first staff read. */
  it('leaves the staff read creating a draft as before', async () => {
    const requestId = await seedRequest();

    const staffRead = await request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${token}`);

    expect(staffRead.status).toBe(200);
    expect(staffRead.body.data.status).toBe('DRAFT');
    expect(
      await WorkReport.countDocuments({ serviceRequest: new Types.ObjectId(requestId) }),
    ).toBe(1);
  });

  /** A customer must never reach the staff conclusion, whose DTO carries the review notes. */
  it('does not open the staff conclusion route to a customer', async () => {
    const requestId = await seedRequest();
    await approve(requestId);

    const response = await request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(403);
  });

  // -- hasApprovedReport -----------------------------------------------------
  //
  // The flag the portal needs to decide whether to OFFER the conclusion at all, since a
  // customer cannot ask for a conclusion's status.

  function detail(requestId: string, bearer = customerToken) {
    return request(app)
      .get(`${API}/service-requests/${requestId}`)
      .set('Authorization', `Bearer ${bearer}`);
  }

  it('flags the request only once its conclusion is approved', async () => {
    const requestId = await seedRequest();

    expect((await detail(requestId)).body.data.hasApprovedReport).toBe(false);

    await request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);
    expect((await detail(requestId)).body.data.hasApprovedReport).toBe(false);

    await request(app)
      .post(`${API}/service-requests/${requestId}/report/submit`)
      .set('Authorization', `Bearer ${token}`);
    expect((await detail(requestId)).body.data.hasApprovedReport).toBe(false);

    await request(app)
      .post(`${API}/service-requests/${requestId}/report/approve`)
      .set('Authorization', `Bearer ${token}`);
    expect((await detail(requestId)).body.data.hasApprovedReport).toBe(true);
  });

  /**
   * The flag is a fact about the CONCLUSION, never about the request's own status. Live
   * data has a COMPLETED request whose conclusion never left DRAFT, which is exactly why
   * `status === 'COMPLETED'` was not usable as a proxy.
   */
  it('stays false for a completed request whose conclusion is still a draft', async () => {
    const requestId = await seedRequest();
    await request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${token}`);
    await ServiceRequest.updateOne(
      { _id: new Types.ObjectId(requestId) },
      { $set: { status: 'COMPLETED' } },
    );

    const response = await detail(requestId);

    expect(response.body.data.status).toBe('COMPLETED');
    expect(response.body.data.hasApprovedReport).toBe(false);
    expect((await readAsCustomer(requestId)).status).toBe(404);
  });

  /** Reading the detail must not mint a conclusion either. */
  it('does not create a conclusion while computing the flag', async () => {
    const requestId = await seedRequest();
    const before = await WorkReport.countDocuments({});

    await detail(requestId);

    expect(await WorkReport.countDocuments({})).toBe(before);
  });
});

/**
 * P0: the customer is told when their request is finished.
 *
 * Nothing told them before. `notify` could address staff by permission or employees by id,
 * and the CUSTOMER preset holds not one staff key — so every existing notification was
 * structurally incapable of reaching a customer inbox, however it was worded.
 */
describe('the customer hears that their request was resolved', () => {
  async function makeCustomerUser(email: string): Promise<string> {
    const user = await createUserWithPermissions(email, [PERMISSIONS.NOTIFICATION_VIEW]);
    await User.updateOne(
      { _id: new Types.ObjectId(user.userId) },
      { $set: { role: 'customer', customer: fixture.customerId } },
    );
    return user.userId;
  }

  async function concludeAndApprove(requestId: string): Promise<void> {
    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);
    await request(app).post(`${API}/service-requests/${requestId}/report/submit`).set('Authorization', `Bearer ${token}`);
    await request(app).post(`${API}/service-requests/${requestId}/report/approve`).set('Authorization', `Bearer ${token}`);
  }

  it('notifies the customer, naming the request and where it was', async () => {
    const userId = await makeCustomerUser('notified.customer@test.mn');
    const requestId = await seedRequest();

    await concludeAndApprove(requestId);

    const rows = await Notification.find({ recipient: new Types.ObjectId(userId) }).lean();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    // Enough to identify it: the request number, and the building it was at.
    const stored = await ServiceRequest.findById(requestId).select('requestNumber').lean();
    expect(row!.title).toContain(stored!.requestNumber);
    expect(row!.body).toContain('Төв');
    // ...and a link a customer can actually open.
    expect(row!.linkPath).toBe(`/portal/requests/${requestId}`);
  });

  /** Another organisation's portal account must not hear about this request at all. */
  it('tells nobody outside the requesting organisation', async () => {
    const outsiderUser = await createUserWithPermissions('outsider@test.mn', [
      PERMISSIONS.NOTIFICATION_VIEW,
    ]);
    const otherCustomer = await Customer.create({ code: 'OTH', name: 'Өөр ХХК' });
    await User.updateOne(
      { _id: new Types.ObjectId(outsiderUser.userId) },
      { $set: { role: 'customer', customer: otherCustomer._id } },
    );
    const requestId = await seedRequest();

    await concludeAndApprove(requestId);

    expect(
      await Notification.countDocuments({ recipient: new Types.ObjectId(outsiderUser.userId) }),
    ).toBe(0);
  });

  /** Submitting is not finishing: the customer hears once, at the end. */
  it('says nothing to the customer while the conclusion is only submitted', async () => {
    const userId = await makeCustomerUser('early.customer@test.mn');
    const requestId = await seedRequest();

    await request(app).get(`${API}/service-requests/${requestId}/report`).set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);
    await request(app).post(`${API}/service-requests/${requestId}/report/submit`).set('Authorization', `Bearer ${token}`);

    expect(
      await Notification.countDocuments({ recipient: new Types.ObjectId(userId) }),
    ).toBe(0);
  });
});

/**
 * WHO hears that a conclusion moved.
 *
 * `REPORT_APPROVED` and `REPORT_RETURNED` were addressed to `service_request.view` alone.
 * TECHNICIAN holds that key, so every technician in the company was told about every
 * conclusion on every request — which is what "the employees always get the same
 * notification" turns out to mean when you read one of their inboxes. These cases pin the
 * recipient rather than the wording: a conclusion concerns the crew on that request, the
 * person who submitted it, and the desk that owns the request's flow.
 */
describe('conclusion notification recipients', () => {
  let recipientSequence = 0;

  /** A technician holding the OLD blanket key, on purpose: they must now hear nothing. */
  async function makeTechnician(
    email: string,
  ): Promise<{ token: string; userId: string; employeeId: Types.ObjectId }> {
    const user = await createUserWithPermissions(email, [
      PERMISSIONS.SERVICE_REQUEST_VIEW,
      PERMISSIONS.SERVICE_REQUEST_UPDATE,
      PERMISSIONS.NOTIFICATION_VIEW,
    ]);
    recipientSequence += 1;
    const employee = await Employee.create({
      employeeCode: `WR-N-${recipientSequence}`,
      firstName: 'Тест',
      lastName: 'Хүлээн авагч',
      registrationNumber: `УУ${String(30_000_000 + recipientSequence)}`,
      status: 'ACTIVE',
      employeeType: 'FULL_TIME',
      employmentStartDate: new Date('2024-01-01'),
      systemUser: new Types.ObjectId(user.userId),
    });
    return {
      token: await login(user.email, user.password),
      userId: user.userId,
      employeeId: employee._id,
    };
  }

  async function assign(requestId: string, employeeIds: Types.ObjectId[]): Promise<void> {
    await ServiceRequest.updateOne(
      { _id: new Types.ObjectId(requestId) },
      { $set: { assignedEmployees: employeeIds } },
    );
  }

  function inboxOf(userId: string, event: string) {
    return Notification.find({ recipient: new Types.ObjectId(userId), event }).lean();
  }

  async function draftAndFill(requestId: string): Promise<void> {
    await request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${token}`);
    await fillReport(requestId);
  }

  function submit(requestId: string, bearer: string) {
    return request(app)
      .post(`${API}/service-requests/${requestId}/report/submit`)
      .set('Authorization', `Bearer ${bearer}`);
  }

  it('tells the crew their conclusion was approved, and no technician outside the job', async () => {
    const onTheJob = await makeTechnician('wr-approved-crew@test.mn');
    const bystander = await makeTechnician('wr-approved-bystander@test.mn');
    const requestId = await seedRequest();
    await assign(requestId, [onTheJob.employeeId]);

    await draftAndFill(requestId);
    expect((await submit(requestId, onTheJob.token)).status).toBe(200);
    await request(app)
      .post(`${API}/service-requests/${requestId}/report/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(await inboxOf(onTheJob.userId, 'REPORT_APPROVED')).toHaveLength(1);
    // Assigned to nothing, holds only a read key. The broadcast reached them; nothing else
    // about this request ever should.
    expect(await inboxOf(bystander.userId, 'REPORT_APPROVED')).toHaveLength(0);
  });

  /**
   * A return is work handed back to a PERSON, and that person was never addressed as one.
   *
   * The request is unassigned between the submission and the return on purpose: it is the
   * case the blanket key hid. An author no longer on the crew is still the author, and
   * anything that reaches them only through a permission fan-out stops reaching them here.
   */
  it('tells the author their conclusion came back, even once they are off the job', async () => {
    const author = await makeTechnician('wr-returned-author@test.mn');
    const bystander = await makeTechnician('wr-returned-bystander@test.mn');
    const requestId = await seedRequest();
    await assign(requestId, [author.employeeId]);

    await draftAndFill(requestId);
    expect((await submit(requestId, author.token)).status).toBe(200);
    await assign(requestId, []);

    const returned = await request(app)
      .post(`${API}/service-requests/${requestId}/report/return`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Гэрэл зураг тодорхойгүй байна.' });
    expect(returned.status).toBe(200);

    expect(await inboxOf(author.userId, 'REPORT_RETURNED')).toHaveLength(1);
    expect(await inboxOf(bystander.userId, 'REPORT_RETURNED')).toHaveLength(0);
  });
});
