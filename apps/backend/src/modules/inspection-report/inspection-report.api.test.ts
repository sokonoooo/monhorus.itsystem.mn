import { PERMISSIONS, SETTING_KEYS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createObjectFixture,
  createOrgFixture,
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
  type OrgFixture,
} from '../../test/helpers';
import { AuditLog } from '../audit/audit-log.model';
import { Employee } from '../employee/employee.model';
import { ObjectNode } from '../objects/object.models';
import { PlannedWorkTask } from '../planned-work/planned-work.models';
import { InspectionReport } from './inspection-report.model';

/**
 * Consolidated inspection report, requirements 7-11.
 *
 * Exercised through HTTP because the rules that matter live across the route guard, the
 * service and the derived DTO: readiness, the зөрчил derivation, the worst-wins verdict,
 * the auto-draft flag and the review chain.
 */

const API = '/api/v1';

/** The performer/author side: runs the work and authors the report, cannot review it. */
const AUTHOR_PERMISSIONS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS,
  PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
] as const;

/** The administrator side: reviews the report, cannot author it. */
const REVIEWER_PERMISSIONS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
] as const;

/** Read-only: may look at the report and its readiness and nothing else. */
const VIEWER_PERMISSIONS = [PERMISSIONS.PLANNED_WORK_VIEW] as const;

let app: Express;
let objects: ObjectFixture;
let org: OrgFixture;
let authorId: string;
let authorToken: string;
let reviewerToken: string;
let secondFloorId: string;

/**
 * The read-only caller is created on demand.
 *
 * Logins are rate limited per process, so a third fixture user in every `beforeEach`
 * would exhaust the window long before the suite finished.
 */
async function viewerLogin(): Promise<string> {
  const viewer = await createUserWithPermissions('irviewer@test.mn', VIEWER_PERMISSIONS);
  return login(viewer.email, viewer.password);
}

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function createWork(body: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${authorToken}`)
    .send({
      projectId: objects.projectId,
      buildingId: objects.buildingId,
      title: 'Улирлын цахилгааны үзлэг',
      plannedStartDate: '2026-07-01T00:00:00.000Z',
      plannedEndDate: '2099-07-31T00:00:00.000Z',
      assignedEmployeeIds: [],
      ...body,
    });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

interface TaskOptions {
  title?: string;
  floorId?: string | null;
  totalQuantity?: number;
}

async function addTask(workId: string, options: TaskOptions = {}): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work/${workId}/tasks`)
    .set('Authorization', `Bearer ${authorToken}`)
    .send({
      floorId: options.floorId === undefined ? objects.floorId : options.floorId,
      title: options.title ?? 'Самбарын үзлэг',
      unit: 'PIECE',
      totalQuantity: options.totalQuantity ?? 10,
      plannedStartDate: '2026-07-05T00:00:00.000Z',
      plannedEndDate: '2099-07-20T00:00:00.000Z',
    });
  expect(response.status).toBe(201);
  const tasks = response.body.data.tasks as { id: string; title: string }[];
  return tasks.find((task) => task.title === (options.title ?? 'Самбарын үзлэг'))!.id;
}

async function transition(workId: string, action: string): Promise<request.Response> {
  return request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${authorToken}`)
    .send({ action });
}

interface CompletionOptions {
  score: number;
  note?: string;
  recommendation?: string;
  quantity?: number;
}

async function completeTask(
  workId: string,
  taskId: string,
  options: CompletionOptions,
): Promise<void> {
  for (const kind of ['BEFORE', 'AFTER']) {
    const uploaded = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/photos`)
      .set('Authorization', `Bearer ${authorToken}`)
      .field('kind', kind)
      .attach('file', Buffer.from('image-bytes'), {
        filename: `${kind.toLowerCase()}.png`,
        contentType: 'image/png',
      });
    expect(uploaded.status).toBe(201);
  }

  const progress = await request(app)
    .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
    .set('Authorization', `Bearer ${authorToken}`)
    .send({
      completedQuantity: options.quantity ?? 10,
      note: options.note ?? 'Холболт хэвийн.',
      recommendation: options.recommendation ?? 'Хагас жил тутам үзэх.',
      score: options.score,
    });
  expect(progress.status).toBe(200);
}

/** A started work whose single sub-task is finished with the given score. */
async function scoredWork(score = 88): Promise<string> {
  const workId = await createWork();
  const taskId = await addTask(workId);
  expect((await transition(workId, 'PLAN')).status).toBe(200);
  expect((await transition(workId, 'START')).status).toBe(200);
  await completeTask(workId, taskId, { score });
  return workId;
}

function reportUrl(workId: string, suffix = ''): string {
  return `${API}/planned-work/${workId}/inspection-report${suffix}`;
}

async function generate(workId: string, token = authorToken): Promise<request.Response> {
  return request(app).post(reportUrl(workId)).set('Authorization', `Bearer ${token}`);
}

async function fetchReport(workId: string, token = authorToken): Promise<request.Response> {
  return request(app).get(reportUrl(workId)).set('Authorization', `Bearer ${token}`);
}

async function readiness(workId: string, token = authorToken): Promise<request.Response> {
  return request(app).get(reportUrl(workId, '/readiness')).set('Authorization', `Bearer ${token}`);
}

async function act(
  workId: string,
  suffix: string,
  token: string,
  body: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(app)
    .post(reportUrl(workId, suffix))
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

/** A generated report sitting in DRAFT. */
async function generatedWork(score = 88): Promise<string> {
  const workId = await scoredWork(score);
  expect((await generate(workId)).status).toBe(201);
  return workId;
}

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  org = await createOrgFixture();
  objects = await createObjectFixture();

  const second = await ObjectNode.create({
    kind: 'FLOOR',
    code: 'FL-2ND',
    name: '2 давхар',
    parent: objects.buildingId,
    customer: objects.customerId,
    ancestors: [objects.projectId, objects.buildingId],
  });
  secondFloorId = String(second._id);

  const author = await createUserWithPermissions('irauthor@test.mn', AUTHOR_PERMISSIONS);
  authorId = author.userId;
  authorToken = await login(author.email, author.password);

  const reviewer = await createUserWithPermissions('irreviewer@test.mn', REVIEWER_PERMISSIONS);
  reviewerToken = await login(reviewer.email, reviewer.password);
});

describe('readiness', () => {
  it('reports NO_TASKS for a work with no sub-tasks', async () => {
    const workId = await createWork();

    const response = await readiness(workId);

    expect(response.status).toBe(200);
    expect(response.body.data.canGenerate).toBe(false);
    expect(response.body.data.blockers).toEqual(['NO_TASKS']);
    expect(response.body.data.existingReportId).toBeNull();
  });

  it('names the outstanding sub-tasks while one is unfinished', async () => {
    const workId = await createWork();
    await addTask(workId, { title: 'Дууссан ажил' });
    await addTask(workId, { title: 'Дуусаагүй ажил' });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');

    const response = await readiness(workId);

    expect(response.body.data.canGenerate).toBe(false);
    expect(response.body.data.blockers).toEqual(['TASKS_INCOMPLETE']);
    expect(response.body.data.outstandingTaskTitles).toEqual(
      expect.arrayContaining(['Дууссан ажил', 'Дуусаагүй ажил']),
    );
  });

  it('clears every blocker once all non-skipped sub-tasks are finished', async () => {
    const workId = await scoredWork();

    const response = await readiness(workId);

    expect(response.body.data.canGenerate).toBe(true);
    expect(response.body.data.blockers).toEqual([]);
    expect(response.body.data.outstandingTaskTitles).toEqual([]);
  });

  it('exempts a skipped sub-task, because skipping is the only exemption', async () => {
    const workId = await createWork();
    const done = await addTask(workId, { title: 'Хийсэн' });
    const skipped = await addTask(workId, { title: 'Хийхгүй' });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, done, { score: 90 });

    const skip = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${skipped}/progress`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ completedQuantity: 0, skipped: true });
    expect(skip.status).toBe(200);

    const response = await readiness(workId);
    expect(response.body.data.canGenerate).toBe(true);
  });

  it('reports SCORES_MISSING for a grandfathered sub-task without withholding the report', async () => {
    const workId = await scoredWork();
    // A sub-task that reached DONE before the үнэлгээ was required.
    await PlannedWorkTask.updateOne(
      { plannedWork: workId },
      { $set: { score: null, riskLevel: null } },
    );

    const response = await readiness(workId);

    expect(response.body.data.blockers).toEqual(['SCORES_MISSING']);
    expect(response.body.data.canGenerate).toBe(true);
    expect((await generate(workId)).status).toBe(201);
  });

  it('reports the existing report id once one is generated', async () => {
    const workId = await generatedWork();

    const response = await readiness(workId);
    expect(response.body.data.existingReportId).not.toBeNull();
  });
});

describe('generation', () => {
  it('returns 404 while no report exists', async () => {
    const workId = await scoredWork();

    const response = await fetchReport(workId);

    expect(response.status).toBe(404);
  });

  it('refuses generation while a sub-task is unfinished and names it', async () => {
    const workId = await createWork();
    await addTask(workId, { title: 'Дуусаагүй ажил' });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');

    const response = await generate(workId);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('Дуусаагүй ажил');
  });

  it('refuses generation for a work with no sub-tasks', async () => {
    const workId = await createWork();

    const response = await generate(workId);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('Дэд ажил бүртгэгдээгүй');
  });

  it('carries the heading, and reads the contractor from Тохиргоо rather than a literal', async () => {
    const admin = await createSuperUser('irsettings@test.mn');
    const adminToken = await login(admin.email, admin.password);
    const changed = await request(app)
      .patch(`${API}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ settings: { [SETTING_KEYS.COMPANY_NAME]: 'Гүйцэтгэгч ХХК' } });
    expect(changed.status).toBe(200);

    await ObjectNode.updateOne(
      { _id: objects.buildingId },
      { $set: { 'attributes.address': 'СБД, 1-р хороо' } },
    );

    const employee = await Employee.create({
      employeeCode: 'EMP-IR-1',
      firstName: 'Бат',
      lastName: 'Дорж',
      company: org.companyId,
      department: org.departmentId,
      position: org.positionId,
      systemUser: authorId,
      status: 'ACTIVE',
    });

    const workId = await createWork({
      assignedEmployeeIds: [String(employee._id)],
      assignedTeamId: org.teamId,
    });
    const taskId = await addTask(workId);
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, taskId, { score: 90 });
    expect((await generate(workId)).status).toBe(201);

    const report = (await fetchReport(workId)).body.data;

    expect(report.workNumber).toMatch(/^PW-/);
    expect(report.workTitle).toBe('Улирлын цахилгааны үзлэг');
    expect(report.customerName).toBe('Central Tower ХХК');
    expect(report.projectName).toBe('Урьдчилан сэргийлэх үйлчилгээ');
    expect(report.buildingName).toBe('Төв барилга');
    expect(report.locationLabel).toBe('СБД, 1-р хороо');
    expect(report.inspectionStart).not.toBeNull();
    expect(report.responsibleEmployeeNames).toEqual(['Дорж Бат']);
    expect(report.responsibleTeamNames).toEqual(['Баг 1']);
    expect(report.contractorName).toBe('Гүйцэтгэгч ХХК');
    expect(report.actName).toBe('Цахилгааны үзлэг');
    // Requirement 11: the signature block carries the position from the Employee record.
    expect(report.createdByName).not.toBeNull();
    expect(report.createdByPosition).toBe('Цахилгааны инженер');
    expect(report.approvedByName).toBeNull();
    expect(report.approvedByPosition).toBeNull();
    expect(report.version).toBe(1);
    expect(report.status).toBe('DRAFT');
  });

  it('groups the sub-task sections by floor', async () => {
    const workId = await createWork();
    const first = await addTask(workId, { title: 'Нэгдүгээр давхрын самбар' });
    const second = await addTask(workId, { title: 'Хоёрдугаар давхрын самбар', floorId: secondFloorId });
    const nowhere = await addTask(workId, { title: 'Давхаргүй ажил', floorId: null });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, first, { score: 90 });
    await completeTask(workId, second, { score: 85 });
    await completeTask(workId, nowhere, { score: 95 });
    expect((await generate(workId)).status).toBe(201);

    const report = (await fetchReport(workId)).body.data;
    const groups = report.groups as { floorId: string | null; floorName: string; tasks: unknown[] }[];

    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.floorName)).toEqual(
      expect.arrayContaining(['1 давхар', '2 давхар', 'Давхар заагаагүй']),
    );
    const unassigned = groups.find((group) => group.floorId === null);
    expect(unassigned?.tasks).toHaveLength(1);
  });

  it('carries the sub-task detail and both photo stages', async () => {
    const workId = await generatedWork(72);

    const report = (await fetchReport(workId)).body.data;
    const task = report.groups[0].tasks[0];

    expect(task.title).toBe('Самбарын үзлэг');
    expect(task.floorName).toBe('1 давхар');
    expect(task.status).toBe('DONE');
    expect(task.statusLabel).toBe('Дууссан');
    expect(task.skipped).toBe(false);
    expect(task.score).toBe(72);
    expect(task.riskLevel).toBe('ATTENTION');
    expect(task.note).toBe('Холболт хэвийн.');
    expect(task.recommendation).toBe('Хагас жил тутам үзэх.');
    expect(task.totalQuantity).toBe(10);
    expect(task.completedQuantity).toBe(10);
    expect(task.completedAt).not.toBeNull();
    expect(task.attachments.map((file: { stage: string }) => file.stage)).toEqual([
      'BEFORE',
      'AFTER',
    ]);
    expect(task.attachments[0].downloadUrl).toMatch(/^\/api\/v1\/files\//);
  });
});

describe('findings and the overall safety level', () => {
  it('derives a зөрчил from any band worse than Хэвийн and leaves Хэвийн alone', async () => {
    const workId = await createWork();
    const healthy = await addTask(workId, { title: 'Хэвийн самбар' });
    const faulty = await addTask(workId, { title: 'Гэмтэлтэй самбар', floorId: secondFloorId });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, healthy, { score: 95 });
    await completeTask(workId, faulty, {
      score: 30,
      note: 'Тусгаарлагч муудсан.',
      recommendation: 'Самбарыг солих.',
    });
    expect((await generate(workId)).status).toBe(201);

    const report = (await fetchReport(workId)).body.data;

    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].title).toBe('Гэмтэлтэй самбар');
    expect(report.issues[0].riskLevel).toBe('CRITICAL');
    expect(report.issues[0].locationLabel).toBe('2 давхар');
    // The зөрчил carries the performer's own Тайлбар and Зөвлөмж, never a new field.
    expect(report.issues[0].condition).toBe('Тусгаарлагч муудсан.');
    expect(report.issues[0].advice).toBe('Самбарыг солих.');
  });

  it('takes the worst band as the overall level rather than an average', async () => {
    const workId = await createWork();
    const good = await addTask(workId, { title: 'Сайн' });
    const middling = await addTask(workId, { title: 'Дунд', floorId: secondFloorId });
    const bad = await addTask(workId, { title: 'Муу', floorId: null });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, good, { score: 95 });
    await completeTask(workId, middling, { score: 50 });
    await completeTask(workId, bad, { score: 10 });
    expect((await generate(workId)).status).toBe(201);

    const report = (await fetchReport(workId)).body.data;

    // Mean of 95, 50 and 10 is 51.6, which would read as SCHEDULE_REPAIR. Worst wins.
    expect(report.overallLevel).toBe('OUT_OF_SERVICE');
    expect(report.overallLabel).toBe('Ашиглах боломжгүй');
    expect(report.issues).toHaveLength(2);
    expect(report.issues[0].riskLevel).toBe('OUT_OF_SERVICE');
  });

  it('reports no overall level when nothing was scored', async () => {
    const workId = await createWork();
    const skipped = await addTask(workId, { title: 'Хийгдээгүй' });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    const skip = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${skipped}/progress`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ completedQuantity: 0, skipped: true });
    expect(skip.status).toBe(200);
    expect((await generate(workId)).status).toBe(201);

    const report = (await fetchReport(workId)).body.data;

    expect(report.overallLevel).toBeNull();
    expect(report.overallLabel).toBeNull();
    expect(report.issues).toEqual([]);
  });

  it('recomputes the overall level from the sub-tasks rather than storing it', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId);
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, taskId, { score: 95 });
    expect((await generate(workId)).status).toBe(201);
    expect((await fetchReport(workId)).body.data.overallLevel).toBe('NORMAL');

    // Re-scoring the sub-task must move the report without regenerating it.
    const rescored = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ completedQuantity: 10, score: 15 });
    expect(rescored.status).toBe(200);

    const report = (await fetchReport(workId)).body.data;
    expect(report.overallLevel).toBe('OUT_OF_SERVICE');
    expect(report.issues).toHaveLength(1);
  });
});

describe('auto-composed draft', () => {
  it('composes the narrative and seeds the replacement lists from the worst findings', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId, { title: 'Гол самбар' });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, taskId, {
      score: 25,
      note: 'Автомат таслуур ажиллахгүй.',
      recommendation: 'Автомат таслуурыг солих.',
    });
    expect((await generate(workId)).status).toBe(201);

    const report = (await fetchReport(workId)).body.data;

    expect(report.isAutoDraft).toBe(true);
    expect(report.issueSummary).toContain('Гол самбар');
    expect(report.issueSummary).toContain('Автомат таслуур ажиллахгүй.');
    expect(report.conclusion).toContain('Ноцтой эрсдэлтэй');
    expect(report.recommendation).toContain('Автомат таслуурыг солих.');
    expect(report.replacementPanels).toEqual(['1 давхар - Гол самбар']);
    expect(report.replacementConnections).toEqual(['1 давхар - Гол самбар']);
  });

  it('clears isAutoDraft the moment an administrator edits the text', async () => {
    const workId = await generatedWork();

    const edited = await request(app)
      .patch(reportUrl(workId))
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ conclusion: 'Гараар бичсэн дүгнэлт.' });

    expect(edited.status).toBe(200);
    expect(edited.body.data.isAutoDraft).toBe(false);
    expect(edited.body.data.conclusion).toBe('Гараар бичсэн дүгнэлт.');
  });

  it('never overwrites an administrator text when the report is regenerated', async () => {
    const workId = await generatedWork();
    await request(app)
      .patch(reportUrl(workId))
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        conclusion: 'Гараар бичсэн дүгнэлт.',
        recommendation: 'Гараар бичсэн зөвлөмж.',
        replacementPanels: ['Гараар бичсэн самбар'],
      });

    const regenerated = await generate(workId);

    expect(regenerated.status).toBe(201);
    expect(regenerated.body.data.isAutoDraft).toBe(false);
    expect(regenerated.body.data.conclusion).toBe('Гараар бичсэн дүгнэлт.');
    expect(regenerated.body.data.recommendation).toBe('Гараар бичсэн зөвлөмж.');
    expect(regenerated.body.data.replacementPanels).toEqual(['Гараар бичсэн самбар']);
  });

  it('refreshes the composed text while the report is still an auto draft', async () => {
    const workId = await generatedWork(95);
    expect((await fetchReport(workId)).body.data.conclusion).toContain('Аюулгүй');

    const task = await PlannedWorkTask.findOne({ plannedWork: workId });
    const rescored = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${String(task?._id)}/progress`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ completedQuantity: 10, score: 30 });
    expect(rescored.status).toBe(200);

    const regenerated = await generate(workId);
    expect(regenerated.body.data.isAutoDraft).toBe(true);
    expect(regenerated.body.data.conclusion).toContain('Ноцтой эрсдэлтэй');
  });

  it('keeps one report per planned work however often it is generated', async () => {
    const workId = await generatedWork();
    expect((await generate(workId)).status).toBe(201);
    expect((await generate(workId)).status).toBe(201);

    expect(await InspectionReport.countDocuments({ plannedWork: workId })).toBe(1);
  });
});

describe('review workflow', () => {
  it('walks DRAFT to SUBMITTED to APPROVED to FINALISED', async () => {
    const workId = await generatedWork();

    const submitted = await act(workId, '/submit', authorToken);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe('SUBMITTED');
    expect(submitted.body.data.submittedByName).not.toBeNull();

    const approved = await act(workId, '/approve', reviewerToken, { note: 'Хянаж баталлаа.' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');
    expect(approved.body.data.approvedByName).not.toBeNull();
    expect(approved.body.data.approvedAt).not.toBeNull();

    const finalised = await act(workId, '/finalise', reviewerToken, {});
    expect(finalised.status).toBe(200);
    expect(finalised.body.data.status).toBe('FINALISED');
    expect(finalised.body.data.finalisedByName).not.toBeNull();
  });

  it('refuses every transition the matrix does not permit', async () => {
    const workId = await generatedWork();

    // From DRAFT only SUBMITTED is reachable.
    expect((await act(workId, '/approve', reviewerToken, {})).status).toBe(400);
    expect((await act(workId, '/finalise', reviewerToken, {})).status).toBe(400);
    expect((await act(workId, '/return', reviewerToken, { reason: 'Болохгүй' })).status).toBe(400);
    expect((await act(workId, '/reopen', reviewerToken)).status).toBe(400);

    await act(workId, '/submit', authorToken);
    // A submitted report cannot be submitted again, nor finalised without approval.
    expect((await act(workId, '/submit', authorToken)).status).toBe(400);
    expect((await act(workId, '/finalise', reviewerToken, {})).status).toBe(400);

    await act(workId, '/approve', reviewerToken, {});
    expect((await act(workId, '/approve', reviewerToken, {})).status).toBe(400);
    expect((await act(workId, '/submit', authorToken)).status).toBe(400);

    await act(workId, '/finalise', reviewerToken, {});
    // FINALISED is terminal for its version: nothing but a reopen leaves it.
    expect((await act(workId, '/submit', authorToken)).status).toBe(400);
    expect((await act(workId, '/approve', reviewerToken, {})).status).toBe(400);
    expect((await act(workId, '/return', reviewerToken, { reason: 'Дахин хянах' })).status).toBe(400);
  });

  it('refuses to edit a report in a locked state', async () => {
    const workId = await generatedWork();
    await act(workId, '/submit', authorToken);

    const edited = await request(app)
      .patch(reportUrl(workId))
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ conclusion: 'Илгээсний дараа засах' });

    expect(edited.status).toBe(400);
    expect(edited.body.message).toContain('засах боломжгүй');
  });

  it('refuses to regenerate a report in a locked state', async () => {
    const workId = await generatedWork();
    await act(workId, '/submit', authorToken);

    expect((await generate(workId)).status).toBe(400);
  });

  it('requires a reason to return the report', async () => {
    const workId = await generatedWork();
    await act(workId, '/submit', authorToken);

    const noReason = await act(workId, '/return', reviewerToken, {});
    expect(noReason.status).toBe(400);

    const blank = await act(workId, '/return', reviewerToken, { reason: '   ' });
    expect(blank.status).toBe(400);
  });

  it('returns the report for correction and allows a resubmission', async () => {
    const workId = await generatedWork();
    await act(workId, '/submit', authorToken);

    const returned = await act(workId, '/return', reviewerToken, {
      reason: 'Дүгнэлт хэт ерөнхий байна.',
    });
    expect(returned.status).toBe(200);
    expect(returned.body.data.status).toBe('RETURNED');
    expect(returned.body.data.returnReason).toBe('Дүгнэлт хэт ерөнхий байна.');
    expect(returned.body.data.returnedByName).not.toBeNull();

    // A returned report is editable again.
    const edited = await request(app)
      .patch(reportUrl(workId))
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ conclusion: 'Дэлгэрэнгүй дүгнэлт.' });
    expect(edited.status).toBe(200);

    const resubmitted = await act(workId, '/submit', authorToken);
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.data.status).toBe('SUBMITTED');
    expect(resubmitted.body.data.returnReason).toBeNull();
  });

  it('returns an approved report as well, because the matrix allows it', async () => {
    const workId = await generatedWork();
    await act(workId, '/submit', authorToken);
    await act(workId, '/approve', reviewerToken, {});

    const returned = await act(workId, '/return', reviewerToken, { reason: 'Дахин үзэх.' });
    expect(returned.status).toBe(200);
    expect(returned.body.data.status).toBe('RETURNED');
  });

  it('bumps the version and returns to DRAFT when a finalised report is reopened', async () => {
    const workId = await generatedWork();
    await act(workId, '/submit', authorToken);
    await act(workId, '/approve', reviewerToken, {});
    await act(workId, '/finalise', reviewerToken, {});

    const reopened = await act(workId, '/reopen', reviewerToken);

    expect(reopened.status).toBe(200);
    expect(reopened.body.data.status).toBe('DRAFT');
    expect(reopened.body.data.version).toBe(2);
    // The stamps belong to the version that closed; the new one starts unreviewed.
    expect(reopened.body.data.approvedByName).toBeNull();
    expect(reopened.body.data.finalisedAt).toBeNull();
    // No previous copy is archived: there is still exactly one document.
    expect(await InspectionReport.countDocuments({ plannedWork: workId })).toBe(1);
  });
});

describe('permissions', () => {
  it('lets planned_work.view read the report and its readiness', async () => {
    const workId = await generatedWork();
    const viewerToken = await viewerLogin();

    expect((await fetchReport(workId, viewerToken)).status).toBe(200);
    expect((await readiness(workId, viewerToken)).status).toBe(200);
  });

  it('refuses authoring without planned_work.submit_report', async () => {
    const workId = await scoredWork();
    const viewerToken = await viewerLogin();

    expect((await generate(workId, viewerToken)).status).toBe(403);
    expect((await generate(workId, reviewerToken)).status).toBe(403);

    expect((await generate(workId)).status).toBe(201);

    const patched = await request(app)
      .patch(reportUrl(workId))
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ conclusion: 'Эрхгүй засвар' });
    expect(patched.status).toBe(403);

    expect((await act(workId, '/submit', reviewerToken)).status).toBe(403);
  });

  it('refuses reviewing without planned_work.approve_report', async () => {
    const workId = await generatedWork();
    await act(workId, '/submit', authorToken);

    expect((await act(workId, '/approve', authorToken, {})).status).toBe(403);
    expect((await act(workId, '/return', authorToken, { reason: 'Өөрөө буцаах' })).status).toBe(403);
    expect((await act(workId, '/finalise', authorToken, {})).status).toBe(403);
    expect((await act(workId, '/reopen', authorToken)).status).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    const workId = await generatedWork();

    expect((await request(app).get(reportUrl(workId))).status).toBe(401);
    expect((await request(app).post(reportUrl(workId))).status).toBe(401);
  });
});

describe('audit trail', () => {
  it('records every action with the old and the new value', async () => {
    const workId = await generatedWork();

    const generated = await AuditLog.find({
      entityType: 'InspectionReport',
      action: 'INSPECTION_REPORT_GENERATED',
    });
    expect(generated).toHaveLength(1);
    expect((generated[0]?.newValue as { status: string }).status).toBe('DRAFT');

    await request(app)
      .patch(reportUrl(workId))
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ conclusion: 'Гараар бичсэн дүгнэлт.' });

    const updated = await AuditLog.find({ action: 'INSPECTION_REPORT_UPDATED' });
    expect(updated).toHaveLength(1);
    const before = updated[0]?.oldValue as { conclusion: string; isAutoDraft: boolean };
    const after = updated[0]?.newValue as { conclusion: string; isAutoDraft: boolean };
    expect(before.conclusion).not.toBe('Гараар бичсэн дүгнэлт.');
    expect(after.conclusion).toBe('Гараар бичсэн дүгнэлт.');
    expect(before.isAutoDraft).toBe(true);
    expect(after.isAutoDraft).toBe(false);

    await act(workId, '/submit', authorToken);
    await act(workId, '/approve', reviewerToken, { note: 'Тайлан бүрэн.' });
    await act(workId, '/return', reviewerToken, { reason: 'Дахин нягтлах.' });
    await act(workId, '/submit', authorToken);
    await act(workId, '/approve', reviewerToken, {});
    await act(workId, '/finalise', reviewerToken, {});
    await act(workId, '/reopen', reviewerToken);

    for (const action of [
      'INSPECTION_REPORT_SUBMITTED',
      'INSPECTION_REPORT_APPROVED',
      'INSPECTION_REPORT_RETURNED',
      'INSPECTION_REPORT_FINALISED',
      'INSPECTION_REPORT_REOPENED',
    ] as const) {
      const rows = await AuditLog.find({ action });
      expect(rows.length).toBeGreaterThan(0);
      const row = rows[rows.length - 1];
      expect(row?.oldValue).not.toBeNull();
      expect(row?.newValue).not.toBeNull();
    }

    // The return above was issued from APPROVED, and the row carries both ends of it.
    const returned = await AuditLog.findOne({ action: 'INSPECTION_REPORT_RETURNED' });
    expect(returned?.reason).toBe('Дахин нягтлах.');
    expect((returned?.oldValue as { status: string }).status).toBe('APPROVED');
    expect((returned?.newValue as { status: string }).status).toBe('RETURNED');

    const reopened = await AuditLog.findOne({ action: 'INSPECTION_REPORT_REOPENED' });
    expect((reopened?.oldValue as { version: number }).version).toBe(1);
    expect((reopened?.newValue as { version: number }).version).toBe(2);
  });
});
