import { PERMISSIONS } from '@monhorus/shared';
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
} from '../../test/helpers';
import { Employee } from '../employee/employee.model';
import { PlannedWorkTask } from './planned-work.models';

/**
 * The sub-task үнэлгээ gate (requirement item 6).
 *
 * A score is required to move a sub-task INTO DONE. A sub-task that is already DONE is
 * not re-validated, so planned works that finished their tasks before the rule existed
 * stay finished and can still be completed.
 */

const API = '/api/v1';

const PERFORMER_PERMISSIONS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS,
  // Reaching PLANNED now goes through the approval gate, so the fixture caller has to
  // hold the approve key as well as the change_status key it drives the rest with.
  PERMISSIONS.PLANNED_WORK_APPROVE,
] as const;

let app: Express;
let objects: ObjectFixture;
let org: OrgFixture;
let token: string;
let employeeId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function createWork(): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      projectId: objects.projectId,
      buildingId: objects.buildingId,
      title: 'Улирлын үзлэг',
      plannedStartDate: '2026-07-01T00:00:00.000Z',
      plannedEndDate: '2099-07-31T00:00:00.000Z',
      assignedEmployeeIds: [],
    });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function addTask(workId: string): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work/${workId}/tasks`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      floorId: objects.floorId,
      title: 'Самбарын үзлэг',
      unit: 'PIECE',
      totalQuantity: 10,
      plannedStartDate: '2026-07-05T00:00:00.000Z',
      plannedEndDate: '2099-07-20T00:00:00.000Z',
    });
  expect(response.status).toBe(201);
  const tasks = response.body.data.tasks as { id: string }[];
  return tasks[tasks.length - 1]!.id;
}

async function transition(
  workId: string,
  action: string,
  body: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${token}`)
    .send({ action, ...body });
}

/**
 * Drives a draft all the way to PLANNED.
 *
 * REACHING PLANNED TAKES TWO ACTIONS NOW: PLAN only submits the work for approval
 * (DRAFT -> PENDING_APPROVAL), and APPROVE is what plans it — and it refuses to run
 * without at least one employee, so the crew travels with the approval.
 */
async function planAndApprove(workId: string): Promise<void> {
  expect((await transition(workId, 'PLAN')).status).toBe(200);
  expect(
    (await transition(workId, 'APPROVE', { assignedEmployeeIds: [employeeId] })).status,
  ).toBe(200);
}

async function attachPhotos(workId: string, taskId: string): Promise<void> {
  for (const kind of ['BEFORE', 'AFTER']) {
    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .field('kind', kind)
      .attach('file', Buffer.from('image-bytes'), {
        filename: `${kind.toLowerCase()}.png`,
        contentType: 'image/png',
      });
    expect(response.status).toBe(201);
  }
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

/** A started work with one sub-task that carries every evidence item except the score. */
async function workReadyExceptScore(): Promise<{ workId: string; taskId: string }> {
  const workId = await createWork();
  const taskId = await addTask(workId);
  await planAndApprove(workId);
  expect((await transition(workId, 'START')).status).toBe(200);
  await attachPhotos(workId, taskId);

  const progress = await recordProgress(workId, taskId, {
    completedQuantity: 10,
    note: 'Бүх самбар хэвийн ажиллаж байна.',
    recommendation: 'Дараагийн үзлэгийг хагас жилийн дараа хийх.',
  });
  expect(progress.status).toBe(200);

  return { workId, taskId };
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

  const performer = await createUserWithPermissions('pwscore@test.mn', PERFORMER_PERMISSIONS);
  token = await login(performer.email, performer.password);

  // Approval assigns, so the suite needs a real employee to hand every work to.
  const employee = await Employee.create({
    employeeCode: 'E-SCORE-1',
    firstName: 'Дорж',
    lastName: 'Бат',
    company: org.companyId,
    department: org.departmentId,
    position: org.positionId,
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    status: 'ACTIVE',
  });
  employeeId = String(employee._id);
});

describe('sub-task score gate', () => {
  it('refuses to finish a sub-task without a үнэлгээ and names the missing field', async () => {
    const { workId } = await workReadyExceptScore();

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`);

    const task = detail.body.data.tasks[0];
    expect(task.progressPercent).toBe(100);
    expect(task.status).toBe('IN_PROGRESS');
    expect(task.missingEvidence).toEqual(['Үнэлгээ']);
    expect(JSON.stringify(detail.body.data.completionBlockers)).toContain('Үнэлгээ');
  });

  it('blocks completing the planned work while a sub-task has no үнэлгээ', async () => {
    const { workId } = await workReadyExceptScore();

    const response = await transition(workId, 'COMPLETE');

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('Үнэлгээ');
  });

  it('finishes the sub-task once a үнэлгээ is recorded', async () => {
    const { workId, taskId } = await workReadyExceptScore();

    const scored = await recordProgress(workId, taskId, { completedQuantity: 10, score: 88 });

    expect(scored.status).toBe(200);
    const task = scored.body.data.tasks[0];
    expect(task.status).toBe('DONE');
    expect(task.score).toBe(88);
    expect(task.missingEvidence).toEqual([]);
    expect(scored.body.data.completionBlockers).toEqual([]);
    expect((await transition(workId, 'COMPLETE')).status).toBe(200);
  });

  it('grandfathers a sub-task that was already DONE with no үнэлгээ', async () => {
    const { workId, taskId } = await workReadyExceptScore();
    // Reach DONE, then strip the score to reproduce a sub-task finished before the rule
    // existed. The stored status is what the gate is grandfathered against.
    expect((await recordProgress(workId, taskId, { completedQuantity: 10, score: 88 })).status).toBe(
      200,
    );
    await PlannedWorkTask.updateOne({ _id: taskId }, { $set: { score: null, riskLevel: null } });

    // An unrelated edit re-derives every task status on the work; a DONE task must
    // survive that re-derivation rather than being pulled back out.
    const edited = await request(app)
      .patch(`${API}/planned-work/${workId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'Тайлбарыг засав.' });
    expect(edited.status).toBe(200);

    const stored = await PlannedWorkTask.findById(taskId);
    expect(stored?.status).toBe('DONE');
    expect(stored?.score).toBeNull();

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.body.data.tasks[0].status).toBe('DONE');
    expect(detail.body.data.tasks[0].missingEvidence).toEqual([]);
    expect(detail.body.data.completionBlockers).toEqual([]);

    // And it does not block the parent planned work from completing.
    expect((await transition(workId, 'COMPLETE')).status).toBe(200);
  });
});
