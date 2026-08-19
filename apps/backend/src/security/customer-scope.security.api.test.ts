import { PERMISSIONS, SYSTEM_ROLE_KEYS } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../test/helpers';
import { Customer, ObjectNode } from '../modules/objects/object.models';
import { Role } from '../modules/rbac/role.model';
import { ServiceRequest } from '../modules/service-request/service-request.model';
import { User } from '../modules/user/user.model';

/**
 * INDEPENDENCE OF PERMISSION AND SCOPE, tenant half.
 *
 * A permission answers "may you call this endpoint". A scope answers "whose records may the
 * answer contain". They are separate defences and neither substitutes for the other, and the
 * whole point of the tier/role coherence rule is that a CUSTOMER holding a STAFF key would
 * be a caller who passes the first defence on endpoints whose second defence was written for
 * staff.
 *
 * `service-request.api.test.ts` already proves the scope holds for a customer carrying the
 * PORTAL keys. That is the supported configuration, and it does not test what this file
 * tests: the accounts here hold `service_request.view`, `object.view` and `customer.view` —
 * real staff keys — while sitting on the `customer` legacy tier. That state is exactly what
 * the chokepoint refuses to create, so it is written straight to the collection, and the
 * last case in the file proves the API still refuses to produce it.
 *
 * If the scope were ever keyed off permissions instead of the tier, or if a handler read the
 * caller's requested `customerId` without passing it through the resolver, every case here
 * turns red.
 */

const API = '/api/v1';
const PASSWORD = 'TestPassword2026x';

let app: Express;

let ownCustomerId: string;
let foreignCustomerId: string;
let ownProjectId: string;
let foreignProjectId: string;
let ownBuildingId: string;
let foreignBuildingId: string;
let ownRequestId: string;
let foreignRequestId: string;

/** The staff keys the fixture accounts hold. Not one of them is a portal key. */
const STAFF_KEYS = [
  PERMISSIONS.SERVICE_REQUEST_VIEW,
  PERMISSIONS.OBJECT_VIEW,
  PERMISSIONS.CUSTOMER_VIEW,
  PERMISSIONS.DASHBOARD_VIEW,
] as const;

async function loginAs(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status, `login failed for ${email}`).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

/**
 * A customer-tier account holding STAFF permissions.
 *
 * Built by demoting the tier of an account created with those permissions, because no API
 * path will produce this pairing: `assertTierRoleCoherence` refuses it in both directions.
 * The fixture is the hypothetical — "suppose one existed anyway" — and the assertions are
 * about what it can reach.
 */
async function createCustomerHoldingStaffKeys(
  email: string,
  linkedCustomerId: string | null,
): Promise<string> {
  const user = await createUserWithPermissions(email, [...STAFF_KEYS]);
  await User.updateOne(
    { _id: new Types.ObjectId(user.userId) },
    {
      $set: {
        role: 'customer',
        customer: linkedCustomerId ? new Types.ObjectId(linkedCustomerId) : null,
      },
    },
  );
  return loginAs(user.email, user.password);
}

/** Two tenants, each with a project, a building and one service request. */
async function seedTwoTenants(): Promise<void> {
  const own = await Customer.create({ code: 'CT', name: 'Central Tower ХХК' });
  const foreign = await Customer.create({ code: 'OT', name: 'Өөр Байгууллага ХХК' });
  ownCustomerId = String(own._id);
  foreignCustomerId = String(foreign._id);

  const build = async (
    customerId: string,
    prefix: string,
  ): Promise<{ projectId: string; buildingId: string }> => {
    const project = await ObjectNode.create({
      kind: 'PROJECT',
      code: `${prefix}-P1`,
      name: `${prefix} төсөл`,
      parent: null,
      customer: customerId,
      ancestors: [],
    });
    const building = await ObjectNode.create({
      kind: 'BUILDING',
      code: `${prefix}-B1`,
      name: `${prefix} барилга`,
      parent: project._id,
      customer: customerId,
      ancestors: [project._id],
    });
    return { projectId: String(project._id), buildingId: String(building._id) };
  };

  const ownNodes = await build(ownCustomerId, 'OWN');
  const foreignNodes = await build(foreignCustomerId, 'FOREIGN');
  ownProjectId = ownNodes.projectId;
  ownBuildingId = ownNodes.buildingId;
  foreignProjectId = foreignNodes.projectId;
  foreignBuildingId = foreignNodes.buildingId;

  const seedRequest = async (
    number: string,
    customerId: string,
    buildingId: string,
    description: string,
  ): Promise<string> => {
    const created = await ServiceRequest.create({
      requestNumber: number,
      customer: customerId,
      building: buildingId,
      description,
      contactName: 'Батаа',
      contactPhone: '9911-0000',
      slaStartedAt: new Date(),
      slaDueAt: new Date(Date.now() + 86_400_000),
    });
    return String(created._id);
  };

  ownRequestId = await seedRequest(
    'SR-202607-0001',
    ownCustomerId,
    ownBuildingId,
    'Манай байгууллагын хүсэлт',
  );
  foreignRequestId = await seedRequest(
    'SR-202607-0002',
    foreignCustomerId,
    foreignBuildingId,
    'ӨӨР БАЙГУУЛЛАГЫН НУУЦ ХҮСЭЛТ',
  );
}

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  await seedTwoTenants();
});

describe('a customer holding staff permissions is still confined to its own organisation', () => {
  it('lists only its own service requests, even though it holds the staff read key', async () => {
    const token = await createCustomerHoldingStaffKeys('sec-scope-a@test.mn', ownCustomerId);

    // The staff key really is held — the case would be vacuous if the caller were being
    // refused by the permission guard instead of confined by the scope.
    const me = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    expect(me.body.data.role).toBe('customer');
    expect(me.body.data.permissions).toContain(PERMISSIONS.SERVICE_REQUEST_VIEW);

    const response = await request(app)
      .get(`${API}/service-requests`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].id).toBe(ownRequestId);
    expect(JSON.stringify(response.body)).not.toContain('ӨӨР БАЙГУУЛЛАГЫН НУУЦ ХҮСЭЛТ');
  });

  it('cannot widen the answer by naming another organisation in the query', async () => {
    const token = await createCustomerHoldingStaffKeys('sec-scope-b@test.mn', ownCustomerId);

    const response = await request(app)
      .get(`${API}/service-requests`)
      .query({ customerId: foreignCustomerId })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].id).toBe(ownRequestId);
    expect(response.body.data.items[0].customer.id).toBe(ownCustomerId);
    expect(JSON.stringify(response.body)).not.toContain(foreignRequestId);
  });

  it('is told another tenant’s record does not exist, not that it is forbidden', async () => {
    const token = await createCustomerHoldingStaffKeys('sec-scope-c@test.mn', ownCustomerId);

    const detail = await request(app)
      .get(`${API}/service-requests/${foreignRequestId}`)
      .set('Authorization', `Bearer ${token}`);

    // 404 rather than 403: a forbidden answer would confirm the id names a real record and
    // turn the endpoint into an oracle for probing other organisations' identifiers.
    expect(detail.status).toBe(404);
    expect(JSON.stringify(detail.body)).not.toContain('ӨӨР БАЙГУУЛЛАГЫН НУУЦ ХҮСЭЛТ');

    // Its own record, by contrast, is served — so the 404 above is the scope and not a
    // blanket refusal.
    const own = await request(app)
      .get(`${API}/service-requests/${ownRequestId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(own.status).toBe(200);
    expect(own.body.data.id).toBe(ownRequestId);
  });

  /**
   * Its OWN record, narrowed.
   *
   * Tenancy was never the gap here — a customer is entitled to this request. One DTO served
   * staff and customers alike, so the reply also carried the internal operating record: who
   * made each status change and the free-text reason for it, the SLA-extension
   * justification, the revisit reason, the creator, the team leader and each technician's
   * internal employee code. The web portal knew and declined to render it, calling itself
   * "a presentation choice, not a boundary"; the customer mobile app rendered it, and
   * `curl` was never bound by either.
   */
  it('does not receive the internal workflow trail on its own request', async () => {
    const token = await createCustomerHoldingStaffKeys('sec-scope-narrow@test.mn', ownCustomerId);

    await ServiceRequest.updateOne(
      { _id: new Types.ObjectId(ownRequestId) },
      {
        $set: {
          slaExtensionReason: 'ДОТООД: ажилтан өвчтэй тул сунгав',
          revisitReason: 'ДОТООД: багаж дутуу байсан',
          createdByName: 'Диспетчер Болд',
          teamLeaderEmployee: new Types.ObjectId(),
          statusHistory: [
            {
              fromStatus: 'NEW',
              toStatus: 'ASSIGNED',
              reason: 'ДОТООД: буцаасан шалтгаан',
              changedByName: 'Менежер Ганаа',
              changedAt: new Date(),
            },
          ],
        },
      },
    );

    const response = await request(app)
      .get(`${API}/service-requests/${ownRequestId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(ownRequestId);

    // Nothing marked ДОТООД may appear anywhere in the payload.
    expect(JSON.stringify(response.body)).not.toContain('ДОТООД');
    expect(JSON.stringify(response.body)).not.toContain('Менежер Ганаа');
    expect(JSON.stringify(response.body)).not.toContain('Диспетчер Болд');

    expect(response.body.data.slaExtensionReason).toBeNull();
    expect(response.body.data.revisitReason).toBeNull();
    expect(response.body.data.createdByName).toBeNull();
    expect(response.body.data.teamLeaderEmployeeId).toBeNull();

    // The progress timeline itself survives — that is the point of the screen — with only
    // the internal who and why removed.
    expect(response.body.data.statusHistory).toHaveLength(1);
    expect(response.body.data.statusHistory[0]).toMatchObject({
      fromStatus: 'NEW',
      toStatus: 'ASSIGNED',
      reason: null,
      changedByName: null,
    });
  });

  it('sees only its own projects through the staff object hierarchy', async () => {
    const token = await createCustomerHoldingStaffKeys('sec-scope-d@test.mn', ownCustomerId);

    const list = await request(app).get(`${API}/projects`).set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const ids = (list.body.data.items as Array<{ id: string }>).map((item) => item.id);
    expect(ids).toEqual([ownProjectId]);

    const foreign = await request(app)
      .get(`${API}/projects/${foreignProjectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(foreign.status).toBe(404);

    const own = await request(app)
      .get(`${API}/projects/${ownProjectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(own.status).toBe(200);
  });

  /**
   * The misconfiguration that would be catastrophic if it defaulted the other way.
   *
   * A customer account with no organisation cannot be scoped at all. Defaulting to "no
   * filter" would hand it every tenant; defaulting to "match nothing" would look like an
   * empty account and hide a misconfiguration an administrator has to fix. It is refused.
   */
  it('refuses a customer account with no organisation rather than leaving it unfiltered', async () => {
    const token = await createCustomerHoldingStaffKeys('sec-scope-e@test.mn', null);

    for (const path of [`${API}/service-requests`, `${API}/projects`]) {
      const response = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      expect(response.status, `${path} answered an unscoped customer`).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain('ӨӨР БАЙГУУЛЛАГЫН НУУЦ ХҮСЭЛТ');
      expect(JSON.stringify(response.body)).not.toContain(foreignProjectId);
    }
  });
});

/**
 * The state the cases above hypothesise is not reachable through the API, in either
 * direction. Without this, the file would read as though the pairing were merely tolerated.
 */
describe('the pairing those fixtures rely on cannot be produced through the API', () => {
  it('refuses a staff role on a customer account and a portal role on a staff account', async () => {
    const superUser = await createSuperUser('sec-scope-super@test.mn');
    const token = await loginAs(superUser.email, superUser.password);

    const staffRole = await Role.findOne({ key: SYSTEM_ROLE_KEYS.ADMIN }).select('_id');
    const portalRole = await Role.findOne({ key: SYSTEM_ROLE_KEYS.CUSTOMER }).select('_id');
    expect(staffRole).not.toBeNull();
    expect(portalRole).not.toBeNull();

    const customerUser = await User.create({
      fullName: 'Харилцагч',
      email: 'sec-scope-target-a@test.mn',
      password: 'irrelevant-hash',
      role: 'customer',
      roles: [portalRole!._id],
      customer: new Types.ObjectId(ownCustomerId),
      status: 'active',
      passwordChangedAt: new Date(),
    });
    const staffUser = await User.create({
      fullName: 'Ажилтан',
      email: 'sec-scope-target-b@test.mn',
      password: 'irrelevant-hash',
      role: 'technician',
      roles: [],
      status: 'active',
      passwordChangedAt: new Date(),
    });

    const staffOnCustomer = await request(app)
      .post(`${API}/rbac/users/${String(customerUser._id)}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [String(staffRole!._id)] });
    expect(staffOnCustomer.status).toBe(400);

    const portalOnStaff = await request(app)
      .post(`${API}/rbac/users/${String(staffUser._id)}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [String(portalRole!._id)] });
    expect(portalOnStaff.status).toBe(400);

    // Neither account moved, and the refusals came from the policy rather than from a
    // validation error about the ids.
    const reloadedCustomer = await User.findById(customerUser._id).select('roles');
    const reloadedStaff = await User.findById(staffUser._id).select('roles');
    expect((reloadedCustomer?.roles ?? []).map(String)).toEqual([String(portalRole!._id)]);
    expect((reloadedStaff?.roles ?? []).map(String)).toEqual([]);
  });
});
