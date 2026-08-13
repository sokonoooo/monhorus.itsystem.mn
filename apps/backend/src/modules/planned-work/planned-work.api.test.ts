import { PERMISSIONS } from '@monhorus/shared';
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
import { Customer, ObjectNode } from '../objects/object.models';
import { PlannedWork, PlannedWorkTask } from './planned-work.models';
import { runOverdueReconciliation } from './planned-work.overdue.service';

const API = '/api/v1';

/** Every planned-work permission, for the happy-path operator. */
const ALL_PLANNED_WORK = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  // Reaching PLANNED now needs an approver, so the happy-path operator holds the key.
  PERMISSIONS.PLANNED_WORK_APPROVE,
  PERMISSIONS.PLANNED_WORK_RESCHEDULE,
  PERMISSIONS.PLANNED_WORK_CANCEL,
  PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS,
  PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
] as const;

let app: Express;
let org: OrgFixture;
let objects: ObjectFixture;
let token: string;
/** The crew APPROVE is given whenever a fixture just needs *some* valid employee. */
let crewEmployeeId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

function validWork(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectId: objects.projectId,
    buildingId: objects.buildingId,
    title: 'Хагас жилийн урьдчилан сэргийлэх үзлэг',
    plannedStartDate: '2026-07-01T00:00:00.000Z',
    plannedEndDate: '2026-07-31T00:00:00.000Z',
    assignedEmployeeIds: [],
    ...overrides,
  };
}

async function createWork(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${token}`)
    .send(validWork(overrides));
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

function validTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    floorId: objects.floorId,
    title: 'Самбарын үзлэг',
    unit: 'PIECE',
    totalQuantity: 10,
    plannedStartDate: '2026-07-05T00:00:00.000Z',
    plannedEndDate: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

async function addTask(
  workId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work/${workId}/tasks`)
    .set('Authorization', `Bearer ${token}`)
    .send(validTask(overrides));
  expect(response.status).toBe(201);
  const tasks = response.body.data.tasks as { id: string; title: string }[];
  return tasks[tasks.length - 1]!.id;
}

async function transition(
  workId: string,
  action: string,
  reason?: string,
  bearer = token,
): Promise<request.Response> {
  return request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${bearer}`)
    .send({ action, ...(reason ? { reason } : {}) });
}

/**
 * Drives a work from DRAFT to PLANNED, which is TWO actions now rather than one.
 *
 * PLAN no longer reaches PLANNED: it submits the work for approval and lands on
 * PENDING_APPROVAL. APPROVE is what makes it PLANNED, it needs
 * `planned_work.approve`, and it refuses to run without a crew — approving the work and
 * staffing it are one decision. Every fixture that used to say `transition(id, 'PLAN')`
 * says this instead; the tests that are ABOUT the transitions still spell both out.
 */
async function planAndApprove(
  workId: string,
  crew: readonly string[] = [crewEmployeeId],
  bearer = token,
): Promise<request.Response> {
  const submitted = await transition(workId, 'PLAN', undefined, bearer);
  expect(submitted.status).toBe(200);
  expect(submitted.body.data.lifecycleStatus).toBe('PENDING_APPROVAL');

  const approved = await request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${bearer}`)
    .send({ action: 'APPROVE', assignedEmployeeIds: crew });
  expect(approved.status).toBe(200);
  expect(approved.body.data.lifecycleStatus).toBe('PLANNED');
  return approved;
}

/**
 * Drives a task to genuine completion: full quantity plus all five pieces of evidence.
 * Photos are attached as real uploads because that is the only way evidence exists.
 */
async function completeTask(workId: string, taskId: string, quantity = 10): Promise<void> {
  for (const kind of ['BEFORE', 'AFTER']) {
    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .field('kind', kind)
      .attach('file', Buffer.from('fake-image-bytes'), {
        filename: `${kind.toLowerCase()}.png`,
        contentType: 'image/png',
      });
    expect(response.status).toBe(201);
  }

  const progress = await request(app)
    .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      completedQuantity: quantity,
      note: 'Бүх самбар хэвийн.',
      score: 88,
      recommendation: 'Дараагийн үзлэгийг 6 сарын дараа хийх.',
    });
  expect(progress.status).toBe(200);
}

/** A work driven all the way to COMPLETED, with its report in DRAFT. */
async function completedWork(): Promise<string> {
  const workId = await createWork();
  const taskId = await addTask(workId);
  await planAndApprove(workId);
  await transition(workId, 'START');
  await completeTask(workId, taskId);
  const done = await transition(workId, 'COMPLETE');
  expect(done.status).toBe(200);
  return workId;
}

async function activeEmployee(code = 'EMP-PW'): Promise<string> {
  const employee = await Employee.create({
    employeeCode: code,
    firstName: 'Дорж',
    lastName: 'Бат',
    company: org.companyId,
    department: org.departmentId,
    position: org.positionId,
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    status: 'ACTIVE',
  });
  return String(employee._id);
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
  const user = await createUserWithPermissions('pw@test.mn', ALL_PLANNED_WORK);
  token = await login(user.email, user.password);
  crewEmployeeId = await activeEmployee();
});

describe('POST /planned-work', () => {
  it('creates a work in DRAFT with a generated work number', async () => {
    const response = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${token}`)
      .send(validWork());

    expect(response.status).toBe(201);
    expect(response.body.data.lifecycleStatus).toBe('DRAFT');
    expect(response.body.data.effectiveStatus).toBe('DRAFT');
    expect(response.body.data.workNumber).toMatch(/^PW-\d{6}-\d{4}$/);
    expect(response.body.data.progressPercent).toBe(0);
  });

  it('allows a project to own several concurrent planned works', async () => {
    const first = await createWork({ title: 'Нэгдүгээр ажил' });
    const second = await createWork({ title: 'Хоёрдугаар ажил' });
    const third = await createWork({
      title: 'Гуравдугаар ажил',
      plannedStartDate: '2026-07-10T00:00:00.000Z',
      plannedEndDate: '2026-07-25T00:00:00.000Z',
    });

    expect(new Set([first, second, third]).size).toBe(3);

    const list = await request(app)
      .get(`${API}/planned-work?projectId=${objects.projectId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(3);
  });

  it('issues distinct work numbers for concurrent creations', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) =>
        request(app)
          .post(`${API}/planned-work`)
          .set('Authorization', `Bearer ${token}`)
          .send(validWork({ title: `Ажил ${index}` })),
      ),
    );

    const numbers = responses.map((response) => response.body.data.workNumber as string);
    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(new Set(numbers).size).toBe(5);
  });

  it('refuses a building that belongs to another project', async () => {
    const response = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${token}`)
      .send(validWork({ buildingId: objects.foreignBuildingId }));

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('төсөлд хамаарахгүй');
  });

  it('creates a work with no project and derives the customer from the building', async () => {
    const response = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${token}`)
      .send(validWork({ projectId: null, title: 'Дотоод засвар үйлчилгээ' }));

    expect(response.status).toBe(201);
    expect(response.body.data.project).toBeNull();
    expect(response.body.data.customer.id).toBe(objects.customerId);

    const stored = await PlannedWork.findById(response.body.data.id);
    expect(stored?.project).toBeNull();
    expect(String(stored?.customer)).toBe(objects.customerId);
  });

  it('refuses a building of another customer when a project is supplied', async () => {
    const otherCustomer = await Customer.create({ code: 'OC', name: 'Өөр харилцагч ХХК' });
    const otherProject = await ObjectNode.create({
      kind: 'PROJECT',
      code: 'PRJ-X',
      name: 'Гадны төсөл',
      parent: null,
      customer: otherCustomer._id,
      ancestors: [],
    });
    const otherBuilding = await ObjectNode.create({
      kind: 'BUILDING',
      code: 'BLD-X',
      name: 'Гадны барилга',
      parent: otherProject._id,
      customer: otherCustomer._id,
      ancestors: [otherProject._id],
    });

    const response = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${token}`)
      .send(validWork({ buildingId: String(otherBuilding._id) }));

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('төсөлд хамаарахгүй');
  });

  it('refuses moving a project-less work onto another customer building', async () => {
    const workId = await createWork({ projectId: null });

    const otherCustomer = await Customer.create({ code: 'OC2', name: 'Өөр харилцагч 2 ХХК' });
    const otherProject = await ObjectNode.create({
      kind: 'PROJECT',
      code: 'PRJ-Y',
      name: 'Гадны төсөл 2',
      parent: null,
      customer: otherCustomer._id,
      ancestors: [],
    });
    const otherBuilding = await ObjectNode.create({
      kind: 'BUILDING',
      code: 'BLD-Y',
      name: 'Гадны барилга 2',
      parent: otherProject._id,
      customer: otherCustomer._id,
      ancestors: [otherProject._id],
    });

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ buildingId: String(otherBuilding._id) });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('харилцагчид хамаарахгүй');
  });

  it('refuses an end date before the start date', async () => {
    const response = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${token}`)
      .send(
        validWork({
          plannedStartDate: '2026-07-31T00:00:00.000Z',
          plannedEndDate: '2026-07-01T00:00:00.000Z',
        }),
      );

    expect(response.status).toBe(400);
  });

  it('refuses a caller without planned_work.create', async () => {
    const reader = await createUserWithPermissions('pwread@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
    ]);
    const readerToken = await login(reader.email, reader.password);

    const response = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${readerToken}`)
      .send(validWork());

    expect(response.status).toBe(403);
  });

  it('writes an audit record', async () => {
    const workId = await createWork();
    const entries = await AuditLog.find({ entityType: 'PlannedWork', entityId: workId });
    expect(entries.some((entry) => entry.action === 'Created')).toBe(true);
  });
});

describe('generic update cannot write status or deadline', () => {
  it('rejects a status field outright', async () => {
    const workId = await createWork();

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'COMPLETED' });

    expect(response.status).toBe(400);
    const work = await PlannedWork.findById(workId);
    expect(work?.status).toBe('DRAFT');
  });

  it('rejects a plannedEndDate field, since extending is a reschedule', async () => {
    const workId = await createWork();

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ plannedEndDate: '2026-09-30T00:00:00.000Z' });

    expect(response.status).toBe(400);
    const work = await PlannedWork.findById(workId);
    expect(work?.plannedEndDate.toISOString()).toBe('2026-07-31T00:00:00.000Z');
  });

  it('accepts an ordinary title change', async () => {
    const workId = await createWork();

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Шинэчилсэн нэр' });

    expect(response.status).toBe(200);
    expect(response.body.data.title).toBe('Шинэчилсэн нэр');
  });
});

describe('sub-tasks', () => {
  /**
   * Equipment is optional, and the whole payload the web form builds proves it.
   *
   * The form sends every field on every save, including the explicit `relatedObjectIds:
   * []` and the nulls for the fields left blank. A planner who registers no equipment
   * must still be able to save; the only cost is that the sub-task's result carries no
   * object into Үзлэг ба дүгнэлт.
   */
  it('accepts a sub-task that names no equipment at all', async () => {
    const workId = await createWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        floorId: null,
        title: 'Тоноглолгүй дэд ажил',
        description: null,
        unit: 'PIECE',
        totalQuantity: 1,
        plannedStartDate: '2026-07-05T00:00:00.000Z',
        plannedEndDate: '2026-07-20T00:00:00.000Z',
        assignedEmployeeId: null,
        relatedObjectIds: [],
      });

    expect(response.status).toBe(201);
    const task = (response.body.data.tasks as { title: string; relatedObjects: unknown[] }[]).find(
      (entry) => entry.title === 'Тоноглолгүй дэд ажил',
    );
    expect(task).toBeDefined();
    expect(task!.relatedObjects).toEqual([]);
  });

  it('rejects a floor belonging to a different building', async () => {
    const workId = await createWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send(validTask({ floorId: objects.foreignFloorId }));

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('барилгад хамаарахгүй');
  });

  it('rejects a task starting before the work window', async () => {
    const workId = await createWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send(validTask({ plannedStartDate: '2026-06-01T00:00:00.000Z' }));

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('эрт байна');
  });

  it('rejects a task ending after the work window', async () => {
    const workId = await createWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send(validTask({ plannedEndDate: '2026-08-15T00:00:00.000Z' }));

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('хойш байна');
  });

  it('rejects a non-positive total quantity', async () => {
    const workId = await createWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send(validTask({ totalQuantity: 0 }));

    expect(response.status).toBe(400);
  });

  it('accepts no status field on a task', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId);

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DONE' });

    expect(response.status).toBe(400);
    const task = await PlannedWorkTask.findById(taskId);
    expect(task?.status).toBe('PENDING');
  });

  it('clamps completed quantity when the total is reduced below it', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId, { totalQuantity: 20 });
    await planAndApprove(workId);
    await transition(workId, 'START');

    await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completedQuantity: 15 });

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ totalQuantity: 10 });

    expect(response.status).toBe(200);
    const task = response.body.data.tasks.find((entry: { id: string }) => entry.id === taskId);
    expect(task.totalQuantity).toBe(10);
    expect(task.completedQuantity).toBe(10);
    expect(task.remainingQuantity).toBe(0);
  });

  it('refuses to delete a task that already has recorded progress', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId);
    await planAndApprove(workId);
    await transition(workId, 'START');
    await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completedQuantity: 3 });

    const response = await request(app)
      .delete(`${API}/planned-work/${workId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(await PlannedWorkTask.countDocuments({ _id: taskId })).toBe(1);
  });
});

describe('progress recording', () => {
  it('refuses a completed quantity above the total', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId, { totalQuantity: 10 });
    await planAndApprove(workId);
    await transition(workId, 'START');

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completedQuantity: 11 });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('их байж болохгүй');
  });

  it('computes the work rollup as a quantity weighted average', async () => {
    const workId = await createWork();
    const bigTask = await addTask(workId, { title: 'Том ажил', totalQuantity: 180 });
    await addTask(workId, { title: 'Жижиг ажил 1', totalQuantity: 10 });
    await addTask(workId, { title: 'Жижиг ажил 2', totalQuantity: 10 });
    await planAndApprove(workId);
    await transition(workId, 'START');

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${bigTask}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completedQuantity: 90 });

    expect(response.status).toBe(200);
    // 90 of 200 units, not one of three tasks.
    expect(response.body.data.progressPercent).toBe(45);
    expect(response.body.data.totalQuantity).toBe(200);
    expect(response.body.data.completedQuantity).toBe(90);
    expect(response.body.data.remainingQuantity).toBe(110);
  });

  it('holds a fully counted task at IN_PROGRESS until evidence is complete', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId, { totalQuantity: 5 });
    await planAndApprove(workId);
    await transition(workId, 'START');

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completedQuantity: 5, note: 'Тайлбар', recommendation: 'Зөвлөмж' });

    expect(response.status).toBe(200);
    const task = response.body.data.tasks[0];
    expect(task.progressPercent).toBe(100);
    // Quantity is complete but the photos and the үнэлгээ are missing.
    expect(task.status).toBe('IN_PROGRESS');
    expect(task.missingEvidence).toEqual([
      'Ажлын өмнөх зураг',
      'Ажлын дараах зураг',
      'Үнэлгээ',
    ]);
  });

  it('reaches DONE once quantity and all five evidence items exist', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId, { totalQuantity: 10 });
    await planAndApprove(workId);
    await transition(workId, 'START');
    await completeTask(workId, taskId);

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.tasks[0].status).toBe('DONE');
    expect(detail.body.data.tasks[0].missingEvidence).toEqual([]);
    expect(detail.body.data.completionBlockers).toEqual([]);
  });

  it('pulls a task back out of DONE when evidence is removed', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId);
    await planAndApprove(workId);
    await transition(workId, 'START');
    await completeTask(workId, taskId);

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`);
    const photoId = detail.body.data.tasks[0].afterPhotos[0].id as string;

    const removed = await request(app)
      .delete(`${API}/planned-work/${workId}/tasks/${taskId}/photos/${photoId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(removed.status).toBe(200);
    expect(removed.body.data.tasks[0].status).toBe('IN_PROGRESS');
    expect(removed.body.data.completionBlockers.length).toBeGreaterThan(0);
  });

  it('excludes a skipped task from the rollup', async () => {
    const workId = await createWork();
    const kept = await addTask(workId, { title: 'Хийх ажил', totalQuantity: 10 });
    const skipped = await addTask(workId, { title: 'Хийхгүй ажил', totalQuantity: 90 });
    await planAndApprove(workId);
    await transition(workId, 'START');

    await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${skipped}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completedQuantity: 0, skipped: true });

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${kept}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completedQuantity: 5 });

    // Denominator is 10, not 100.
    expect(response.body.data.totalQuantity).toBe(10);
    expect(response.body.data.progressPercent).toBe(50);
    expect(response.body.data.taskCount).toBe(1);
  });

  it('reports floor progress with the same quantity weighting', async () => {
    const workId = await createWork();
    const onFloor = await addTask(workId, { title: 'Давхарт', totalQuantity: 40 });
    await addTask(workId, { title: 'Давхаргүй', floorId: null, totalQuantity: 60 });
    await planAndApprove(workId);
    await transition(workId, 'START');

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${onFloor}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completedQuantity: 10 });

    const floors = response.body.data.floorProgress as {
      floorId: string;
      progressPercent: number;
    }[];
    const floorRow = floors.find((row) => row.floorId === objects.floorId);
    expect(floorRow?.progressPercent).toBe(25);
    const unassigned = floors.find((row) => row.floorId === '');
    expect(unassigned?.progressPercent).toBe(0);
  });

  it('refuses progress on a DRAFT work', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId);

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completedQuantity: 1 });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Төлөвлөгдөөгүй');
  });

  it('refuses a caller without planned_work.record_progress', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId);
    await planAndApprove(workId);
    await transition(workId, 'START');

    const observer = await createUserWithPermissions('pwobs@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
    ]);
    const observerToken = await login(observer.email, observer.password);

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${observerToken}`)
      .send({ completedQuantity: 1 });

    expect(response.status).toBe(403);
  });
});

/**
 * Sub-task evaluation. The note replaces the old task-level conclusion, and the band is a
 * function of the score against the thresholds in Тохиргоо rather than caller input.
 */
describe('sub-task note and evaluation', () => {
  async function startedWorkWithTask(): Promise<{ workId: string; taskId: string }> {
    const workId = await createWork();
    const taskId = await addTask(workId, { totalQuantity: 10 });
    await planAndApprove(workId);
    await transition(workId, 'START');
    return { workId, taskId };
  }

  async function recordProgress(
    workId: string,
    taskId: string,
    body: Record<string, unknown>,
  ): Promise<request.Response> {
    return request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('round-trips the note and the score on a sub-task', async () => {
    const { workId, taskId } = await startedWorkWithTask();

    const response = await recordProgress(workId, taskId, {
      completedQuantity: 4,
      note: 'Гурван самбарын холболт чангалагдсан.',
      score: 88,
    });

    expect(response.status).toBe(200);
    const task = response.body.data.tasks[0];
    expect(task.note).toBe('Гурван самбарын холболт чангалагдсан.');
    expect(task.score).toBe(88);

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.body.data.tasks[0].note).toBe('Гурван самбарын холболт чангалагдсан.');
    expect(detail.body.data.tasks[0].score).toBe(88);
  });

  /**
   * A sub-task carries BOTH a Тайлбар and a Дүгнэлт.
   *
   * Section 10.1 used to reserve Дүгнэлт for the consolidated report, and this test
   * enforced that. The rule is reversed: the rows of Үзлэг ба дүгнэлт are the per-object
   * items fanned out from a sub-task, so with no conclusion on the sub-task their Дүгнэлт
   * column was permanently empty while a manual object assessment filled it. The
   * consolidated report keeps its own conclusion; this is an addition to it.
   *
   * What has NOT changed is the evidence gate. Дүгнэлт is optional — a task reaches DONE
   * without one — so it must never appear in `missingEvidence`, which is asserted below
   * in both the empty and the written state.
   */
  it('carries both a Тайлбар and a Дүгнэлт, and gates only on the Тайлбар', async () => {
    const { workId, taskId } = await startedWorkWithTask();

    const empty = await recordProgress(workId, taskId, { completedQuantity: 4 });
    expect(empty.status).toBe(200);
    expect(empty.body.data.tasks[0].conclusion).toBeNull();
    expect(empty.body.data.tasks[0].missingEvidence).toContain('Тайлбар');
    expect(empty.body.data.tasks[0].missingEvidence).not.toContain('Дүгнэлт');

    const written = await recordProgress(workId, taskId, {
      completedQuantity: 4,
      note: 'Тайлбар',
      conclusion: 'Ашиглалтад тэнцэнэ.',
    });
    expect(written.body.data.tasks[0].missingEvidence).not.toContain('Тайлбар');
    // Still absent from the gate: an optional field cannot start blocking completion.
    expect(written.body.data.tasks[0].missingEvidence).not.toContain('Дүгнэлт');
    expect(written.body.data.tasks[0].conclusion).toBe('Ашиглалтад тэнцэнэ.');

    // And it survives a re-read, not just the write's own response.
    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.body.data.tasks[0].conclusion).toBe('Ашиглалтад тэнцэнэ.');
  });

  it('derives the band from the score rather than accepting one', async () => {
    const { workId, taskId } = await startedWorkWithTask();

    const response = await recordProgress(workId, taskId, { completedQuantity: 1, score: 88 });

    expect(response.status).toBe(200);
    expect(response.body.data.tasks[0].riskLevel).toBe('NORMAL');

    const stored = await PlannedWorkTask.findById(taskId);
    expect(stored?.riskLevel).toBe('NORMAL');
  });

  it('re-derives the band when the score changes', async () => {
    const { workId, taskId } = await startedWorkWithTask();

    await recordProgress(workId, taskId, { completedQuantity: 1, score: 88 });
    const lowered = await recordProgress(workId, taskId, { completedQuantity: 2, score: 30 });
    expect(lowered.body.data.tasks[0].riskLevel).toBe('CRITICAL');

    const raised = await recordProgress(workId, taskId, { completedQuantity: 3, score: 50 });
    expect(raised.body.data.tasks[0].riskLevel).toBe('SCHEDULE_REPAIR');

    const cleared = await recordProgress(workId, taskId, { completedQuantity: 4, score: null });
    expect(cleared.body.data.tasks[0].score).toBeNull();
    expect(cleared.body.data.tasks[0].riskLevel).toBeNull();
  });

  it('refuses a band supplied by the caller', async () => {
    const { workId, taskId } = await startedWorkWithTask();

    const response = await recordProgress(workId, taskId, {
      completedQuantity: 1,
      score: 10,
      riskLevel: 'NORMAL',
    });

    expect(response.status).toBe(400);
  });

  it('refuses a score outside 0-100', async () => {
    const { workId, taskId } = await startedWorkWithTask();

    const tooHigh = await recordProgress(workId, taskId, { completedQuantity: 1, score: 101 });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.message).toBeTruthy();

    const negative = await recordProgress(workId, taskId, { completedQuantity: 1, score: -1 });
    expect(negative.status).toBe(400);

    const stored = await PlannedWorkTask.findById(taskId);
    expect(stored?.score).toBeNull();
    expect(stored?.riskLevel).toBeNull();
  });
});

/**
 * Who wrote the Дүгнэлт, and how long the sub-task took.
 *
 * Both answers were previously unavailable and both were being guessed at from the wrong
 * fields — the conclusion from whoever last touched the row, the duration from `completedAt`,
 * which moves whenever evidence does.
 */
describe('sub-task conclusion authorship and duration', () => {
  async function startedWorkWithTask(
    overrides: Record<string, unknown> = {},
  ): Promise<{ workId: string; taskId: string }> {
    const workId = await createWork();
    const taskId = await addTask(workId, { totalQuantity: 10, ...overrides });
    await planAndApprove(workId);
    await transition(workId, 'START');
    return { workId, taskId };
  }

  async function recordProgress(
    workId: string,
    taskId: string,
    body: Record<string, unknown>,
    bearer = token,
  ): Promise<request.Response> {
    return request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${bearer}`)
      .send(body);
  }

  it('stamps the writer when the Дүгнэлт text is written', async () => {
    const { workId, taskId } = await startedWorkWithTask();

    const response = await recordProgress(workId, taskId, {
      completedQuantity: 3,
      conclusion: 'Тусгаарлагч хэвийн.',
    });

    expect(response.status).toBe(200);
    const task = response.body.data.tasks[0];
    expect(task.conclusionByName).toBe('Test pw@test.mn');
    expect(task.conclusionById).toBeTruthy();
    expect(task.conclusionAt).toBeTruthy();
  });

  it('does not re-stamp the conclusion on a later progress write that leaves the text alone', async () => {
    const { workId, taskId } = await startedWorkWithTask();
    await recordProgress(workId, taskId, {
      completedQuantity: 3,
      conclusion: 'Тусгаарлагч хэвийн.',
    });
    const first = await PlannedWorkTask.findById(taskId);
    const stampedAt = first?.conclusionAt?.getTime();
    expect(stampedAt).toBeTruthy();

    const other = await createUserWithPermissions('pwother@test.mn', ALL_PLANNED_WORK);
    const otherToken = await login(other.email, other.password);

    // A colleague nudges the quantity, and the sheet resends the conclusion it loaded.
    // Neither is an act of authorship, so the stamp must not move to them.
    const quantityOnly = await recordProgress(
      workId,
      taskId,
      { completedQuantity: 6 },
      otherToken,
    );
    expect(quantityOnly.body.data.tasks[0].conclusionByName).toBe('Test pw@test.mn');

    const resent = await recordProgress(
      workId,
      taskId,
      { completedQuantity: 7, conclusion: 'Тусгаарлагч хэвийн.' },
      otherToken,
    );
    expect(resent.body.data.tasks[0].conclusionByName).toBe('Test pw@test.mn');

    const after = await PlannedWorkTask.findById(taskId);
    expect(after?.conclusionAt?.getTime()).toBe(stampedAt);
  });

  it('re-stamps the conclusion when a different user changes the text', async () => {
    const { workId, taskId } = await startedWorkWithTask();
    await recordProgress(workId, taskId, {
      completedQuantity: 3,
      conclusion: 'Тусгаарлагч хэвийн.',
    });

    const other = await createUserWithPermissions('pwsecond@test.mn', ALL_PLANNED_WORK);
    const otherToken = await login(other.email, other.password);

    const rewritten = await recordProgress(
      workId,
      taskId,
      { completedQuantity: 4, conclusion: 'Дахин шалгахад халалт илэрсэн.' },
      otherToken,
    );

    expect(rewritten.status).toBe(200);
    expect(rewritten.body.data.tasks[0].conclusionByName).toBe('Test pwsecond@test.mn');
  });

  it('clears the whole stamp when the Дүгнэлт is cleared', async () => {
    const { workId, taskId } = await startedWorkWithTask();
    await recordProgress(workId, taskId, {
      completedQuantity: 3,
      conclusion: 'Тусгаарлагч хэвийн.',
    });

    const cleared = await recordProgress(workId, taskId, {
      completedQuantity: 3,
      conclusion: null,
    });

    const task = cleared.body.data.tasks[0];
    expect(task.conclusion).toBeNull();
    expect(task.conclusionById).toBeNull();
    expect(task.conclusionByName).toBeNull();
    expect(task.conclusionAt).toBeNull();
  });

  it('sets startedAt once and never moves it', async () => {
    const { workId, taskId } = await startedWorkWithTask();

    await recordProgress(workId, taskId, { completedQuantity: 0, started: true });
    const first = await PlannedWorkTask.findById(taskId);
    const startedAt = first?.startedAt?.getTime();
    expect(startedAt).toBeTruthy();

    await recordProgress(workId, taskId, { completedQuantity: 2 });
    await recordProgress(workId, taskId, { completedQuantity: 5 });
    // Even a correction back to nothing done leaves the start where it was: the work did
    // begin, and re-deriving from the current quantity would rewrite history.
    await recordProgress(workId, taskId, { completedQuantity: 0 });

    const after = await PlannedWorkTask.findById(taskId);
    expect(after?.startedAt?.getTime()).toBe(startedAt);
  });

  it('stamps the completion instant at quantity completion, before the evidence gate', async () => {
    const { workId, taskId } = await startedWorkWithTask();

    const response = await recordProgress(workId, taskId, { completedQuantity: 10 });

    // Quantity is complete but the five evidence items are not, so the task is not DONE.
    expect(response.body.data.tasks[0].status).toBe('IN_PROGRESS');
    const stored = await PlannedWorkTask.findById(taskId);
    expect(stored?.completedAt).toBeNull();
    expect(stored?.quantityCompletedAt).toBeTruthy();
  });

  it('keeps the completion instant across a re-derivation that pulls the task out of DONE', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId);
    await planAndApprove(workId);
    await transition(workId, 'START');
    await completeTask(workId, taskId);

    const before = await PlannedWorkTask.findById(taskId);
    const quantityCompletedAt = before?.quantityCompletedAt?.getTime();
    const startedAt = before?.startedAt?.getTime();
    expect(quantityCompletedAt).toBeTruthy();
    expect(before?.status).toBe('DONE');

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`);
    const photoId = detail.body.data.tasks[0].afterPhotos[0].id as string;

    const removed = await request(app)
      .delete(`${API}/planned-work/${workId}/tasks/${taskId}/photos/${photoId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(removed.status).toBe(200);
    expect(removed.body.data.tasks[0].status).toBe('IN_PROGRESS');

    const after = await PlannedWorkTask.findById(taskId);
    // `completedAt` follows the DONE derivation and is cleared, as it always has been.
    expect(after?.completedAt).toBeNull();
    // The physical work still finished when it finished. This is the whole point of the
    // separate field: the duration must not be erased by touching a photo.
    expect(after?.quantityCompletedAt?.getTime()).toBe(quantityCompletedAt);
    expect(after?.startedAt?.getTime()).toBe(startedAt);
    expect(removed.body.data.tasks[0].durationMinutes).not.toBeNull();
  });

  it('reports no duration while the sub-task is unfinished', async () => {
    const { workId, taskId } = await startedWorkWithTask();

    const response = await recordProgress(workId, taskId, { completedQuantity: 4 });

    // Null rather than zero: an open sub-task has no duration to state.
    expect(response.body.data.tasks[0].durationMinutes).toBeNull();
  });

  it('reports no duration for a skipped sub-task', async () => {
    const { workId, taskId } = await startedWorkWithTask();

    const response = await recordProgress(workId, taskId, {
      completedQuantity: 10,
      skipped: true,
    });

    expect(response.body.data.tasks[0].status).toBe('SKIPPED');
    expect(response.body.data.tasks[0].durationMinutes).toBeNull();
  });

  it('reports the duration in whole minutes once the quantity is complete', async () => {
    const { workId, taskId } = await startedWorkWithTask();

    // Complete the quantity FIRST, so both sticky instants are already stamped, then
    // rewind the start to exactly 2h30 before the recorded completion.
    //
    // Rewinding before the completing write instead would leave the span at
    // `150 + (time the test itself took)`, which rounds to 151 the moment those two
    // calls are more than thirty seconds apart - so the assertion passed locally and
    // failed under load. Anchoring to the stored completion instant removes the
    // wall clock from the test entirely.
    await recordProgress(workId, taskId, { completedQuantity: 10 });

    const stamped = await PlannedWorkTask.findById(taskId);
    const completedAt = stamped!.quantityCompletedAt!;
    await PlannedWorkTask.updateOne(
      { _id: taskId },
      { $set: { startedAt: new Date(completedAt.getTime() - 150 * 60_000) } },
    );

    const response = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`);

    const minutes = response.body.data.tasks[0].durationMinutes as number;
    expect(Number.isInteger(minutes)).toBe(true);
    expect(minutes).toBe(150);
  });
});

describe('lifecycle transitions', () => {
  /**
   * The walk itself, spelled out rather than run through `planAndApprove`, because the
   * two-step shape of it is the thing under test: PLAN submits, APPROVE commits.
   */
  it('walks DRAFT to PENDING_APPROVAL to PLANNED to STARTED', async () => {
    const workId = await createWork();

    const submitted = await transition(workId, 'PLAN');
    expect(submitted.status).toBe(200);
    // PLAN is a submission for approval now, not the plan itself.
    expect(submitted.body.data.lifecycleStatus).toBe('PENDING_APPROVAL');

    const planned = await request(app)
      .post(`${API}/planned-work/${workId}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'APPROVE', assignedEmployeeIds: [crewEmployeeId] });
    expect(planned.status).toBe(200);
    expect(planned.body.data.lifecycleStatus).toBe('PLANNED');
    // Approving and staffing are one decision, so PLANNED never arrives unstaffed.
    expect(
      (planned.body.data.assignedEmployees as { id: string }[]).map((entry) => entry.id),
    ).toEqual([crewEmployeeId]);

    const started = await transition(workId, 'START');
    expect(started.body.data.lifecycleStatus).toBe('STARTED');
    expect(started.body.data.actualStartDate).not.toBeNull();
  });

  it('refuses to approve without a crew, and refuses START while pending', async () => {
    const workId = await createWork();
    expect((await transition(workId, 'PLAN')).status).toBe(200);

    const unstaffed = await transition(workId, 'APPROVE');
    expect(unstaffed.status).toBe(400);
    expect(unstaffed.body.message).toContain('ажилтныг сонгоно');

    // Still pending, so the work has not become startable by failing to be approved.
    const premature = await transition(workId, 'START');
    expect(premature.status).toBe(400);
    expect((await PlannedWork.findById(workId))?.status).toBe('PENDING_APPROVAL');
  });

  it('refuses a transition that is not in the matrix', async () => {
    const workId = await createWork();

    const response = await transition(workId, 'START');
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('үйлдэл хийх боломжгүй');
  });

  it('rejects OVERDUE as a requested action', async () => {
    const workId = await createWork();

    const response = await transition(workId, 'OVERDUE');
    expect(response.status).toBe(400);
  });

  it('requires a reason to pause and records the pause history', async () => {
    const workId = await createWork();
    await planAndApprove(workId);
    await transition(workId, 'START');

    const noReason = await transition(workId, 'PAUSE');
    expect(noReason.status).toBe(400);

    const paused = await transition(workId, 'PAUSE', 'Материал хүлээгдэж байна');
    expect(paused.status).toBe(200);
    expect(paused.body.data.lifecycleStatus).toBe('PAUSED');
    expect(paused.body.data.currentPauseStartedAt).not.toBeNull();
    expect(paused.body.data.pauseHistory).toHaveLength(1);
    expect(paused.body.data.pauseHistory[0].reason).toBe('Материал хүлээгдэж байна');
  });

  it('never shifts the deadline when pausing or resuming', async () => {
    const workId = await createWork();
    await planAndApprove(workId);
    await transition(workId, 'START');
    await transition(workId, 'PAUSE', 'Түр зогсоов');

    const resumed = await transition(workId, 'RESUME');
    expect(resumed.status).toBe(200);
    // The original deadline stands; the paused duration is recorded, never added.
    expect(resumed.body.data.plannedEndDate).toBe('2026-07-31T00:00:00.000Z');
    expect(resumed.body.data.originalPlannedEndDate).toBe('2026-07-31T00:00:00.000Z');
    expect(resumed.body.data.currentPauseStartedAt).toBeNull();
    expect(resumed.body.data.pauseHistory[0].resumedAt).not.toBeNull();
  });

  it('resumes to STARTED when the work had begun', async () => {
    const workId = await createWork();
    await planAndApprove(workId);
    await transition(workId, 'START');
    await transition(workId, 'PAUSE', 'Түр зогсоов');

    const resumed = await transition(workId, 'RESUME');
    expect(resumed.body.data.lifecycleStatus).toBe('STARTED');
  });

  it('resumes to PLANNED when the work had never begun', async () => {
    const workId = await createWork();
    await planAndApprove(workId);
    await transition(workId, 'PAUSE', 'Хойшлуулав');

    const resumed = await transition(workId, 'RESUME');
    expect(resumed.body.data.lifecycleStatus).toBe('PLANNED');
    expect(resumed.body.data.actualStartDate).toBeNull();
  });

  it('refuses completion while a task is unfinished, and lists the blockers', async () => {
    const workId = await createWork();
    await addTask(workId, { totalQuantity: 10 });
    await planAndApprove(workId);
    await transition(workId, 'START');

    const response = await transition(workId, 'COMPLETE');
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('бүрэн биелээгүй');
    expect(response.body.issues.length).toBeGreaterThan(0);
  });

  it('refuses completion of a work with no sub-tasks', async () => {
    const workId = await createWork();
    await planAndApprove(workId);
    await transition(workId, 'START');

    const response = await transition(workId, 'COMPLETE');
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('Дэд ажил бүртгэгдээгүй');
  });

  it('completes when every rule passes and creates the report in DRAFT', async () => {
    const workId = await completedWork();

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.lifecycleStatus).toBe('COMPLETED');
    expect(detail.body.data.progressPercent).toBe(100);
    expect(detail.body.data.report.status).toBe('DRAFT');
    expect(detail.body.data.report.visibleToCustomer).toBe(false);
  });

  it('requires a reason and the cancel permission to cancel', async () => {
    const workId = await createWork();

    const noReason = await transition(workId, 'CANCEL');
    expect(noReason.status).toBe(400);

    const noPermission = await createUserWithPermissions('pwnocancel@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
    ]);
    const noPermissionToken = await login(noPermission.email, noPermission.password);
    const forbidden = await transition(workId, 'CANCEL', 'Захиалагч татгалзав', noPermissionToken);
    expect(forbidden.status).toBe(403);

    const cancelled = await transition(workId, 'CANCEL', 'Захиалагч татгалзав');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.lifecycleStatus).toBe('CANCELLED');
    expect(cancelled.body.data.cancelReason).toBe('Захиалагч татгалзав');
    expect(cancelled.body.data.cancelledBy.name).not.toBeNull();
  });

  it('leaves a cancelled work read-only', async () => {
    const workId = await createWork();
    await transition(workId, 'CANCEL', 'Захиалагч татгалзав');

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Дахин нэрлэх' });

    expect(response.status).toBe(400);
  });

  it('offers only permitted actions in availableActions', async () => {
    const limited = await createUserWithPermissions('pwlimited@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
    ]);
    const limitedToken = await login(limited.email, limited.password);

    /**
     * The caller is ASSIGNED to this work on purpose.
     *
     * Holding neither `planned_work.update` nor any other oversight key, this account is
     * inside the assignment scope, so an unassigned work would now offer it nothing at all
     * and the assertions below would pass for the wrong reason. Assigning it isolates the
     * thing under test: the list is filtered by PERMISSION.
     */
    const employeeId = await Employee.create({
      employeeCode: 'EMP-LIMITED',
      firstName: 'Сүх',
      lastName: 'Бат',
      company: org.companyId,
      department: org.departmentId,
      position: org.positionId,
      employeeType: 'FULL_TIME',
      employmentStartDate: new Date('2024-01-01'),
      status: 'ACTIVE',
      systemUser: limited.userId,
    }).then((employee) => String(employee._id));

    // Approved WITH that same employee as the crew: APPROVE writes the crew, so approving
    // with anybody else would quietly undo the assignment this test depends on.
    const workId = await createWork({ assignedEmployeeIds: [employeeId] });
    await planAndApprove(workId, [employeeId]);

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${limitedToken}`);

    const actions = (detail.body.data.availableActions as { action: string }[]).map(
      (entry) => entry.action,
    );
    expect(actions).toContain('START');
    expect(actions).toContain('PAUSE');
    // No cancel permission, so no cancel button is offered.
    expect(actions).not.toContain('CANCEL');
    expect(actions).not.toContain('COMPLETE');
  });

  it('writes a status change audit record for every transition', async () => {
    const workId = await createWork();
    await planAndApprove(workId);
    await transition(workId, 'START');

    const entries = await AuditLog.find({ entityType: 'PlannedWork', entityId: workId });
    const statusChanges = entries.filter((entry) => entry.action === 'StatusChanged');
    // Three transitions were performed — PLAN, APPROVE, START — so three rows.
    expect(statusChanges).toHaveLength(3);
  });
});

describe('overdue behaviour', () => {
  async function overdueWork(): Promise<string> {
    const workId = await createWork({
      plannedStartDate: '2020-01-01T00:00:00.000Z',
      plannedEndDate: '2020-01-31T00:00:00.000Z',
    });
    await planAndApprove(workId);
    return workId;
  }

  it('reports OVERDUE as effective status while the lifecycle status stays PLANNED', async () => {
    const workId = await overdueWork();

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.lifecycleStatus).toBe('PLANNED');
    expect(detail.body.data.effectiveStatus).toBe('OVERDUE');
    expect(detail.body.data.overdueAt).not.toBeNull();
  });

  it('leaves a DRAFT work out of the overdue state', async () => {
    const workId = await createWork({
      plannedStartDate: '2020-01-01T00:00:00.000Z',
      plannedEndDate: '2020-01-31T00:00:00.000Z',
    });

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.effectiveStatus).toBe('DRAFT');
    expect(detail.body.data.overdueAt).toBeNull();
  });

  it('keeps a paused work overdue', async () => {
    const workId = await overdueWork();
    await transition(workId, 'PAUSE', 'Түр зогсоов');

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.lifecycleStatus).toBe('PAUSED');
    expect(detail.body.data.effectiveStatus).toBe('OVERDUE');
  });

  it('writes the breach audit event once, attributed to SYSTEM', async () => {
    const workId = await overdueWork();

    // Two reads plus the reconciliation job: still one breach event.
    await request(app).get(`${API}/planned-work/${workId}`).set('Authorization', `Bearer ${token}`);
    await request(app).get(`${API}/planned-work/${workId}`).set('Authorization', `Bearer ${token}`);
    await runOverdueReconciliation();

    const events = await AuditLog.find({
      entityId: workId,
      action: 'PLANNED_WORK_BECAME_OVERDUE',
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.userLabel).toBe('SYSTEM');
    expect(events[0]?.user).toBeNull();
    expect((events[0]?.oldValue as { effectiveStatus: string }).effectiveStatus).toBe('PLANNED');
    expect((events[0]?.newValue as { effectiveStatus: string }).effectiveStatus).toBe('OVERDUE');
  });

  it('marks unopened work through the reconciliation job', async () => {
    const workId = await createWork({
      plannedStartDate: '2020-01-01T00:00:00.000Z',
      plannedEndDate: '2020-01-31T00:00:00.000Z',
    });
    await planAndApprove(workId);
    // Clear the stamp the transition read left behind, to simulate a never-opened work.
    // The audit log is append-only, so the earlier breach row cannot be deleted; the
    // assertion is on the delta the job produces instead.
    await PlannedWork.updateOne({ _id: workId }, { $set: { overdueAt: null } });
    const before = await AuditLog.countDocuments({ action: 'PLANNED_WORK_BECAME_OVERDUE' });

    const result = await runOverdueReconciliation();
    expect(result.markedOverdue).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'PLANNED_WORK_BECAME_OVERDUE' })).toBe(
      before + 1,
    );

    const work = await PlannedWork.findById(workId);
    expect(work?.overdueAt).not.toBeNull();
  });

  it('filters the list by effective OVERDUE status', async () => {
    await overdueWork();
    const onTime = await createWork({
      title: 'Хугацаандаа',
      plannedStartDate: '2099-01-01T00:00:00.000Z',
      plannedEndDate: '2099-01-31T00:00:00.000Z',
    });
    await planAndApprove(onTime);

    const overdueList = await request(app)
      .get(`${API}/planned-work?status=OVERDUE`)
      .set('Authorization', `Bearer ${token}`);

    expect(overdueList.body.data.total).toBe(1);
    expect(overdueList.body.data.items[0].effectiveStatus).toBe('OVERDUE');

    const plannedList = await request(app)
      .get(`${API}/planned-work?status=PLANNED`)
      .set('Authorization', `Bearer ${token}`);

    // An overdue record does not also count as PLANNED, so the two figures add up.
    expect(plannedList.body.data.total).toBe(1);
    expect(plannedList.body.data.items[0].id).toBe(onTime);
  });

  it('does not clear overdue when an ordinary update sends a different date', async () => {
    const workId = await overdueWork();

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ plannedEndDate: '2099-01-01T00:00:00.000Z' });

    expect(response.status).toBe(400);
    const work = await PlannedWork.findById(workId);
    expect(work?.overdueAt).not.toBeNull();
  });

  it('clears overdue through an authorised reschedule and audits both dates', async () => {
    const workId = await overdueWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/reschedule`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        plannedEndDate: '2099-06-30T00:00:00.000Z',
        reason: 'Захиалагчтай тохирсон шинэ хугацаа',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.effectiveStatus).toBe('PLANNED');
    expect(response.body.data.overdueAt).toBeNull();
    // The original commitment is preserved.
    expect(response.body.data.originalPlannedEndDate).toBe('2020-01-31T00:00:00.000Z');
    expect(response.body.data.scheduleHistory).toHaveLength(1);
    expect(response.body.data.scheduleHistory[0].clearedOverdue).toBe(true);
    expect(response.body.data.scheduleHistory[0].previousPlannedEndDate).toBe(
      '2020-01-31T00:00:00.000Z',
    );

    const events = await AuditLog.find({ entityId: workId, action: 'PLANNED_WORK_RESCHEDULED' });
    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe('Захиалагчтай тохирсон шинэ хугацаа');
  });

  it('requires a reason and the reschedule permission', async () => {
    const workId = await overdueWork();

    const noReason = await request(app)
      .post(`${API}/planned-work/${workId}/reschedule`)
      .set('Authorization', `Bearer ${token}`)
      .send({ plannedEndDate: '2099-06-30T00:00:00.000Z' });
    expect(noReason.status).toBe(400);

    const limited = await createUserWithPermissions('pwnoresched@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_UPDATE,
    ]);
    const limitedToken = await login(limited.email, limited.password);

    const forbidden = await request(app)
      .post(`${API}/planned-work/${workId}/reschedule`)
      .set('Authorization', `Bearer ${limitedToken}`)
      .send({ plannedEndDate: '2099-06-30T00:00:00.000Z', reason: 'Шинэ хугацаа тохирлоо' });
    expect(forbidden.status).toBe(403);
  });

  it('refuses a reschedule that would strand a sub-task outside the window', async () => {
    const workId = await createWork();
    await addTask(workId, { plannedEndDate: '2026-07-20T00:00:00.000Z' });

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/reschedule`)
      .set('Authorization', `Bearer ${token}`)
      .send({ plannedEndDate: '2026-07-10T00:00:00.000Z', reason: 'Хугацаа багасгах' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Дэд ажлын хугацаа');
  });

  it('records lateness when a work completes after its deadline', async () => {
    const workId = await createWork({
      plannedStartDate: '2020-01-01T00:00:00.000Z',
      plannedEndDate: '2020-01-31T00:00:00.000Z',
    });
    const taskId = await addTask(workId, {
      plannedStartDate: '2020-01-02T00:00:00.000Z',
      plannedEndDate: '2020-01-30T00:00:00.000Z',
    });
    await planAndApprove(workId);
    await transition(workId, 'START');
    await completeTask(workId, taskId);

    const response = await transition(workId, 'COMPLETE');
    expect(response.status).toBe(200);
    expect(response.body.data.completedLate).toBe(true);
    expect(response.body.data.delayMinutes).toBeGreaterThan(0);
    // A completed work is no longer reported as overdue.
    expect(response.body.data.effectiveStatus).toBe('COMPLETED');
  });
});

describe('planned materials', () => {
  it('stores a material as a name, a quantity and a unit', async () => {
    const workId = await createWork();

    const response = await request(app)
      .put(`${API}/planned-work/${workId}/materials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ materials: [{ name: 'Кабель 3x2.5', quantity: 120, unit: 'METRE' }] });

    expect(response.status).toBe(200);
    expect(response.body.data.materials).toHaveLength(1);
    expect(response.body.data.materials[0]).toMatchObject({
      name: 'Кабель 3x2.5',
      quantity: 120,
      unit: 'METRE',
    });
  });

  it('replaces the whole list rather than merging into it', async () => {
    const workId = await createWork();

    await request(app)
      .put(`${API}/planned-work/${workId}/materials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ materials: [{ name: 'Кабель', quantity: 10, unit: 'METRE' }] });

    const response = await request(app)
      .put(`${API}/planned-work/${workId}/materials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ materials: [{ name: 'Автомат таслуур', quantity: 4, unit: 'PIECE' }] });

    expect(response.status).toBe(200);
    expect(response.body.data.materials).toHaveLength(1);
    expect(response.body.data.materials[0].name).toBe('Автомат таслуур');
  });

  it('rejects a duplicated material name in the list', async () => {
    const workId = await createWork();

    const response = await request(app)
      .put(`${API}/planned-work/${workId}/materials`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        materials: [
          { name: 'Кабель 3x2.5', quantity: 10, unit: 'METRE' },
          { name: 'кабель 3x2.5', quantity: 20, unit: 'METRE' },
        ],
      });

    expect(response.status).toBe(400);
  });
});

describe('GET /planned-work', () => {
  it('hides archived work unless it is explicitly requested', async () => {
    const workId = await completedWork();
    await PlannedWork.updateOne({ _id: workId }, { $set: { status: 'ARCHIVED' } });

    const hidden = await request(app)
      .get(`${API}/planned-work`)
      .set('Authorization', `Bearer ${token}`);
    expect(hidden.body.data.total).toBe(0);

    const shown = await request(app)
      .get(`${API}/planned-work?includeArchived=true`)
      .set('Authorization', `Bearer ${token}`);
    expect(shown.body.data.total).toBe(1);
  });

  it('refuses a caller without planned_work.view', async () => {
    const outsider = await createUserWithPermissions('pwout@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);

    const response = await request(app)
      .get(`${API}/planned-work`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(403);
  });

  it('searches by work number and title', async () => {
    await createWork({ title: 'Гэрэлтүүлгийн ажил' });
    await createWork({ title: 'Самбарын ажил' });

    const response = await request(app)
      .get(`${API}/planned-work?search=${encodeURIComponent('Гэрэлтүүлг')}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
  });
});
