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
} from '../../test/helpers';
import { Employee } from '../employee/employee.model';

/**
 * THE PHOTOGRAPHIC REPORT IS NOT A WAY AROUND THE OTHER TWO.
 *
 * `GET /:plannedWorkId/report/photo-pdf` renders the same work as `/report` and
 * `/report/pdf`, is keyed on the same `planned_work.view`, and sits directly beside them.
 * A document that answered a caller the other two refuse would make the assignment scope
 * decorative: the same customer, site, crew and photographs, reachable by asking for a
 * different file extension.
 *
 * These tests exist because the route was written against the raw `findPlannedWorkOrThrow`
 * — the loader the write paths use, which applies no scope of its own — exactly as the two
 * older report reads were. All three now go through `findReadableWorkOrThrow`.
 *
 * WHAT IS ASSERTED, AND WHY IT IS ENOUGH. The scope gate runs before the report is
 * assembled, so a caller inside the scope reaches the completeness check and one outside it
 * does not. That makes 404 the signal for "refused by scope" and anything else — 200 with a
 * PDF, or 400 for an unfinished report — the signal for "admitted". Asserting an exact
 * success status would tie this file to how complete the fixture's report happens to be,
 * which is not what is under test.
 *
 * 404 rather than 403 is deliberate and is asserted: a refusal confirming the id names a
 * real job would turn the endpoint into an oracle for probing identifiers.
 */

const API = '/api/v1';

/** The planned-work keys the seeded TECHNICIAN role grants, and nothing more. */
const TECHNICIAN_KEYS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS,
  PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
] as const;

/** A planner: the doing keys plus the oversight ones that lift the assignment bound. */
const SUPERVISOR_KEYS = [
  ...TECHNICIAN_KEYS,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_APPROVE,
] as const;

let app: Express;
let org: OrgFixture;
let objects: ObjectFixture;

let supervisorToken: string;
let assignedToken: string;
let strangerToken: string;
let assignedEmployeeId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

/**
 * An account plus the employee card it is linked to. The link is what `employeeId` resolves
 * from, so it is the only way to make a caller "an employee" as far as the scope is
 * concerned — an account without one matches no assignment at all.
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

  return { token: await login(user.email, user.password), employeeId: String(employee._id) };
}

/** A PLANNED work whose only crew member is the assignee, and which names no team. */
async function plannedWorkForAssignee(): Promise<string> {
  const created = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send({
      projectId: objects.projectId,
      buildingId: objects.buildingId,
      title: 'Хагас жилийн урьдчилан сэргийлэх үзлэг',
      plannedStartDate: '2026-07-01T00:00:00.000Z',
      plannedEndDate: '2026-07-31T00:00:00.000Z',
      assignedEmployeeIds: [],
    });
  expect(created.status).toBe(201);
  const workId = created.body.data.id as string;

  const plan = await request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send({ action: 'PLAN' });
  expect(plan.status).toBe(200);

  const approve = await request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send({ action: 'APPROVE', assignedEmployeeIds: [assignedEmployeeId] });
  expect(approve.status).toBe(200);

  return workId;
}

const photoPdf = (workId: string): string =>
  `${API}/planned-work/${workId}/report/photo-pdf`;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  org = await createOrgFixture();
  objects = await createObjectFixture();

  const supervisor = await createStaff('photo-scope-sup@test.mn', 'SUP-P1', SUPERVISOR_KEYS);
  supervisorToken = supervisor.token;

  const assigned = await createStaff('photo-scope-asg@test.mn', 'ASG-P1', TECHNICIAN_KEYS);
  assignedToken = assigned.token;
  assignedEmployeeId = assigned.employeeId;

  const stranger = await createStaff('photo-scope-str@test.mn', 'STR-P1', TECHNICIAN_KEYS);
  strangerToken = stranger.token;
});

describe('the photographic report obeys the assignment scope of the report it copies', () => {
  it('answers a technician who is not on the job not-found', async () => {
    const workId = await plannedWorkForAssignee();

    const refused = await request(app)
      .get(photoPdf(workId))
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(refused.status).toBe(404);
  });

  it('is indistinguishable from an id that was never real', async () => {
    const workId = await plannedWorkForAssignee();

    const outOfScope = await request(app)
      .get(photoPdf(workId))
      .set('Authorization', `Bearer ${strangerToken}`);
    const invented = await request(app)
      .get(photoPdf('0'.repeat(24)))
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(outOfScope.status).toBe(invented.status);
    expect(outOfScope.body.message).toBe(invented.body.message);
  });

  it('admits the assigned technician', async () => {
    const workId = await plannedWorkForAssignee();

    const admitted = await request(app)
      .get(photoPdf(workId))
      .set('Authorization', `Bearer ${assignedToken}`);

    // Past the scope gate. Whether the report is assembled enough to render is a different
    // question, answered by a different status - see the file docblock.
    expect(admitted.status).not.toBe(404);
  });

  it('leaves an oversight holder unbounded', async () => {
    const workId = await plannedWorkForAssignee();

    const admitted = await request(app)
      .get(photoPdf(workId))
      .set('Authorization', `Bearer ${supervisorToken}`);

    // The supervisor is on no crew and no team; `planned_work.update` is what lifts the
    // bound. This is what makes the refusal above scope rather than a blanket lock-out.
    expect(admitted.status).not.toBe(404);
  });

  it('refuses the stranger on all three report reads alike', async () => {
    const workId = await plannedWorkForAssignee();

    for (const path of [
      `${API}/planned-work/${workId}/report`,
      `${API}/planned-work/${workId}/report/pdf`,
      photoPdf(workId),
    ]) {
      const refused = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${strangerToken}`);
      expect(refused.status, `${path} must refuse a stranger`).toBe(404);
    }
  });
});
