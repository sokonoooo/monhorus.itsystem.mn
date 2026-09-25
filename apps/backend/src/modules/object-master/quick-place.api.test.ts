import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { hashPassword } from '../../utils/password.util';
import { Customer } from '../objects/object.models';
import { Role } from '../rbac/role.model';
import { User } from '../user/user.model';
import { ObjectRecord } from './object-master.models';

/**
 * Placing equipment from a single click on the floor plan.
 *
 * The whole point of the endpoint is that the caller supplies no identity, so most of what
 * is asserted here is about what the SERVER invents: that the code survives an index it
 * shares with hand-typed codes, and that the name is numbered against what the floor
 * already shows even when ten clicks arrive at once.
 */

const API = '/api/v1';

const FULL = [
  PERMISSIONS.OBJECT_VIEW,
  PERMISSIONS.OBJECT_MANAGE,
  PERMISSIONS.OBJECT_MASTER_VIEW,
  PERMISSIONS.OBJECT_MASTER_MANAGE,
  PERMISSIONS.OBJECT_TYPE_MANAGE,
] as const;

let app: Express;
let token: string;
let customerId: string;
let floorId: string;
let lampTypeId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

let portalRoleSequence = 0;

/** A `customer` account linked to one organisation, holding whatever keys the test needs. */
async function loginAsCustomer(
  email: string,
  linkedCustomerId: string | null,
  permissions: readonly PermissionKey[],
): Promise<string> {
  portalRoleSequence += 1;

  const role = await Role.create({
    key: `TEST_QUICKPLACE_ROLE_${portalRoleSequence}`,
    name: `Portal role ${email}`,
    description: null,
    permissions: [...permissions],
    isSystem: false,
  });

  const password = 'PortalPassword2026x';
  await User.create({
    fullName: `Portal ${email}`,
    email,
    password: await hashPassword(password),
    role: 'customer',
    roles: [role._id],
    status: 'active',
    customer: linkedCustomerId ? new Types.ObjectId(linkedCustomerId) : null,
    passwordChangedAt: new Date(),
  });

  return login(email, password);
}

async function createType(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${API}/object-types`)
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'LAMP', name: 'Гэрэлтүүлэг', category: 'EQUIPMENT', showOnPlan: true, ...overrides });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

/** A whole project → building → floor chain for one organisation. */
async function createFloor(
  ownerCustomerId: string,
  suffix: string,
  floorNumber = 1,
): Promise<string> {
  const project = await request(app)
    .post(`${API}/projects`)
    .set('Authorization', `Bearer ${token}`)
    .send({ customerId: ownerCustomerId, code: `PRJ-${suffix}`, name: `Төсөл ${suffix}` });
  expect(project.status).toBe(201);

  const building = await request(app)
    .post(`${API}/buildings`)
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId: project.body.data.id, code: `BLD-${suffix}`, name: `Барилга ${suffix}` });
  expect(building.status).toBe(201);

  const floor = await request(app)
    .post(`${API}/floors`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      buildingId: building.body.data.id,
      code: `FL-${suffix}`,
      name: `${floorNumber} давхар`,
      floorNumber,
    });
  expect(floor.status).toBe(201);
  return floor.body.data.id as string;
}

function quickPlace(
  body: Record<string, unknown> = {},
  authToken: string = token,
): request.Test {
  return request(app)
    .post(`${API}/objects-master/quick-place`)
    .set('Authorization', `Bearer ${authToken}`)
    .send({
      customerId,
      objectTypeId: lampTypeId,
      floorId,
      planPosition: { x: 0.5, y: 0.5 },
      ...body,
    });
}

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  const customer = await Customer.create({ code: 'CT', name: 'Central Tower ХХК' });
  customerId = String(customer._id);

  const user = await createUserWithPermissions('quickplace@test.mn', FULL);
  token = await login(user.email, user.password);

  floorId = await createFloor(customerId, '1');
  lampTypeId = await createType();
});

describe('quick placement', () => {
  it('creates an object from a type, a floor and a coordinate alone', async () => {
    const response = await quickPlace();

    expect(response.status).toBe(201);
    const data = response.body.data;
    expect(data.code).toBe('LAMP-001');
    expect(data.name).toBe('Гэрэлтүүлэг 1');
    expect(data.category).toBe('EQUIPMENT');
    expect(data.floorId).toBe(floorId);
    expect(data.planPosition).toEqual({ x: 0.5, y: 0.5 });
    expect(data.status).toBe('ACTIVE');
    // Everything the plan needs to draw the pin without refetching the list.
    expect(data.objectType).toMatchObject({
      id: lampTypeId,
      code: 'LAMP',
      name: 'Гэрэлтүүлэг',
      showOnPlan: true,
    });
    expect(data.objectType.iconUrl).toBeDefined();
    // An empty attribute block, not a missing one: the load service reads this as
    // "Бүрэн бус" rather than failing.
    expect(data.equipment).not.toBeNull();
    expect(data.equipment.ratedPowerKw).toBeNull();
    expect(data.calculatedLoad.valueKw).toBeNull();
    expect(data.calculatedLoad.complete).toBe(false);
    expect(data.calculatedLoad.reasons.length).toBeGreaterThan(0);
  });

  it('derives the category from the type rather than from the caller', async () => {
    const panelType = await createType({ code: 'DB', name: 'Түгээх самбар', category: 'PANEL' });
    const response = await quickPlace({ objectTypeId: panelType });

    expect(response.status).toBe(201);
    expect(response.body.data.category).toBe('PANEL');
    expect(response.body.data.code).toBe('DB-001');
    expect(response.body.data.panel).not.toBeNull();
    expect(response.body.data.equipment).toBeNull();
  });

  it('uses a slash-bearing type name verbatim', async () => {
    const lineType = await createType({ code: 'LINE', name: 'Хэлхээ/шугам', category: 'CIRCUIT' });
    const response = await quickPlace({ objectTypeId: lineType });

    expect(response.status).toBe(201);
    expect(response.body.data.name).toBe('Хэлхээ/шугам 1');
  });

  it('numbers codes upward within one customer', async () => {
    const codes: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await quickPlace();
      expect(response.status).toBe(201);
      codes.push(response.body.data.code);
    }

    expect(codes).toEqual(['LAMP-001', 'LAMP-002', 'LAMP-003']);
  });

  it('gives two customers the same first code, because the index is per customer', async () => {
    const first = await quickPlace();
    expect(first.status).toBe(201);
    expect(first.body.data.code).toBe('LAMP-001');

    const other = await Customer.create({ code: 'OT', name: 'Өөр харилцагч ХХК' });
    const otherCustomerId = String(other._id);
    const otherFloorId = await createFloor(otherCustomerId, '2');

    const second = await quickPlace({ customerId: otherCustomerId, floorId: otherFloorId });
    expect(second.status).toBe(201);
    expect(second.body.data.code).toBe('LAMP-001');
    expect(second.body.data.customerId).toBe(otherCustomerId);
  });

  it('skips a hand-typed code the counter would have offered', async () => {
    // Exactly the dev-database situation: someone registered LAMP-001 through the full
    // form before quick placement existed, so the counter's first candidate is taken.
    const manual = await request(app)
      .post(`${API}/objects-master`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        code: 'LAMP-001',
        name: 'Гараар бүртгэсэн гэрэл',
        category: 'EQUIPMENT',
        objectTypeId: lampTypeId,
        floorId,
        equipment: {},
      });
    expect(manual.status).toBe(201);

    const response = await quickPlace();

    expect(response.status).toBe(201);
    expect(response.body.data.code).toBe('LAMP-002');
    expect(await ObjectRecord.countDocuments({ customer: customerId, code: 'LAMP-001' })).toBe(1);
  });

  it('retries past a whole run of hand-typed codes', async () => {
    for (let index = 1; index <= 5; index += 1) {
      const manual = await request(app)
        .post(`${API}/objects-master`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          customerId,
          code: `LAMP-00${index}`,
          name: `Гараар ${index}`,
          category: 'EQUIPMENT',
          objectTypeId: lampTypeId,
          equipment: {},
        });
      expect(manual.status).toBe(201);
    }

    const response = await quickPlace();
    expect(response.status).toBe(201);
    expect(response.body.data.code).toBe('LAMP-006');
  });

  it('hands ten simultaneous clicks ten distinct codes and names', async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, () => quickPlace()));

    for (const response of responses) expect(response.status).toBe(201);

    const codes = responses.map((response) => response.body.data.code as string);
    const names = responses.map((response) => response.body.data.name as string);

    expect(new Set(codes).size).toBe(10);
    expect(new Set(names).size).toBe(10);
    expect(await ObjectRecord.countDocuments({ customer: customerId })).toBe(10);
  });

  it('restarts names on each floor while codes keep climbing', async () => {
    const secondFloorId = await createFloor(customerId, '2', 2);

    const first = await quickPlace();
    const second = await quickPlace({ floorId: secondFloorId });

    expect(first.body.data.name).toBe('Гэрэлтүүлэг 1');
    expect(second.body.data.name).toBe('Гэрэлтүүлэг 1');
    // The code is a per-customer identifier, so it does not restart with the floor.
    expect(first.body.data.code).toBe('LAMP-001');
    expect(second.body.data.code).toBe('LAMP-002');
  });

  it('numbers past a name somebody typed by hand on that floor', async () => {
    const manual = await request(app)
      .post(`${API}/objects-master`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        code: 'HAND-1',
        name: 'Гэрэлтүүлэг 3',
        category: 'EQUIPMENT',
        objectTypeId: lampTypeId,
        floorId,
        equipment: {},
      });
    expect(manual.status).toBe(201);

    const response = await quickPlace();

    expect(response.status).toBe(201);
    expect(response.body.data.name).toBe('Гэрэлтүүлэг 4');
    expect(await ObjectRecord.countDocuments({ floor: floorId, name: 'Гэрэлтүүлэг 3' })).toBe(1);
  });

  it('skips a hand-typed name that appears after the counter was seeded', async () => {
    const first = await quickPlace();
    expect(first.body.data.name).toBe('Гэрэлтүүлэг 1');

    // The counter now stands at 1 and would offer 2 next; a person takes that name first.
    const manual = await request(app)
      .post(`${API}/objects-master`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        code: 'HAND-2',
        name: 'Гэрэлтүүлэг 2',
        category: 'EQUIPMENT',
        objectTypeId: lampTypeId,
        floorId,
        equipment: {},
      });
    expect(manual.status).toBe(201);

    const second = await quickPlace();
    expect(second.status).toBe(201);
    expect(second.body.data.name).toBe('Гэрэлтүүлэг 3');
  });

  it('refuses an archived type', async () => {
    const archived = await request(app)
      .patch(`${API}/object-types/${lampTypeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });
    expect(archived.status).toBe(200);

    const response = await quickPlace();

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Идэвхгүй');
  });

  it('refuses a floor belonging to another customer', async () => {
    const other = await Customer.create({ code: 'OT', name: 'Өөр харилцагч ХХК' });
    const foreignFloorId = await createFloor(String(other._id), '9');

    const response = await quickPlace({ floorId: foreignFloorId });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('харилцагчид хамаарахгүй');
  });

  it('refuses a missing or out-of-range position, and an unknown floor', async () => {
    const missing = await request(app)
      .post(`${API}/objects-master/quick-place`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, objectTypeId: lampTypeId, floorId });
    expect(missing.status).toBe(400);

    const tooLarge = await quickPlace({ planPosition: { x: 1.5, y: 0.2 } });
    expect(tooLarge.status).toBe(400);

    const negative = await quickPlace({ planPosition: { x: 0.2, y: -0.1 } });
    expect(negative.status).toBe(400);

    const floorless = await request(app)
      .post(`${API}/objects-master/quick-place`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, objectTypeId: lampTypeId, planPosition: { x: 0.2, y: 0.2 } });
    expect(floorless.status).toBe(400);

    const unknownFloor = await quickPlace({ floorId: new Types.ObjectId().toHexString() });
    expect(unknownFloor.status).toBe(400);

    expect(await ObjectRecord.countDocuments({})).toBe(0);
  });

  it('refuses an unknown field rather than dropping it', async () => {
    const response = await quickPlace({ code: 'MINE-1', name: 'Миний нэр' });
    expect(response.status).toBe(400);
  });

  it('refuses the placement without object_master.manage', async () => {
    const viewer = await createUserWithPermissions('quickplace-viewer@test.mn', [
      PERMISSIONS.OBJECT_MASTER_VIEW,
    ]);
    const viewerToken = await login(viewer.email, viewer.password);

    const response = await quickPlace({}, viewerToken);
    expect(response.status).toBe(403);
  });

  it('refuses a customer placing on another organisation', async () => {
    const other = await Customer.create({ code: 'OT', name: 'Өөр харилцагч ХХК' });
    const otherCustomerId = String(other._id);
    const otherFloorId = await createFloor(otherCustomerId, '8');

    const portalToken = await loginAsCustomer('tenant@test.mn', otherCustomerId, [
      PERMISSIONS.OBJECT_MASTER_MANAGE,
    ]);

    // Naming the other organisation outright.
    const named = await quickPlace({}, portalToken);
    expect(named.status).toBe(403);

    // And reaching their floor while claiming their own organisation.
    const viaFloor = await request(app)
      .post(`${API}/objects-master/quick-place`)
      .set('Authorization', `Bearer ${portalToken}`)
      .send({
        customerId: otherCustomerId,
        objectTypeId: lampTypeId,
        floorId,
        planPosition: { x: 0.4, y: 0.4 },
      });
    expect(viaFloor.status).toBe(400);

    // Their own floor is fine, and lands in their own tenant.
    const own = await request(app)
      .post(`${API}/objects-master/quick-place`)
      .set('Authorization', `Bearer ${portalToken}`)
      .send({
        customerId: otherCustomerId,
        objectTypeId: lampTypeId,
        floorId: otherFloorId,
        planPosition: { x: 0.4, y: 0.4 },
      });
    expect(own.status).toBe(201);
    expect(own.body.data.customerId).toBe(otherCustomerId);

    expect(await ObjectRecord.countDocuments({ customer: customerId })).toBe(0);
  });

  it('deletes a freshly placed object, which is what undo needs', async () => {
    const placed = await quickPlace();
    expect(placed.status).toBe(201);
    expect(placed.body.data.deleteBlockers).toEqual([]);

    const response = await request(app)
      .delete(`${API}/objects-master/${placed.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(await ObjectRecord.countDocuments({ _id: placed.body.data.id })).toBe(0);
  });
});
