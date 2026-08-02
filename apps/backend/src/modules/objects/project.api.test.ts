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
import { Customer } from './object.models';

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
    .send({ customerId: tenantCustomerId, code: `${code}-PRJ`, name: `${code} төсөл` });
  expect(project.status).toBe(201);

  const building = await request(app)
    .post(`${API}/buildings`)
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId: project.body.data.id, code: `${code}-BLD`, name: `${code} барилга` });
  expect(building.status).toBe(201);

  const floor = await request(app)
    .post(`${API}/floors`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      buildingId: building.body.data.id,
      code: `${code}-FL`,
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
    .send({ customerId, code: 'PRJ-1', name: 'Урьдчилан сэргийлэх үйлчилгээ', ...overrides });
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
    .send({ projectId, code: 'BLD-1', name: 'Төв барилга', ...overrides });
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
    .send({ buildingId, code: 'FL-1', name: '1 давхар', floorNumber: 1, ...overrides });
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
        code: 'PRJ-9',
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
        code: 'PRJ-8',
        name: 'Буруу хугацаа',
        startDate: '2026-12-31T00:00:00.000Z',
        endDate: '2026-01-01T00:00:00.000Z',
      });

    expect(response.status).toBe(400);
  });

  it('refuses a duplicate code within the same customer', async () => {
    await createProject();
    const response = await request(app)
      .post(`${API}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, code: 'PRJ-1', name: 'Давхардсан' });

    expect(response.status).toBe(409);
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
    await createProject({ code: 'PRJ-A', name: 'Гэрэлтүүлгийн төсөл' });
    await createProject({ code: 'PRJ-B', name: 'Самбарын төсөл' });

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
      .send({ customerId, code: 'PRJ-X', name: 'Эрхгүй' });

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
      .send({ projectId, code: 'BLD-9', name: 'Хагас координат', gpsLatitude: 47.9 });

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
      .send({ projectId, code: 'BLD-2', name: 'Архивласан төсөлд' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Архивласан');
  });

  it('refuses a building whose project does not exist', async () => {
    const response = await request(app)
      .post(`${API}/buildings`)
      .set('Authorization', `Bearer ${token}`)
      .send({ projectId: '000000000000000000000000', code: 'BLD-3', name: 'Байхгүй төсөл' });

    expect(response.status).toBe(404);
  });

  it('filters buildings by project', async () => {
    const first = await createProject({ code: 'PRJ-C' });
    const second = await createProject({ code: 'PRJ-D' });
    await createBuilding(first, { code: 'B-1' });
    await createBuilding(second, { code: 'B-2' });

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
    const floorId = await createFloor(buildingId, { code: 'FL-B1', floorNumber: -1, name: '-1 давхар' });

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
      .send({ buildingId, code: 'FL-9', name: 'Архивласан барилгад' });

    expect(response.status).toBe(400);
  });

  it('filters floors by building and by project', async () => {
    const projectId = await createProject();
    const buildingId = await createBuilding(projectId);
    await createFloor(buildingId, { code: 'FL-1' });
    await createFloor(buildingId, { code: 'FL-2', name: '2 давхар', floorNumber: 2 });

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
      .send({ customerId: tenantA.customerId, code: 'TA-NEW', name: 'Шинэ төсөл' });
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
      .send({ customerId: tenantB.customerId, code: 'TB-X', name: 'Өөр харилцагчид' });
    expect(createIntoB.status).toBe(403);
    expect(createIntoB.body.message).toContain('Өөр харилцагчийн');

    // A building under another tenant's project: the parent does not resolve in scope.
    const buildingUnderB = await request(app)
      .post(`${API}/buildings`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({ projectId: tenantB.projectId, code: 'TB-X2', name: 'Өөр төсөлд' });
    expect(buildingUnderB.status).toBe(404);

    // A floor under another tenant's building, for the same reason.
    const floorUnderB = await request(app)
      .post(`${API}/floors`)
      .set('Authorization', `Bearer ${overPrivileged}`)
      .send({ buildingId: tenantB.buildingId, code: 'TB-X3', name: 'Өөр барилгад' });
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
