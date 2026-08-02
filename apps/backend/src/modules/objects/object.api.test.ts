import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { AuditLog } from '../audit/audit-log.model';

const API = '/api/v1';

let app: Express;
let token: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function createCustomer(code = 'CT'): Promise<string> {
  const response = await request(app)
    .post(`${API}/objects/customers`)
    .set('Authorization', `Bearer ${token}`)
    .send({ code, name: `${code} ХХК`, phone: '7711-0000' });
  return response.body.data.id as string;
}

async function createNode(
  kind: string,
  code: string,
  customerId: string,
  parentId: string | null,
): Promise<request.Response> {
  return request(app)
    .post(`${API}/objects/nodes`)
    .set('Authorization', `Bearer ${token}`)
    .send({ kind, code, name: `${kind} ${code}`, customerId, parentId });
}

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  const admin = await createSuperUser();
  token = await login(admin.email, admin.password);
});

describe('customer write operations', () => {
  it('creates a customer and audits it', async () => {
    const response = await request(app)
      .post(`${API}/objects/customers`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'CT', name: 'Central Tower ХХК', phone: '7711-0000' });

    expect(response.status).toBe(201);
    expect(response.body.data.code).toBe('CT');

    const audit = await AuditLog.find({ entityType: 'Customer', action: 'Created' });
    expect(audit).toHaveLength(1);
  });

  it('rejects a duplicate customer code', async () => {
    await createCustomer('CT');

    const response = await request(app)
      .post(`${API}/objects/customers`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'CT', name: 'Өөр нэр' });

    expect(response.status).toBe(409);
  });

  it('rejects an invalid phone format', async () => {
    const response = await request(app)
      .post(`${API}/objects/customers`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'BAD', name: 'Тест', phone: '123' });

    expect(response.status).toBe(400);
  });

  it('updates a customer', async () => {
    const customerId = await createCustomer('CT');

    const response = await request(app)
      .patch(`${API}/objects/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Шинэ нэр', isActive: false });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Шинэ нэр');
    expect(response.body.data.isActive).toBe(false);
  });

  it('refuses customer creation without customer.manage', async () => {
    const user = await createUserWithPermissions('readonly@test.mn', [PERMISSIONS.CUSTOMER_VIEW]);
    const viewerToken = await login(user.email, user.password);

    const response = await request(app)
      .post(`${API}/objects/customers`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ code: 'NEW', name: 'Тест' });

    expect(response.status).toBe(403);
  });
});

describe('object node hierarchy rules', () => {
  it('creates a root project without a parent', async () => {
    const customerId = await createCustomer();

    const response = await createNode('PROJECT', 'PRJ-1', customerId, null);

    expect(response.status).toBe(201);
    expect(response.body.data.parentId).toBeNull();
  });

  it('rejects a project that is given a parent', async () => {
    const customerId = await createCustomer();
    const project = await createNode('PROJECT', 'PRJ-1', customerId, null);

    const response = await createNode('PROJECT', 'PRJ-2', customerId, project.body.data.id);

    expect(response.status).toBe(400);
  });

  it('rejects a building with no parent', async () => {
    const customerId = await createCustomer();

    const response = await createNode('BUILDING', 'B1', customerId, null);

    expect(response.status).toBe(400);
  });

  it('rejects a parent of the wrong kind', async () => {
    const customerId = await createCustomer();
    const project = await createNode('PROJECT', 'PRJ-1', customerId, null);

    // A floor must sit under a building, not directly under a project.
    const response = await createNode('FLOOR', 'F1', customerId, project.body.data.id);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('BUILDING');
  });

  it('rejects a parent belonging to another customer', async () => {
    const customerA = await createCustomer('CTA');
    const customerB = await createCustomer('CTB');
    const project = await createNode('PROJECT', 'PRJ-A', customerA, null);

    const response = await createNode('BUILDING', 'B1', customerB, project.body.data.id);

    expect(response.status).toBe(400);
  });

  it('materialises the ancestor chain so the breadcrumb resolves', async () => {
    const customerId = await createCustomer();
    const project = await createNode('PROJECT', 'PRJ-1', customerId, null);
    const building = await createNode('BUILDING', 'B1', customerId, project.body.data.id);
    const floor = await createNode('FLOOR', 'F1', customerId, building.body.data.id);

    const response = await request(app)
      .get(`${API}/objects/nodes/${floor.body.data.id}/breadcrumb`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.map((entry: { kind: string }) => entry.kind)).toEqual([
      'PROJECT',
      'BUILDING',
      'FLOOR',
    ]);
  });

  it('rejects a duplicate code within the same customer', async () => {
    const customerId = await createCustomer();
    await createNode('PROJECT', 'PRJ-1', customerId, null);

    const response = await createNode('PROJECT', 'PRJ-1', customerId, null);

    expect(response.status).toBe(409);
  });

  it('derives the risk level from the score band', async () => {
    const customerId = await createCustomer();
    const project = await createNode('PROJECT', 'PRJ-1', customerId, null);

    const response = await request(app)
      .patch(`${API}/objects/nodes/${project.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ riskScore: 30 });

    expect(response.status).toBe(200);
    // Requirements section 10: 21-40 is CRITICAL.
    expect(response.body.data.riskLevel).toBe('CRITICAL');
  });

  it('rejects a risk score outside 0 to 100', async () => {
    const customerId = await createCustomer();
    const project = await createNode('PROJECT', 'PRJ-1', customerId, null);

    const response = await request(app)
      .patch(`${API}/objects/nodes/${project.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ riskScore: 140 });

    expect(response.status).toBe(400);
  });

  it('refuses node creation without object.manage', async () => {
    const customerId = await createCustomer();
    const user = await createUserWithPermissions('objview@test.mn', [PERMISSIONS.OBJECT_VIEW]);
    const viewerToken = await login(user.email, user.password);

    const response = await request(app)
      .post(`${API}/objects/nodes`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ kind: 'PROJECT', code: 'X', name: 'X', customerId, parentId: null });

    expect(response.status).toBe(403);
  });
});
