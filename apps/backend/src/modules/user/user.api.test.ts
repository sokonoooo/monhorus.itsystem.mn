import {
  PERMISSIONS,
  SYSTEM_ROLE_DEFAULT_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
} from '@monhorus/shared';
import type { Express } from 'express';
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
import { Customer } from '../objects/object.models';
import { Role } from '../rbac/role.model';
import { Session } from './session.model';
import { User } from './user.model';

const API = '/api/v1';
const PASSWORD = 'AdminPassword2026x';

let app: Express;
let customerId: string;
let otherCustomerId: string;

async function loginAs(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

async function login(email: string): Promise<string> {
  return loginAs(email, PASSWORD);
}

/** The id of a seeded system role, which `resetDomainCollections` preserves. */
async function systemRoleId(key: string): Promise<string> {
  const role = await Role.findOne({ key }).select('_id');
  expect(role).not.toBeNull();
  return String(role?._id);
}

/**
 * Creates an active account directly, bypassing the API.
 *
 * The API is the thing under test here, so fixtures are written straight to the
 * collection: a fixture built through the endpoint would make a failing assertion
 * ambiguous between the setup and the case.
 */
async function createAccount(options: {
  email: string;
  role: 'customer' | 'technician' | 'admin' | 'head_admin';
  customer?: string | null;
  /** Dynamic roles. Defaults to none, which is what a legacy account carries. */
  roles?: string[];
}): Promise<string> {
  const user = await User.create({
    fullName: `Test ${options.email}`,
    email: options.email,
    password: await hashPassword(PASSWORD),
    role: options.role,
    roles: options.roles ?? [],
    customer: options.customer ?? null,
    status: 'active',
    passwordChangedAt: new Date(),
  });
  return String(user._id);
}

function newUserBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: 'Шинэ Хэрэглэгч',
    email: 'new.user@test.mn',
    password: 'NewUserPass2026x',
    role: 'customer',
    requirePasswordChange: true,
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
  const customer = await Customer.create({ code: 'CT', name: 'Central Tower ХХК' });
  const other = await Customer.create({ code: 'OT', name: 'Өөр Байгууллага ХХК' });
  customerId = String(customer._id);
  otherCustomerId = String(other._id);
});

describe('POST /users - customer organisation link', () => {
  it('refuses a customer-role user without a customerId', async () => {
    const token = await login((await headAdmin()).email);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody());

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.issues).toContainEqual({
      field: 'customerId',
      message: 'Байгууллага заавал сонгоно.',
    });

    // Refused means not written: no half-created, unlinked customer account is left behind.
    expect(await User.findOne({ email: 'new.user@test.mn' })).toBeNull();
  });

  it('links a customer-role user to the organisation and returns its name', async () => {
    const token = await login((await headAdmin()).email);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ customerId }));

    expect(response.status).toBe(201);
    expect(response.body.data.user.customerId).toBe(customerId);
    expect(response.body.data.user.customerName).toBe('Central Tower ХХК');

    const stored = await User.findOne({ email: 'new.user@test.mn' });
    expect(String(stored?.customer)).toBe(customerId);
  });

  it('refuses a customerId that references no organisation', async () => {
    const token = await login((await headAdmin()).email);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ customerId: '0123456789abcdef01234567' }));

    expect(response.status).toBe(400);
    expect(response.body.issues).toContainEqual({
      field: 'customerId',
      message: 'Сонгосон байгууллага олдсонгүй.',
    });
  });

  it('refuses a customerId on a staff account rather than ignoring it', async () => {
    const token = await login((await headAdmin()).email);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ role: 'technician', customerId }));

    expect(response.status).toBe(400);
    expect(response.body.issues).toContainEqual({
      field: 'customerId',
      message: 'Зөвхөн харилцагчийн эрхтэй хэрэглэгчийг байгууллагад холбоно.',
    });
    expect(await User.findOne({ email: 'new.user@test.mn' })).toBeNull();
  });

  it('creates a staff account with no link and leaves it null', async () => {
    const token = await login((await headAdmin()).email);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ role: 'technician' }));

    expect(response.status).toBe(201);
    expect(response.body.data.user.customerId).toBeNull();
    expect(response.body.data.user.customerName).toBeNull();
  });

  it('records the link on the creation audit row', async () => {
    const token = await login((await headAdmin()).email);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ customerId }));
    expect(response.status).toBe(201);

    const entry = await AuditLog.findOne({
      entityType: 'User',
      action: 'Created',
      entityId: response.body.data.user.id,
    });
    expect(entry?.newValue).toMatchObject({ customerId });
  });
});

/**
 * Regression cover for accounts being created with no dynamic roles at all.
 *
 * Effective permissions come only from `roles`, so an account written without one used to
 * resolve to an empty set: every endpoint answered 403 until an administrator remembered
 * to call POST /rbac/users/:userId/roles separately. The customer case is asserted end to
 * end, because a locked-out customer is the failure that was actually reported.
 */
describe('POST /users - dynamic role assignment', () => {
  it('gives a created customer the CUSTOMER role and a portal session that works', async () => {
    const token = await login((await headAdmin()).email);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      // The passcode change is waived so the new account can be exercised immediately;
      // enforcePasswordChange would otherwise block it before any permission is consulted.
      .send(newUserBody({ customerId, requirePasswordChange: false }));

    expect(response.status).toBe(201);

    const stored = await User.findOne({ email: 'new.user@test.mn' });
    expect(stored?.roles.map(String)).toEqual([await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER)]);

    const portalToken = await loginAs('new.user@test.mn', 'NewUserPass2026x');

    const me = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).toContain(PERMISSIONS.PORTAL_PROJECT_VIEW);
    // Not one staff key, so the portal grant did not quietly widen into the back office.
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.OBJECT_MANAGE);

    // The endpoint the reported failure was on: reachable with no second admin call.
    const projects = await request(app)
      .get(`${API}/projects`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(projects.status).toBe(200);
  });

  it('records the granted roles on the creation audit row', async () => {
    const token = await login((await headAdmin()).email);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ customerId }));
    expect(response.status).toBe(201);

    const entry = await AuditLog.findOne({
      entityType: 'User',
      action: 'Created',
      entityId: response.body.data.user.id,
    });
    expect(entry?.newValue).toMatchObject({
      roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER)],
    });
  });

  it('gives a created admin the ADMIN role, not the superuser one', async () => {
    const token = await login((await headAdmin()).email);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ role: 'admin', email: 'new.admin@test.mn' }));

    expect(response.status).toBe(201);
    const stored = await User.findOne({ email: 'new.admin@test.mn' });
    expect(stored?.roles.map(String)).toEqual([await systemRoleId(SYSTEM_ROLE_KEYS.ADMIN)]);
  });

  /**
   * The tier used to map to null, so every technician was created permissionless and the
   * employee mobile app answered 403 to its very first call after a successful login.
   */
  it('gives a created technician the TECHNICIAN role and a session that can work', async () => {
    const token = await login((await headAdmin()).email);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ role: 'technician', requirePasswordChange: false }));

    expect(response.status).toBe(201);

    const stored = await User.findOne({ email: 'new.user@test.mn' });
    expect(stored?.roles.map(String)).toEqual([await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN)]);

    const techToken = await loginAs('new.user@test.mn', 'NewUserPass2026x');

    const me = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${techToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).toContain(PERMISSIONS.PLANNED_WORK_VIEW);
    expect(me.body.data.permissions).toContain(PERMISSIONS.OBJECT_MASTER_ASSESS);
    // Doing the work, not deciding who does it or signing it off.
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.DISPATCH_ASSIGN);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.PLANNED_WORK_APPROVE_REPORT);
    // Money and staff records are somebody else's tier.
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.INVOICE_MANAGE);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.EMPLOYEE_VIEW_SALARY);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.RBAC_MANAGE);

    // The work list the mobile app opens on: reachable with no second admin call.
    const work = await request(app)
      .get(`${API}/planned-work`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(work.status).toBe(200);
  });

  it('honours an explicit role choice instead of the tier default', async () => {
    const token = await login((await headAdmin()).email);
    const salesRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.SALES);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ role: 'technician', roleIds: [salesRoleId] }));

    expect(response.status).toBe(201);
    expect((await User.findOne({ email: 'new.user@test.mn' }))?.roles.map(String)).toEqual([
      salesRoleId,
    ]);
  });

  it('falls back to the default when the role picker submits an empty selection', async () => {
    const token = await login((await headAdmin()).email);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ customerId, roleIds: [] }));

    expect(response.status).toBe(201);
    expect((await User.findOne({ email: 'new.user@test.mn' }))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER),
    ]);
  });

  it('refuses a role carrying permissions the creating admin does not hold', async () => {
    // rbac.manage is granted so the case exercises the permission CAP and not the gate
    // asserted below it: holding the key to assign roles is not holding the roles. user.manage
    // is granted for the same reason — it is the router's key, not the assignment rule.
    const actor = await createUserWithPermissions('limited.admin@test.mn', [
      PERMISSIONS.CUSTOMER_VIEW,
      PERMISSIONS.USER_MANAGE,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...newUserBody({ role: 'technician' }),
        roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN)],
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSUFFICIENT_PRIVILEGES');
    // Refused means not written: no superuser account is left behind by the attempt.
    expect(await User.findOne({ email: 'new.user@test.mn' })).toBeNull();
  });

  it('refuses a staff role on a customer account even for the head_admin', async () => {
    const token = await login((await headAdmin()).email);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ customerId, roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.ADMIN)] }));

    expect(response.status).toBe(400);
    expect(response.body.issues).toContainEqual({
      field: 'roleIds',
      message: 'Харилцагчид ажилтны эрх олгох боломжгүй.',
    });
    expect(await User.findOne({ email: 'new.user@test.mn' })).toBeNull();
  });
});

/**
 * Privilege escalation through `roleIds`.
 *
 * The user router mounts `authorize('admin', 'head_admin')`, a legacy-tier check that asks
 * for no permission whatsoever. Choosing an account's dynamic roles is role assignment, and
 * role assignment requires rbac.manage everywhere else in the API, so before this the
 * creation endpoint was a way around POST /rbac/users/:userId/roles for any admin-tier
 * account — including one carrying `roles: []`, which holds no permission at all.
 */
describe('POST /users - roleIds requires rbac.manage', () => {
  it('refuses an admin-tier actor without rbac.manage who supplies roleIds', async () => {
    // Everything an ordinary back-office admin holds, minus the one key that governs
    // assignment, so the refusal cannot be mistaken for a generally underpowered account.
    const actor = await createUserWithPermissions('nomanage.admin@test.mn', [
      PERMISSIONS.CUSTOMER_VIEW,
      PERMISSIONS.OBJECT_VIEW,
      PERMISSIONS.EMPLOYEE_CREATE,
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.USER_VIEW,
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...newUserBody({ role: 'technician' }),
        roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.DISPATCH)],
      });

    expect(response.status).toBe(403);
    expect(await User.findOne({ email: 'new.user@test.mn' })).toBeNull();
  });

  it('refuses even a role the actor could not otherwise be caught granting', async () => {
    // The requested role is the tier default, so the permission cap alone would let this
    // through: only the rbac.manage gate refuses it. Without the gate, an actor with no
    // permissions could still pick roles, which is the hole being closed.
    const actor = await createUserWithPermissions('nomanage.two@test.mn', [
      PERMISSIONS.CUSTOMER_VIEW,
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...newUserBody({ role: 'technician' }),
        roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN)],
      });

    expect(response.status).toBe(403);
    expect(await User.findOne({ email: 'new.user@test.mn' })).toBeNull();
  });

  it('refuses a legacy admin account that holds no dynamic roles at all', async () => {
    // The tier gate passes for this account and its effective permission set is empty, so
    // it is the sharpest form of the defect: authority with nothing backing it. Two rules
    // now refuse it — `user.manage` at the router and `rbac.manage` at the chokepoint — and
    // it is kept because it is the shape of account the tier gate alone used to wave through.
    await createAccount({ email: 'legacy.admin@test.mn', role: 'admin', roles: [] });
    const token = await login('legacy.admin@test.mn');

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...newUserBody({ role: 'technician' }),
        roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN)],
      });

    expect(response.status).toBe(403);
    expect(await User.findOne({ email: 'new.user@test.mn' })).toBeNull();
  });

  it('still lets an admin without rbac.manage create an account the ordinary way', async () => {
    const actor = await createUserWithPermissions('plain.admin@test.mn', [
      PERMISSIONS.CUSTOMER_VIEW,
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ role: 'technician' }));

    expect(response.status).toBe(201);
    expect((await User.findOne({ email: 'new.user@test.mn' }))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);
  });

  it('treats an empty selection as the default rather than as a role choice', async () => {
    // The picker submits the field whether or not anything is ticked, and an empty array
    // resolves to exactly what silence resolves to, so gating it would break plain admins
    // without preventing a single escalation.
    const actor = await createUserWithPermissions('empty.picker@test.mn', [
      PERMISSIONS.CUSTOMER_VIEW,
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ customerId, roleIds: [] }));

    expect(response.status).toBe(201);
    expect((await User.findOne({ email: 'new.user@test.mn' }))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER),
    ]);
  });
});

describe('PATCH /users/:userId - changing the customer organisation', () => {
  it('writes an audit row carrying the old and the new organisation', async () => {
    const token = await login((await headAdmin()).email);
    const targetId = await createAccount({
      email: 'linked@test.mn',
      role: 'customer',
      customer: customerId,
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: otherCustomerId, reason: 'Байгууллага шилжсэн.' });

    expect(response.status).toBe(200);
    expect(response.body.data.customerId).toBe(otherCustomerId);
    expect(response.body.data.customerName).toBe('Өөр Байгууллага ХХК');

    const entry = await AuditLog.findOne({ entityType: 'User', action: 'Updated' });
    expect(entry?.oldValue).toEqual({ customerId });
    expect(entry?.newValue).toEqual({ customerId: otherCustomerId });
    expect(entry?.reason).toBe('Байгууллага шилжсэн.');
  });

  it('refuses to unlink an account that is still a customer', async () => {
    const token = await login((await headAdmin()).email);
    const targetId = await createAccount({
      email: 'linked@test.mn',
      role: 'customer',
      customer: customerId,
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: null });

    expect(response.status).toBe(400);
    expect(String((await User.findById(targetId))?.customer)).toBe(customerId);
  });

  it('clears the link when the account is demoted from customer to staff', async () => {
    const token = await login((await headAdmin()).email);
    const customerRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER);
    const targetId = await createAccount({
      email: 'linked@test.mn',
      role: 'customer',
      customer: customerId,
      roles: [customerRoleId],
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'technician' });

    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe('technician');
    expect(response.body.data.customerId).toBeNull();
    expect((await User.findById(targetId))?.customer).toBeNull();

    const entry = await AuditLog.findOne({ entityType: 'User', action: 'Updated' });
    expect(entry?.oldValue).toEqual({
      role: 'customer',
      customerId,
      roleIds: [customerRoleId],
    });
    expect(entry?.newValue).toEqual({
      role: 'technician',
      customerId: null,
      roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN)],
    });
  });

  it('refuses to promote a staff account to customer without an organisation', async () => {
    const token = await login((await headAdmin()).email);
    const targetId = await createAccount({ email: 'staff@test.mn', role: 'technician' });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'customer' });

    expect(response.status).toBe(400);
    expect((await User.findById(targetId))?.role).toBe('technician');
  });

  it('links a staff account promoted to customer with an organisation', async () => {
    const token = await login((await headAdmin()).email);
    const targetId = await createAccount({ email: 'staff@test.mn', role: 'technician' });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'customer', customerId });

    expect(response.status).toBe(200);
    expect(response.body.data.customerId).toBe(customerId);
  });

  it('keeps the existing link when the request says nothing about it', async () => {
    const token = await login((await headAdmin()).email);
    const targetId = await createAccount({
      email: 'linked@test.mn',
      role: 'customer',
      customer: customerId,
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Шинэ Нэр' });

    expect(response.status).toBe(200);
    expect(response.body.data.fullName).toBe('Шинэ Нэр');
    expect(response.body.data.customerId).toBe(customerId);
  });

  it('refuses a caller who is not an administrator', async () => {
    await createAccount({ email: 'tech@test.mn', role: 'technician' });
    const token = await login('tech@test.mn');
    const targetId = await createAccount({
      email: 'linked@test.mn',
      role: 'customer',
      customer: customerId,
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: otherCustomerId });

    expect(response.status).toBe(403);
    expect(String((await User.findById(targetId))?.customer)).toBe(customerId);
    expect(await AuditLog.findOne({ entityType: 'User', action: 'Updated' })).toBeNull();
  });

  it('refuses an unauthenticated caller', async () => {
    const targetId = await createAccount({
      email: 'linked@test.mn',
      role: 'customer',
      customer: customerId,
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .send({ customerId: otherCustomerId });

    expect(response.status).toBe(401);
  });

  it('refuses a plain admin acting on another administrator', async () => {
    // The seeded ADMIN role, so the actor clears the router keys and the refusal below is
    // assertCanManageRole's rather than a missing permission.
    await createAccount({
      email: 'admin@test.mn',
      role: 'admin',
      roles: [await systemRoleId(SYSTEM_ROLE_KEYS.ADMIN)],
    });
    const token = await login('admin@test.mn');
    const targetId = await createAccount({ email: 'peer.admin@test.mn', role: 'admin' });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'customer', customerId });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSUFFICIENT_PRIVILEGES');
  });
});

/**
 * Cross-tenant exposure on a tier change.
 *
 * Tenant scoping keys off the LEGACY tier, not off permissions: `resolveCustomerScope`
 * branches on `auth.role === 'customer'` and every other value resolves to `{ mode: 'STAFF' }`,
 * whose filter is `{}` — no filter at all. An account promoted out of `customer` while still
 * holding the CUSTOMER role therefore kept portal keys, which the portal endpoints accept,
 * but lost the predicate that confined them to one organisation: it read every tenant's
 * records. The demotion direction is the same mistake reversed, a former admin keeping the
 * back office.
 *
 * The invariant these assert is that the account's roles always describe its current tier.
 */
describe('PATCH /users/:userId - dynamic roles follow the tier', () => {
  it('drops the portal role when a customer is promoted to staff', async () => {
    const token = await login((await headAdmin()).email);
    const targetId = await createAccount({
      email: 'promoted@test.mn',
      role: 'customer',
      customer: customerId,
      roles: [await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER)],
    });
    const targetToken = await login('promoted@test.mn');

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'technician' });
    expect(response.status).toBe(200);

    expect((await User.findById(targetId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);

    // The live session picks the change up on its next call; nothing is cached in the token.
    const me = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${targetToken}`);
    expect(me.status).toBe(200);
    // Not one portal key survives, so there is no permission left that the now-absent
    // customer scope was the only thing restraining.
    expect(
      (me.body.data.permissions as string[]).filter((key) => key.startsWith('portal.')),
    ).toEqual([]);
    expect(me.body.data.permissions).toContain(PERMISSIONS.PLANNED_WORK_VIEW);
  });

  it('drops the back-office role when an admin is demoted to customer', async () => {
    const token = await login((await headAdmin()).email);
    const targetId = await createAccount({
      email: 'demoted@test.mn',
      role: 'admin',
      roles: [await systemRoleId(SYSTEM_ROLE_KEYS.ADMIN)],
    });
    const targetToken = await login('demoted@test.mn');

    // Held before the demotion, so the refusal below is the demotion's doing.
    const beforeEmployees = await request(app)
      .get(`${API}/employees`)
      .set('Authorization', `Bearer ${targetToken}`);
    expect(beforeEmployees.status).toBe(200);

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'customer', customerId });
    expect(response.status).toBe(200);

    expect((await User.findById(targetId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER),
    ]);

    const afterEmployees = await request(app)
      .get(`${API}/employees`)
      .set('Authorization', `Bearer ${targetToken}`);
    expect(afterEmployees.status).toBe(403);

    // Still a working account, just a customer one now.
    const projects = await request(app)
      .get(`${API}/projects`)
      .set('Authorization', `Bearer ${targetToken}`);
    expect(projects.status).toBe(200);
  });

  it('leaves the roles alone when the edit does not change the tier', async () => {
    const token = await login((await headAdmin()).email);
    const dispatchRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.DISPATCH);
    const targetId = await createAccount({
      email: 'unchanged@test.mn',
      role: 'technician',
      // A deliberate grant from the access screen: an unrelated edit must not undo it.
      roles: [dispatchRoleId],
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Өөр Нэр' });

    expect(response.status).toBe(200);
    expect((await User.findById(targetId))?.roles.map(String)).toEqual([dispatchRoleId]);
  });

  it('leaves the roles alone when the request restates the tier it already has', async () => {
    const token = await login((await headAdmin()).email);
    const dispatchRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.DISPATCH);
    const targetId = await createAccount({
      email: 'restated@test.mn',
      role: 'technician',
      roles: [dispatchRoleId],
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'technician', fullName: 'Мөн Тэр' });

    expect(response.status).toBe(200);
    expect((await User.findById(targetId))?.roles.map(String)).toEqual([dispatchRoleId]);
  });

  it('leaves the account untouched when the tier change is rejected by the link rules', async () => {
    const token = await login((await headAdmin()).email);
    const dispatchRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.DISPATCH);
    const targetId = await createAccount({
      email: 'halfway@test.mn',
      role: 'technician',
      roles: [dispatchRoleId],
    });

    // Promotion to customer with no organisation: refused, and the roles must not have
    // been re-mapped on the way to the refusal.
    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'customer' });

    expect(response.status).toBe(400);
    const stored = await User.findById(targetId);
    expect(stored?.role).toBe('technician');
    expect(stored?.roles.map(String)).toEqual([dispatchRoleId]);
  });
});

/**
 * Privilege escalation through the tier-change re-map.
 *
 * The re-map that keeps roles in step with the tier is itself a permission GRANT, and it
 * arrived with no authority rule on it: the router in front of PATCH mounts only
 * `authorize('admin', 'head_admin')`, a coarse tier check that asks for no permission at
 * all. So an admin-tier account holding nothing but `dashboard.view` could flip a customer
 * to `technician` and thereby hand out the whole TECHNICIAN set — a grant it could make
 * through no other endpoint, and one PATCH could not make at all before the re-map existed.
 *
 * The rule now applied is creation's: `rbac.manage`, or hold what you are handing out.
 */
describe('PATCH /users/:userId - the tier re-map is capped by the actor', () => {
  it('refuses an admin-tier actor who holds neither rbac.manage nor the tier default', async () => {
    // user.manage is granted throughout this block so every refusal below is the re-map cap
    // speaking, not the router key that now guards the endpoint.
    const actor = await createUserWithPermissions('weak.admin@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const customerRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER);
    const targetId = await createAccount({
      email: 'victim@test.mn',
      role: 'customer',
      customer: customerId,
      roles: [customerRoleId],
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'technician' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSUFFICIENT_PRIVILEGES');

    // Nothing at all was written: not the tier, not the link, not the roles. The re-map is
    // resolved before `save`, so a refusal cannot leave a half-migrated account.
    const stored = await User.findById(targetId);
    expect(stored?.role).toBe('customer');
    expect(String(stored?.customer)).toBe(customerId);
    expect(stored?.roles.map(String)).toEqual([customerRoleId]);
    expect(await AuditLog.findOne({ entityType: 'User', action: 'Updated' })).toBeNull();
  });

  it('refuses the escalation even when the target had no roles to begin with', async () => {
    const actor = await createUserWithPermissions('weak.admin2@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const targetId = await createAccount({
      email: 'empty@test.mn',
      role: 'customer',
      customer: customerId,
      roles: [],
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'technician' });

    expect(response.status).toBe(403);
    expect((await User.findById(targetId))?.roles).toEqual([]);
  });

  it('allows an actor holding rbac.manage, the authority for assigning roles', async () => {
    const actor = await createUserWithPermissions('rbac.admin@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.USER_MANAGE,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const targetId = await createAccount({
      email: 'promotable@test.mn',
      role: 'customer',
      customer: customerId,
      roles: [await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER)],
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'technician' });

    expect(response.status).toBe(200);
    expect((await User.findById(targetId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);
  });

  /**
   * The ordinary back-office workflow, which the cap must not break: an administrator whose
   * own role is a superset of TECHNICIAN is giving away nothing it does not have, so it
   * needs no `rbac.manage` — exactly as it needs none to create a technician from scratch.
   */
  it('allows an actor who already holds everything the tier default carries', async () => {
    const actor = await createUserWithPermissions('ordinary.admin@test.mn', [
      ...SYSTEM_ROLE_DEFAULT_PERMISSIONS[SYSTEM_ROLE_KEYS.TECHNICIAN],
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const targetId = await createAccount({
      email: 'newtech@test.mn',
      role: 'customer',
      customer: customerId,
      roles: [await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER)],
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'technician' });

    expect(response.status).toBe(200);
    expect((await User.findById(targetId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);
  });

  /**
   * The one carve-out. No staff role holds a portal key — CUSTOMER is defined as portal keys
   * only, so that a customer is refused at every staff guard — so capping the customer tier
   * against the actor's own set would make moving an account to it impossible for anyone but
   * a superuser. A portal key confers no authority over staff data; the customer scope
   * resolver confines it to the account's own organisation.
   */
  it('allows a demotion to the customer tier, whose portal keys no staff actor holds', async () => {
    const actor = await createUserWithPermissions('demoting.admin@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const targetId = await createAccount({
      email: 'tobe.customer@test.mn',
      role: 'technician',
      roles: [await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN)],
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'customer', customerId });

    expect(response.status).toBe(200);
    expect((await User.findById(targetId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER),
    ]);
  });

  it('leaves the head_admin workflow untouched', async () => {
    const token = await login((await headAdmin()).email);
    const targetId = await createAccount({
      email: 'byhead@test.mn',
      role: 'customer',
      customer: customerId,
      roles: [await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER)],
    });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'technician' });

    expect(response.status).toBe(200);
    expect((await User.findById(targetId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);
  });
});

/**
 * Suspension is the only way to take a working account away from someone, so the two
 * refusals matter as much as the success: an administrator must not be able to lock
 * itself out, and a plain admin must not be able to suspend a peer administrator.
 */
describe('PATCH /users/:userId/status', () => {
  it('suspends an active account, revoking its live sessions', async () => {
    const token = await login((await headAdmin()).email);
    const targetId = await createAccount({ email: 'target@test.mn', role: 'technician' });
    // A signed-in target, so the revocation is observed rather than assumed.
    const targetToken = await login('target@test.mn');
    expect(
      (await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${targetToken}`))
        .status,
    ).toBe(200);

    const response = await request(app)
      .patch(`${API}/users/${targetId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'suspended', reason: 'Ажлаас чөлөөлөгдсөн.' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('suspended');
    expect((await User.findById(targetId))?.status).toBe('suspended');

    expect(await Session.countDocuments({ user: targetId, revokedAt: null })).toBe(0);

    const entry = await AuditLog.findOne({ entityType: 'User', action: 'StatusChanged' });
    expect(entry?.oldValue).toEqual({ status: 'active' });
    expect(entry?.newValue).toEqual({ status: 'suspended' });
    expect(entry?.reason).toBe('Ажлаас чөлөөлөгдсөн.');
  });

  it('reactivates a suspended account', async () => {
    const token = await login((await headAdmin()).email);
    const targetId = await createAccount({ email: 'target@test.mn', role: 'technician' });
    await User.findByIdAndUpdate(targetId, { status: 'suspended' });

    const response = await request(app)
      .patch(`${API}/users/${targetId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'active' });

    expect(response.status).toBe(200);
    expect((await User.findById(targetId))?.status).toBe('active');
  });

  it('refuses the caller changing their own status', async () => {
    const actorId = await createAccount({ email: 'selfie.admin@test.mn', role: 'head_admin' });
    const token = await login('selfie.admin@test.mn');

    const response = await request(app)
      .patch(`${API}/users/${actorId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'suspended' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('SELF_ACTION_FORBIDDEN');
    // Not even a head_admin can lock itself out of the system it administers.
    expect((await User.findById(actorId))?.status).toBe('active');
    expect(await AuditLog.findOne({ entityType: 'User', action: 'StatusChanged' })).toBeNull();
  });

  it('refuses a plain admin suspending another administrator', async () => {
    await createAccount({
      email: 'admin@test.mn',
      role: 'admin',
      roles: [await systemRoleId(SYSTEM_ROLE_KEYS.ADMIN)],
    });
    const token = await login('admin@test.mn');
    const targetId = await createAccount({ email: 'peer.admin@test.mn', role: 'admin' });

    const response = await request(app)
      .patch(`${API}/users/${targetId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'suspended' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSUFFICIENT_PRIVILEGES');
    expect((await User.findById(targetId))?.status).toBe('active');
  });

  it('refuses a status the account model does not define', async () => {
    const token = await login((await headAdmin()).email);
    const targetId = await createAccount({ email: 'target@test.mn', role: 'technician' });

    // must_change_password is the system's to set on a passcode reset, never an admin's
    // to choose, so the schema does not accept it as a target.
    const response = await request(app)
      .patch(`${API}/users/${targetId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'must_change_password' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect((await User.findById(targetId))?.status).toBe('active');
  });
});

/**
 * The user router's own gate: the legacy tier AND a permission key, per route.
 *
 * The tier alone asked for no permission, so every admin-tier account — including one
 * carrying `roles: []`, which resolves to nothing at all — held the whole user register:
 * read it, create accounts on it, reset credentials, suspend anybody it outranked. That is
 * also why the access screen could not gate its controls honestly, since there was no key to
 * gate them on. Reading and writing are separated because the employee screen loads the list
 * to fill a picker and must not thereby be able to write.
 *
 * Both directions are asserted: the key without the tier is refused too, so the tier gate is
 * demonstrably still standing rather than replaced.
 */
describe('user routes require the tier AND a permission key', () => {
  /** Monotonic suffix: `resetDomainCollections` preserves roles, so keys must not repeat. */
  let gateRoleSequence = 0;

  /** An account on an arbitrary tier holding exactly `permissions`. */
  async function accountWith(options: {
    email: string;
    role: 'customer' | 'technician' | 'admin' | 'head_admin';
    permissions: readonly string[];
  }): Promise<string> {
    gateRoleSequence += 1;
    const role = await Role.create({
      key: `USER_GATE_${gateRoleSequence}`,
      name: `Gate fixture ${gateRoleSequence}`,
      description: null,
      permissions: [...options.permissions],
      isSystem: false,
    });
    return createAccount({
      email: options.email,
      role: options.role,
      roles: [String(role._id)],
    });
  }

  it('refuses the list to an admin-tier account without user.view', async () => {
    await accountWith({
      email: 'noview.admin@test.mn',
      role: 'admin',
      // Everything an ordinary back-office admin holds bar the register keys, so the refusal
      // cannot be read as a generally powerless account.
      permissions: [PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.EMPLOYEE_VIEW, PERMISSIONS.RBAC_VIEW],
    });
    const token = await login('noview.admin@test.mn');

    const response = await request(app).get(`${API}/users`).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('serves the list to an admin-tier account holding user.view', async () => {
    await accountWith({
      email: 'view.admin@test.mn',
      role: 'admin',
      permissions: [PERMISSIONS.USER_VIEW],
    });
    const token = await login('view.admin@test.mn');
    await createAccount({ email: 'listed@test.mn', role: 'technician' });

    const response = await request(app).get(`${API}/users`).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect((response.body.data.items as { email: string }[]).map((item) => item.email)).toContain(
      'listed@test.mn',
    );
  });

  it('refuses the detail to an admin-tier account without user.view', async () => {
    await accountWith({
      email: 'nodetail.admin@test.mn',
      role: 'admin',
      permissions: [PERMISSIONS.CUSTOMER_VIEW],
    });
    const token = await login('nodetail.admin@test.mn');
    const targetId = await createAccount({ email: 'hidden@test.mn', role: 'technician' });

    const response = await request(app)
      .get(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('refuses the list to a technician holding user.view, so the tier gate still stands', async () => {
    await accountWith({
      email: 'keyed.tech@test.mn',
      role: 'technician',
      permissions: [PERMISSIONS.USER_VIEW, PERMISSIONS.USER_MANAGE],
    });
    const token = await login('keyed.tech@test.mn');

    const response = await request(app).get(`${API}/users`).set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('refuses creation to an admin-tier account without user.manage, and writes nothing', async () => {
    // user.view is held, so the case pins that reading the register is not writing to it.
    await accountWith({
      email: 'reader.admin@test.mn',
      role: 'admin',
      permissions: [PERMISSIONS.USER_VIEW],
    });
    const token = await login('reader.admin@test.mn');

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ role: 'technician' }));

    expect(response.status).toBe(403);
    expect(await User.findOne({ email: 'new.user@test.mn' })).toBeNull();
  });

  it('refuses a passcode reset to an admin-tier account without user.manage', async () => {
    await accountWith({
      email: 'reader.two@test.mn',
      role: 'admin',
      permissions: [PERMISSIONS.USER_VIEW],
    });
    const token = await login('reader.two@test.mn');
    const targetId = await createAccount({ email: 'victim.tech@test.mn', role: 'technician' });

    const response = await request(app)
      .post(`${API}/users/${targetId}/reset-passcode`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword: 'ResetByStranger2026x' });

    expect(response.status).toBe(403);
    // The credential still works, which is the effect the refusal exists to produce.
    await login('victim.tech@test.mn');
  });

  it('refuses an account edit to an admin-tier account without user.manage', async () => {
    await accountWith({
      email: 'reader.three@test.mn',
      role: 'admin',
      permissions: [PERMISSIONS.USER_VIEW],
    });
    const token = await login('reader.three@test.mn');
    const targetId = await createAccount({ email: 'editable@test.mn', role: 'technician' });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Өөрчлөгдсөн Нэр' });

    expect(response.status).toBe(403);
    expect((await User.findById(targetId))?.fullName).toBe('Test editable@test.mn');
  });

  it('refuses a suspension to an admin-tier account without user.manage', async () => {
    await accountWith({
      email: 'reader.four@test.mn',
      role: 'admin',
      // rbac.manage is held deliberately: it was the key the access screen gated the
      // suspend action on, and it is emphatically not authority over the register.
      permissions: [PERMISSIONS.USER_VIEW, PERMISSIONS.RBAC_VIEW, PERMISSIONS.RBAC_MANAGE],
    });
    const token = await login('reader.four@test.mn');
    const targetId = await createAccount({ email: 'stays.active@test.mn', role: 'technician' });
    const targetToken = await login('stays.active@test.mn');

    const response = await request(app)
      .patch(`${API}/users/${targetId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'suspended' });

    expect(response.status).toBe(403);
    expect((await User.findById(targetId))?.status).toBe('active');
    // The session survives, so nothing was half-done on the way to the refusal.
    expect(
      (await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${targetToken}`))
        .status,
    ).toBe(200);
    expect(await AuditLog.findOne({ entityType: 'User', action: 'StatusChanged' })).toBeNull();
  });

  it('suspends for an admin-tier account holding user.manage', async () => {
    await accountWith({
      email: 'manager.admin@test.mn',
      role: 'admin',
      permissions: [PERMISSIONS.USER_VIEW, PERMISSIONS.USER_MANAGE],
    });
    const token = await login('manager.admin@test.mn');
    const targetId = await createAccount({ email: 'gets.suspended@test.mn', role: 'technician' });
    const targetToken = await login('gets.suspended@test.mn');

    const response = await request(app)
      .patch(`${API}/users/${targetId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'suspended' });

    expect(response.status).toBe(200);
    expect((await User.findById(targetId))?.status).toBe('suspended');
    // The end effect: the suspended account is out, not merely flagged. `authenticate`
    // re-reads the status, so the live token stops working on its very next call.
    const after = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${targetToken}`);
    expect(after.status).toBe(403);
    expect(after.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  /**
   * The upgrade guarantee. Both keys are seeded onto the ADMIN preset, so an installation's
   * existing administrators keep every screen they had; if the seed ever drops one, this
   * fails rather than an operator discovering it.
   */
  it('leaves an administrator holding the seeded ADMIN role fully able to work', async () => {
    await createAccount({
      email: 'seeded.admin@test.mn',
      role: 'admin',
      roles: [await systemRoleId(SYSTEM_ROLE_KEYS.ADMIN)],
    });
    const token = await login('seeded.admin@test.mn');
    const targetId = await createAccount({ email: 'ordinary.tech@test.mn', role: 'technician' });

    expect(
      (await request(app).get(`${API}/users`).set('Authorization', `Bearer ${token}`)).status,
    ).toBe(200);

    const created = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send(newUserBody({ role: 'technician' }));
    expect(created.status).toBe(201);

    const suspended = await request(app)
      .patch(`${API}/users/${targetId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'suspended' });
    expect(suspended.status).toBe(200);
    expect((await User.findById(targetId))?.status).toBe('suspended');
  });
});

describe('user reads carry the organisation', () => {
  it('returns the organisation name on the list and on the detail', async () => {
    const token = await login((await headAdmin()).email);
    const targetId = await createAccount({
      email: 'linked@test.mn',
      role: 'customer',
      customer: customerId,
    });

    const list = await request(app)
      .get(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .query({ role: 'customer' });
    expect(list.status).toBe(200);
    expect(list.body.data.items[0].customerId).toBe(customerId);
    expect(list.body.data.items[0].customerName).toBe('Central Tower ХХК');

    const detail = await request(app)
      .get(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.customerName).toBe('Central Tower ХХК');
  });
});

describe('GET /auth/me - the caller sees their own organisation', () => {
  it('returns the linked organisation for a customer account', async () => {
    await createAccount({ email: 'portal@test.mn', role: 'customer', customer: customerId });
    const token = await login('portal@test.mn');

    const response = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.customerId).toBe(customerId);
  });

  it('reports null rather than failing for a customer account that predates the link', async () => {
    // Existing data is never auto-assigned, so an account like this must still be able to
    // sign in and be told, honestly, that it has no organisation. The scope resolver is
    // what refuses its customer-owned reads; nothing here papers over that.
    await createAccount({ email: 'legacy@test.mn', role: 'customer', customer: null });
    const token = await login('legacy@test.mn');

    const response = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.customerId).toBeNull();
  });

  it('returns null for a staff account', async () => {
    await createAccount({ email: 'tech@test.mn', role: 'technician' });
    const token = await login('tech@test.mn');

    const response = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.customerId).toBeNull();
    expect(response.body.data.customerName).toBeNull();
  });
});

/** A head_admin fixture, created lazily so each case pays only for what it uses. */
async function headAdmin(): Promise<{ email: string }> {
  const email = 'head@test.mn';
  const existing = await User.findOne({ email }).select('_id');
  if (!existing) {
    await createAccount({ email, role: 'head_admin' });
  }
  return { email };
}
