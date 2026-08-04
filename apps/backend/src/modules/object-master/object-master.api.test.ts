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
import { AuditLog } from '../audit/audit-log.model';
import { Customer, ObjectNode } from '../objects/object.models';
import { Role } from '../rbac/role.model';
import { Report, ReportItem } from '../report-record/report-record.model';
import { StoredFile } from '../storage/stored-file.model';
import { User } from '../user/user.model';
import { ObjectAssessment, ObjectRecord } from './object-master.models';

const API = '/api/v1';

const FULL = [
  PERMISSIONS.OBJECT_VIEW,
  PERMISSIONS.OBJECT_MANAGE,
  PERMISSIONS.OBJECT_MASTER_VIEW,
  PERMISSIONS.OBJECT_MASTER_MANAGE,
  PERMISSIONS.OBJECT_MASTER_ASSESS,
  PERMISSIONS.OBJECT_TYPE_MANAGE,
] as const;

let app: Express;
let token: string;
let customerId: string;
let projectId: string;
let buildingId: string;
let floorId: string;

/** Exactly what the CUSTOMER system role holds for this module. No staff key appears. */
const PORTAL = [
  PERMISSIONS.PORTAL_PROJECT_VIEW,
  PERMISSIONS.PORTAL_BUILDING_VIEW,
  PERMISSIONS.PORTAL_FLOOR_VIEW,
  PERMISSIONS.PORTAL_OBJECT_VIEW,
] as const;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

/**
 * Monotonic counter for generated role keys. `resetDomainCollections` preserves the roles
 * collection, so a key derived only from the email would collide across tests.
 */
let portalRoleSequence = 0;

/**
 * Signs in a `customer` account linked to one organisation.
 *
 * `permissions` is a parameter rather than a constant so a test can hand a customer a
 * STAFF key and prove the scope still refuses them. That is the point being tested: a
 * permission answers "may you look at this module", never "at whose records".
 */
async function loginAsCustomer(
  email: string,
  linkedCustomerId: string | null,
  permissions: readonly PermissionKey[] = PORTAL,
): Promise<string> {
  portalRoleSequence += 1;

  const role = await Role.create({
    key: `TEST_OBJ_PORTAL_ROLE_${portalRoleSequence}`,
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

async function createType(
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await request(app)
    .post(`${API}/object-types`)
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'MCB', name: 'Автомат таслуур', category: 'EQUIPMENT', ...overrides });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function createObject(
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app)
    .post(`${API}/objects-master`)
    .set('Authorization', `Bearer ${token}`)
    .send({ customerId, ...body });
}

/**
 * Uploads one evidence photo and returns its id.
 *
 * Every assessment must carry evidence, so a test that records a score uploads a picture
 * first, the same way the drawer does.
 */
async function uploadAssessmentPhoto(authToken: string = token): Promise<string> {
  const response = await request(app)
    .post(`${API}/files/object-assessment-photos`)
    .set('Authorization', `Bearer ${authToken}`)
    .attach('file', Buffer.from('evidence-bytes'), {
      filename: 'evidence.png',
      contentType: 'image/png',
    });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

/** Records an assessment with a freshly uploaded evidence photo. */
async function recordAssessment(
  objectId: string,
  body: Record<string, unknown> = {},
): Promise<request.Response> {
  const photoId = await uploadAssessmentPhoto();
  return request(app)
    .post(`${API}/objects-master/${objectId}/assessments`)
    .set('Authorization', `Bearer ${token}`)
    .send({ photoIds: [photoId], ...body });
}

/** A panel, one circuit under it, and one device on that circuit. */
async function buildChain(): Promise<{ panel: string; circuit: string; equipment: string }> {
  const panelType = await createType({ code: 'DB', name: 'Түгээх самбар', category: 'PANEL' });
  const circuitType = await createType({ code: 'LINE', name: 'Шугам', category: 'CIRCUIT' });
  const equipmentType = await createType({ code: 'LAMP', name: 'Гэрэл', category: 'EQUIPMENT' });

  const panel = await createObject({
    code: 'DB-2A',
    name: 'Түгээх самбар 2A',
    category: 'PANEL',
    objectTypeId: panelType,
    floorId,
    panel: { capacityKw: 25, location: 'Баруун жигүүр', protection: 'IP54' },
  });
  expect(panel.status).toBe(201);

  const circuit = await createObject({
    code: 'HL-01',
    name: 'Коридор гэрэлтүүлэг',
    category: 'CIRCUIT',
    objectTypeId: circuitType,
    floorId,
    circuit: {
      panelId: panel.body.data.id,
      breakerRating: 'MCB 16A',
      cableType: 'VVG 3x2.5',
      cableSectionMm2: 2.5,
      cableLengthM: 38,
      permittedCapacityKw: 8,
    },
  });
  expect(circuit.status).toBe(201);

  const equipment = await createObject({
    code: 'EQ-01',
    name: 'LED луминер',
    category: 'EQUIPMENT',
    objectTypeId: equipmentType,
    floorId,
    equipment: {
      circuitId: circuit.body.data.id,
      ratedPowerKw: 1.5,
      quantity: 4,
      usageCoefficient: 0.8,
    },
  });
  expect(equipment.status).toBe(201);

  return {
    panel: panel.body.data.id as string,
    circuit: circuit.body.data.id as string,
    equipment: equipment.body.data.id as string,
  };
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

  const user = await createUserWithPermissions('objm@test.mn', FULL);
  token = await login(user.email, user.password);

  const project = await request(app)
    .post(`${API}/projects`)
    .set('Authorization', `Bearer ${token}`)
    .send({ customerId, code: 'PRJ-1', name: 'Төсөл' });
  projectId = project.body.data.id;

  const building = await request(app)
    .post(`${API}/buildings`)
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId, code: 'BLD-1', name: 'Барилга' });
  buildingId = building.body.data.id;

  const floor = await request(app)
    .post(`${API}/floors`)
    .set('Authorization', `Bearer ${token}`)
    .send({ buildingId, code: 'FL-1', name: '1 давхар', floorNumber: 1 });
  floorId = floor.body.data.id;
});

describe('section 4.1 type registry', () => {
  it('creates a type with all eight fields', async () => {
    const response = await request(app)
      .post(`${API}/object-types`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'RCD',
        name: 'RCD/RCCB',
        description: 'Гүйдэл алдагдлын хамгаалалт',
        category: 'EQUIPMENT',
        showOnPlan: true,
        insidePanel: true,
        generatesConclusion: true,
        icon: 'BREAKER',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.showOnPlan).toBe(true);
    expect(response.body.data.insidePanel).toBe(true);
    expect(response.body.data.generatesConclusion).toBe(true);
    expect(response.body.data.icon).toBe('BREAKER');
    expect(response.body.data.objectCount).toBe(0);
  });

  it('refuses a duplicate code', async () => {
    await createType();
    const response = await request(app)
      .post(`${API}/object-types`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'MCB', name: 'Давхардсан', category: 'EQUIPMENT' });

    expect(response.status).toBe(409);
  });

  it('refuses to change category or code after creation', async () => {
    const typeId = await createType();
    const response = await request(app)
      .patch(`${API}/object-types/${typeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'PANEL' });

    expect(response.status).toBe(400);
  });

  it('refuses deletion while an object uses the type', async () => {
    const chain = await buildChain();
    expect(chain.panel).toBeTruthy();

    const types = await request(app)
      .get(`${API}/object-types?category=PANEL`)
      .set('Authorization', `Bearer ${token}`);
    const panelType = types.body.data.items[0];

    expect(panelType.objectCount).toBe(1);

    const response = await request(app)
      .delete(`${API}/object-types/${panelType.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('Идэвхгүй болгоно уу');
  });

  it('deletes an unused type', async () => {
    const typeId = await createType({ code: 'UNUSED', name: 'Ашиглагдаагүй' });

    const response = await request(app)
      .delete(`${API}/object-types/${typeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('refuses type management without object_type.manage', async () => {
    const reader = await createUserWithPermissions('objtread@test.mn', [
      PERMISSIONS.OBJECT_MASTER_VIEW,
    ]);
    const readerToken = await login(reader.email, reader.password);

    const response = await request(app)
      .post(`${API}/object-types`)
      .set('Authorization', `Bearer ${readerToken}`)
      .send({ code: 'NOPE', name: 'Эрхгүй', category: 'EQUIPMENT' });

    expect(response.status).toBe(403);
  });
});

describe('strict per-category validation', () => {
  it('refuses an equipment field on a panel payload', async () => {
    const panelType = await createType({ code: 'DB', name: 'Самбар', category: 'PANEL' });

    const response = await createObject({
      code: 'DB-X',
      name: 'Буруу самбар',
      category: 'PANEL',
      objectTypeId: panelType,
      panel: { capacityKw: 25 },
      equipment: { ratedPowerKw: 2 },
    });

    expect(response.status).toBe(400);
  });

  it('refuses a type whose category does not match the object', async () => {
    const equipmentType = await createType({ code: 'LAMP', name: 'Гэрэл', category: 'EQUIPMENT' });

    const response = await createObject({
      code: 'DB-Y',
      name: 'Ангилал зөрсөн',
      category: 'PANEL',
      objectTypeId: equipmentType,
      panel: { capacityKw: 10 },
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('ангилалд хамаарахгүй');
  });

  it('refuses an archived type on a new object', async () => {
    const typeId = await createType({ code: 'DB', name: 'Самбар', category: 'PANEL' });
    await request(app)
      .patch(`${API}/object-types/${typeId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    const response = await createObject({
      code: 'DB-Z',
      name: 'Идэвхгүй төрөл',
      category: 'PANEL',
      objectTypeId: typeId,
      panel: { capacityKw: 10 },
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Идэвхгүй');
  });

  it('refuses a circuit whose panel belongs to another customer', async () => {
    const other = await Customer.create({ code: 'OT', name: 'Өөр ХХК' });
    const panelType = await createType({ code: 'DB', name: 'Самбар', category: 'PANEL' });
    const circuitType = await createType({ code: 'LINE', name: 'Шугам', category: 'CIRCUIT' });

    const foreignPanel = await request(app)
      .post(`${API}/objects-master`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: String(other._id),
        code: 'DB-OTHER',
        name: 'Өөр самбар',
        category: 'PANEL',
        objectTypeId: panelType,
        panel: { capacityKw: 10 },
      });

    const response = await createObject({
      code: 'HL-X',
      name: 'Хөндлөн холбоос',
      category: 'CIRCUIT',
      objectTypeId: circuitType,
      circuit: { panelId: foreignPanel.body.data.id },
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('өөр харилцагчид');
  });

  it('refuses a duplicate code within one customer but allows it across customers', async () => {
    const panelType = await createType({ code: 'DB', name: 'Самбар', category: 'PANEL' });
    await createObject({
      code: 'DB-2A',
      name: 'Самбар',
      category: 'PANEL',
      objectTypeId: panelType,
      panel: {},
    });

    const duplicate = await createObject({
      code: 'DB-2A',
      name: 'Давхардсан',
      category: 'PANEL',
      objectTypeId: panelType,
      panel: {},
    });
    expect(duplicate.status).toBe(409);

    const other = await Customer.create({ code: 'OT', name: 'Өөр ХХК' });
    const allowed = await request(app)
      .post(`${API}/objects-master`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: String(other._id),
        code: 'DB-2A',
        name: 'Өөр харилцагчид ижил код',
        category: 'PANEL',
        objectTypeId: panelType,
        panel: {},
      });
    expect(allowed.status).toBe(201);
  });

  it('refuses to change an object category after creation', async () => {
    const chain = await buildChain();

    const response = await request(app)
      .patch(`${API}/objects-master/${chain.panel}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ category: 'EQUIPMENT' });

    expect(response.status).toBe(400);
  });
});

/**
 * A cable does not run between two towers.
 *
 * Every object-to-object reference — a circuit's panel, its start and end points, and a
 * device's circuit — must join two assets standing in the same building. The floorless case
 * is deliberately permissive: an object with no floor has no building, so there is nothing
 * to contradict, and the master list is documented as accepting an object before it is
 * placed.
 */
describe('building scoping for object connections', () => {
  /** A second floor inside the SAME building as `floorId`. */
  async function secondFloorSameBuilding(): Promise<string> {
    const floor = await request(app)
      .post(`${API}/floors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ buildingId, code: 'FL-2', name: '2 давхар', floorNumber: 2 });
    expect(floor.status).toBe(201);
    return floor.body.data.id as string;
  }

  /** A floor in a DIFFERENT building of the same project and the same customer. */
  async function floorInOtherBuilding(): Promise<string> {
    const building = await request(app)
      .post(`${API}/buildings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ projectId, code: 'BLD-2', name: 'Хоёрдугаар барилга' });
    expect(building.status).toBe(201);

    const floor = await request(app)
      .post(`${API}/floors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ buildingId: building.body.data.id, code: 'B2-FL-1', name: '1 давхар', floorNumber: 1 });
    expect(floor.status).toBe(201);
    return floor.body.data.id as string;
  }

  /** Type codes are unique registry-wide, so each panel here brings its own. */
  let panelSequence = 0;

  async function createPanel(onFloor: string | null): Promise<string> {
    panelSequence += 1;
    const panelType = await createType({
      code: `DBX${panelSequence}`,
      name: 'Самбар',
      category: 'PANEL',
    });
    const panel = await createObject({
      code: `DBX-${panelSequence}`,
      name: 'Түгээх самбар',
      category: 'PANEL',
      objectTypeId: panelType,
      floorId: onFloor,
      panel: { capacityKw: 25 },
    });
    expect(panel.status).toBe(201);
    return panel.body.data.id as string;
  }

  it('accepts a connection between two floors of the same building', async () => {
    const upstairs = await secondFloorSameBuilding();
    const panel = await createPanel(floorId);
    const circuitType = await createType({ code: 'LINE', name: 'Шугам', category: 'CIRCUIT' });

    const circuit = await createObject({
      code: 'HL-SAME',
      name: 'Нэг барилгын хэлхээ',
      category: 'CIRCUIT',
      objectTypeId: circuitType,
      floorId: upstairs,
      circuit: { panelId: panel },
    });

    expect(circuit.status).toBe(201);
    expect(circuit.body.data.circuit.panel.id).toBe(panel);
  });

  it('refuses a circuit whose panel stands in another building', async () => {
    const elsewhere = await floorInOtherBuilding();
    const panel = await createPanel(elsewhere);
    const circuitType = await createType({ code: 'LINE', name: 'Шугам', category: 'CIRCUIT' });

    const response = await createObject({
      code: 'HL-CROSS',
      name: 'Хөндлөн барилгын хэлхээ',
      category: 'CIRCUIT',
      objectTypeId: circuitType,
      floorId,
      circuit: { panelId: panel },
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('өөр барилгад');
    expect(response.body.issues).toContainEqual({
      field: 'circuit.panelId',
      message: 'Зөвхөн нэг барилгын объектыг холбоно.',
    });
  });

  it('refuses equipment fed by a circuit in another building', async () => {
    const elsewhere = await floorInOtherBuilding();
    const circuitType = await createType({ code: 'LINE', name: 'Шугам', category: 'CIRCUIT' });
    const equipmentType = await createType({ code: 'LAMP', name: 'Гэрэл', category: 'EQUIPMENT' });

    const circuit = await createObject({
      code: 'HL-FAR',
      name: 'Хол хэлхээ',
      category: 'CIRCUIT',
      objectTypeId: circuitType,
      floorId: elsewhere,
      circuit: {},
    });
    expect(circuit.status).toBe(201);

    const response = await createObject({
      code: 'EQ-CROSS',
      name: 'Хөндлөн тоноглол',
      category: 'EQUIPMENT',
      objectTypeId: equipmentType,
      floorId,
      equipment: { circuitId: circuit.body.data.id },
    });

    expect(response.status).toBe(400);
    expect(response.body.issues).toContainEqual({
      field: 'equipment.circuitId',
      message: 'Зөвхөн нэг барилгын объектыг холбоно.',
    });
  });

  it('refuses a cross-building connection made by update, and keeps the stored one', async () => {
    const chain = await buildChain();
    const elsewhere = await floorInOtherBuilding();
    const foreignPanel = await createPanel(elsewhere);

    const response = await request(app)
      .patch(`${API}/objects-master/${chain.circuit}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ circuit: { panelId: foreignPanel } });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('өөр барилгад');

    const after = await ObjectRecord.findById(chain.circuit).select('circuit.panel');
    expect(String(after?.circuit?.panel)).toBe(chain.panel);
  });

  it('judges an update that moves the object against the floor it is landing on', async () => {
    const chain = await buildChain();
    const elsewhere = await floorInOtherBuilding();

    // The move and the reference arrive in one request. The panel is in the original
    // building, so the object leaving that building takes the connection out of scope.
    const response = await request(app)
      .patch(`${API}/objects-master/${chain.circuit}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ floorId: elsewhere, circuit: { panelId: chain.panel } });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('өөр барилгад');
  });

  it('allows a connection when the object being connected has no floor', async () => {
    const panel = await createPanel(floorId);
    const circuitType = await createType({ code: 'LINE', name: 'Шугам', category: 'CIRCUIT' });

    // A floorless object has no building, so there is no building to contradict. The
    // master list is documented as accepting an object before it is placed, and refusing
    // this would make that object unconnectable.
    const circuit = await createObject({
      code: 'HL-FLOORLESS',
      name: 'Байршуулаагүй хэлхээ',
      category: 'CIRCUIT',
      objectTypeId: circuitType,
      circuit: { panelId: panel },
    });

    expect(circuit.status).toBe(201);
    expect(circuit.body.data.floorId).toBeNull();
    expect(circuit.body.data.circuit.panel.id).toBe(panel);
  });

  it('allows a connection when the referenced object has no floor', async () => {
    const panel = await createPanel(null);
    const circuitType = await createType({ code: 'LINE', name: 'Шугам', category: 'CIRCUIT' });

    const circuit = await createObject({
      code: 'HL-TO-FLOORLESS',
      name: 'Байршуулаагүй самбарт холбогдсон',
      category: 'CIRCUIT',
      objectTypeId: circuitType,
      floorId,
      circuit: { panelId: panel },
    });

    expect(circuit.status).toBe(201);
    expect(circuit.body.data.circuit.panel.id).toBe(panel);
  });

  it('still refuses a cross-tenant connection, before the building is ever compared', async () => {
    const other = await Customer.create({ code: 'OT', name: 'Өөр ХХК' });
    const circuitType = await createType({ code: 'LINE', name: 'Шугам', category: 'CIRCUIT' });
    const equipmentType = await createType({ code: 'LAMP', name: 'Гэрэл', category: 'EQUIPMENT' });

    const foreignCircuit = await request(app)
      .post(`${API}/objects-master`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: String(other._id),
        code: 'HL-OTHER',
        name: 'Өөр харилцагчийн хэлхээ',
        category: 'CIRCUIT',
        objectTypeId: circuitType,
        circuit: {},
      });
    expect(foreignCircuit.status).toBe(201);

    const response = await createObject({
      code: 'EQ-TENANT',
      name: 'Хөндлөн харилцагч',
      category: 'EQUIPMENT',
      objectTypeId: equipmentType,
      floorId,
      equipment: { circuitId: foreignCircuit.body.data.id },
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('өөр харилцагчид');
  });
});

describe('load calculation through the API', () => {
  it('computes equipment, circuit and panel loads from the stored graph', async () => {
    const chain = await buildChain();

    const equipment = await request(app)
      .get(`${API}/objects-master/${chain.equipment}`)
      .set('Authorization', `Bearer ${token}`);
    // 1.5 kW x 4 x 0.8
    expect(equipment.body.data.calculatedLoad.valueKw).toBe(4.8);

    const circuit = await request(app)
      .get(`${API}/objects-master/${chain.circuit}`)
      .set('Authorization', `Bearer ${token}`);
    expect(circuit.body.data.calculatedLoad.valueKw).toBe(4.8);
    // 4.8 of a permitted 8 kW
    expect(circuit.body.data.loadPercent.valueKw).toBe(60);

    const panel = await request(app)
      .get(`${API}/objects-master/${chain.panel}`)
      .set('Authorization', `Bearer ${token}`);
    expect(panel.body.data.calculatedLoad.valueKw).toBe(4.8);
    expect(panel.body.data.reserveKw.valueKw).toBe(20.2);
  });

  it('reports Бүрэн бус when a technical field is missing', async () => {
    const equipmentType = await createType({ code: 'LAMP', name: 'Гэрэл', category: 'EQUIPMENT' });

    const created = await createObject({
      code: 'EQ-INC',
      name: 'Дутуу мэдээлэл',
      category: 'EQUIPMENT',
      objectTypeId: equipmentType,
      floorId,
      equipment: { quantity: 3 },
    });

    const detail = await request(app)
      .get(`${API}/objects-master/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.calculatedLoad.valueKw).toBeNull();
    expect(detail.body.data.calculatedLoad.complete).toBe(false);
    expect(detail.body.data.calculatedLoad.reasons).toContain('MISSING_RATED_POWER');
  });

  it('excludes a decommissioned object from the load', async () => {
    const chain = await buildChain();

    await request(app)
      .patch(`${API}/objects-master/${chain.equipment}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DECOMMISSIONED' });

    const circuit = await request(app)
      .get(`${API}/objects-master/${chain.circuit}`)
      .set('Authorization', `Bearer ${token}`);

    expect(circuit.body.data.calculatedLoad.valueKw).toBe(0);
  });

  it('rolls a floor up to the panel total and reports unattached equipment separately', async () => {
    const chain = await buildChain();
    expect(chain.panel).toBeTruthy();

    const looseType = await createType({ code: 'PUMP', name: 'Насос', category: 'EQUIPMENT' });
    await createObject({
      code: 'EQ-LOOSE',
      name: 'Хэлхээгүй тоноглол',
      category: 'EQUIPMENT',
      objectTypeId: looseType,
      floorId,
      equipment: { ratedPowerKw: 3, quantity: 1 },
    });

    const summary = await request(app)
      .get(`${API}/floors/${floorId}/load`)
      .set('Authorization', `Bearer ${token}`);

    expect(summary.status).toBe(200);
    expect(summary.body.data.panelCount).toBe(1);
    // Section 11.5 counts panels only: the 3 kW loose device is not in the total.
    expect(summary.body.data.totalKw.valueKw).toBe(4.8);
    expect(summary.body.data.unattachedEquipmentCount).toBe(1);
    expect(summary.body.data.unattachedEquipmentKw.valueKw).toBe(3);
  });

  it('reports no aggregate risk score, only counts by level', async () => {
    await buildChain();

    const summary = await request(app)
      .get(`${API}/floors/${floorId}/load`)
      .set('Authorization', `Bearer ${token}`);

    expect(summary.body.data).not.toHaveProperty('aggregateRiskScore');
    expect(summary.body.data.unassessedCount).toBe(3);
    expect(summary.body.data.riskCounts).toEqual([]);
    expect(summary.body.data.kvaNote).toContain('power factor');
  });
});

describe('floor object linking', () => {
  it('links an existing object without copying it', async () => {
    const panelType = await createType({ code: 'DB', name: 'Самбар', category: 'PANEL' });
    const created = await createObject({
      code: 'DB-FREE',
      name: 'Холбоогүй самбар',
      category: 'PANEL',
      objectTypeId: panelType,
      panel: { capacityKw: 10 },
    });
    const objectId = created.body.data.id as string;

    const linked = await request(app)
      .post(`${API}/floors/${floorId}/objects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ objectIds: [objectId] });

    expect(linked.status).toBe(200);
    expect(linked.body.data.linked).toBe(1);

    const detail = await request(app)
      .get(`${API}/objects-master/${objectId}`)
      .set('Authorization', `Bearer ${token}`);
    // Same record, now carrying the floor: nothing was duplicated.
    expect(detail.body.data.id).toBe(objectId);
    expect(detail.body.data.floorId).toBe(floorId);

    const all = await request(app)
      .get(`${API}/objects-master?customerId=${customerId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(all.body.data.total).toBe(1);
  });

  it('unlinks without deleting the object', async () => {
    const chain = await buildChain();

    const response = await request(app)
      .delete(`${API}/floors/${floorId}/objects/${chain.panel}`)
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);

    const detail = await request(app)
      .get(`${API}/objects-master/${chain.panel}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.floorId).toBeNull();
  });

  it('refuses to link an object from a different customer', async () => {
    const other = await Customer.create({ code: 'OT', name: 'Өөр ХХК' });
    const panelType = await createType({ code: 'DB', name: 'Самбар', category: 'PANEL' });

    const foreign = await request(app)
      .post(`${API}/objects-master`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: String(other._id),
        code: 'DB-OTHER',
        name: 'Өөр самбар',
        category: 'PANEL',
        objectTypeId: panelType,
        panel: {},
      });

    const response = await request(app)
      .post(`${API}/floors/${floorId}/objects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ objectIds: [foreign.body.data.id] });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('өөр харилцагчид');
  });

  it('refuses to link onto an archived floor', async () => {
    const panelType = await createType({ code: 'DB', name: 'Самбар', category: 'PANEL' });
    const created = await createObject({
      code: 'DB-A',
      name: 'Самбар',
      category: 'PANEL',
      objectTypeId: panelType,
      panel: {},
    });

    await request(app)
      .patch(`${API}/floors/${floorId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    const response = await request(app)
      .post(`${API}/floors/${floorId}/objects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ objectIds: [created.body.data.id] });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Архивласан');
  });

  it('offers only unlinked objects to the picker', async () => {
    const chain = await buildChain();
    expect(chain.panel).toBeTruthy();

    const panelType = await createType({ code: 'DB2', name: 'Хоёр дахь самбар', category: 'PANEL' });
    await createObject({
      code: 'DB-FREE',
      name: 'Холбоогүй',
      category: 'PANEL',
      objectTypeId: panelType,
      panel: {},
    });

    const response = await request(app)
      .get(`${API}/objects-master?customerId=${customerId}&unlinkedOnly=true`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].code).toBe('DB-FREE');
  });

  it('audits a link and an unlink', async () => {
    const chain = await buildChain();
    await request(app)
      .delete(`${API}/floors/${floorId}/objects/${chain.panel}`)
      .set('Authorization', `Bearer ${token}`);

    const entries = await AuditLog.find({ entityType: 'Object', entityId: chain.panel });
    const reasons = entries.map((entry) => entry.reason);
    expect(reasons).toContain('unlinked from floor');
  });
});

describe('deletion guards', () => {
  it('refuses to delete a panel that still has circuits', async () => {
    const chain = await buildChain();

    const response = await request(app)
      .delete(`${API}/objects-master/${chain.panel}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('хэлхээ');
  });

  it('refuses to delete an assessed object and allows archiving instead', async () => {
    const chain = await buildChain();

    await recordAssessment(chain.equipment, { newScore: 90 });

    const blocked = await request(app)
      .delete(`${API}/objects-master/${chain.equipment}`)
      .set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain('үнэлгээний бүртгэлтэй');

    const archived = await request(app)
      .patch(`${API}/objects-master/${chain.equipment}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' });
    expect(archived.status).toBe(200);
  });

  it('deletes an object with no dependents', async () => {
    const panelType = await createType({ code: 'DB', name: 'Самбар', category: 'PANEL' });
    const created = await createObject({
      code: 'DB-SOLO',
      name: 'Ганцаараа',
      category: 'PANEL',
      objectTypeId: panelType,
      panel: {},
    });

    const response = await request(app)
      .delete(`${API}/objects-master/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });
});

describe('assessment history', () => {
  it('records the previous and new score and is append-only', async () => {
    const chain = await buildChain();

    const first = await recordAssessment(chain.equipment, {
      newScore: 90,
      conclusion: 'Хэвийн',
    });
    expect(first.status).toBe(201);
    expect(first.body.data.previousScore).toBeNull();
    expect(first.body.data.riskLevel).toBe('NORMAL');

    const second = await recordAssessment(chain.equipment, {
      newScore: 70,
      recommendation: 'Холболтыг чангалах',
      repairRequired: true,
    });
    expect(second.status).toBe(201);
    expect(second.body.data.previousScore).toBe(90);
    expect(second.body.data.riskLevel).toBe('ATTENTION');

    // Both rows survive: nothing was overwritten.
    const stored = await ObjectAssessment.find({ object: chain.equipment });
    expect(stored).toHaveLength(2);
  });

  it('blocks every mutation path on a stored assessment', async () => {
    const chain = await buildChain();
    await recordAssessment(chain.equipment, { newScore: 95 });

    await expect(
      ObjectAssessment.updateOne({ object: chain.equipment }, { $set: { newScore: 10 } }),
    ).rejects.toThrow(/өөрчлөх, устгах боломжгүй/);

    await expect(ObjectAssessment.deleteMany({ object: chain.equipment })).rejects.toThrow(
      /өөрчлөх, устгах боломжгүй/,
    );
  });

  it('requires conclusion, recommendation and action on a red score', async () => {
    const chain = await buildChain();

    const response = await recordAssessment(chain.equipment, { newScore: 30 });

    expect(response.status).toBe(400);
    const messages = JSON.stringify(response.body.issues);
    expect(messages).toContain('дүгнэлт заавал');
    expect(messages).toContain('зөвлөмж заавал');
    expect(messages).toContain('арга хэмжээ заавал');
  });

  it('requires a recommendation plus repair or revisit on a yellow score', async () => {
    const chain = await buildChain();

    const response = await recordAssessment(chain.equipment, { newScore: 70 });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('зөвлөмж заавал');
  });

  it('requires a date and an owner when a revisit is flagged', async () => {
    const chain = await buildChain();

    const response = await recordAssessment(chain.equipment, {
      newScore: 95,
      revisitRequired: true,
    });

    expect(response.status).toBe(400);
    const messages = JSON.stringify(response.body.issues);
    expect(messages).toContain('Дахин очих огноо заавал');
    expect(messages).toContain('Дахин очих хариуцагч заавал');
  });

  /** Rule 17.9: a black-band object must not remain in active use. */
  it('decommissions an object scored into the black band', async () => {
    const chain = await buildChain();

    await recordAssessment(chain.equipment, {
      newScore: 10,
      conclusion: 'Тусгаарлагч эвдэрсэн',
      recommendation: 'Яаралтай солих',
      actionTaken: 'Тэжээлийг салгасан',
    });

    const detail = await request(app)
      .get(`${API}/objects-master/${chain.equipment}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.status).toBe('DECOMMISSIONED');
  });

  it('keeps the measured reading separate and derives the variance', async () => {
    const chain = await buildChain();

    await recordAssessment(chain.equipment, { newScore: 95, measuredLoadKw: 5.2 });

    const detail = await request(app)
      .get(`${API}/objects-master/${chain.equipment}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.calculatedLoad.valueKw).toBe(4.8);
    expect(detail.body.data.measuredLoadKw).toBe(5.2);
    // Measured minus calculated, rounded.
    expect(detail.body.data.loadVariance.valueKw).toBeCloseTo(0.4, 3);
  });

  /**
   * Multiple load units.
   *
   * The invariant under test throughout is that `measuredLoadKw` is still the only summable
   * quantity: amps and volts are recorded beside the assessment and are visible to nothing
   * that adds up.
   */
  describe('load measurements', () => {
    it('refuses a reading whose unit does not match its kind', async () => {
      const chain = await buildChain();

      const response = await recordAssessment(chain.equipment, {
        newScore: 95,
        // A current in kilowatts. Accepted, it would read as 42 kW of power everywhere.
        measurements: [{ kind: 'CURRENT', value: 42, unit: 'KILOWATT', phase: 'L1' }],
      });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('unit');
    });

    it('refuses a phase on a power reading', async () => {
      const chain = await buildChain();

      const response = await recordAssessment(chain.equipment, {
        newScore: 95,
        measurements: [{ kind: 'ACTIVE_POWER', value: 8, unit: 'KILOWATT', phase: 'L2' }],
      });

      expect(response.status).toBe(400);
    });

    it('round-trips three per-phase current readings on one assessment', async () => {
      const chain = await buildChain();

      const created = await recordAssessment(chain.equipment, {
        newScore: 95,
        measurements: [
          { kind: 'CURRENT', value: 41.2, unit: 'AMPERE', phase: 'L1' },
          { kind: 'CURRENT', value: 38.9, unit: 'AMPERE', phase: 'L2' },
          { kind: 'CURRENT', value: 44.1, unit: 'AMPERE', phase: 'L3' },
          { kind: 'VOLTAGE', value: 231, unit: 'VOLT', phase: null },
        ],
      });
      expect(created.status).toBe(201);

      const history = await request(app)
        .get(`${API}/objects-master/${chain.equipment}/history`)
        .set('Authorization', `Bearer ${token}`);

      // The per-phase imbalance is the finding, so all three survive as separate rows in
      // the order they were entered rather than being averaged into one figure.
      expect(history.body.data.assessments[0].measurements).toEqual([
        { kind: 'CURRENT', value: 41.2, unit: 'AMPERE', phase: 'L1' },
        { kind: 'CURRENT', value: 38.9, unit: 'AMPERE', phase: 'L2' },
        { kind: 'CURRENT', value: 44.1, unit: 'AMPERE', phase: 'L3' },
        { kind: 'VOLTAGE', value: 231, unit: 'VOLT', phase: null },
      ]);
      // No kW was given and none was invented from the amps.
      expect(history.body.data.assessments[0].measuredLoadKw).toBeNull();
    });

    it('refuses the same kind and phase twice', async () => {
      const chain = await buildChain();

      const response = await recordAssessment(chain.equipment, {
        newScore: 95,
        measurements: [
          { kind: 'CURRENT', value: 41.2, unit: 'AMPERE', phase: 'L1' },
          { kind: 'CURRENT', value: 12.0, unit: 'AMPERE', phase: 'L1' },
        ],
      });

      expect(response.status).toBe(400);
    });

    it('leaves an assessment with no measurements exactly as it was', async () => {
      const chain = await buildChain();

      const created = await recordAssessment(chain.equipment, {
        newScore: 95,
        measuredLoadKw: 5.2,
      });
      expect(created.status).toBe(201);
      // Optional on the wire and empty in the reply — never null, so no reader has to
      // distinguish "not sent" from "nothing read".
      expect(created.body.data.measurements).toEqual([]);
      expect(created.body.data.measuredLoadKw).toBe(5.2);

      const detail = await request(app)
        .get(`${API}/objects-master/${chain.equipment}`)
        .set('Authorization', `Bearer ${token}`);

      expect(detail.body.data.measuredLoadKw).toBe(5.2);
      expect(detail.body.data.loadVariance.valueKw).toBeCloseTo(0.4, 3);
    });

    it('refuses a kW reading that disagrees with the measured load', async () => {
      const chain = await buildChain();

      const response = await recordAssessment(chain.equipment, {
        newScore: 95,
        measuredLoadKw: 5.2,
        measurements: [{ kind: 'ACTIVE_POWER', value: 7.9, unit: 'KILOWATT', phase: null }],
      });

      // Neither figure wins: one of the two would vanish with no trace it was entered.
      // Refused at the schema, so the message lands on the kW field the technician can see.
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain('зөрж байна');
    });

    it('fills the measured load from a kW reading when the kW field was left empty', async () => {
      const chain = await buildChain();

      const created = await recordAssessment(chain.equipment, {
        newScore: 95,
        measurements: [{ kind: 'ACTIVE_POWER', value: 7.9, unit: 'KILOWATT', phase: null }],
      });
      expect(created.status).toBe(201);
      expect(created.body.data.measuredLoadKw).toBe(7.9);

      // And it reaches the summable head on the object, exactly as the kW box does.
      const detail = await request(app)
        .get(`${API}/objects-master/${chain.equipment}`)
        .set('Authorization', `Bearer ${token}`);
      expect(detail.body.data.measuredLoadKw).toBe(7.9);
    });

    it('leaves the floor load summary unchanged when amp and volt readings are added', async () => {
      const chain = await buildChain();

      await recordAssessment(chain.panel, { newScore: 95, measuredLoadKw: 10 });

      const before = await request(app)
        .get(`${API}/floors/${floorId}/load`)
        .set('Authorization', `Bearer ${token}`);

      // The same kW figure, now with four non-kW readings alongside it.
      await recordAssessment(chain.panel, {
        newScore: 95,
        measuredLoadKw: 10,
        measurements: [
          { kind: 'CURRENT', value: 41.2, unit: 'AMPERE', phase: 'L1' },
          { kind: 'CURRENT', value: 38.9, unit: 'AMPERE', phase: 'L2' },
          { kind: 'CURRENT', value: 44.1, unit: 'AMPERE', phase: 'L3' },
          { kind: 'VOLTAGE', value: 231, unit: 'VOLT', phase: null },
        ],
      });

      const after = await request(app)
        .get(`${API}/floors/${floorId}/load`)
        .set('Authorization', `Bearer ${token}`);

      // 41.2 + 38.9 + 44.1 + 231 = 355.4 of nothing: the amps and volts are visible to no
      // total. Only `measuredLoadKw` is summed, and it did not move.
      expect(after.body.data.measuredTotalKw).toBe(10);
      expect(after.body.data.measuredTotalKw).toEqual(before.body.data.measuredTotalKw);
      expect(after.body.data.totalKw).toEqual(before.body.data.totalKw);
      expect(after.body.data.variance).toEqual(before.body.data.variance);
    });
  });

  it('refuses an assessment on a type that does not generate conclusions', async () => {
    const typeId = await createType({
      code: 'CLAMP',
      name: 'Клемм',
      category: 'EQUIPMENT',
      generatesConclusion: false,
    });
    const created = await createObject({
      code: 'EQ-CLAMP',
      name: 'Клемм',
      category: 'EQUIPMENT',
      objectTypeId: typeId,
      equipment: { ratedPowerKw: 0.1, quantity: 1 },
    });

    const response = await recordAssessment(created.body.data.id as string, { newScore: 95 });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('тохируулагдаагүй');
  });

  it('refuses assessing without object_master.assess', async () => {
    const chain = await buildChain();
    const viewer = await createUserWithPermissions('objview@test.mn', [
      PERMISSIONS.OBJECT_MASTER_VIEW,
    ]);
    const viewerToken = await login(viewer.email, viewer.password);

    const response = await request(app)
      .post(`${API}/objects-master/${chain.equipment}/assessments`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ newScore: 95 });

    expect(response.status).toBe(403);
  });

  it('builds a history timeline with assessment and measurement rows', async () => {
    const chain = await buildChain();

    await recordAssessment(chain.equipment, { newScore: 95, measuredLoadKw: 5 });

    const history = await request(app)
      .get(`${API}/objects-master/${chain.equipment}/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(history.status).toBe(200);
    expect(history.body.data.assessments).toHaveLength(1);

    /*
     * The manual screen is UNCHANGED by the per-equipment author added for planned work.
     *
     * One person records the score here and that recording IS the sign-off, so it lands in
     * `assessedBy` exactly as before. `judgedBy` is left null rather than repeating them:
     * it means "a separately recorded author of the verdict", and inventing one here would
     * make a reader think two people were involved.
     */
    const entry = history.body.data.assessments[0] as {
      assessedById: string | null;
      assessedByName: string | null;
      judgedById: string | null;
      judgedByName: string | null;
    };
    expect(entry.assessedById).not.toBeNull();
    expect(entry.assessedByName).not.toBeNull();
    expect(entry.judgedById).toBeNull();
    expect(entry.judgedByName).toBeNull();

    // The timeline is built from report items now, so a row's kind is the report type that
    // produced it rather than a vocabulary private to this endpoint.
    const kinds = (history.body.data.timeline as { kind: string }[]).map((entry) => entry.kind);
    expect(kinds).toContain('OBJECT_ASSESSMENT');
    expect(kinds).toContain('MEASUREMENT');
    expect(kinds).toContain('AUDIT');
  });
});

/**
 * Write-through to the unified report store, and the worst-case hierarchy rollup.
 *
 * The ObjectAssessment history stays exactly as it was — append-only and untouched — and
 * every recorded assessment ALSO lands as one Report row, carrying the hierarchy resolved
 * at write time. The floor, building and project then carry the score of their worst
 * assessed equipment, per ROLLUP_METHOD; nothing assessed means null, never zero.
 */
describe('unified report write-through and rollup', () => {
  /** Reads one node's stored worst-case figure through its own display endpoint. */
  async function rollupAt(path: string): Promise<Record<string, unknown>> {
    const response = await request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    return response.body.data.rollup as Record<string, unknown>;
  }

  it('writes exactly one approved report with one item and the resolved hierarchy', async () => {
    const chain = await buildChain();

    await recordAssessment(chain.equipment, { newScore: 90 });

    // The finding on the equipment is the item; the narrative and approval are the report.
    const items = await ReportItem.find({ object: chain.equipment });
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item?.score).toBe(90);
    expect(item?.riskLevel).toBe('NORMAL');
    expect(String(item?.customer)).toBe(customerId);
    expect(String(item?.floor)).toBe(floorId);
    // The uploaded evidence photo travels with the item.
    expect(item?.evidenceAttachments).toHaveLength(1);

    const report = await Report.findById(item?.report);
    expect(report?.type).toBe('OBJECT_ASSESSMENT');
    expect(report?.status).toBe('APPROVED');
    expect(report?.sourceType).toBe('MANUAL');
    expect(report?.sourceId).toBeNull();
    expect(report?.reportNumber).toMatch(/^RPT-\d{6}-\d{4}$/);
    // The headline is the worst (only) item's score, banded server-side.
    expect(report?.overallScore).toBe(90);
    expect(report?.riskLevel).toBe('NORMAL');

    // The hierarchy was resolved from the equipment's floor when the report was written.
    expect(String(report?.customer)).toBe(customerId);
    expect(String(report?.project)).toBe(projectId);
    expect(String(report?.building)).toBe(buildingId);
  });

  it('keeps manual assessments a history: a re-assessment adds a second report', async () => {
    const chain = await buildChain();

    await recordAssessment(chain.equipment, { newScore: 90 });
    await recordAssessment(chain.equipment, {
      newScore: 70,
      recommendation: 'Холболтыг чангалах',
      repairRequired: true,
    });

    // Two events, two rows: a manual assessment names no source record, so nothing
    // deduplicates it — unlike a re-completed planned work, which corrects its one report.
    expect(await ReportItem.countDocuments({ object: chain.equipment })).toBe(2);
    expect(await Report.countDocuments({ type: 'OBJECT_ASSESSMENT' })).toBe(2);

    const detail = await request(app)
      .get(`${API}/objects-master/${chain.equipment}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.body.data.latestAssessment.score).toBe(70);
  });

  /**
   * The manual path writes its history row ITSELF, and the derived report must not write a
   * second one.
   *
   * `recordAssessment` creates the `ObjectAssessment`, points the head at it, and only then
   * writes a derived `OBJECT_ASSESSMENT` report and applies it. Since the apply now appends
   * history for every other report type, this pins the exemption: two rows for one
   * assessment would be the regression, and so would a head that stopped resolving.
   */
  it('adds no second history row when the manual assessment writes through to a report', async () => {
    const chain = await buildChain();

    await recordAssessment(chain.equipment, { newScore: 90, conclusion: 'Хэвийн' });

    const rows = await ObjectAssessment.find({ object: chain.equipment });
    // One assessment, one history row — despite the report write-through and its apply.
    expect(rows).toHaveLength(1);
    // Written by the manual path, so it is not keyed to a report finding and appends every
    // time rather than deduplicating.
    expect(rows[0]?.sourceReportItem ?? null).toBeNull();
    expect(rows[0]?.sourceLabel).toBeNull();

    // The head still resolves to the row the manual path created.
    const object = await ObjectRecord.findById(chain.equipment);
    expect(String(object?.latestAssessment?.assessment)).toBe(String(rows[0]?._id));

    // A second manual assessment appends, because nothing keys it to a correctable record.
    const again = await recordAssessment(chain.equipment, {
      newScore: 70,
      recommendation: 'Чангалах',
      repairRequired: true,
    });
    expect(again.status).toBe(201);
    expect(await ObjectAssessment.countDocuments({ object: chain.equipment })).toBe(2);
  });

  it('rolls the worst equipment score up to the floor, building and project', async () => {
    const chain = await buildChain();

    await recordAssessment(chain.equipment, { newScore: 90 });

    for (const path of [
      `/floors/${floorId}`,
      `/buildings/${buildingId}`,
      `/projects/${projectId}`,
    ]) {
      const rollup = await rollupAt(path);
      expect(rollup.score).toBe(90);
      expect(rollup.riskLevel).toBe('NORMAL');
      expect(rollup.worstObjectId).toBe(chain.equipment);
      expect(rollup.assessedCount).toBe(1);
      // The panel and the circuit on the same floor are counted, not silently dropped.
      expect(rollup.unassessedCount).toBe(2);
    }
  });

  it('follows the worst equipment down and back up again', async () => {
    const chain = await buildChain();
    await recordAssessment(chain.equipment, { newScore: 90 });

    // A worse finding on a second piece of equipment drags the building down to it.
    await recordAssessment(chain.panel, {
      newScore: 70,
      recommendation: 'Самбарын холболтыг шалгах',
      repairRequired: true,
    });
    let rollup = await rollupAt(`/buildings/${buildingId}`);
    expect(rollup.score).toBe(70);
    expect(rollup.worstObjectId).toBe(chain.panel);

    // Repairing it hands the worst-case back to the next-worst equipment.
    await recordAssessment(chain.panel, { newScore: 95 });
    rollup = await rollupAt(`/buildings/${buildingId}`);
    expect(rollup.score).toBe(90);
    expect(rollup.worstObjectId).toBe(chain.equipment);
  });

  it('writes a standalone report for an object with no floor and moves no rollup', async () => {
    const looseType = await createType({ code: 'PUMP', name: 'Насос', category: 'EQUIPMENT' });
    const created = await createObject({
      code: 'EQ-FREE',
      name: 'Давхаргүй тоноглол',
      category: 'EQUIPMENT',
      objectTypeId: looseType,
      equipment: { ratedPowerKw: 3, quantity: 1 },
    });
    const objectId = created.body.data.id as string;

    const response = await recordAssessment(objectId, { newScore: 90 });
    expect(response.status).toBe(201);

    // The report exists but can name no floor, building or project: the object hangs off
    // nothing, so only the tenant — read from the object itself — is known.
    const item = await ReportItem.findOne({ object: objectId });
    expect(item).not.toBeNull();
    expect(item?.floor).toBeNull();

    const report = await Report.findById(item?.report);
    expect(report).not.toBeNull();
    expect(String(report?.customer)).toBe(customerId);
    expect(report?.project).toBeNull();
    expect(report?.building).toBeNull();

    // And no node anywhere picked up a figure from it.
    expect(await ObjectNode.countDocuments({ rollup: { $ne: null } })).toBe(0);
  });

  it('reports null, not zero, for a node with equipment but no assessments', async () => {
    await buildChain();

    const rollup = await rollupAt(`/floors/${floorId}`);
    // Unassessed is not the same as bad: zero would put an untouched floor at the top of
    // a critical-risk queue.
    expect(rollup.score).toBeNull();
    expect(rollup.riskLevel).toBeNull();
    expect(rollup.worstObjectId).toBeNull();
    expect(rollup.calculatedAt).toBeNull();
  });
});

/**
 * Evidence (product owner: a score with no picture behind it is not an assessment).
 *
 * The rule is enforced on the server, not only in the drawer, so a request made straight
 * at the API without a photo fails just as the form does.
 */
describe('assessment evidence', () => {
  it('refuses an assessment with no photo and names the missing evidence', async () => {
    const chain = await buildChain();

    const response = await request(app)
      .post(`${API}/objects-master/${chain.equipment}/assessments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newScore: 95 });

    expect(response.status).toBe(400);
    const issues = response.body.issues as { field: string; message: string }[];
    expect(issues.map((issue) => issue.field)).toContain('photoIds');
    expect(JSON.stringify(issues)).toContain('Нотлох зураг заавал');

    // Nothing was written: a refused assessment leaves no row behind.
    expect(await ObjectAssessment.countDocuments({ object: chain.equipment })).toBe(0);
  });

  it('refuses an assessment whose photo id does not resolve to a stored file', async () => {
    const chain = await buildChain();

    const response = await request(app)
      .post(`${API}/objects-master/${chain.equipment}/assessments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newScore: 95, photoIds: ['507f1f77bcf86cd799439011'] });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Хавсаргасан зураг олдсонгүй');
  });

  it('accepts an assessment with a photo and returns the attachment on the DTO', async () => {
    const chain = await buildChain();
    const photoId = await uploadAssessmentPhoto();

    const response = await request(app)
      .post(`${API}/objects-master/${chain.equipment}/assessments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newScore: 95, photoIds: [photoId] });

    expect(response.status).toBe(201);
    expect(response.body.data.photos).toHaveLength(1);
    expect(response.body.data.photos[0].id).toBe(photoId);
    expect(response.body.data.photos[0].name).toBe('evidence.png');
    expect(response.body.data.photos[0].downloadUrl).toBe(`/api/v1/files/${photoId}`);

    // The file was parked on the uploader and is now owned by the object it evidences.
    const stored = await StoredFile.findById(photoId);
    expect(stored?.ownerType).toBe('OBJECT');
    expect(String(stored?.ownerId)).toBe(chain.equipment);

    // The history reads the same attachment back.
    const history = await request(app)
      .get(`${API}/objects-master/${chain.equipment}/history`)
      .set('Authorization', `Bearer ${token}`);
    expect(history.body.data.assessments[0].photos).toHaveLength(1);
    expect(history.body.data.assessments[0].photos[0].id).toBe(photoId);
  });

  it('writes the attachments into the audit record for the assessment', async () => {
    const chain = await buildChain();
    const photoId = await uploadAssessmentPhoto();

    await request(app)
      .post(`${API}/objects-master/${chain.equipment}/assessments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newScore: 95, photoIds: [photoId] });

    const entry = await AuditLog.findOne({
      entityType: 'Object',
      entityId: chain.equipment,
      reason: 'assessment recorded',
    });

    expect(entry).not.toBeNull();
    expect((entry?.newValue as { score: number }).score).toBe(95);
    expect((entry?.newValue as { photos: string[] }).photos).toEqual([photoId]);
  });

  /**
   * Grandfathering. Assessments recorded before evidence was required have no photos and
   * stay valid: the rule is on recording, not on reading, so nothing in the history is
   * invalidated and no migration rewrites it.
   */
  it('still reads an assessment stored before evidence was required', async () => {
    const chain = await buildChain();

    await ObjectAssessment.create({
      object: chain.equipment,
      previousScore: null,
      newScore: 88,
      riskLevel: 'NORMAL',
      assessedBy: null,
      assessedByName: 'Хуучин бүртгэл',
      assessedAt: new Date('2026-01-01T00:00:00.000Z'),
      photos: [],
      conclusion: 'Зурагггүй хуучин үнэлгээ',
      recommendation: null,
      actionTaken: null,
      measuredLoadKw: null,
      repairRequired: false,
      revisitRequired: false,
      revisitDate: null,
      revisitOwner: null,
      revisitOwnerName: null,
      sourceLabel: null,
    });

    const history = await request(app)
      .get(`${API}/objects-master/${chain.equipment}/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(history.status).toBe(200);
    expect(history.body.data.assessments).toHaveLength(1);
    expect(history.body.data.assessments[0].newScore).toBe(88);
    expect(history.body.data.assessments[0].photos).toEqual([]);
  });

  it('refuses a non-image as assessment evidence', async () => {
    const response = await request(app)
      .post(`${API}/files/object-assessment-photos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'report.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Зөвхөн зураг');
  });

  it('refuses uploading evidence without object_master.assess', async () => {
    const viewer = await createUserWithPermissions('objevidence@test.mn', [
      PERMISSIONS.OBJECT_MASTER_VIEW,
    ]);
    const viewerToken = await login(viewer.email, viewer.password);

    const response = await request(app)
      .post(`${API}/files/object-assessment-photos`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .attach('file', Buffer.from('evidence-bytes'), {
        filename: 'evidence.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(403);
  });
});

/**
 * Tenant isolation on the object master.
 *
 * `customerId` used to be a filter for everyone, so any authenticated caller who sent
 * another organisation's id received that organisation's objects, and the detail endpoint
 * fetched by id alone. These prove it is now a security boundary.
 */
describe('customer scope on objects', () => {
  interface ForeignTenant {
    customerId: string;
    projectId: string;
    buildingId: string;
    floorId: string;
    objectId: string;
  }

  let foreign: ForeignTenant;
  let ownObjectId: string;
  let customerToken: string;

  /** A second organisation with its own hierarchy and one object, created as staff. */
  async function seedForeignTenant(): Promise<ForeignTenant> {
    const customer = await Customer.create({ code: 'OT', name: 'Өөр ХХК' });
    const foreignCustomerId = String(customer._id);

    const project = await request(app)
      .post(`${API}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: foreignCustomerId, code: 'OT-PRJ', name: 'Өөр төсөл' });
    expect(project.status).toBe(201);

    const building = await request(app)
      .post(`${API}/buildings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ projectId: project.body.data.id, code: 'OT-BLD', name: 'Өөр барилга' });
    expect(building.status).toBe(201);

    const floor = await request(app)
      .post(`${API}/floors`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        buildingId: building.body.data.id,
        code: 'OT-FL',
        name: 'Өөр 1 давхар',
        floorNumber: 1,
      });
    expect(floor.status).toBe(201);

    const panelType = await createType({ code: 'DBOT', name: 'Өөр самбар', category: 'PANEL' });
    const object = await request(app)
      .post(`${API}/objects-master`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId: foreignCustomerId,
        code: 'OT-DB',
        name: 'Өөр түгээх самбар',
        category: 'PANEL',
        objectTypeId: panelType,
        floorId: floor.body.data.id,
        panel: { capacityKw: 12 },
      });
    expect(object.status).toBe(201);

    return {
      customerId: foreignCustomerId,
      projectId: project.body.data.id as string,
      buildingId: building.body.data.id as string,
      floorId: floor.body.data.id as string,
      objectId: object.body.data.id as string,
    };
  }

  beforeEach(async () => {
    const panelType = await createType({ code: 'DBCT', name: 'Өөрийн самбар', category: 'PANEL' });
    const own = await createObject({
      code: 'CT-DB',
      name: 'Өөрийн түгээх самбар',
      category: 'PANEL',
      objectTypeId: panelType,
      floorId,
      panel: { capacityKw: 20 },
    });
    expect(own.status).toBe(201);
    ownObjectId = own.body.data.id as string;

    foreign = await seedForeignTenant();
    customerToken = await loginAsCustomer('objscope-a@test.mn', customerId);
  });

  const asCustomer = (path: string): request.Test =>
    request(app).get(`${API}${path}`).set('Authorization', `Bearer ${customerToken}`);

  const asStaff = (path: string): request.Test =>
    request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`);

  it('lists only the calling customer objects', async () => {
    const response = await asCustomer('/objects-master');

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].id).toBe(ownObjectId);
  });

  it('ignores a customerId naming another organisation on the object list', async () => {
    const response = await asCustomer(`/objects-master?customerId=${foreign.customerId}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].id).toBe(ownObjectId);
    expect(response.body.data.items[0].customerId).toBe(customerId);
  });

  it('reports another organisation object as not found rather than forbidden', async () => {
    const response = await asCustomer(`/objects-master/${foreign.objectId}`);

    // Not 403: a forbidden reply would confirm the id is real.
    expect(response.status).toBe(404);
    expect(response.body.data).toBeNull();
  });

  it('returns an empty page for another organisation floor objects', async () => {
    const response = await asCustomer(`/floors/${foreign.floorId}/objects`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(0);
  });

  it('reports another organisation floor load summary as not found', async () => {
    const response = await asCustomer(`/floors/${foreign.floorId}/load`);

    expect(response.status).toBe(404);
  });

  it('serves the calling customer own floor load summary', async () => {
    const response = await asCustomer(`/floors/${floorId}/load`);

    expect(response.status).toBe(200);
    expect(response.body.data.panelCount).toBe(1);
  });

  it('refuses a customer account that is linked to no organisation', async () => {
    const orphan = await loginAsCustomer('objscope-orphan@test.mn', null);

    const response = await request(app)
      .get(`${API}/objects-master`)
      .set('Authorization', `Bearer ${orphan}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('харилцагч байгууллагад холбогдоогүй');
  });

  it('refuses every object write path to the portal role', async () => {
    const create = await request(app)
      .post(`${API}/objects-master`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ customerId, code: 'CT-X', name: 'Шинэ', category: 'PANEL', panel: {} });
    expect(create.status).toBe(403);

    const update = await request(app)
      .patch(`${API}/objects-master/${ownObjectId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ name: 'Өөрчилсөн' });
    expect(update.status).toBe(403);

    const remove = await request(app)
      .delete(`${API}/objects-master/${ownObjectId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(remove.status).toBe(403);
  });

  /**
   * The scope, not the guard, is what stops a cross-tenant write. Proven by handing a
   * customer account the STAFF write permissions it must never hold in production.
   */
  it('refuses a cross-tenant object write even when the account holds the staff permission', async () => {
    const overPrivileged = await loginAsCustomer('objscope-over@test.mn', customerId, [
      PERMISSIONS.OBJECT_VIEW,
      PERMISSIONS.OBJECT_MANAGE,
      PERMISSIONS.OBJECT_MASTER_VIEW,
      PERMISSIONS.OBJECT_MASTER_MANAGE,
      PERMISSIONS.OBJECT_MASTER_ASSESS,
      PERMISSIONS.OBJECT_TYPE_MANAGE,
    ]);
    const panelType = await createType({ code: 'DBX', name: 'Гуравдахь самбар', category: 'PANEL' });

    const createIntoForeign = await request(app)
      .post(`${API}/objects-master`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({
        customerId: foreign.customerId,
        code: 'OT-X',
        name: 'Өөр харилцагчид',
        category: 'PANEL',
        objectTypeId: panelType,
        panel: {},
      });
    expect(createIntoForeign.status).toBe(403);
    expect(createIntoForeign.body.message).toContain('Өөр харилцагчийн');

    // Own customer, but placed on another tenant's floor.
    const createOnForeignFloor = await request(app)
      .post(`${API}/objects-master`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({
        customerId,
        code: 'CT-X2',
        name: 'Өөр давхарт',
        category: 'PANEL',
        objectTypeId: panelType,
        floorId: foreign.floorId,
        panel: {},
      });
    expect(createOnForeignFloor.status).toBe(400);
    expect(createOnForeignFloor.body.message).toContain('харилцагчид хамаарахгүй');

    const updateForeign = await request(app)
      .patch(`${API}/objects-master/${foreign.objectId}`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({ name: 'Хулгайлсан нэр' });
    expect(updateForeign.status).toBe(404);

    const deleteForeign = await request(app)
      .delete(`${API}/objects-master/${foreign.objectId}`)
      .set('Authorization', `Bearer ${overPrivileged}`);
    expect(deleteForeign.status).toBe(404);

    // The lighter position endpoint is scoped exactly like the full update above: a small
    // payload is not a smaller permission.
    const moveForeign = await request(app)
      .patch(`${API}/objects-master/${foreign.objectId}/position`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({ planPosition: { x: 0.5, y: 0.5 } });
    expect(moveForeign.status).toBe(404);

    // Another tenant's object cannot be pulled onto the caller's own floor.
    const link = await request(app)
      .post(`${API}/floors/${floorId}/objects`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({ objectIds: [foreign.objectId] });
    expect(link.status).toBe(400);
    expect(link.body.message).toContain('олдсонгүй');

    // Nor unlinked from its own floor.
    const unlink = await request(app)
      .delete(`${API}/floors/${foreign.floorId}/objects/${foreign.objectId}`)
      .set('Authorization', `Bearer ${overPrivileged}`);
    expect(unlink.status).toBe(404);

    const photoId = await uploadAssessmentPhoto(overPrivileged);
    const assess = await request(app)
      .post(`${API}/objects-master/${foreign.objectId}/assessments`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({ newScore: 95, photoIds: [photoId] });
    expect(assess.status).toBe(404);

    const history = await request(app)
      .get(`${API}/objects-master/${foreign.objectId}/history`)
      .set('Authorization', `Bearer ${overPrivileged}`);
    expect(history.status).toBe(404);

    // Nothing was written into the other organisation.
    const intact = await asStaff(`/objects-master/${foreign.objectId}`);
    expect(intact.body.data.name).toBe('Өөр түгээх самбар');
    expect(intact.body.data.floorId).toBe(foreign.floorId);
    expect(intact.body.data.latestAssessment).toBeNull();
  });

  it('keeps staff cross-tenant access and their customerId filter', async () => {
    const all = await asStaff('/objects-master');
    expect(all.status).toBe(200);
    expect(all.body.data.total).toBe(2);

    const filtered = await asStaff(`/objects-master?customerId=${foreign.customerId}`);
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.items[0].id).toBe(foreign.objectId);

    const detail = await asStaff(`/objects-master/${foreign.objectId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(foreign.objectId);

    const load = await asStaff(`/floors/${foreign.floorId}/load`);
    expect(load.status).toBe(200);
    expect(load.body.data.panelCount).toBe(1);
  });
});

/**
 * Placement on the floor plan (section 11.2).
 *
 * Coordinates are normalised fractions of the plan image, so the API is exercised with the
 * same 0..1 pairs the plan panel sends and with values outside that range, which no plan
 * can express.
 */
describe('plan placement', () => {
  async function createPlaceable(
    body: Record<string, unknown> = {},
  ): Promise<request.Response> {
    const typeId = await createType({
      code: `PIN${Math.floor(Math.random() * 100000)}`,
      name: 'План дээрх төрөл',
      category: 'EQUIPMENT',
      showOnPlan: true,
    });
    return createObject({
      code: 'EQ-PIN',
      name: 'План дээрх тоноглол',
      category: 'EQUIPMENT',
      objectTypeId: typeId,
      floorId,
      equipment: { ratedPowerKw: 1 },
      ...body,
    });
  }

  it('creates an object with a position and returns it on the floor listing', async () => {
    const created = await createPlaceable({ planPosition: { x: 0.25, y: 0.75 } });

    expect(created.status).toBe(201);
    expect(created.body.data.planPosition).toEqual({ x: 0.25, y: 0.75 });

    // The plan draws its markers from this one call, so the position has to survive the
    // list mapping and not only the detail mapping.
    const listed = await request(app)
      .get(`${API}/floors/${floorId}/objects`)
      .set('Authorization', `Bearer ${token}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.items[0].planPosition).toEqual({ x: 0.25, y: 0.75 });

    // …and so does the registry's own answer to "may this be drawn on a plan". A client
    // that only holds this list would otherwise have to fetch the whole type registry to
    // decide whether to draw the marker it was just handed a position for.
    expect(listed.body.data.items[0].objectType.showOnPlan).toBe(true);
  });

  /**
   * The inline type reference carries `showOnPlan` for every object, not only for a
   * placed one: it is what a plan filters on, and a false is as load-bearing as a true.
   */
  it('reports showOnPlan as false for a type that is not shown on the plan', async () => {
    const typeId = await createType({
      code: `NOPIN${Math.floor(Math.random() * 100000)}`,
      name: 'Планд харагдахгүй төрөл',
      category: 'EQUIPMENT',
      showOnPlan: false,
    });
    const created = await createObject({
      code: 'EQ-NOPIN',
      name: 'Планд харагдахгүй тоноглол',
      category: 'EQUIPMENT',
      objectTypeId: typeId,
      floorId,
      equipment: { ratedPowerKw: 1 },
    });
    expect(created.status).toBe(201);

    const listed = await request(app)
      .get(`${API}/floors/${floorId}/objects`)
      .set('Authorization', `Bearer ${token}`);
    const row = (listed.body.data.items as { id: string; objectType: { showOnPlan: boolean } }[])
      .find((item) => item.id === created.body.data.id);
    expect(row?.objectType.showOnPlan).toBe(false);
  });

  it('creates an object with no position at all', async () => {
    const created = await createPlaceable();

    expect(created.status).toBe(201);
    expect(created.body.data.planPosition).toBeNull();
  });

  it('refuses a coordinate outside the plan', async () => {
    for (const planPosition of [
      { x: 1.5, y: 0.5 },
      { x: 0.5, y: -0.2 },
    ]) {
      const response = await createPlaceable({ code: 'EQ-BAD', planPosition });
      expect(response.status).toBe(400);
    }
  });

  /** A pin belongs to a drawing, and the drawing belongs to a floor. */
  it('refuses a position with no floor behind it', async () => {
    const response = await createPlaceable({
      floorId: null,
      planPosition: { x: 0.4, y: 0.4 },
    });

    expect(response.status).toBe(400);
    const issues = response.body.issues as { field: string }[];
    expect(issues.some((issue) => issue.field.includes('planPosition'))).toBe(true);
  });

  it('moves a pin through the position endpoint', async () => {
    const created = await createPlaceable({ planPosition: { x: 0.1, y: 0.1 } });
    const objectId = created.body.data.id as string;

    const moved = await request(app)
      .patch(`${API}/objects-master/${objectId}/position`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planPosition: { x: 0.6, y: 0.35 } });

    expect(moved.status).toBe(200);
    expect(moved.body.data.planPosition).toEqual({ x: 0.6, y: 0.35 });

    const reread = await request(app)
      .get(`${API}/objects-master/${objectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(reread.body.data.planPosition).toEqual({ x: 0.6, y: 0.35 });
  });

  it('clears a pin through the position endpoint', async () => {
    const created = await createPlaceable({ planPosition: { x: 0.2, y: 0.2 } });
    const objectId = created.body.data.id as string;

    const cleared = await request(app)
      .patch(`${API}/objects-master/${objectId}/position`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planPosition: null });

    expect(cleared.status).toBe(200);
    expect(cleared.body.data.planPosition).toBeNull();
    // The object itself survives: clearing removes the pin, never the registration.
    expect(cleared.body.data.floorId).toBe(floorId);
  });

  it('refuses a coordinate outside the plan on the position endpoint', async () => {
    const created = await createPlaceable();
    const objectId = created.body.data.id as string;

    const response = await request(app)
      .patch(`${API}/objects-master/${objectId}/position`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planPosition: { x: 0.5, y: 2 } });

    expect(response.status).toBe(400);
  });

  /** Every other mutation in this module is audited; moving a pin is one too. */
  it('audits a move and a clear', async () => {
    const created = await createPlaceable({ planPosition: { x: 0.1, y: 0.1 } });
    const objectId = created.body.data.id as string;

    await request(app)
      .patch(`${API}/objects-master/${objectId}/position`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planPosition: { x: 0.8, y: 0.9 } });
    await request(app)
      .patch(`${API}/objects-master/${objectId}/position`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planPosition: null });

    const entries = await AuditLog.find({ entityType: 'Object', entityId: objectId });
    const reasons = entries.map((entry) => entry.reason);
    expect(reasons).toContain('plan position updated');
    expect(reasons).toContain('plan position cleared');

    const moved = entries.find((entry) => entry.reason === 'plan position updated');
    expect((moved?.oldValue as { planPosition: unknown }).planPosition).toEqual({
      x: 0.1,
      y: 0.1,
    });
    expect((moved?.newValue as { planPosition: unknown }).planPosition).toEqual({
      x: 0.8,
      y: 0.9,
    });
  });

  /** An unplaced object has no floor, so there is no plan to pin it to. */
  it('refuses a position on an object that sits on no floor', async () => {
    const created = await createPlaceable({ code: 'EQ-LOOSE', floorId: null });
    const objectId = created.body.data.id as string;

    const response = await request(app)
      .patch(`${API}/objects-master/${objectId}/position`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planPosition: { x: 0.5, y: 0.5 } });

    expect(response.status).toBe(400);
  });

  /** Unlinking removes the placement, and the pin is part of the placement. */
  it('drops the pin when the object leaves the floor', async () => {
    const created = await createPlaceable({ planPosition: { x: 0.3, y: 0.3 } });
    const objectId = created.body.data.id as string;

    const unlink = await request(app)
      .delete(`${API}/floors/${floorId}/objects/${objectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(unlink.status).toBe(200);

    const reread = await request(app)
      .get(`${API}/objects-master/${objectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(reread.body.data.planPosition).toBeNull();
  });

  /**
   * Replacing the plan keeps every placement.
   *
   * The positions are fractions of the drawing, and a replacement plan is the same floor
   * redrawn, so clearing them would throw away the survey work of placing each object.
   */
  it('keeps stored positions when the plan image is replaced or removed', async () => {
    const created = await createPlaceable({ planPosition: { x: 0.42, y: 0.58 } });
    const objectId = created.body.data.id as string;

    await request(app)
      .put(`${API}/floors/${floorId}/plan`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('plan-one'), { filename: 'a.png', contentType: 'image/png' });
    await request(app)
      .put(`${API}/floors/${floorId}/plan`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('plan-two'), { filename: 'b.png', contentType: 'image/png' });

    let reread = await request(app)
      .get(`${API}/objects-master/${objectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(reread.body.data.planPosition).toEqual({ x: 0.42, y: 0.58 });

    await request(app)
      .delete(`${API}/floors/${floorId}/plan`)
      .set('Authorization', `Bearer ${token}`);

    reread = await request(app)
      .get(`${API}/objects-master/${objectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(reread.body.data.planPosition).toEqual({ x: 0.42, y: 0.58 });
  });
});
