import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createOrgFixture,
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type OrgFixture,
  type TestUser,
} from '../../test/helpers';
import { AuditLog } from '../audit/audit-log.model';
import { Employee } from '../employee/employee.model';
import { Customer, ObjectNode } from '../objects/object.models';
import { User } from '../user/user.model';
import { ServiceRequest } from './service-request.model';

const API = '/api/v1';

let app: Express;
let org: OrgFixture;
let token: string;
let customerId: string;
let projectId: string;
let buildingId: string;
let floorId: string;
let foreignCustomerId: string;
let foreignProjectId: string;
let foreignBuildingId: string;
let foreignFloorId: string;
let foreignDeviceId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

/**
 * Two customers, each with its own project, building and floor.
 *
 * Both hierarchies are complete so cross-customer rejection can be exercised at every
 * level a request references, not only at the building.
 */
async function seedHierarchy(): Promise<void> {
  const customer = await Customer.create({ code: 'CT', name: 'Central Tower ХХК' });
  const foreign = await Customer.create({ code: 'OTHER', name: 'Бусад харилцагч' });

  const project = await ObjectNode.create({
    kind: 'PROJECT',
    code: 'P1',
    name: 'Үндсэн төсөл',
    parent: null,
    customer: customer._id,
    ancestors: [],
  });
  const building = await ObjectNode.create({
    kind: 'BUILDING',
    code: 'B1',
    name: 'Main Tower',
    parent: null,
    customer: customer._id,
    ancestors: [],
  });
  const floor = await ObjectNode.create({
    kind: 'FLOOR',
    code: 'F1',
    name: '1 давхар',
    parent: building._id,
    customer: customer._id,
    ancestors: [building._id],
  });

  const foreignProject = await ObjectNode.create({
    kind: 'PROJECT',
    code: 'P9',
    name: 'Өөр төсөл',
    parent: null,
    customer: foreign._id,
    ancestors: [],
  });
  const foreignBuilding = await ObjectNode.create({
    kind: 'BUILDING',
    code: 'B9',
    name: 'Өөр барилга',
    parent: null,
    customer: foreign._id,
    ancestors: [],
  });
  const foreignFloor = await ObjectNode.create({
    kind: 'FLOOR',
    code: 'F9',
    name: 'Өөр давхар',
    parent: foreignBuilding._id,
    customer: foreign._id,
    ancestors: [foreignBuilding._id],
  });
  const foreignDevice = await ObjectNode.create({
    kind: 'DEVICE',
    code: 'D9',
    name: 'Өөр төхөөрөмж',
    parent: foreignFloor._id,
    customer: foreign._id,
    ancestors: [foreignBuilding._id, foreignFloor._id],
  });

  customerId = String(customer._id);
  projectId = String(project._id);
  buildingId = String(building._id);
  floorId = String(floor._id);
  foreignCustomerId = String(foreign._id);
  foreignProjectId = String(foreignProject._id);
  foreignBuildingId = String(foreignBuilding._id);
  foreignFloorId = String(foreignFloor._id);
  foreignDeviceId = String(foreignDevice._id);
}

/**
 * A signed-in customer account: portal permissions plus the organisation link that the
 * scope resolver reads. The link lives on the user, which is the entire point: nothing a
 * request carries can change it.
 */
async function createCustomerUser(
  email: string,
  linkedCustomerId: string | null,
  permissions: readonly PermissionKey[] = [
    PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW,
    PERMISSIONS.PORTAL_SERVICE_REQUEST_CREATE,
  ],
): Promise<TestUser> {
  const user = await createUserWithPermissions(email, permissions);
  await User.updateOne(
    { _id: new Types.ObjectId(user.userId) },
    {
      $set: {
        role: 'customer',
        customer: linkedCustomerId ? new Types.ObjectId(linkedCustomerId) : null,
      },
    },
  );
  return user;
}

function validRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerId,
    buildingId,
    requestType: 'URGENT_CALL',
    isUrgent: true,
    description: 'Самбар дээр богино холболт илэрсэн',
    contactName: 'Б. Болд',
    contactPhone: '9911-2233',
    ...overrides,
  };
}

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  org = await createOrgFixture();
  await seedHierarchy();
  const admin = await createSuperUser();
  token = await login(admin.email, admin.password);
});

describe('service request creation', () => {
  it('creates a request and sets a six hour SLA for an urgent call', async () => {
    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send(validRequest());

    expect(response.status).toBe(201);
    expect(response.body.data.requestNumber).toMatch(/^SR-\d{6}-\d{4}$/);
    expect(response.body.data.status).toBe('NEW');

    const started = new Date(response.body.data.slaStartedAt).getTime();
    const due = new Date(response.body.data.slaDueAt).getTime();
    expect(Math.round((due - started) / (60 * 60 * 1000))).toBe(6);
  });

  it('sets a twenty four hour SLA for a standard call', async () => {
    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send(validRequest({ isUrgent: false, requestType: 'STANDARD_CALL' }));

    const started = new Date(response.body.data.slaStartedAt).getTime();
    const due = new Date(response.body.data.slaDueAt).getTime();
    expect(Math.round((due - started) / (60 * 60 * 1000))).toBe(24);
  });

  it('rejects a building belonging to another customer', async () => {
    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send(validRequest({ buildingId: foreignBuildingId }));

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a missing description', async () => {
    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send(validRequest({ description: '' }));

    expect(response.status).toBe(400);
  });

  it('writes an audit record on creation', async () => {
    await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send(validRequest());

    const entries = await AuditLog.find({ entityType: 'Work', action: 'Created' });
    expect(entries).toHaveLength(1);
  });
});

describe('service request workflow transitions', () => {
  let requestId: string;

  beforeEach(async () => {
    const created = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send(validRequest());
    requestId = created.body.data.id as string;
  });

  it('rejects an invalid transition', async () => {
    // NEW cannot jump straight to COMPLETED.
    const response = await request(app)
      .post(`${API}/service-requests/${requestId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'COMPLETED' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('шилжих боломжгүй');
  });

  it('accepts a valid transition and records history', async () => {
    const response = await request(app)
      .post(`${API}/service-requests/${requestId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'UNASSIGNED' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('UNASSIGNED');
    expect(response.body.data.statusHistory.length).toBeGreaterThanOrEqual(2);
  });

  it('requires a reason for a transition that mandates one', async () => {
    const response = await request(app)
      .post(`${API}/service-requests/${requestId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED' });

    expect(response.status).toBe(400);
    const fields = (response.body.issues as Array<{ field: string }>).map((issue) => issue.field);
    expect(fields).toContain('reason');
  });
});

describe('service request assignment', () => {
  let requestId: string;

  beforeEach(async () => {
    const created = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send(validRequest());
    requestId = created.body.data.id as string;
  });

  async function makeEmployee(status: 'ACTIVE' | 'TERMINATED'): Promise<string> {
    const employee = await Employee.create({
      employeeCode: `EMP-${status}`,
      firstName: 'Тест',
      lastName: 'Ажилтан',
      company: org.companyId,
      department: org.departmentId,
      position: org.positionId,
      employeeType: 'FULL_TIME',
      employmentStartDate: new Date('2024-01-01'),
      status,
      ...(status === 'TERMINATED'
        ? { terminationDate: new Date('2025-01-01'), terminationReason: 'Гэрээ дууссан' }
        : {}),
    });
    return String(employee._id);
  }

  it('assigns an active employee and moves the request to ASSIGNED', async () => {
    const employeeId = await makeEmployee('ACTIVE');

    const response = await request(app)
      .post(`${API}/service-requests/${requestId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeIds: [employeeId] });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ASSIGNED');
    expect(response.body.data.assignedEmployees).toHaveLength(1);
  });

  it('refuses to assign a terminated employee', async () => {
    const employeeId = await makeEmployee('TERMINATED');

    const response = await request(app)
      .post(`${API}/service-requests/${requestId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeIds: [employeeId] });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Идэвхгүй ажилтанд');
  });

  it('requires at least one employee or a team', async () => {
    const response = await request(app)
      .post(`${API}/service-requests/${requestId}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeIds: [] });

    expect(response.status).toBe(400);
  });

  it('refuses assignment without dispatch.assign', async () => {
    const user = await createUserWithPermissions('viewer2@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);
    const viewerToken = await login(user.email, user.password);
    const employeeId = await makeEmployee('ACTIVE');

    const response = await request(app)
      .post(`${API}/service-requests/${requestId}/assign`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ employeeIds: [employeeId] });

    expect(response.status).toBe(403);
  });

  it('extends the SLA and records the reason', async () => {
    const before = await request(app)
      .get(`${API}/service-requests/${requestId}`)
      .set('Authorization', `Bearer ${token}`);

    const response = await request(app)
      .post(`${API}/service-requests/${requestId}/extend-sla`)
      .set('Authorization', `Bearer ${token}`)
      .send({ additionalMinutes: 120, reason: 'Сэлбэг хүлээгдэж байна' });

    expect(response.status).toBe(200);
    expect(response.body.data.slaExtendedMinutes).toBe(120);

    const beforeDue = new Date(before.body.data.slaDueAt).getTime();
    const afterDue = new Date(response.body.data.slaDueAt).getTime();
    expect(Math.round((afterDue - beforeDue) / 60000)).toBe(120);
  });
});

/**
 * The customer boundary.
 *
 * Every case here is a cross-tenant attempt made through a different door: the query
 * string, the request body and a direct read by id. The permission guard is deliberately
 * not the only thing under test, because a permission says who may call an endpoint and a
 * scope says which records the answer may contain.
 */
describe('service request customer scope', () => {
  let ownRequestId: string;
  let foreignRequestId: string;
  let customerToken: string;

  /** Creates a request as the administrator, who may act for any customer. */
  async function seedRequestFor(owner: 'own' | 'foreign'): Promise<string> {
    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send(
        owner === 'own'
          ? validRequest()
          : validRequest({ customerId: foreignCustomerId, buildingId: foreignBuildingId }),
      );
    expect(response.status).toBe(201);
    return response.body.data.id as string;
  }

  beforeEach(async () => {
    ownRequestId = await seedRequestFor('own');
    foreignRequestId = await seedRequestFor('foreign');

    const customerUser = await createCustomerUser('portal-a@test.mn', customerId);
    customerToken = await login(customerUser.email, customerUser.password);
  });

  it('lists only the requests of the signed in customer', async () => {
    const response = await request(app)
      .get(`${API}/service-requests`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].id).toBe(ownRequestId);
    expect(response.body.data.total).toBe(1);
  });

  it('ignores a customerId query parameter naming another customer', async () => {
    const response = await request(app)
      .get(`${API}/service-requests`)
      .query({ customerId: foreignCustomerId })
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].id).toBe(ownRequestId);
    expect(response.body.data.items[0].customer.id).toBe(customerId);
  });

  it('reports another customer request as not found rather than forbidden', async () => {
    const response = await request(app)
      .get(`${API}/service-requests/${foreignRequestId}`)
      .set('Authorization', `Bearer ${customerToken}`);

    // Not 403: a forbidden answer would confirm the id exists in another organisation.
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
    // The record itself must not travel in the refusal.
    expect(response.body.data ?? null).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain(foreignRequestId);
  });

  it('serves the customer their own request by id', async () => {
    const response = await request(app)
      .get(`${API}/service-requests/${ownRequestId}`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(ownRequestId);
    expect(response.body.data.statusHistory.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses to create a request in another customer name', async () => {
    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(validRequest({ customerId: foreignCustomerId, buildingId: foreignBuildingId }));

    expect(response.status).toBe(403);
    expect(await ServiceRequest.countDocuments({ customer: foreignCustomerId })).toBe(1);
  });

  it('creates a request owned by the signed in customer', async () => {
    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(validRequest());

    expect(response.status).toBe(201);
    expect(response.body.data.customer.id).toBe(customerId);
  });

  it('refuses a request referencing another customer project', async () => {
    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(validRequest({ projectId: foreignProjectId }));

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    const fields = (response.body.issues as Array<{ field: string }>).map((issue) => issue.field);
    expect(fields).toContain('projectId');
  });

  it('refuses a request referencing another customer building', async () => {
    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(validRequest({ buildingId: foreignBuildingId }));

    expect(response.status).toBe(400);
    const fields = (response.body.issues as Array<{ field: string }>).map((issue) => issue.field);
    expect(fields).toContain('buildingId');
  });

  it('refuses a request referencing another customer floor', async () => {
    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(validRequest({ floorId: foreignFloorId }));

    expect(response.status).toBe(400);
    const fields = (response.body.issues as Array<{ field: string }>).map((issue) => issue.field);
    expect(fields).toContain('floorId');
  });

  it('refuses a request referencing another customer object', async () => {
    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(validRequest({ deviceId: foreignDeviceId }));

    expect(response.status).toBe(400);
    const fields = (response.body.issues as Array<{ field: string }>).map((issue) => issue.field);
    expect(fields).toContain('deviceId');
  });

  it('refuses a customer account with no linked organisation', async () => {
    const orphan = await createCustomerUser('portal-orphan@test.mn', null);
    const orphanToken = await login(orphan.email, orphan.password);

    const response = await request(app)
      .get(`${API}/service-requests`)
      .set('Authorization', `Bearer ${orphanToken}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('харилцагч байгууллагад холбогдоогүй');
  });

  it('refuses a customer the staff only actions', async () => {
    const employee = await Employee.create({
      employeeCode: 'EMP-SCOPE',
      firstName: 'Тест',
      lastName: 'Ажилтан',
      company: org.companyId,
      department: org.departmentId,
      position: org.positionId,
      employeeType: 'FULL_TIME',
      employmentStartDate: new Date('2024-01-01'),
      status: 'ACTIVE',
    });

    const assign = await request(app)
      .post(`${API}/service-requests/${ownRequestId}/assign`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ employeeIds: [String(employee._id)] });
    expect(assign.status).toBe(403);

    const extend = await request(app)
      .post(`${API}/service-requests/${ownRequestId}/extend-sla`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ additionalMinutes: 60, reason: 'Хүсэлт' });
    expect(extend.status).toBe(403);

    const status = await request(app)
      .post(`${API}/service-requests/${ownRequestId}/status`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ status: 'UNASSIGNED' });
    expect(status.status).toBe(403);

    const board = await request(app)
      .get(`${API}/dispatch/board`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(board.status).toBe(403);
  });

  /**
   * The scope has to hold on its own.
   *
   * This account is a customer that has been handed a staff write permission, which the
   * CUSTOMER role never grants. It exists to prove the write path is refused by the tenant
   * predicate and not merely by the permission guard in front of it.
   */
  it('refuses a scoped account a status change on another customer request', async () => {
    const scoped = await createCustomerUser('portal-writer@test.mn', customerId, [
      PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW,
      PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS,
    ]);
    const scopedToken = await login(scoped.email, scoped.password);

    const foreign = await request(app)
      .post(`${API}/service-requests/${foreignRequestId}/status`)
      .set('Authorization', `Bearer ${scopedToken}`)
      .send({ status: 'UNASSIGNED' });

    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('NOT_FOUND');

    const own = await request(app)
      .post(`${API}/service-requests/${ownRequestId}/status`)
      .set('Authorization', `Bearer ${scopedToken}`)
      .send({ status: 'UNASSIGNED' });

    expect(own.status).toBe(200);
    const untouched = await ServiceRequest.findById(foreignRequestId).select('status');
    expect(untouched?.status).toBe('NEW');
  });

  it('refuses a scoped account an assignment on another customer request', async () => {
    const scoped = await createCustomerUser('portal-dispatcher@test.mn', customerId, [
      PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW,
      PERMISSIONS.DISPATCH_ASSIGN,
    ]);
    const scopedToken = await login(scoped.email, scoped.password);
    const employee = await Employee.create({
      employeeCode: 'EMP-SCOPE-2',
      firstName: 'Тест',
      lastName: 'Ажилтан',
      company: org.companyId,
      department: org.departmentId,
      position: org.positionId,
      employeeType: 'FULL_TIME',
      employmentStartDate: new Date('2024-01-01'),
      status: 'ACTIVE',
    });

    const response = await request(app)
      .post(`${API}/service-requests/${foreignRequestId}/assign`)
      .set('Authorization', `Bearer ${scopedToken}`)
      .send({ employeeIds: [String(employee._id)] });

    expect(response.status).toBe(404);
    const untouched = await ServiceRequest.findById(foreignRequestId).select('assignedEmployees');
    expect(untouched?.assignedEmployees).toHaveLength(0);
  });

  it('keeps staff access across every customer', async () => {
    const response = await request(app)
      .get(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(2);
  });

  it('keeps the staff customerId filter working', async () => {
    const response = await request(app)
      .get(`${API}/service-requests`)
      .query({ customerId: foreignCustomerId })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].id).toBe(foreignRequestId);
  });

  it('serves staff any request by id', async () => {
    const response = await request(app)
      .get(`${API}/service-requests/${foreignRequestId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(foreignRequestId);
  });
});

describe('dispatch board', () => {
  it('returns one column per workflow status', async () => {
    const response = await request(app)
      .get(`${API}/dispatch/board`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.columns).toHaveLength(11);
    expect(response.body.data.columns[0].status).toBe('UNASSIGNED');
  });

  it('refuses the board without dispatch.view', async () => {
    const user = await createUserWithPermissions('nodispatch@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);
    const viewerToken = await login(user.email, user.password);

    const response = await request(app)
      .get(`${API}/dispatch/board`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(403);
  });
});
