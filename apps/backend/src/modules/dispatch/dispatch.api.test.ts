import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
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
  createCallableObjectType,
} from '../../test/helpers';
import { Employee } from '../employee/employee.model';
import { Customer, ObjectNode } from '../objects/object.models';

const API = '/api/v1';

let app: Express;
let org: OrgFixture;
let token: string;
let callableTypeId: string;
let customerId: string;
let buildingId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function makeEmployee(
  code: string,
  status: 'ACTIVE' | 'TERMINATED',
  extras: Record<string, unknown> = {},
): Promise<string> {
  const employee = await Employee.create({
    employeeCode: code,
    firstName: 'Тест',
    lastName: code,
    company: org.companyId,
    department: org.departmentId,
    position: org.positionId,
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    status,
    ...(status === 'TERMINATED'
      ? { terminationDate: new Date('2025-01-01'), terminationReason: 'Гэрээ дууссан' }
      : {}),
    ...extras,
  });
  return String(employee._id);
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
  org = await createOrgFixture();

  const customer = await Customer.create({ code: 'CT', name: 'Central Tower ХХК' });
  const building = await ObjectNode.create({
    kind: 'BUILDING',
    code: 'B1',
    name: 'Main Tower',
    parent: null,
    customer: customer._id,
    ancestors: [],
  });
  customerId = String(customer._id);
  buildingId = String(building._id);

  const admin = await createSuperUser();
  token = await login(admin.email, admin.password);
});

describe('dispatch employee candidates', () => {
  it('returns only ACTIVE employees', async () => {
    await makeEmployee('EMP-ACTIVE', 'ACTIVE');
    await makeEmployee('EMP-GONE', 'TERMINATED');

    const response = await request(app)
      .get(`${API}/dispatch/employee-candidates`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].employeeCode).toBe('EMP-ACTIVE');
  });

  it('reports zero workload and availability for an unassigned employee', async () => {
    await makeEmployee('EMP-FREE', 'ACTIVE');

    const response = await request(app)
      .get(`${API}/dispatch/employee-candidates`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data[0].activeAssignments).toBe(0);
    expect(response.body.data[0].isAvailable).toBe(true);
  });

  it('counts an active assignment and marks the employee unavailable', async () => {
    const employeeId = await makeEmployee('EMP-BUSY', 'ACTIVE');

    const created = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        buildingId,
        requestType: 'URGENT_CALL',
        objectTypeId: callableTypeId,
        isUrgent: true,
        description: 'Богино холболт илэрсэн',
        contactName: 'Б. Болд',
        contactPhone: '9911-2233',
      });

    await request(app)
      .post(`${API}/service-requests/${created.body.data.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeIds: [employeeId] });

    const response = await request(app)
      .get(`${API}/dispatch/employee-candidates`)
      .set('Authorization', `Bearer ${token}`);

    const candidate = response.body.data.find(
      (entry: { employeeCode: string }) => entry.employeeCode === 'EMP-BUSY',
    );
    expect(candidate.activeAssignments).toBe(1);
    expect(candidate.isAvailable).toBe(false);
  });

  it('filters to available employees only when asked', async () => {
    const busyId = await makeEmployee('EMP-BUSY2', 'ACTIVE');
    await makeEmployee('EMP-FREE2', 'ACTIVE');

    const created = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        buildingId,
        requestType: 'STANDARD_CALL',
        objectTypeId: callableTypeId,
        isUrgent: false,
        description: 'Гэрэл асахгүй байна',
        contactName: 'Б. Болд',
        contactPhone: '9911-2233',
      });

    await request(app)
      .post(`${API}/service-requests/${created.body.data.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeIds: [busyId] });

    const response = await request(app)
      .get(`${API}/dispatch/employee-candidates?availableOnly=true`)
      .set('Authorization', `Bearer ${token}`);

    const codes = response.body.data.map((entry: { employeeCode: string }) => entry.employeeCode);
    expect(codes).toContain('EMP-FREE2');
    expect(codes).not.toContain('EMP-BUSY2');
  });

  it('filters by skill', async () => {
    await makeEmployee('EMP-SKILL', 'ACTIVE', { skills: ['UPS', 'Кабель'] });
    await makeEmployee('EMP-OTHER', 'ACTIVE', { skills: ['Гэрэл'] });

    const response = await request(app)
      .get(`${API}/dispatch/employee-candidates?skill=UPS`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].employeeCode).toBe('EMP-SKILL');
  });

  it('refuses candidates without dispatch.view', async () => {
    const user = await createUserWithPermissions('nodispatch2@test.mn', [
      PERMISSIONS.EMPLOYEE_VIEW,
    ]);
    const viewerToken = await login(user.email, user.password);

    const response = await request(app)
      .get(`${API}/dispatch/employee-candidates`)
      .set('Authorization', `Bearer ${viewerToken}`);

    expect(response.status).toBe(403);
  });
});

describe('dispatch team candidates', () => {
  it('returns teams with their active member count', async () => {
    await makeEmployee('EMP-T1', 'ACTIVE', { team: org.teamId });
    await makeEmployee('EMP-T2', 'ACTIVE', { team: org.teamId });
    // A terminated member must not inflate the count.
    await makeEmployee('EMP-T3', 'TERMINATED', { team: org.teamId });

    const response = await request(app)
      .get(`${API}/dispatch/team-candidates`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const team = response.body.data.find((entry: { id: string }) => entry.id === org.teamId);
    expect(team.memberCount).toBe(2);
  });
});

/**
 * The board is the only place a dispatcher sees new work, and it had no end-to-end test
 * of its own: the shipped board queried UNASSIGNED but every request is created NEW, so
 * a freshly filed request was invisible until somebody assigned it by other means. These
 * cases go through the real create endpoint rather than writing a status straight to the
 * collection, so nothing here can pass while creation and the board disagree again.
 */
describe('dispatch board', () => {
  async function createRequest(description: string): Promise<{ id: string; number: string }> {
    const created = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        buildingId,
        requestType: 'STANDARD_CALL',
        objectTypeId: callableTypeId,
        isUrgent: false,
        description,
        contactName: 'Б. Болд',
        contactPhone: '9911-2233',
      });
    expect(created.status).toBe(201);
    return { id: created.body.data.id as string, number: created.body.data.requestNumber as string };
  }

  async function fetchBoard(): Promise<
    { id: string; statuses: string[]; total: number; items: { id: string }[] }[]
  > {
    const response = await request(app)
      .get(`${API}/dispatch/board`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return response.body.data.columns;
  }

  it('shows a newly created request in the merged open column', async () => {
    const created = await createRequest('Гэрэл асахгүй байна');

    const columns = await fetchBoard();
    const open = columns.find((column) => column.id === 'OPEN');

    expect(open).toBeDefined();
    expect(open?.statuses).toEqual(['NEW', 'UNASSIGNED']);
    expect(open?.total).toBe(1);
    expect(open?.items.map((item) => item.id)).toContain(created.id);
  });

  it('keeps a request in the open column once it moves NEW -> UNASSIGNED', async () => {
    const created = await createRequest('Автомат унтарсан');

    await request(app)
      .post(`${API}/service-requests/${created.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'UNASSIGNED' });

    const columns = await fetchBoard();
    const open = columns.find((column) => column.id === 'OPEN');

    // One column, one card — the merge must not double-count across its two statuses.
    expect(open?.total).toBe(1);
    expect(open?.items.map((item) => item.id)).toEqual([created.id]);
  });

  it('shows a paused request in the WAITING column', async () => {
    const created = await createRequest('Сэлбэг хүлээж байна');
    const employeeId = await makeEmployee('EMP-BOARD', 'ACTIVE');

    await request(app)
      .post(`${API}/service-requests/${created.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeIds: [employeeId] });

    for (const status of ['ACCEPTED', 'ON_THE_WAY', 'WAITING']) {
      const changed = await request(app)
        .post(`${API}/service-requests/${created.id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status, reason: 'Сэлбэг хүлээгдэж байна' });
      expect(changed.status).toBe(200);
    }

    const columns = await fetchBoard();
    const waiting = columns.find((column) => column.id === 'WAITING');

    expect(waiting?.total).toBe(1);
    expect(waiting?.items.map((item) => item.id)).toEqual([created.id]);
    // And it left the open column rather than showing in both.
    expect(columns.find((column) => column.id === 'OPEN')?.total).toBe(0);
  });
});

describe('employee workload on the detail page', () => {
  it('reports the real assignment counts', async () => {
    const employeeId = await makeEmployee('EMP-LOAD', 'ACTIVE');

    const created = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        buildingId,
        requestType: 'REPAIR',
        objectTypeId: callableTypeId,
        isUrgent: false,
        description: 'Розетка солих',
        contactName: 'Б. Болд',
        contactPhone: '9911-2233',
      });

    await request(app)
      .post(`${API}/service-requests/${created.body.data.id}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeIds: [employeeId] });

    const detail = await request(app)
      .get(`${API}/employees/${employeeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.workload.activeAssignments).toBe(1);
    expect(detail.body.data.workload.completedAssignments).toBe(0);
  });
});
