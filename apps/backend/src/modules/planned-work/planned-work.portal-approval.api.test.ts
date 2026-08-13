import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
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
  type TestUser,
} from '../../test/helpers';
import { Employee } from '../employee/employee.model';
import { Customer, ObjectNode } from '../objects/object.models';
import { User } from '../user/user.model';
import { PlannedWork } from './planned-work.models';

/**
 * THE CUSTOMER-RAISED PLANNED WORK FLOW.
 *
 * The property every case here circles is one sentence:
 *
 *   A CUSTOMER MAY ASK FOR WORK, AND NOBODY IS ON IT UNTIL AN AUTHORISED APPROVER SAYS SO.
 *
 * `assignedEmployees` is the field every scope check and every technician-facing query
 * reads, so the assertions are mostly about that field being empty when it should be and
 * populated exactly when approval says — not about the status label, which is the visible
 * symptom rather than the mechanism.
 */

const API = '/api/v1';

/** Raises work and follows it. Holds no staff planned-work key at all. */
const PORTAL_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.PORTAL_PLANNED_WORK_VIEW,
  PERMISSIONS.PORTAL_PLANNED_WORK_CREATE,
];

/** The authorised admin. Approves and assigns; does not raise customer work. */
const APPROVER_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_APPROVE,
];

/** A planner with no approval authority, to prove the key is what decides. */
const PLANNER_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
];

let app: Express;
let org: OrgFixture;
let objects: ObjectFixture;

let portalToken: string;
let approverToken: string;
let plannerToken: string;
let employeeId: string;
let foreignBuildingId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function createCustomerUser(email: string, customerId: string): Promise<TestUser> {
  const user = await createUserWithPermissions(email, PORTAL_PERMISSIONS);
  await User.updateOne(
    { _id: new Types.ObjectId(user.userId) },
    { $set: { role: 'customer', customer: new Types.ObjectId(customerId) } },
  );
  return user;
}

function workBody(buildingId: string, overrides: Record<string, unknown> = {}) {
  return {
    buildingId,
    title: 'Улирлын урьдчилан сэргийлэх үзлэг',
    plannedStartDate: '2026-09-01T00:00:00.000Z',
    plannedEndDate: '2099-09-03T00:00:00.000Z',
    assignedEmployeeIds: [],
    ...overrides,
  };
}

/** Raises one as the customer and returns its id. */
async function raiseAsCustomer(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${portalToken}`)
    .send(workBody(objects.buildingId, overrides));
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

function transition(workId: string, body: Record<string, unknown>, bearer: string) {
  return request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${bearer}`)
    .send(body);
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

  const portal = await createCustomerUser('pwportal@test.mn', objects.customerId);
  portalToken = await login(portal.email, portal.password);

  const approver = await createUserWithPermissions('pwapprover@test.mn', APPROVER_PERMISSIONS);
  approverToken = await login(approver.email, approver.password);

  const planner = await createUserWithPermissions('pwplanner@test.mn', PLANNER_PERMISSIONS);
  plannerToken = await login(planner.email, planner.password);

  const employee = await Employee.create({
    employeeCode: 'E-PORTAL-1',
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

  const foreign = await Customer.create({ code: 'OT', name: 'Бусад ХХК' });
  const foreignBuilding = await ObjectNode.create({
    customer: foreign._id,
    kind: 'BUILDING',
    code: 'B-OT',
    name: 'Өөр барилга',
    parent: null,
    ancestors: [],
  });
  foreignBuildingId = String(foreignBuilding._id);
});

describe('a customer raising planned work', () => {
  it('creates a real planned work in PENDING_APPROVAL with nobody on it', async () => {
    const workId = await raiseAsCustomer();

    const work = await PlannedWork.findById(workId);
    expect(work?.status).toBe('PENDING_APPROVAL');
    expect(work?.assignedEmployees).toHaveLength(0);
    expect(work?.assignedTeam).toBeNull();
    // A real PlannedWork record, with its own work number — not a service request.
    expect(work?.workNumber).toMatch(/^PW-/);
    expect(String(work?.customer)).toBe(objects.customerId);
  });

  /**
   * The crew is forced empty server-side, so naming one in the payload changes nothing.
   * That is what makes "cannot be assigned before approval" a property of the data.
   */
  it('ignores a crew the customer tries to name', async () => {
    const workId = await raiseAsCustomer({ assignedEmployeeIds: [employeeId] });

    expect((await PlannedWork.findById(workId))?.assignedEmployees).toHaveLength(0);
  });

  it('refuses to raise work on another organisation building', async () => {
    const response = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${portalToken}`)
      .send(workBody(foreignBuildingId));

    expect(response.status).toBe(400);
    expect(await PlannedWork.countDocuments({ building: foreignBuildingId })).toBe(0);
  });

  it('lists and reads its own work, and 404s another organisation', async () => {
    const workId = await raiseAsCustomer();

    const list = await request(app)
      .get(`${API}/planned-work`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((item: { id: string }) => item.id)).toEqual([workId]);

    // Raised by staff for another tenant, so it exists but is not theirs.
    const foreign = await PlannedWork.create({
      workNumber: 'PW-FOREIGN-1',
      building: foreignBuildingId,
      customer: (await Customer.findOne({ code: 'OT' }))!._id,
      title: 'Өөр ажил',
      plannedStartDate: new Date('2026-09-01'),
      plannedEndDate: new Date('2099-09-03'),
      originalPlannedEndDate: new Date('2099-09-03'),
      status: 'PLANNED',
    });

    const detail = await request(app)
      .get(`${API}/planned-work/${String(foreign._id)}`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(detail.status).toBe(404);
  });

  it('cannot drive the lifecycle itself', async () => {
    const workId = await raiseAsCustomer();

    for (const action of ['APPROVE', 'START', 'PLAN']) {
      const response = await transition(workId, { action }, portalToken);
      expect(response.status).toBe(403);
    }
    expect((await PlannedWork.findById(workId))?.status).toBe('PENDING_APPROVAL');
  });
});

describe('approval is what makes it assignable', () => {
  it('refuses assignment while the work is pending', async () => {
    const workId = await raiseAsCustomer();

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ assignedEmployeeIds: [employeeId] });

    expect(response.status).toBe(400);
    expect((await PlannedWork.findById(workId))?.assignedEmployees).toHaveLength(0);
  });

  /**
   * The same rule one level down. A sub-task carries its own assignee, and that path only
   * ever checked `assertMutable` — which permits PENDING_APPROVAL — so the sub-tasks of an
   * unapproved customer request could be staffed even though the work-level crew could not.
   */
  it('refuses naming an employee on a sub-task while the work is pending', async () => {
    const workId = await raiseAsCustomer();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        title: 'Шатны үзлэг',
        totalQuantity: 4,
        plannedStartDate: '2026-09-01T00:00:00.000Z',
        plannedEndDate: '2026-09-02T00:00:00.000Z',
        assignedEmployeeId: employeeId,
      });

    expect(response.status).toBe(400);
  });

  /** Scoping the job before approving it is fine — only the promise to a person is refused. */
  it('allows an unassigned sub-task while the work is pending', async () => {
    const workId = await raiseAsCustomer();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        title: 'Шатны үзлэг',
        totalQuantity: 4,
        plannedStartDate: '2026-09-01T00:00:00.000Z',
        plannedEndDate: '2026-09-02T00:00:00.000Z',
      });

    expect(response.status).toBe(201);
  });

  it('approves to PLANNED and only then accepts a crew', async () => {
    const workId = await raiseAsCustomer();

    const approved = await transition(workId, { action: 'APPROVE' }, approverToken);
    expect(approved.status).toBe(200);
    expect((await PlannedWork.findById(workId))?.status).toBe('PLANNED');

    const assigned = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ assignedEmployeeIds: [employeeId] });

    expect(assigned.status).toBe(200);
    expect((await PlannedWork.findById(workId))?.assignedEmployees.map(String)).toEqual([
      employeeId,
    ]);
  });

  /** The approve key is what decides, not merely holding some planned-work permission. */
  it('refuses approval to a planner without the approve key', async () => {
    const workId = await raiseAsCustomer();

    const response = await transition(workId, { action: 'APPROVE' }, plannerToken);

    expect(response.status).toBe(403);
    expect((await PlannedWork.findById(workId))?.status).toBe('PENDING_APPROVAL');
  });

  it('rejects to CANCELLED with a reason the customer can read', async () => {
    const workId = await raiseAsCustomer();

    const rejected = await transition(
      workId,
      { action: 'REJECT', reason: 'Тухайн хугацаанд боломжгүй.' },
      approverToken,
    );
    expect(rejected.status).toBe(200);

    const work = await PlannedWork.findById(workId);
    expect(work?.status).toBe('CANCELLED');
    expect(work?.cancelReason).toBe('Тухайн хугацаанд боломжгүй.');
    expect(work?.assignedEmployees).toHaveLength(0);

    // And the customer sees it on their own read.
    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.cancelReason).toBe('Тухайн хугацаанд боломжгүй.');
  });

  it('requires a reason to reject', async () => {
    const workId = await raiseAsCustomer();

    const response = await transition(workId, { action: 'REJECT' }, approverToken);

    expect(response.status).toBe(400);
    expect((await PlannedWork.findById(workId))?.status).toBe('PENDING_APPROVAL');
  });

  /**
   * The end of the flow: once approved and assigned, the work reaches the employee through
   * the EXISTING assignment-scope filter. Nothing was added for this — it is why the
   * employee work list needed no change.
   */
  it('shows the approved work to the employee it was assigned to', async () => {
    const workId = await raiseAsCustomer();
    await transition(workId, { action: 'APPROVE' }, approverToken);
    await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ assignedEmployeeIds: [employeeId] });

    const technician = await createUserWithPermissions('pwtech@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
    ]);
    await Employee.updateOne(
      { _id: new Types.ObjectId(employeeId) },
      { $set: { systemUser: new Types.ObjectId(technician.userId) } },
    );
    const technicianToken = await login(technician.email, technician.password);

    const list = await request(app)
      .get(`${API}/planned-work`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(list.status).toBe(200);
    expect(list.body.data.items.map((item: { id: string }) => item.id)).toContain(workId);
  });

  /** Before approval the same technician must not see it — there is nothing to match on. */
  it('keeps a pending work out of every employee work list', async () => {
    await raiseAsCustomer();

    const technician = await createUserWithPermissions('pwtech2@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
    ]);
    await Employee.updateOne(
      { _id: new Types.ObjectId(employeeId) },
      { $set: { systemUser: new Types.ObjectId(technician.userId) } },
    );
    const technicianToken = await login(technician.email, technician.password);

    const list = await request(app)
      .get(`${API}/planned-work`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(list.body.data.items).toHaveLength(0);
  });
});

describe('the staff path is unchanged', () => {
  it('still creates staff work in DRAFT with the crew the planner named', async () => {
    const created = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${plannerToken}`)
      .send(workBody(objects.buildingId, { assignedEmployeeIds: [employeeId] }));

    expect(created.status).toBe(201);
    const work = await PlannedWork.findById(created.body.data.id as string);
    expect(work?.status).toBe('DRAFT');
    expect(work?.assignedEmployees.map(String)).toEqual([employeeId]);
  });

  it('still takes a staff draft straight to PLANNED with PLAN', async () => {
    const created = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${plannerToken}`)
      .send(workBody(objects.buildingId));
    const workId = created.body.data.id as string;

    const planned = await transition(workId, { action: 'PLAN' }, plannerToken);

    expect(planned.status).toBe(200);
    expect((await PlannedWork.findById(workId))?.status).toBe('PLANNED');
  });
});
