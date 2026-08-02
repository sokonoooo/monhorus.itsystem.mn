import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createObjectFixture,
  createOrgFixture,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
  type OrgFixture,
} from '../test/helpers';
import { Employee } from '../modules/employee/employee.model';
import {
  PlannedWork,
  PlannedWorkReport,
  PlannedWorkTask,
} from '../modules/planned-work/planned-work.models';

/**
 * PLANNED WORK — WHAT A TECHNICIAN MAY NEVER DO, ASSIGNED OR NOT.
 *
 * `planned-work.assignment-scope.api.test.ts` covers the DATA SCOPE: a technician holding
 * `planned_work.change_status` may drive only the jobs they are actually on. That is one of
 * the two axes. This file covers the other: the actions that are refused by PERMISSION
 * regardless of assignment, which is the owner's case 32 and the separation of duties in
 * requirements section 9.2.
 *
 * The distinction is load-bearing. A technician who is fully, legitimately assigned to a job
 * still must not approve their own report, cancel the job, reschedule it, or edit the plan —
 * and if the assignment scope were ever relaxed, none of those refusals may relax with it.
 * So every case here uses a technician who IS assigned, which is the strongest form of the
 * claim and the one that fails if the two axes are ever collapsed into one.
 *
 * Case 33 — the supervisory actions still work — is asserted in the same file and on the
 * same records, so "the technician is refused" cannot pass because the action is broken for
 * everybody.
 */

const API = '/api/v1';

/** Exactly the planned-work half of the seeded TECHNICIAN default. */
const TECHNICIAN_KEYS: readonly PermissionKey[] = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS,
  PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
];

/** A planner: everything the technician has plus the oversight keys of a supervisor. */
const SUPERVISOR_KEYS: readonly PermissionKey[] = [
  ...TECHNICIAN_KEYS,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_RESCHEDULE,
  PERMISSIONS.PLANNED_WORK_CANCEL,
];

/** The other half of the 9.2 separation: reads and approves, never writes the report. */
const APPROVER_KEYS: readonly PermissionKey[] = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
];

let app: Express;
let org: OrgFixture;
let objects: ObjectFixture;

let supervisorToken: string;
let approverToken: string;
let technicianToken: string;
let technicianEmployeeId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status, `login failed for ${email}`).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

/**
 * An account holding `permissions`, with an employee card linked to it. The link is what
 * `AuthContext.employeeId` resolves from, so it is the only way to make a caller "an
 * employee" as far as the assignment policy is concerned.
 */
async function createStaff(
  email: string,
  code: string,
  permissions: readonly PermissionKey[],
): Promise<{ token: string; employeeId: string }> {
  const user = await createUserWithPermissions(email, [...permissions]);
  const employee = await Employee.create({
    employeeCode: code,
    firstName: 'Дорж',
    lastName: 'Бат',
    company: org.companyId,
    department: org.departmentId,
    position: org.positionId,
    team: null,
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    status: 'ACTIVE',
    systemUser: user.userId,
  });

  return {
    token: await login(user.email, user.password),
    employeeId: String(employee._id),
  };
}

function validWork(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectId: objects.projectId,
    buildingId: objects.buildingId,
    title: 'Хагас жилийн урьдчилан сэргийлэх үзлэг',
    plannedStartDate: '2026-07-01T00:00:00.000Z',
    plannedEndDate: '2026-07-31T00:00:00.000Z',
    assignedEmployeeIds: [technicianEmployeeId],
    ...overrides,
  };
}

async function transition(
  workId: string,
  action: string,
  bearer: string,
  reason?: string,
): Promise<request.Response> {
  return request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${bearer}`)
    .send({ action, ...(reason ? { reason } : {}) });
}

/** A work the technician IS assigned to, planned by the supervisor and started by them. */
async function startedWorkForTechnician(): Promise<string> {
  const created = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send(validWork());
  expect(created.status).toBe(201);
  const workId = created.body.data.id as string;

  expect((await transition(workId, 'PLAN', supervisorToken)).status).toBe(200);
  expect((await transition(workId, 'START', technicianToken)).status).toBe(200);
  return workId;
}

/**
 * A work at COMPLETED whose report is in DRAFT and was authored by the TECHNICIAN.
 *
 * The whole lifecycle is driven by the technician wherever the technician is entitled to
 * drive it, because the point of the approval cases is that a caller who legitimately did
 * all the work still may not sign it off.
 *
 * The task is added while the work is still DRAFT and its window sits inside the work's,
 * both of which the domain rules require; the far-future dates keep the work open.
 */
async function completedWorkAuthoredByTechnician(): Promise<string> {
  const created = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send(validWork({ plannedEndDate: '2099-07-31T00:00:00.000Z' }));
  expect(created.status).toBe(201);
  const workId = created.body.data.id as string;

  const taskResponse = await request(app)
    .post(`${API}/planned-work/${workId}/tasks`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send({
      floorId: objects.floorId,
      title: 'Самбарын үзлэг',
      unit: 'PIECE',
      totalQuantity: 10,
      plannedStartDate: '2026-07-05T00:00:00.000Z',
      plannedEndDate: '2099-07-20T00:00:00.000Z',
    });
  expect(taskResponse.status).toBe(201);
  const tasks = taskResponse.body.data.tasks as { id: string }[];
  const taskId = tasks[tasks.length - 1]!.id;

  expect((await transition(workId, 'PLAN', supervisorToken)).status).toBe(200);
  expect((await transition(workId, 'START', technicianToken)).status).toBe(200);

  for (const kind of ['BEFORE', 'AFTER']) {
    const photo = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/photos`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .field('kind', kind)
      .attach('file', Buffer.from('image-bytes'), {
        filename: `${kind.toLowerCase()}.png`,
        contentType: 'image/png',
      });
    expect(photo.status).toBe(201);
  }

  const progress = await request(app)
    .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
    .set('Authorization', `Bearer ${technicianToken}`)
    .send({
      completedQuantity: 10,
      note: 'Самбар хэвийн ажиллаж байна.',
      score: 88,
      recommendation: 'Дараагийн үзлэгийг хагас жилийн дараа хийх.',
    });
  expect(progress.status).toBe(200);

  expect((await transition(workId, 'COMPLETE', technicianToken)).status).toBe(200);

  const filled = await request(app)
    .patch(`${API}/planned-work/${workId}/report`)
    .set('Authorization', `Bearer ${technicianToken}`)
    .send({
      conclusion: 'Ажил төлөвлөгөөний дагуу бүрэн хийгдсэн.',
      recommendation: 'Тоног төхөөрөмжийг хагас жил тутам үзэх.',
    });
  expect(filled.status).toBe(200);

  return workId;
}

async function statusOf(workId: string): Promise<string | undefined> {
  const work = await PlannedWork.findById(workId).select('status');
  return work?.status;
}

/**
 * The cast is built ONCE. `POST /auth/login` is limited to 100 per IP per fifteen minutes
 * outside production; rebuilding three signed-in identities per test spends that budget on
 * setup and produces 429s that have nothing to do with the policy.
 */
beforeAll(async () => {
  app = await startTestApp();
  await resetDomainCollections();

  org = await createOrgFixture();
  objects = await createObjectFixture();

  const technician = await createStaff('sec-pw-tech@test.mn', 'TECH-9', TECHNICIAN_KEYS);
  technicianToken = technician.token;
  technicianEmployeeId = technician.employeeId;

  const supervisor = await createStaff('sec-pw-sup@test.mn', 'SUP-9', SUPERVISOR_KEYS);
  supervisorToken = supervisor.token;

  const approver = await createStaff('sec-pw-appr@test.mn', 'APPR-9', APPROVER_KEYS);
  approverToken = approver.token;
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await Promise.all([
    PlannedWork.deleteMany({}),
    PlannedWorkTask.deleteMany({}),
    PlannedWorkReport.deleteMany({}),
    // The audit log is not cleared: it refuses deletion at the schema level, on purpose.
  ]);
});

/**
 * OWNER CASE 32 — a technician cannot approve or cancel, and being assigned does not help.
 */
describe('an ASSIGNED technician is still refused the planning and approval actions', () => {
  it('cannot cancel the job it is working on', async () => {
    const workId = await startedWorkForTechnician();

    const response = await transition(
      workId,
      'CANCEL',
      technicianToken,
      'Технич цуцлахыг оролдов',
    );

    expect(response.status).toBe(403);
    // CANCEL is the one action on the transition endpoint keyed separately, on
    // `planned_work.cancel`, which the technician contract deliberately omits.
    expect(await statusOf(workId)).toBe('STARTED');
  });

  it('cannot reschedule the job it is working on', async () => {
    const workId = await startedWorkForTechnician();
    const before = await PlannedWork.findById(workId).select('plannedEndDate');

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/reschedule`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ plannedEndDate: '2026-09-30T00:00:00.000Z', reason: 'Цаг хүрэлцэхгүй байна' });

    expect(response.status).toBe(403);
    const after = await PlannedWork.findById(workId).select('plannedEndDate');
    expect(after?.plannedEndDate?.toISOString()).toBe(before?.plannedEndDate?.toISOString());
  });

  it('cannot approve or return the report it submitted itself', async () => {
    const workId = await completedWorkAuthoredByTechnician();

    // The report exists in DRAFT and the technician legitimately submits it — that half of
    // the 9.2 separation is theirs.
    const submitted = await request(app)
      .post(`${API}/planned-work/${workId}/report/submit`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({});
    expect(submitted.status).toBe(200);

    const approve = await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({});
    expect(approve.status).toBe(403);

    const returned = await request(app)
      .post(`${API}/planned-work/${workId}/report/return`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ reason: 'Өөрөө буцаах оролдлого' });
    expect(returned.status).toBe(403);

    const report = await PlannedWorkReport.findOne({ plannedWork: workId }).select('status');
    expect(report?.status).toBe('SUBMITTED');
  });

  it('cannot create, edit or re-plan work at all', async () => {
    const workId = await startedWorkForTechnician();

    const create = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send(validWork({ title: 'Технич өөрөө үүсгэсэн ажил' }));
    expect(create.status).toBe(403);
    expect(await PlannedWork.countDocuments({ title: 'Технич өөрөө үүсгэсэн ажил' })).toBe(0);

    const edit = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ title: 'Дур мэдэн өөрчилсөн' });
    expect(edit.status).toBe(403);

    const addTask = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({
        floorId: objects.floorId,
        title: 'Өөрөө нэмсэн дэд ажил',
        unit: 'PIECE',
        totalQuantity: 5,
        plannedStartDate: '2026-07-05T00:00:00.000Z',
        plannedEndDate: '2026-07-20T00:00:00.000Z',
      });
    expect(addTask.status).toBe(403);

    const work = await PlannedWork.findById(workId).select('title');
    expect(work?.title).toBe('Хагас жилийн урьдчилан сэргийлэх үзлэг');
    expect(await PlannedWorkTask.countDocuments({ plannedWork: workId })).toBe(0);
  });
});

/**
 * OWNER CASE 33 — the supervisory side is unaffected.
 *
 * Same endpoints, same records, different callers. Without this, every refusal above would
 * also be satisfied by an endpoint that is simply broken.
 */
describe('supervisory actions remain available to the roles that hold them', () => {
  it('lets a supervisor cancel a work they are not assigned to', async () => {
    const workId = await startedWorkForTechnician();

    const response = await transition(
      workId,
      'CANCEL',
      supervisorToken,
      'Харилцагч хойшлууллаа',
    );

    expect(response.status).toBe(200);
    expect(await statusOf(workId)).toBe('CANCELLED');
  });

  it('lets a supervisor reschedule it', async () => {
    const workId = await startedWorkForTechnician();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/reschedule`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ plannedEndDate: '2026-09-30T00:00:00.000Z', reason: 'Материал хүлээгдэж байна' });

    expect(response.status).toBe(200);
    const after = await PlannedWork.findById(workId).select('plannedEndDate');
    expect(after?.plannedEndDate?.toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });

  it('lets a separate approver approve the report the technician submitted', async () => {
    const workId = await completedWorkAuthoredByTechnician();
    expect(
      (
        await request(app)
          .post(`${API}/planned-work/${workId}/report/submit`)
          .set('Authorization', `Bearer ${technicianToken}`)
          .send({})
      ).status,
    ).toBe(200);

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({});

    expect(response.status).toBe(200);
    const report = await PlannedWorkReport.findOne({ plannedWork: workId }).select('status');
    expect(report?.status).toBe('APPROVED');
  });
});
