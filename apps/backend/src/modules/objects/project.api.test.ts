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
import { Role } from '../rbac/role.model';
import { User } from '../user/user.model';
import { Customer, ObjectNode } from './object.models';

const API = '/api/v1';

const MANAGER = [PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE] as const;

/** Exactly what the CUSTOMER system role holds for this module. No staff key appears. */
const PORTAL = [
  PERMISSIONS.PORTAL_PROJECT_VIEW,
  PERMISSIONS.PORTAL_BUILDING_VIEW,
  PERMISSIONS.PORTAL_FLOOR_VIEW,
  PERMISSIONS.PORTAL_OBJECT_VIEW,
] as const;

let app: Express;
let token: string;
let customerId: string;

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
    key: `TEST_PORTAL_ROLE_${portalRoleSequence}`,
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

interface Tenant {
  customerId: string;
  projectId: string;
  buildingId: string;
  floorId: string;
}

/** One organisation with a project, a building and a floor, created as staff. */
async function seedTenant(code: string): Promise<Tenant> {
  const customer = await Customer.create({ code, name: `${code} ХХК` });
  const tenantCustomerId = String(customer._id);

  const project = await request(app)
    .post(`${API}/projects`)
    .set('Authorization', `Bearer ${token}`)
    .send({ customerId: tenantCustomerId, name: `${code} төсөл` });
  expect(project.status).toBe(201);

  const building = await request(app)
    .post(`${API}/buildings`)
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId: project.body.data.id, name: `${code} барилга` });
  expect(building.status).toBe(201);

  const floor = await request(app)
    .post(`${API}/floors`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      buildingId: building.body.data.id,
      name: `${code} 1 давхар`,
      floorNumber: 1,
    });
  expect(floor.status).toBe(201);

  return {
    customerId: tenantCustomerId,
    projectId: project.body.data.id as string,
    buildingId: building.body.data.id as string,
    floorId: floor.body.data.id as string,
  };
}

async function createProject(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${API}/projects`)
    .set('Authorization', `Bearer ${token}`)
    .send({ customerId, name: 'Урьдчилан сэргийлэх үйлчилгээ', ...overrides });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function createBuilding(
  projectId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await request(app)
    .post(`${API}/buildings`)
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId, name: 'Төв барилга', ...overrides });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function createFloor(
  buildingId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await request(app)
    .post(`${API}/floors`)
    .set('Authorization', `Bearer ${token}`)
    .send({ buildingId, name: '1 давхар', floorNumber: 1, ...overrides });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
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
  const user = await createUserWithPermissions('proj@test.mn', MANAGER);
  token = await login(user.email, user.password);
});

describe('project CRUD', () => {
  it('creates a project with its section 4.2 fields', async () => {
    const response = await request(app)
      .post(`${API}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        name: 'Жилийн үзлэг',
        contractNumber: 'C-2026-001',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
        description: 'Тайлбар',
      });

    expect(response.status).toBe(201);
    expect(response.body.data.contractNumber).toBe('C-2026-001');
    expect(response.body.data.isActive).toBe(true);
    expect(response.body.data.buildingCount).toBe(0);
  });

  it('refuses an end date before the start date', async () => {
    const response = await request(app)
      .post(`${API}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerId,
        name: 'Буруу хугацаа',
        startDate: '2026-12-31T00:00:00.000Z',
        endDate: '2026-01-01T00:00:00.000Z',
      });

    expect(response.status).toBe(400);
  });

  /**
   * A caller cannot collide with an existing code any more, because a caller no longer
   * proposes one. The duplicate-code rejection this replaces tested a field that has been
   * taken off the wire; what must hold now is that the server never issues a code twice,
   * which is the `generated codes` group below.
   */
  it('ignores a code a caller tries to supply and issues its own', async () => {
    const response = await request(app)
      .post(`${API}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, name: 'Кодоо өөрөө сонгох гэсэн', code: 'MINE-1' });

    expect(response.status).toBe(201);
    expect(response.body.data.code).toBe('PRJ-001');
  });

  it('archives rather than deletes, and reports counts', async () => {
    const projectId = await createProject();
    await createBuilding(projectId);

    const archived = await request(app)
      .patch(`${API}/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    expect(archived.status).toBe(200);
    expect(archived.body.data.isActive).toBe(false);
    expect(archived.body.data.buildingCount).toBe(1);
  });

  it('refuses deletion while a building exists, and allows it once empty', async () => {
    const projectId = await createProject();
    const buildingId = await createBuilding(projectId);

    const blocked = await request(app)
      .delete(`${API}/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain('барилга');

    await request(app)
      .delete(`${API}/buildings/${buildingId}`)
      .set('Authorization', `Bearer ${token}`);

    const allowed = await request(app)
      .delete(`${API}/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(allowed.status).toBe(200);
  });

  it('publishes delete blockers on the detail payload', async () => {
    const projectId = await createProject();
    await createBuilding(projectId);

    const detail = await request(app)
      .get(`${API}/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.deleteBlockers.length).toBeGreaterThan(0);
  });

  it('searches and filters the list', async () => {
    await createProject({ name: 'Гэрэлтүүлгийн төсөл' });
    await createProject({ name: 'Самбарын төсөл' });

    const search = await request(app)
      .get(`${API}/projects?search=${encodeURIComponent('Гэрэлтүүлг')}`)
      .set('Authorization', `Bearer ${token}`);
    expect(search.body.data.total).toBe(1);

    const byCustomer = await request(app)
      .get(`${API}/projects?customerId=${customerId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(byCustomer.body.data.total).toBe(2);
  });

  it('refuses a caller without object.manage', async () => {
    const reader = await createUserWithPermissions('projread@test.mn', [PERMISSIONS.OBJECT_VIEW]);
    const readerToken = await login(reader.email, reader.password);

    const response = await request(app)
      .post(`${API}/projects`)
      .set('Authorization', `Bearer ${readerToken}`)
      .send({ customerId, name: 'Эрхгүй' });

    expect(response.status).toBe(403);
  });

  it('refuses a caller without object.view', async () => {
    const outsider = await createUserWithPermissions('projout@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);

    const response = await request(app)
      .get(`${API}/projects`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(403);
  });

  it('audits creation and archiving', async () => {
    const projectId = await createProject();
    await request(app)
      .patch(`${API}/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    const entries = await AuditLog.find({ entityType: 'Project', entityId: projectId });
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('Created');
    expect(actions).toContain('StatusChanged');
  });
});

describe('building CRUD and containment', () => {
  it('belongs to exactly one project and inherits its customer', async () => {
    const projectId = await createProject();
    const buildingId = await createBuilding(projectId, {
      address: 'Олимпийн гудамж 15',
      gpsLatitude: 47.9175,
      gpsLongitude: 106.9172,
    });

    const detail = await request(app)
      .get(`${API}/buildings/${buildingId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.projectId).toBe(projectId);
    expect(detail.body.data.customerId).toBe(customerId);
    expect(detail.body.data.gpsLatitude).toBe(47.9175);
  });

  it('refuses a half-supplied coordinate', async () => {
    const projectId = await createProject();

    const response = await request(app)
      .post(`${API}/buildings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ projectId, name: 'Хагас координат', gpsLatitude: 47.9 });

    expect(response.status).toBe(400);
  });

  it('refuses a building under an archived project', async () => {
    const projectId = await createProject();
    await request(app)
      .patch(`${API}/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    const response = await request(app)
      .post(`${API}/buildings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ projectId, name: 'Архивласан төсөлд' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Архивласан');
  });

  it('refuses a building whose project does not exist', async () => {
    const response = await request(app)
      .post(`${API}/buildings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ projectId: '000000000000000000000000', name: 'Байхгүй төсөл' });

    expect(response.status).toBe(404);
  });

  it('filters buildings by project', async () => {
    const first = await createProject();
    const second = await createProject();
    await createBuilding(first);
    await createBuilding(second);

    const response = await request(app)
      .get(`${API}/buildings?projectId=${first}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.total).toBe(1);
  });
});

describe('floor CRUD and containment', () => {
  it('belongs to one building and carries the project in its ancestors', async () => {
    const projectId = await createProject();
    const buildingId = await createBuilding(projectId);
    const floorId = await createFloor(buildingId, { areaSqm: 1245, purpose: 'Оффис' });

    const detail = await request(app)
      .get(`${API}/floors/${floorId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.buildingId).toBe(buildingId);
    expect(detail.body.data.projectId).toBe(projectId);
    expect(detail.body.data.areaSqm).toBe(1245);
    expect(detail.body.data.hasPlanImage).toBe(false);
  });

  it('accepts a negative floor number for a basement', async () => {
    const projectId = await createProject();
    const buildingId = await createBuilding(projectId);
    const floorId = await createFloor(buildingId, { floorNumber: -1, name: '-1 давхар' });

    const detail = await request(app)
      .get(`${API}/floors/${floorId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.floorNumber).toBe(-1);
  });

  it('refuses a floor under an archived building', async () => {
    const projectId = await createProject();
    const buildingId = await createBuilding(projectId);
    await request(app)
      .patch(`${API}/buildings/${buildingId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    const response = await request(app)
      .post(`${API}/floors`)
      .set('Authorization', `Bearer ${token}`)
      .send({ buildingId, name: 'Архивласан барилгад' });

    expect(response.status).toBe(400);
  });

  it('filters floors by building and by project', async () => {
    const projectId = await createProject();
    const buildingId = await createBuilding(projectId);
    await createFloor(buildingId);
    await createFloor(buildingId, { name: '2 давхар', floorNumber: 2 });

    const byBuilding = await request(app)
      .get(`${API}/floors?buildingId=${buildingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(byBuilding.body.data.total).toBe(2);

    const byProject = await request(app)
      .get(`${API}/floors?projectId=${projectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(byProject.body.data.total).toBe(2);
  });

  it('lists buildings for a project through the nested route', async () => {
    const projectId = await createProject();
    await createBuilding(projectId);

    const response = await request(app)
      .get(`${API}/projects/${projectId}/buildings`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
  });
});

/**
 * The worst-case rollup travels on every hierarchy DTO, next to the per-band counts.
 *
 * The counts stayed by explicit choice; the rollup is the single figure whose method
 * (worst-case) has since been settled. Assessment-driven movement of the figure is
 * exercised in the object-master suite, where assessments can be recorded; this proves
 * the resting state: nothing assessed reads as null, never as zero.
 */
describe('worst-case rollup on the hierarchy DTOs', () => {
  it('carries a null rollup until something beneath is assessed', async () => {
    const projectId = await createProject();
    const buildingId = await createBuilding(projectId);
    const floorId = await createFloor(buildingId);

    for (const path of [
      `/projects/${projectId}`,
      `/buildings/${buildingId}`,
      `/floors/${floorId}`,
    ]) {
      const detail = await request(app)
        .get(`${API}${path}`)
        .set('Authorization', `Bearer ${token}`);

      expect(detail.status).toBe(200);
      expect(detail.body.data.rollup.score).toBeNull();
      expect(detail.body.data.rollup.riskLevel).toBeNull();
      expect(detail.body.data.rollup.worstObjectId).toBeNull();
      expect(detail.body.data.rollup.assessedCount).toBe(0);
      expect(detail.body.data.rollup.unassessedCount).toBe(0);
    }
  });
});

/**
 * Tenant isolation.
 *
 * `customerId` used to be a filter for everyone, so any authenticated caller who sent
 * another organisation's id received that organisation's records, and every detail
 * endpoint fetched by id alone. These prove it is now a security boundary: for a customer
 * the tenant comes from the account and the request is ignored, and staff behaviour is
 * unchanged.
 */
describe('customer scope on projects, buildings and floors', () => {
  let tenantA: Tenant;
  let tenantB: Tenant;
  let customerToken: string;

  beforeEach(async () => {
    tenantA = await seedTenant('TA');
    tenantB = await seedTenant('TB');
    customerToken = await loginAsCustomer('scope-a@test.mn', tenantA.customerId);
  });

  const asCustomer = (path: string): request.Test =>
    request(app).get(`${API}${path}`).set('Authorization', `Bearer ${customerToken}`);

  const asStaff = (path: string): request.Test =>
    request(app).get(`${API}${path}`).set('Authorization', `Bearer ${token}`);

  // -- Projects --------------------------------------------------------------

  it('lists only the calling customer projects', async () => {
    const response = await asCustomer('/projects');

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].id).toBe(tenantA.projectId);
  });

  it('ignores a customerId naming another organisation on the project list', async () => {
    const response = await asCustomer(`/projects?customerId=${tenantB.customerId}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].id).toBe(tenantA.projectId);
    expect(response.body.data.items[0].customerId).toBe(tenantA.customerId);
  });

  it('reports another organisation project as not found rather than forbidden', async () => {
    const response = await asCustomer(`/projects/${tenantB.projectId}`);

    // Not 403: a forbidden reply would confirm the id is real and turn the endpoint into
    // an oracle for probing other organisations' identifiers.
    expect(response.status).toBe(404);
    expect(response.body.data).toBeNull();
  });

  /** The portal role holds no staff key, so the graph is out of reach at the guard. */
  it('does not expose the project graph to the portal role at all', async () => {
    const response = await asCustomer(`/projects/${tenantA.projectId}/graph`);

    expect(response.status).toBe(403);
  });

  /**
   * The graph builder takes a project id and knows nothing about tenants, so the route loads
   * the project through the scoped path first. Proven with an account that holds the staff
   * key, because the guard alone would otherwise mask whether the scope is enforced: without
   * the scoped load this endpoint is reachable by id alone, which is the exact shape of the
   * bug being fixed.
   */
  it('refuses a cross-tenant project graph even when the account holds the staff permission', async () => {
    const overPrivileged = await loginAsCustomer('scope-graph@test.mn', tenantA.customerId, [
      PERMISSIONS.OBJECT_VIEW,
    ]);

    const foreign = await request(app)
      .get(`${API}/projects/${tenantB.projectId}/graph`)
      .set('Authorization', `Bearer ${overPrivileged}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.data).toBeNull();

    const own = await request(app)
      .get(`${API}/projects/${tenantA.projectId}/graph`)
      .set('Authorization', `Bearer ${overPrivileged}`);
    expect(own.status).toBe(200);
    expect(own.body.data).not.toBeNull();
  });

  it('reports another organisation project buildings as an empty page', async () => {
    const response = await asCustomer(`/projects/${tenantB.projectId}/buildings`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(0);
  });

  // -- Buildings -------------------------------------------------------------

  it('lists only the calling customer buildings', async () => {
    const response = await asCustomer('/buildings');

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].id).toBe(tenantA.buildingId);
  });

  it('ignores a customerId naming another organisation on the building list', async () => {
    const response = await asCustomer(`/buildings?customerId=${tenantB.customerId}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].id).toBe(tenantA.buildingId);
  });

  it('reports another organisation building as not found rather than forbidden', async () => {
    const response = await asCustomer(`/buildings/${tenantB.buildingId}`);

    expect(response.status).toBe(404);
    expect(response.body.data).toBeNull();
  });

  // -- Floors ----------------------------------------------------------------

  it('lists only the calling customer floors', async () => {
    const response = await asCustomer('/floors');

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].id).toBe(tenantA.floorId);
  });

  it('ignores a customerId naming another organisation on the floor list', async () => {
    const response = await asCustomer(`/floors?customerId=${tenantB.customerId}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].id).toBe(tenantA.floorId);
  });

  it('reports another organisation floor as not found rather than forbidden', async () => {
    const response = await asCustomer(`/floors/${tenantB.floorId}`);

    expect(response.status).toBe(404);
    expect(response.body.data).toBeNull();
  });

  it('reports another organisation floor plan as not found', async () => {
    const response = await asCustomer(`/floors/${tenantB.floorId}/plan`);

    expect(response.status).toBe(404);
  });

  it('returns a null plan for the calling customer own floor', async () => {
    const response = await asCustomer(`/floors/${tenantA.floorId}/plan`);

    // "No plan yet" stays a normal state with its own empty screen.
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
  });

  // -- Misconfigured account -------------------------------------------------

  it('refuses a customer account that is linked to no organisation', async () => {
    const orphan = await loginAsCustomer('scope-orphan@test.mn', null);

    const response = await request(app)
      .get(`${API}/projects`)
      .set('Authorization', `Bearer ${orphan}`);

    // Refused rather than defaulted: "no filter" would expose every tenant and "match
    // nothing" would hide a misconfiguration an administrator has to fix.
    expect(response.status).toBe(403);
    expect(response.body.message).toContain('харилцагч байгууллагад холбогдоогүй');
  });

  // -- Writes ----------------------------------------------------------------

  it('refuses every write path to the portal role', async () => {
    const create = await request(app)
      .post(`${API}/projects`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ customerId: tenantA.customerId, name: 'Шинэ төсөл' });
    expect(create.status).toBe(403);

    const update = await request(app)
      .patch(`${API}/projects/${tenantA.projectId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ name: 'Өөрчилсөн' });
    expect(update.status).toBe(403);

    const remove = await request(app)
      .delete(`${API}/floors/${tenantA.floorId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(remove.status).toBe(403);
  });

  /**
   * The scope, not the guard, is what stops a cross-tenant write. Proven by handing a
   * customer account the STAFF write permission it must never hold in production: the
   * permission alone gets it past the guard and no further.
   */
  it('refuses a cross-tenant write even when the account holds the staff permission', async () => {
    const overPrivileged = await loginAsCustomer('scope-over@test.mn', tenantA.customerId, [
      PERMISSIONS.OBJECT_VIEW,
      PERMISSIONS.OBJECT_MANAGE,
    ]);

    const createIntoB = await request(app)
      .post(`${API}/projects`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({ customerId: tenantB.customerId, name: 'Өөр харилцагчид' });
    expect(createIntoB.status).toBe(403);
    expect(createIntoB.body.message).toContain('Өөр харилцагчийн');

    // A building under another tenant's project: the parent does not resolve in scope.
    const buildingUnderB = await request(app)
      .post(`${API}/buildings`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({ projectId: tenantB.projectId, name: 'Өөр төсөлд' });
    expect(buildingUnderB.status).toBe(404);

    // A floor under another tenant's building, for the same reason.
    const floorUnderB = await request(app)
      .post(`${API}/floors`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({ buildingId: tenantB.buildingId, name: 'Өөр барилгад' });
    expect(floorUnderB.status).toBe(404);

    const updateB = await request(app)
      .patch(`${API}/projects/${tenantB.projectId}`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({ name: 'Хулгайлсан нэр' });
    expect(updateB.status).toBe(404);

    const archiveB = await request(app)
      .patch(`${API}/buildings/${tenantB.buildingId}`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({ isActive: false });
    expect(archiveB.status).toBe(404);

    const deleteB = await request(app)
      .delete(`${API}/floors/${tenantB.floorId}`)
      .set('Authorization', `Bearer ${overPrivileged}`);
    expect(deleteB.status).toBe(404);

    // Nothing was written into the other organisation.
    const stillIntact = await asStaff(`/projects/${tenantB.projectId}`);
    expect(stillIntact.body.data.name).toBe('TB төсөл');
  });

  // -- Staff -----------------------------------------------------------------

  it('keeps staff cross-tenant access and their customerId filter', async () => {
    // The beforeEach at file level also seeds a CT customer with no records, so only the
    // two tenants above contribute rows.
    const allProjects = await asStaff('/projects');
    expect(allProjects.status).toBe(200);
    expect(allProjects.body.data.total).toBe(2);

    const filtered = await asStaff(`/projects?customerId=${tenantB.customerId}`);
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.items[0].id).toBe(tenantB.projectId);

    const allBuildings = await asStaff('/buildings');
    expect(allBuildings.body.data.total).toBe(2);

    const filteredBuildings = await asStaff(`/buildings?customerId=${tenantA.customerId}`);
    expect(filteredBuildings.body.data.total).toBe(1);

    const allFloors = await asStaff('/floors');
    expect(allFloors.body.data.total).toBe(2);

    // And a detail read across tenants still resolves for staff.
    const detail = await asStaff(`/floors/${tenantB.floorId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(tenantB.floorId);
  });
});

/**
 * Project, building and floor codes are issued by the server, never by the caller.
 *
 * The three things that have to hold are all here: the SHAPE a reader was promised
 * (`PRJ-001`), that no two records ever share a code, and that the guarantee survives
 * simultaneous creates — which is the case a generator built on counting existing rows
 * gets wrong, and the reason this one draws from an atomic counter instead.
 */
describe('generated codes', () => {
  it('issues the documented shape, numbered from one per kind', async () => {
    const projectId = await createProject();
    const buildingId = await createBuilding(projectId);
    const floorId = await createFloor(buildingId);

    const project = await request(app)
      .get(`${API}/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`);
    const building = await request(app)
      .get(`${API}/buildings/${buildingId}`)
      .set('Authorization', `Bearer ${token}`);
    const floor = await request(app)
      .get(`${API}/floors/${floorId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(project.body.data.code).toBe('PRJ-001');
    expect(building.body.data.code).toBe('BLD-001');
    expect(floor.body.data.code).toBe('FLR-001');
  });

  it('counts each kind up independently', async () => {
    const projectId = await createProject();
    await createProject({ name: 'Хоёр дахь төсөл' });
    const buildingId = await createBuilding(projectId);
    await createBuilding(projectId, { name: 'Хоёр дахь барилга' });
    await createFloor(buildingId);
    await createFloor(buildingId, { name: '2 давхар', floorNumber: 2 });

    const codes = await ObjectNode.find({ customer: customerId }).select('kind code');
    const of = (kind: string): string[] =>
      codes
        .filter((row) => row.kind === kind)
        .map((row) => row.code)
        .sort();

    expect(of('PROJECT')).toEqual(['PRJ-001', 'PRJ-002']);
    expect(of('BUILDING')).toEqual(['BLD-001', 'BLD-002']);
    expect(of('FLOOR')).toEqual(['FLR-001', 'FLR-002']);
  });

  /**
   * A floor is numbered per CUSTOMER, not per building — the unique index is
   * `{ customer, code }`, so restarting at 1 inside each building would collide the
   * moment a second building got a floor. Asserted so nobody "fixes" the numbering into
   * a duplicate key.
   */
  it('keeps counting floors across buildings rather than restarting', async () => {
    const projectId = await createProject();
    const first = await createBuilding(projectId);
    const second = await createBuilding(projectId, { name: 'Хоёр дахь барилга' });

    await createFloor(first);
    const floorId = await createFloor(second, { name: 'Нөгөө барилгын давхар' });

    const floor = await request(app)
      .get(`${API}/floors/${floorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(floor.body.data.code).toBe('FLR-002');
  });

  it('numbers each customer from one, independently of the others', async () => {
    const other = await Customer.create({ code: 'OTH', name: 'Өөр ХХК' });
    await createProject();

    const response = await request(app)
      .post(`${API}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: String(other._id), name: 'Өөр харилцагчийн эхний төсөл' });

    expect(response.status).toBe(201);
    // Both customers own a PRJ-001, which the per-customer unique index permits.
    expect(response.body.data.code).toBe('PRJ-001');
  });

  /**
   * THE CASE THE COUNTER EXISTS FOR.
   *
   * Ten creates in flight at once. A generator that read the highest existing code and
   * added one would hand several of them the same number; the unique index would reject
   * the losers and the user would see a 409 for pressing a button at the wrong moment.
   * The atomic `$inc` cannot do that — and it needs no transaction, which matters because
   * the test database is a standalone mongod where transactions silently do nothing.
   */
  it('hands ten simultaneous creates ten distinct codes', async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        request(app)
          .post(`${API}/projects`)
          .set('Authorization', `Bearer ${token}`)
          .send({ customerId, name: `Зэрэг үүсгэсэн ${index + 1}` }),
      ),
    );

    for (const response of responses) expect(response.status).toBe(201);

    const codes = responses.map((response) => response.body.data.code as string);
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((code) => /^PRJ-\d{3,}$/.test(code))).toBe(true);
    expect(await ObjectNode.countDocuments({ customer: customerId, kind: 'PROJECT' })).toBe(10);
  });

  /**
   * A deleted code is retired, not recycled. Somebody may have written PRJ-002 on a
   * drawing or in an email, and a second, unrelated project answering to it later is
   * worse than a gap in the numbering.
   */
  it('does not reissue the code of a deleted record', async () => {
    await createProject();
    const second = await createProject({ name: 'Устгагдах төсөл' });

    const deleted = await request(app)
      .delete(`${API}/projects/${second}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleted.status).toBe(200);

    const third = await request(app)
      .post(`${API}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, name: 'Дараагийн төсөл' });

    expect(third.body.data.code).toBe('PRJ-003');
  });

  /**
   * Codes existed before they were generated, and the dev seed still writes them by hand.
   * The counter is seeded from what the customer already shows, so the first generated
   * code lands after them instead of colliding with one.
   */
  it('starts after the codes a customer already had', async () => {
    await ObjectNode.create({
      kind: 'PROJECT',
      code: 'PRJ-007',
      name: 'Гараар бүртгэсэн',
      parent: null,
      customer: new Types.ObjectId(customerId),
      ancestors: [],
      attributes: {},
    });

    const response = await request(app)
      .post(`${API}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, name: 'Дараах' });

    expect(response.body.data.code).toBe('PRJ-008');
  });

  /**
   * A hand-typed code in the generated shape is skipped rather than overwritten. The
   * counter cannot know about a code typed after it was seeded, so the existence check
   * is what keeps the promise; the skipped number is simply lost.
   */
  it('steps over a code that was taken after the counter was seeded', async () => {
    await createProject();

    await ObjectNode.create({
      kind: 'PROJECT',
      code: 'PRJ-002',
      name: 'Дундуур нь орсон',
      parent: null,
      customer: new Types.ObjectId(customerId),
      ancestors: [],
      attributes: {},
    });

    const response = await request(app)
      .post(`${API}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, name: 'Дараах' });

    expect(response.status).toBe(201);
    expect(response.body.data.code).toBe('PRJ-003');
  });

  /**
   * The other half of "generated": it must not drift afterwards. The update schemas are
   * `.strict()`, so a code on the wire is refused outright rather than ignored — a
   * silent drop would let a caller believe it had renamed something.
   */
  it('refuses to edit a code, and leaves it alone when the name changes', async () => {
    const projectId = await createProject();

    const rejected = await request(app)
      .patch(`${API}/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'PRJ-999' });
    expect(rejected.status).toBe(400);

    const renamed = await request(app)
      .patch(`${API}/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Шинэ нэр' });

    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Шинэ нэр');
    expect(renamed.body.data.code).toBe('PRJ-001');
  });

  it('refuses to edit a building or a floor code either', async () => {
    const projectId = await createProject();
    const buildingId = await createBuilding(projectId);
    const floorId = await createFloor(buildingId);

    const building = await request(app)
      .patch(`${API}/buildings/${buildingId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'BLD-999' });
    expect(building.status).toBe(400);

    const floor = await request(app)
      .patch(`${API}/floors/${floorId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'FLR-999' });
    expect(floor.status).toBe(400);
  });
});
