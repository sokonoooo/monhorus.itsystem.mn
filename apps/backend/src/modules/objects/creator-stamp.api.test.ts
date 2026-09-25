import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createSuperUser, resetDomainCollections, startTestApp, stopTestApp } from '../../test/helpers';
import { Customer } from './object.models';

const API = '/api/v1';

let app: Express;
let token: string;
let adminName: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

function authed(method: 'get' | 'post', path: string) {
  return request(app)[method](`${API}${path}`).set('Authorization', `Bearer ${token}`);
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
  adminName = 'Super Admin';
  token = await login(admin.email, admin.password);
});

/**
 * The creator stamp, end to end.
 *
 * Customers and the project/building/floor tree had NO creator field at all until now, so
 * these cover the whole path rather than one layer: the create stamps an id, the list
 * resolves it to a name, and a record that predates the field still answers honestly with
 * null instead of borrowing somebody else's name.
 */
describe('creator stamp on newly created records', () => {
  it('records who created a customer and returns the name on the list', async () => {
    const created = await authed('post', '/objects/customers').send({
      code: 'CT',
      name: 'Central Tower ХХК',
      phone: '7711-0000',
    });
    expect(created.status).toBe(201);

    const list = await authed('get', '/objects/customers');
    expect(list.status).toBe(200);

    const row = list.body.data.items.find(
      (item: { id: string }) => item.id === created.body.data.id,
    );
    expect(row.createdByName).toBe(adminName);
  });

  it('records who created a project, and its buildings and floors', async () => {
    const customer = await authed('post', '/objects/customers').send({
      code: 'CT',
      name: 'Central Tower ХХК',
      phone: '7711-0000',
    });
    const customerId = customer.body.data.id as string;

    const project = await authed('post', '/projects').send({
      customerId,
      name: 'Урьдчилан сэргийлэх үйлчилгээ',
    });
    expect(project.status).toBe(201);

    const building = await authed('post', '/buildings').send({
      projectId: project.body.data.id,
      name: 'Төв барилга',
    });
    expect(building.status).toBe(201);

    const floor = await authed('post', '/floors').send({
      buildingId: building.body.data.id,
      name: '2 давхар',
      floorNumber: 2,
    });
    expect(floor.status).toBe(201);

    // All three are ObjectNode rows, so one missing stamp would show up as one null here.
    const projects = await authed('get', '/projects');
    const buildings = await authed('get', `/buildings?projectId=${project.body.data.id}`);
    const floors = await authed('get', `/floors?buildingId=${building.body.data.id}`);

    expect(projects.body.data.items[0].createdByName).toBe(adminName);
    expect(buildings.body.data.items[0].createdByName).toBe(adminName);
    expect(floors.body.data.items[0].createdByName).toBe(adminName);
  });

  /**
   * The case every existing row in the database is in. It must read as "not known", not as
   * a name belonging to somebody else and not as a crash.
   */
  it('reports null for a record created before the creator was recorded', async () => {
    // Written straight to the collection with no creator, exactly as every pre-existing row
    // looks after the schema change.
    await Customer.create({ code: 'OLD', name: 'Хуучин харилцагч' });

    const list = await authed('get', '/objects/customers');

    const row = list.body.data.items.find((item: { code: string }) => item.code === 'OLD');
    expect(row).toBeDefined();
    expect(row.createdByName).toBeNull();
  });
});
