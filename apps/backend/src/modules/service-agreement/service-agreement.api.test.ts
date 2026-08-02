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
} from '../../test/helpers';
import { AuditLog } from '../audit/audit-log.model';
import { Employee } from '../employee/employee.model';

const API = '/api/v1';

let app: Express;
let org: OrgFixture;
let token: string;
let customerId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

function validAgreement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerId,
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    serviceType: 'Урьдчилан сэргийлэх үзлэг',
    monthlyFee: 1_500_000,
    frequency: 'MONTHLY',
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

  const admin = await createSuperUser();
  token = await login(admin.email, admin.password);

  const customer = await request(app)
    .post(`${API}/objects/customers`)
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'CT', name: 'Central Tower ХХК' });
  customerId = customer.body.data.id as string;
});

describe('customer extended fields', () => {
  it('stores the tax number and responsible employee', async () => {
    const employee = await Employee.create({
      employeeCode: 'EMP-RESP',
      firstName: 'Хариуцагч',
      lastName: 'Тест',
      company: org.companyId,
      department: org.departmentId,
      position: org.positionId,
      employeeType: 'FULL_TIME',
      employmentStartDate: new Date('2024-01-01'),
      status: 'ACTIVE',
    });

    const response = await request(app)
      .patch(`${API}/objects/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        taxNumber: '99887766',
        responsibleEmployeeId: String(employee._id),
        notes: 'Тэмдэглэл',
      });

    expect(response.status).toBe(200);
    expect(response.body.data.taxNumber).toBe('99887766');
    expect(response.body.data.responsibleEmployeeName).toBe('Тест Хариуцагч');
  });

  it('returns project, building and agreement counts on the detail endpoint', async () => {
    await request(app)
      .post(`${API}/service-agreements`)
      .set('Authorization', `Bearer ${token}`)
      .send(validAgreement());

    const response = await request(app)
      .get(`${API}/objects/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.projectCount).toBe(0);
    expect(response.body.data.buildingCount).toBe(0);
    // The new agreement is DRAFT, so it does not count as active.
    expect(response.body.data.activeAgreementCount).toBe(0);
  });

  it('paginates the customer list', async () => {
    const response = await request(app)
      .get(`${API}/objects/customers?limit=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.page).toBe(1);
    expect(response.body.data.total).toBe(1);
  });
});

describe('service agreement creation', () => {
  it('creates an agreement as DRAFT with a generated number', async () => {
    const response = await request(app)
      .post(`${API}/service-agreements`)
      .set('Authorization', `Bearer ${token}`)
      .send(validAgreement());

    expect(response.status).toBe(201);
    expect(response.body.data.agreementNumber).toMatch(/^SA-\d{4}-\d{4}$/);
    // Requirements 6.3: a new agreement is not billable until it becomes ACTIVE.
    expect(response.body.data.status).toBe('DRAFT');
  });

  it('defaults the SLA windows to the requirements section 8.1 values', async () => {
    const response = await request(app)
      .post(`${API}/service-agreements`)
      .set('Authorization', `Bearer ${token}`)
      .send(validAgreement());

    expect(response.body.data.slaUrgentHours).toBe(6);
    expect(response.body.data.slaStandardHours).toBe(24);
  });

  it('rejects an end date before the start date', async () => {
    const response = await request(app)
      .post(`${API}/service-agreements`)
      .set('Authorization', `Bearer ${token}`)
      .send(validAgreement({ startDate: '2026-06-01', endDate: '2026-01-01' }));

    expect(response.status).toBe(400);
    const fields = (response.body.issues as Array<{ field: string }>).map((issue) => issue.field);
    expect(fields).toContain('endDate');
  });

  it('requires a calendar rule for a CUSTOM frequency', async () => {
    const response = await request(app)
      .post(`${API}/service-agreements`)
      .set('Authorization', `Bearer ${token}`)
      .send(validAgreement({ frequency: 'CUSTOM' }));

    expect(response.status).toBe(400);
    const fields = (response.body.issues as Array<{ field: string }>).map((issue) => issue.field);
    expect(fields).toContain('calendarRule');
  });

  it('rejects a negative monthly fee', async () => {
    const response = await request(app)
      .post(`${API}/service-agreements`)
      .set('Authorization', `Bearer ${token}`)
      .send(validAgreement({ monthlyFee: -1 }));

    expect(response.status).toBe(400);
  });

  it('rejects an unknown customer', async () => {
    const response = await request(app)
      .post(`${API}/service-agreements`)
      .set('Authorization', `Bearer ${token}`)
      .send(validAgreement({ customerId: '507f1f77bcf86cd799439099' }));

    expect(response.status).toBe(400);
  });

  it('refuses a non-active responsible employee', async () => {
    const employee = await Employee.create({
      employeeCode: 'EMP-GONE',
      firstName: 'Гарсан',
      lastName: 'Тест',
      status: 'TERMINATED',
      terminationDate: new Date('2025-01-01'),
      terminationReason: 'Гэрээ дууссан',
    });

    const response = await request(app)
      .post(`${API}/service-agreements`)
      .set('Authorization', `Bearer ${token}`)
      .send(validAgreement({ responsibleEmployeeId: String(employee._id) }));

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('идэвхтэй ажилтан');
  });

  it('refuses creation without customer.manage', async () => {
    const user = await createUserWithPermissions('agreementview@test.mn', [
      PERMISSIONS.CUSTOMER_VIEW,
    ]);
    const viewerToken = await login(user.email, user.password);

    const response = await request(app)
      .post(`${API}/service-agreements`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send(validAgreement());

    expect(response.status).toBe(403);
  });

  it('writes an audit record on creation', async () => {
    await request(app)
      .post(`${API}/service-agreements`)
      .set('Authorization', `Bearer ${token}`)
      .send(validAgreement());

    const entries = await AuditLog.find({
      entityType: 'Customer',
      reason: 'service agreement created',
    });
    expect(entries).toHaveLength(1);
  });
});

describe('service agreement status transitions', () => {
  let agreementId: string;

  beforeEach(async () => {
    const created = await request(app)
      .post(`${API}/service-agreements`)
      .set('Authorization', `Bearer ${token}`)
      .send(validAgreement());
    agreementId = created.body.data.id as string;
  });

  it('activates an agreement so it becomes billable', async () => {
    const response = await request(app)
      .post(`${API}/service-agreements/${agreementId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ACTIVE');

    const customer = await request(app)
      .get(`${API}/objects/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(customer.body.data.activeAgreementCount).toBe(1);
  });

  it('requires a reason to suspend', async () => {
    const response = await request(app)
      .post(`${API}/service-agreements/${agreementId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUSPENDED' });

    expect(response.status).toBe(400);
    const fields = (response.body.issues as Array<{ field: string }>).map((issue) => issue.field);
    expect(fields).toContain('reason');
  });

  it('requires a reason to cancel and records it', async () => {
    const refused = await request(app)
      .post(`${API}/service-agreements/${agreementId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED' });
    expect(refused.status).toBe(400);

    const accepted = await request(app)
      .post(`${API}/service-agreements/${agreementId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED', reason: 'Харилцагчийн хүсэлтээр' });

    expect(accepted.status).toBe(200);
    expect(accepted.body.data.statusReason).toBe('Харилцагчийн хүсэлтээр');

    const entries = await AuditLog.find({ entityType: 'Customer', action: 'StatusChanged' });
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects a transition to the current status', async () => {
    const response = await request(app)
      .post(`${API}/service-agreements/${agreementId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DRAFT' });

    expect(response.status).toBe(400);
  });

  it('lists agreements for a customer', async () => {
    const response = await request(app)
      .get(`${API}/service-agreements?customerId=${customerId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].customerName).toBe('Central Tower ХХК');
  });
});
