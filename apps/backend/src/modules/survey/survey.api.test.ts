import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createCallableObjectType,
  createObjectFixture,
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
  type TestUser,
} from '../../test/helpers';
import { Employee } from '../employee/employee.model';
import { Notification } from '../notification/notification.model';
import { runReminderSweep, SURVEY_REMINDER_AFTER_MS } from '../notification/reminder.service';
import { Customer, ObjectNode } from '../objects/object.models';
import { ServiceRequest, nextRequestNumber } from '../service-request/service-request.model';
import { WorkReport } from '../service-request/work-report.model';
import { StoredFile } from '../storage/stored-file.model';
import { User } from '../user/user.model';
import { issueSurveyInvitation } from './survey.invitation';
import { SurveyInvitation, SurveyQuestion, SurveyResponse } from './survey.models';

const API = '/api/v1';
const DAY = 24 * 60 * 60 * 1000;

let app: Express;
let admin: string;
let fixture: ObjectFixture;
let callableTypeId: string;

let sequence = 0;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function tokenFor(email: string, permissions: readonly PermissionKey[]): Promise<string> {
  const user = await createUserWithPermissions(email, permissions);
  return login(user.email, user.password);
}

/**
 * A portal account: the permission plus the organisation link the scope resolver reads.
 * The link lives on the USER, which is the whole point — nothing a request carries can
 * change which tenant the caller is.
 */
async function customerToken(
  email: string,
  linkedCustomerId: string,
  permissions: readonly PermissionKey[] = [PERMISSIONS.PORTAL_SURVEY_SUBMIT],
): Promise<string> {
  const user: TestUser = await createUserWithPermissions(email, permissions);
  await User.updateOne(
    { _id: new Types.ObjectId(user.userId) },
    { $set: { role: 'customer', customer: new Types.ObjectId(linkedCustomerId) } },
  );
  return login(user.email, user.password);
}

async function seedEmployee(): Promise<Types.ObjectId> {
  sequence += 1;
  const employee = await Employee.create({
    employeeCode: `SV-E-${sequence}`,
    firstName: 'Батаа',
    lastName: 'Дорж',
    registrationNumber: `УУ${String(30_000_000 + sequence)}`,
    status: 'ACTIVE',
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
  });
  return employee._id;
}

async function seedRequest(
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; number: string }> {
  const requestNumber = await nextRequestNumber();
  const created = await ServiceRequest.create({
    requestNumber,
    customer: fixture.customerId,
    building: fixture.buildingId,
    floor: fixture.floorId,
    objectType: callableTypeId,
    isUrgent: false,
    description: 'Гэрэл асахгүй байна.',
    contactName: 'Бат',
    contactPhone: '99112233',
    status: 'IN_PROGRESS',
    slaStartedAt: new Date(),
    slaDueAt: new Date(Date.now() + 3_600_000),
    ...overrides,
  });
  return { id: String(created._id), number: requestNumber };
}

async function createQuestion(
  body: Record<string, unknown>,
  bearer = admin,
): Promise<request.Response> {
  return request(app)
    .post(`${API}/surveys/questions`)
    .set('Authorization', `Bearer ${bearer}`)
    .send({ text: 'Асуулт', type: 'TEXT', isRequired: false, ...body });
}

/** The overall-score rating question every scoring case needs. */
async function seedOverallQuestion(): Promise<string> {
  const response = await createQuestion({
    text: 'Үйлчилгээг ерөнхийд нь үнэлнэ үү',
    type: 'RATING_1_5',
    isRequired: true,
    isOverallScore: true,
  });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function seedPhoto(name: string): Promise<string> {
  sequence += 1;
  const file = await StoredFile.create({
    originalName: name,
    storageKey: `survey-test/${sequence}-${name}`,
    mimeType: 'image/png',
    sizeBytes: 512,
    ownerType: 'SERVICE_REQUEST',
    ownerId: fixture.customerId,
    uploadedBy: null,
    uploadedByName: 'Тест',
  });
  return String(file._id);
}

/**
 * The COMMON completion path, driven end to end: write the conclusion, submit it, approve
 * it. Approval is what moves the request to COMPLETED, and therefore what must issue the
 * invitation — going through HTTP rather than calling the emitter proves the wiring.
 */
async function approveConclusion(requestId: string): Promise<void> {
  // The conclusion is brought into being by the first READ of it, so the form is opened
  // before it can be saved — the same order the technician's app follows.
  const opened = await request(app)
    .get(`${API}/service-requests/${requestId}/report`)
    .set('Authorization', `Bearer ${admin}`);
  expect(opened.status).toBe(200);

  const filled = await request(app)
    .put(`${API}/service-requests/${requestId}/report`)
    .set('Authorization', `Bearer ${admin}`)
    .send({
      score: 80,
      conclusion: 'Холболт сул байсныг чангаллаа.',
      recommendation: 'Долоо хоногийн дараа шалгах.',
      repairRequired: false,
      revisitRequired: false,
      beforePhotoIds: [await seedPhoto('before.png')],
      afterPhotoIds: [await seedPhoto('after.png')],
    });
  expect(filled.status).toBe(200);

  const submitted = await request(app)
    .post(`${API}/service-requests/${requestId}/report/submit`)
    .set('Authorization', `Bearer ${admin}`);
  expect(submitted.status).toBe(200);

  const approved = await request(app)
    .post(`${API}/service-requests/${requestId}/report/approve`)
    .set('Authorization', `Bearer ${admin}`);
  expect(approved.status).toBe(200);
}

function surveyNotifications(): Promise<number> {
  return Notification.countDocuments({ event: 'SURVEY_REQUESTED' });
}

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  callableTypeId = await createCallableObjectType();
  const superUser = await createSuperUser();
  admin = await login(superUser.email, superUser.password);
  fixture = await createObjectFixture();
});

/* ------------------------------------------------------------------ catalogue */

describe('Survey question catalogue', () => {
  it('creates, lists, updates and deletes a question', async () => {
    const created = await createQuestion({ text: 'Цаг барьсан уу?', type: 'YES_NO' });
    expect(created.status).toBe(201);
    const questionId = created.body.data.id as string;
    expect(created.body.data.sortOrder).toBe(1);
    expect(created.body.data.hasAnswers).toBe(false);

    const listed = await request(app)
      .get(`${API}/surveys/questions`)
      .set('Authorization', `Bearer ${admin}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);

    const patched = await request(app)
      .patch(`${API}/surveys/questions/${questionId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ text: 'Цагтаа ирсэн үү?' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.text).toBe('Цагтаа ирсэн үү?');

    const deleted = await request(app)
      .delete(`${API}/surveys/questions/${questionId}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(deleted.status).toBe(200);
    expect(await request(app).get(`${API}/surveys/questions`).set('Authorization', `Bearer ${admin}`).then((r) => r.body.data)).toHaveLength(0);
  });

  it('lists inactive questions too, because the admin has to be able to reactivate them', async () => {
    const created = await createQuestion({ text: 'Хуучин асуулт', isActive: false });
    expect(created.status).toBe(201);

    const listed = await request(app)
      .get(`${API}/surveys/questions`)
      .set('Authorization', `Bearer ${admin}`);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].isActive).toBe(false);
  });

  it('lets a results reader see the catalogue but not edit it', async () => {
    await createQuestion({ text: 'Асуулт 1' });
    const reader = await tokenFor('reader@test.mn', [PERMISSIONS.SURVEY_VIEW_RESULTS]);

    const listed = await request(app)
      .get(`${API}/surveys/questions`)
      .set('Authorization', `Bearer ${reader}`);
    expect(listed.status).toBe(200);

    const refused = await createQuestion({ text: 'Асуулт 2' }, reader);
    expect(refused.status).toBe(403);
  });

  it('refuses the catalogue to a caller holding neither survey key', async () => {
    const outsider = await tokenFor('outsider@test.mn', [PERMISSIONS.SERVICE_REQUEST_VIEW]);

    const listed = await request(app)
      .get(`${API}/surveys/questions`)
      .set('Authorization', `Bearer ${outsider}`);
    expect(listed.status).toBe(403);
  });

  /**
   * The flag MOVES. The partial unique index permits one holder, so a service that set the
   * new one before clearing the old would fail with a duplicate key instead of reassigning.
   */
  it('moves the overall-score flag rather than tripping the unique index', async () => {
    const first = await createQuestion({
      text: 'Ерөнхий үнэлгээ 1',
      type: 'RATING_1_5',
      isOverallScore: true,
    });
    expect(first.status).toBe(201);

    const second = await createQuestion({
      text: 'Ерөнхий үнэлгээ 2',
      type: 'RATING_1_5',
      isOverallScore: true,
    });
    expect(second.status).toBe(201);
    expect(second.body.data.isOverallScore).toBe(true);

    const afterCreate = await request(app)
      .get(`${API}/surveys/questions`)
      .set('Authorization', `Bearer ${admin}`);
    expect(
      afterCreate.body.data.filter((q: { isOverallScore: boolean }) => q.isOverallScore),
    ).toHaveLength(1);
    expect(
      afterCreate.body.data.find((q: { id: string }) => q.id === first.body.data.id)
        .isOverallScore,
    ).toBe(false);

    // And back again, this time through the update path.
    const moved = await request(app)
      .patch(`${API}/surveys/questions/${first.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ isOverallScore: true });
    expect(moved.status).toBe(200);

    const afterPatch = await request(app)
      .get(`${API}/surveys/questions`)
      .set('Authorization', `Bearer ${admin}`);
    const holders = afterPatch.body.data.filter((q: { isOverallScore: boolean }) => q.isOverallScore);
    expect(holders).toHaveLength(1);
    expect(holders[0].id).toBe(first.body.data.id);
  });

  /**
   * The one-holder rule is the DATABASE's, not the service's.
   *
   * Written directly through the model, bypassing every service check, so the assertion is
   * about the partial unique index itself. Without it the service's clear-then-set order
   * would be a convention rather than a guarantee, and any future writer could quietly put a
   * second holder in the collection.
   */
  it('lets the database refuse a second overall-score question', async () => {
    await createQuestion({ text: 'Ерөнхий', type: 'RATING_1_5', isOverallScore: true });

    await expect(
      SurveyQuestion.create({
        text: 'Хоёр дахь ерөнхий',
        type: 'RATING_1_5',
        isOverallScore: true,
        isRequired: true,
        isActive: true,
        sortOrder: 99,
      }),
    ).rejects.toMatchObject({ code: 11000 });

    // ...while a non-holder is unaffected: the index is partial, so only `true` collides.
    await expect(
      SurveyQuestion.create({
        text: 'Энгийн асуулт',
        type: 'RATING_1_5',
        isOverallScore: false,
        isRequired: true,
        isActive: true,
        sortOrder: 100,
      }),
    ).resolves.toBeDefined();
  });

  it('refuses to retype the overall-score question away from a rating', async () => {
    const created = await createQuestion({
      text: 'Ерөнхий үнэлгээ',
      type: 'RATING_1_5',
      isOverallScore: true,
    });

    const refused = await request(app)
      .patch(`${API}/surveys/questions/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ type: 'YES_NO' });
    expect(refused.status).toBe(400);
    expect(refused.body.issues.some((i: { field: string }) => i.field === 'isOverallScore')).toBe(
      true,
    );
  });

  it('rewrites sortOrder from an id list', async () => {
    const a = await createQuestion({ text: 'A' });
    const b = await createQuestion({ text: 'B' });
    const c = await createQuestion({ text: 'C' });

    const reordered = await request(app)
      .post(`${API}/surveys/questions/reorder`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ questionIds: [c.body.data.id, a.body.data.id, b.body.data.id] });

    expect(reordered.status).toBe(200);
    expect(reordered.body.data.map((q: { text: string }) => q.text)).toEqual(['C', 'A', 'B']);
  });
});

/* --------------------------------------------------------------- invitations */

describe('Survey invitations', () => {
  it('issues exactly one invitation when the conclusion is approved, and never a second', async () => {
    await seedOverallQuestion();
    const employeeId = await seedEmployee();
    const { id: requestId } = await seedRequest({ assignedEmployees: [employeeId] });
    // A portal account for the organisation, or the notification has no recipient and the
    // count below would be measuring nothing.
    await customerToken('notified@test.mn', fixture.customerId);

    await approveConclusion(requestId);

    expect(await SurveyInvitation.countDocuments({})).toBe(1);
    expect(await surveyNotifications()).toBe(1);

    // A second completion — a reopened and re-finished request, or a retried approval —
    // must not re-issue and, above all, must not re-announce.
    await issueSurveyInvitation(requestId);
    expect(await SurveyInvitation.countDocuments({})).toBe(1);
    expect(await surveyNotifications()).toBe(1);
  });

  /**
   * The OTHER completion path: a status moved by hand rather than by an approval.
   *
   * Staged rather than driven, because approving through the API auto-completes the request
   * and there would then be no hand-made move left to test. The request is parked at
   * VERIFICATION with an already-approved conclusion behind it — exactly the state an office
   * closing a job by hand is in — and only then is COMPLETED posted.
   */
  it('issues on the manual completion path too', async () => {
    await seedOverallQuestion();
    const employeeId = await seedEmployee();
    const { id: requestId } = await seedRequest({ assignedEmployees: [employeeId] });
    await customerToken('manual-notified@test.mn', fixture.customerId);

    await request(app)
      .get(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${admin}`);
    await request(app)
      .put(`${API}/service-requests/${requestId}/report`)
      .set('Authorization', `Bearer ${admin}`)
      .send({
        score: 90,
        conclusion: 'Ажил дууслаа.',
        recommendation: 'Тогтмол үзлэг.',
        repairRequired: false,
        revisitRequired: false,
        beforePhotoIds: [await seedPhoto('before.png')],
        afterPhotoIds: [await seedPhoto('after.png')],
      });
    await WorkReport.updateOne(
      { serviceRequest: new Types.ObjectId(requestId) },
      { $set: { status: 'APPROVED', approvedAt: new Date(), approvedByName: 'Тест' } },
    );
    await ServiceRequest.updateOne(
      { _id: new Types.ObjectId(requestId) },
      { $set: { status: 'VERIFICATION' } },
    );

    const changed = await request(app)
      .post(`${API}/service-requests/${requestId}/status`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ status: 'COMPLETED' });
    expect(changed.status).toBe(200);

    expect(
      await SurveyInvitation.countDocuments({
        serviceRequest: new Types.ObjectId(requestId),
      }),
    ).toBe(1);
    expect(await surveyNotifications()).toBe(1);
  });

  it('issues nothing when nobody was assigned', async () => {
    await seedOverallQuestion();
    const { id: requestId } = await seedRequest({ assignedEmployees: [] });

    await approveConclusion(requestId);

    expect(await SurveyInvitation.countDocuments({})).toBe(0);
    expect(await surveyNotifications()).toBe(0);
  });

  it('issues nothing while the catalogue has no active question', async () => {
    // Deliberately no question at all — this is the rollout gate: the feature stays off
    // until an administrator has actually written the survey.
    const employeeId = await seedEmployee();
    const { id: requestId } = await seedRequest({ assignedEmployees: [employeeId] });

    await approveConclusion(requestId);

    expect(await SurveyInvitation.countDocuments({})).toBe(0);
    expect(await surveyNotifications()).toBe(0);
  });

  it('issues nothing when every question has been deactivated', async () => {
    const questionId = await seedOverallQuestion();
    await request(app)
      .patch(`${API}/surveys/questions/${questionId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ isActive: false, isOverallScore: false });

    const employeeId = await seedEmployee();
    const { id: requestId } = await seedRequest({ assignedEmployees: [employeeId] });
    await approveConclusion(requestId);

    expect(await SurveyInvitation.countDocuments({})).toBe(0);
  });
});

/* ----------------------------------------------------------------- answering */

describe('Answering the survey', () => {
  let questionId: string;
  let employeeA: Types.ObjectId;
  let employeeB: Types.ObjectId;
  let requestId: string;
  let portal: string;

  beforeEach(async () => {
    questionId = await seedOverallQuestion();
    employeeA = await seedEmployee();
    employeeB = await seedEmployee();
    const seeded = await seedRequest({ assignedEmployees: [employeeA, employeeB] });
    requestId = seeded.id;
    await approveConclusion(requestId);
    portal = await customerToken('portal@test.mn', fixture.customerId);
  });

  function submit(body: Record<string, unknown>, bearer = portal): Promise<request.Response> {
    return request(app)
      .post(`${API}/surveys/requests/${requestId}/responses`)
      .set('Authorization', `Bearer ${bearer}`)
      .send(body);
  }

  it('lists the pending invitation and serves the form', async () => {
    const pending = await request(app)
      .get(`${API}/surveys/pending`)
      .set('Authorization', `Bearer ${portal}`);
    expect(pending.status).toBe(200);
    expect(pending.body.data).toHaveLength(1);
    expect(pending.body.data[0].employees).toHaveLength(2);
    expect(pending.body.data[0].employees[0].isRated).toBe(false);

    const form = await request(app)
      .get(`${API}/surveys/requests/${requestId}/form`)
      .set('Authorization', `Bearer ${portal}`);
    expect(form.status).toBe(200);
    expect(form.body.data.questions).toHaveLength(1);
    expect(form.body.data.employees).toHaveLength(2);
  });

  it('records a rating and denormalises the overall score', async () => {
    const response = await submit({
      employeeId: String(employeeA),
      answers: [{ questionId, ratingValue: 5 }],
    });

    expect(response.status).toBe(201);
    expect(response.body.data.overallScore).toBe(5);
    expect(response.body.data.answers[0].questionText).toBe('Үйлчилгээг ерөнхийд нь үнэлнэ үү');
  });

  it('refuses a second response for the same technician', async () => {
    expect(
      (await submit({ employeeId: String(employeeA), answers: [{ questionId, ratingValue: 4 }] }))
        .status,
    ).toBe(201);

    const again = await submit({
      employeeId: String(employeeA),
      answers: [{ questionId, ratingValue: 1 }],
    });
    expect(again.status).toBe(400);
    expect(again.body.message).toContain('аль хэдийн үнэлсэн');
    expect(await SurveyResponse.countDocuments({ employee: employeeA })).toBe(1);
  });

  it('refuses a technician who was not on the job', async () => {
    const stranger = await seedEmployee();
    const refused = await submit({
      employeeId: String(stranger),
      answers: [{ questionId, ratingValue: 5 }],
    });
    expect(refused.status).toBe(400);
    expect(refused.body.issues[0].field).toBe('employeeId');
  });

  it('rejects an answer of the wrong shape for its question', async () => {
    const refused = await submit({
      employeeId: String(employeeA),
      answers: [{ questionId, booleanValue: true }],
    });
    expect(refused.status).toBe(400);
    expect(refused.body.issues[0].field).toBe('answers.0.ratingValue');
  });

  it('rejects a missing required answer', async () => {
    const refused = await submit({ employeeId: String(employeeA), answers: [] });
    expect(refused.status).toBe(400);
    expect(refused.body.issues.some((i: { field: string }) => i.field === 'answers')).toBe(true);
  });

  it('rejects a choice that is not on the question', async () => {
    const choice = await createQuestion({
      text: 'Хаанаас сонссон бэ?',
      type: 'SINGLE_CHOICE',
      isRequired: false,
      options: [
        { value: 'WEB', label: 'Вэб' },
        { value: 'PHONE', label: 'Утас' },
      ],
    });
    expect(choice.status).toBe(201);

    const refused = await submit({
      employeeId: String(employeeA),
      answers: [
        { questionId, ratingValue: 5 },
        { questionId: choice.body.data.id, choiceValue: 'FAX' },
      ],
    });
    expect(refused.status).toBe(400);
    expect(refused.body.issues[0].field).toBe('answers.1.choiceValue');
  });

  /**
   * THE SKIP. It records a response, so the invitation can close; it carries no score, so
   * nothing the customer did not observe reaches the technician's average.
   */
  it('records a skip, closes the invitation and keeps the skip out of the average', async () => {
    expect(
      (await submit({ employeeId: String(employeeA), answers: [{ questionId, ratingValue: 4 }] }))
        .status,
    ).toBe(201);

    const skipped = await submit({ employeeId: String(employeeB), skipped: true });
    expect(skipped.status).toBe(201);
    expect(skipped.body.data.overallScore).toBeNull();
    expect(skipped.body.data.answers).toHaveLength(0);

    const invitation = await SurveyInvitation.findOne({ serviceRequest: requestId });
    expect(invitation?.closedAt).not.toBeNull();

    const pending = await request(app)
      .get(`${API}/surveys/pending`)
      .set('Authorization', `Bearer ${portal}`);
    expect(pending.body.data).toHaveLength(0);

    const results = await request(app)
      .get(`${API}/surveys/results`)
      .set('Authorization', `Bearer ${admin}`);
    expect(results.status).toBe(200);
    expect(results.body.data.totalResponses).toBe(2);
    expect(results.body.data.skippedCount).toBe(1);
    // The average is 4, not 2 — the skip contributes nothing to it.
    expect(results.body.data.averageScore).toBe(4);
    expect(results.body.data.ratedEmployeeCount).toBe(1);

    const skippedRow = results.body.data.employees.find(
      (row: { employee: { id: string } }) => row.employee.id === String(employeeB),
    );
    expect(skippedRow.skippedCount).toBe(1);
    expect(skippedRow.scoredCount).toBe(0);
    // Never 0: nobody has scored this person, so they have no average at all.
    expect(skippedRow.averageScore).toBeNull();
  });

  it('refuses a body that both skips and answers', async () => {
    const refused = await submit({
      employeeId: String(employeeA),
      skipped: true,
      answers: [{ questionId, ratingValue: 5 }],
    });
    expect(refused.status).toBe(400);
  });

  /**
   * Another tenant's request is NOT FOUND, never FORBIDDEN. A 403 would confirm the id is
   * real and turn this endpoint into an oracle for probing other organisations' requests.
   */
  it('answers 404, not 403, for another tenant', async () => {
    const other = await Customer.create({ code: 'OT', name: 'Өөр ХХК' });
    const otherBuilding = await ObjectNode.create({
      kind: 'BUILDING',
      code: 'OB-1',
      name: 'Өөр барилга',
      parent: null,
      customer: other._id,
      ancestors: [],
    });
    const intruder = await customerToken('intruder@test.mn', String(other._id));

    const form = await request(app)
      .get(`${API}/surveys/requests/${requestId}/form`)
      .set('Authorization', `Bearer ${intruder}`);
    expect(form.status).toBe(404);

    const posted = await submit(
      { employeeId: String(employeeA), answers: [{ questionId, ratingValue: 1 }] },
      intruder,
    );
    expect(posted.status).toBe(404);
    expect(await SurveyResponse.countDocuments({})).toBe(0);

    const pending = await request(app)
      .get(`${API}/surveys/pending`)
      .set('Authorization', `Bearer ${intruder}`);
    expect(pending.body.data).toHaveLength(0);
    expect(String(otherBuilding.customer)).toBe(String(other._id));
  });
});

/* ------------------------------------------------------------------- results */

describe('Survey results', () => {
  it('refuses the results to a customer', async () => {
    const portal = await customerToken('customer-results@test.mn', fixture.customerId);

    expect(
      (await request(app).get(`${API}/surveys/results`).set('Authorization', `Bearer ${portal}`))
        .status,
    ).toBe(403);
    expect(
      (await request(app).get(`${API}/surveys/responses`).set('Authorization', `Bearer ${portal}`))
        .status,
    ).toBe(403);
  });

  it('always returns five distribution buckets, even with no data at all', async () => {
    const results = await request(app)
      .get(`${API}/surveys/results`)
      .set('Authorization', `Bearer ${admin}`);

    expect(results.status).toBe(200);
    expect(results.body.data.distribution.map((b: { score: number }) => b.score)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(results.body.data.distribution.every((b: { count: number }) => b.count === 0)).toBe(
      true,
    );
    // No responses means no average — not zero.
    expect(results.body.data.averageScore).toBeNull();
  });

  it('narrows independently by employee, by request and by date', async () => {
    const questionId = await seedOverallQuestion();
    const employeeA = await seedEmployee();
    const employeeB = await seedEmployee();
    const portal = await customerToken('filters@test.mn', fixture.customerId);

    const first = await seedRequest({ assignedEmployees: [employeeA, employeeB] });
    await approveConclusion(first.id);
    const second = await seedRequest({ assignedEmployees: [employeeA] });
    await approveConclusion(second.id);

    const answer = async (requestId: string, employee: Types.ObjectId, rating: number) => {
      const response = await request(app)
        .post(`${API}/surveys/requests/${requestId}/responses`)
        .set('Authorization', `Bearer ${portal}`)
        .send({ employeeId: String(employee), answers: [{ questionId, ratingValue: rating }] });
      expect(response.status).toBe(201);
    };

    await answer(first.id, employeeA, 5);
    await answer(first.id, employeeB, 1);
    await answer(second.id, employeeA, 3);

    const results = (query: string) =>
      request(app).get(`${API}/surveys/results${query}`).set('Authorization', `Bearer ${admin}`);

    const all = await results('');
    expect(all.body.data.totalResponses).toBe(3);
    expect(all.body.data.averageScore).toBe(3);
    expect(all.body.data.ratedRequestCount).toBe(2);
    expect(all.body.data.ratedEmployeeCount).toBe(2);

    const byEmployee = await results(`?employeeId=${String(employeeA)}`);
    expect(byEmployee.body.data.totalResponses).toBe(2);
    expect(byEmployee.body.data.averageScore).toBe(4);

    const byRequest = await results(`?serviceRequestId=${first.id}`);
    expect(byRequest.body.data.totalResponses).toBe(2);
    expect(byRequest.body.data.averageScore).toBe(3);

    const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
    const byFuture = await results(`?dateFrom=${tomorrow}`);
    expect(byFuture.body.data.totalResponses).toBe(0);
    expect(byFuture.body.data.averageScore).toBeNull();

    const today = new Date().toISOString().slice(0, 10);
    // A date-only upper bound means the WHOLE of that day, not midnight.
    const byToday = await results(`?dateTo=${today}`);
    expect(byToday.body.data.totalResponses).toBe(3);

    const listed = await request(app)
      .get(`${API}/surveys/responses?employeeId=${String(employeeB)}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.total).toBe(1);
    expect(listed.body.data.items[0].employee.id).toBe(String(employeeB));
    expect(listed.body.data.items[0].requestNumber).toBe(first.number);
  });

  it('heads the breakdown with the CURRENT wording while answers keep their own', async () => {
    const questionId = await seedOverallQuestion();
    const employeeId = await seedEmployee();
    const portal = await customerToken('wording@test.mn', fixture.customerId);
    const { id: requestId } = await seedRequest({ assignedEmployees: [employeeId] });
    await approveConclusion(requestId);

    await request(app)
      .post(`${API}/surveys/requests/${requestId}/responses`)
      .set('Authorization', `Bearer ${portal}`)
      .send({ employeeId: String(employeeId), answers: [{ questionId, ratingValue: 4 }] });

    await request(app)
      .patch(`${API}/surveys/questions/${questionId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ text: 'Шинэчилсэн асуулт' });

    const results = await request(app)
      .get(`${API}/surveys/results`)
      .set('Authorization', `Bearer ${admin}`);
    expect(results.body.data.questions[0].questionText).toBe('Шинэчилсэн асуулт');
    expect(results.body.data.questions[0].averageRating).toBe(4);

    const listed = await request(app)
      .get(`${API}/surveys/responses`)
      .set('Authorization', `Bearer ${admin}`);
    // The answer still says what the customer was actually asked.
    expect(listed.body.data.items[0].answers[0].questionText).toBe(
      'Үйлчилгээг ерөнхийд нь үнэлнэ үү',
    );
  });

  it('refuses to delete a question that has been answered', async () => {
    const questionId = await seedOverallQuestion();
    const employeeId = await seedEmployee();
    const portal = await customerToken('answered@test.mn', fixture.customerId);
    const { id: requestId } = await seedRequest({ assignedEmployees: [employeeId] });
    await approveConclusion(requestId);

    await request(app)
      .post(`${API}/surveys/requests/${requestId}/responses`)
      .set('Authorization', `Bearer ${portal}`)
      .send({ employeeId: String(employeeId), answers: [{ questionId, ratingValue: 2 }] });

    const refused = await request(app)
      .delete(`${API}/surveys/questions/${questionId}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('Идэвхгүй болгоно уу');

    const listed = await request(app)
      .get(`${API}/surveys/questions`)
      .set('Authorization', `Bearer ${admin}`);
    expect(listed.body.data[0].hasAnswers).toBe(true);
  });
});

/* ------------------------------------------------------------------ reminder */

describe('Survey reminder', () => {
  async function seedInvitation(overrides: Record<string, unknown> = {}): Promise<void> {
    const issuedAt = new Date(Date.now() - SURVEY_REMINDER_AFTER_MS - 60_000);
    await SurveyInvitation.create({
      serviceRequest: new Types.ObjectId(),
      customer: new Types.ObjectId(fixture.customerId),
      requestNumber: 'SR-202608-9001',
      buildingName: 'Төв барилга',
      employees: [new Types.ObjectId()],
      issuedAt,
      completedAt: issuedAt,
      reminderSentFor: null,
      closedAt: null,
      ...overrides,
    });
  }

  function reminderCount(): Promise<number> {
    return Notification.countDocuments({ event: 'SURVEY_REMINDER' });
  }

  beforeEach(async () => {
    // Somebody has to hold a portal account for the organisation, or the notification has
    // no recipient and the sweep is a silent no-op.
    await customerToken('reminded@test.mn', fixture.customerId);
  });

  it('fires once at three days and never again', async () => {
    await seedInvitation();

    const first = await runReminderSweep();
    expect(first.surveyReminder).toBe(1);
    expect(await reminderCount()).toBe(1);

    const second = await runReminderSweep();
    expect(second.surveyReminder).toBe(0);
    expect(await reminderCount()).toBe(1);
  });

  it('stays silent before three days have passed', async () => {
    await seedInvitation({ issuedAt: new Date(Date.now() - DAY) });

    expect((await runReminderSweep()).surveyReminder).toBe(0);
    expect(await reminderCount()).toBe(0);
  });

  it('stays silent once the survey has been answered', async () => {
    await seedInvitation({ closedAt: new Date() });

    expect((await runReminderSweep()).surveyReminder).toBe(0);
    expect(await reminderCount()).toBe(0);
  });
});
