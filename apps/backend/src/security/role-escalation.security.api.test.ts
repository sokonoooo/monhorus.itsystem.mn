import {
  PERMISSIONS,
  SYSTEM_ROLE_DEFAULT_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
} from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../test/helpers';
import { AuditLog } from '../modules/audit/audit-log.model';
import { Employee } from '../modules/employee/employee.model';
import { Customer } from '../modules/objects/object.models';
import { Company, Department, Position } from '../modules/org/org.models';
import { Role } from '../modules/rbac/role.model';
import { User } from '../modules/user/user.model';
import { hashPassword } from '../utils/password.util';

/**
 * PRIVILEGE ESCALATION THROUGH THE ROLE-WRITING ROUTES.
 *
 * `role-assignment.api.test.ts` already drives the chokepoint through
 * `POST /rbac/users/:userId/roles` and the role editors, and `user.api.test.ts` and
 * `employee.api.test.ts` cover their own provisioning paths. This file exists for the
 * branches those three leave untouched, and every case is one the owner named:
 *
 *   - Self-modification through routes OTHER than the RBAC one — the legacy TIER, and the
 *     employee access screen. The rule is "an actor may never increase its own authority by
 *     ANY route", and a rule proven on one route is not proven.
 *   - REMOVING a protected role, as opposed to granting one. `classifyProtection` treats
 *     both directions as protected, and only the granting direction had a test: an actor
 *     that can strip the superuser role from an administrator can decapitate the
 *     installation, which is the same authority pointed the other way.
 *   - Each remaining provisioning path asserted to reach the SAME decision, and asserted to
 *     leave NO half-built account behind when it refuses.
 *
 * Every case fails against the pre-hardening code, where `user.roles = roleIds; save()` was
 * the whole implementation on the RBAC route and each other path carried its own partial
 * copy of the rules.
 */

const API = '/api/v1';
const PASSWORD = 'TestPassword2026x';

let app: Express;

/** Monotonic suffix: `resetDomainCollections` preserves roles, so keys must not repeat. */
let roleSequence = 0;

async function loginAs(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status, `login failed for ${email}`).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

/** The id of a seeded system role, which `resetDomainCollections` preserves. */
async function systemRoleId(key: string): Promise<string> {
  const role = await Role.findOne({ key }).select('_id');
  expect(role, `seedRbac did not create ${key}`).not.toBeNull();
  return String(role?._id);
}

/** A bespoke role, so a case can name a precise permission boundary. */
async function createRole(permissions: readonly string[]): Promise<string> {
  roleSequence += 1;
  const role = await Role.create({
    key: `SECURITY_ESC_${roleSequence}`,
    name: `Escalation fixture ${roleSequence}`,
    description: null,
    permissions: [...permissions],
    isSystem: false,
  });
  return String(role._id);
}

/**
 * A fixture account written straight to the collection.
 *
 * The API is what is under test, so a victim built through it would make a failing
 * assertion ambiguous between the setup and the case — and several of these fixtures are
 * states the API deliberately refuses to produce.
 */
async function createAccount(options: {
  email: string;
  role: 'customer' | 'technician' | 'admin' | 'head_admin';
  roles?: string[];
  status?: 'active' | 'suspended';
  customer?: string | null;
}): Promise<string> {
  const user = await User.create({
    fullName: `Test ${options.email}`,
    email: options.email,
    password: await hashPassword(PASSWORD),
    role: options.role,
    roles: options.roles ?? [],
    customer: options.customer ?? null,
    status: options.status ?? 'active',
    passwordChangedAt: new Date(),
  });
  return String(user._id);
}

/** The roles an account holds right now, as ids. */
async function storedRoles(userId: string): Promise<string[]> {
  const user = await User.findById(userId).select('roles');
  return (user?.roles ?? []).map(String);
}

async function storedTier(userId: string): Promise<string | undefined> {
  const user = await User.findById(userId).select('role');
  return user?.role;
}

/** An employee card, optionally linked to an account. Needed by the access-screen cases. */
async function createEmployeeCard(options: {
  code: string;
  systemUser?: string | null;
}): Promise<string> {
  const company = await Company.findOne().select('_id');
  const department = await Department.findOne().select('_id');
  const position = await Position.findOne().select('_id');

  const employee = await Employee.create({
    employeeCode: options.code,
    firstName: 'Дорж',
    lastName: 'Бат',
    company: company?._id,
    department: department?._id,
    position: position?._id,
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    status: 'ACTIVE',
    systemUser: options.systemUser ?? null,
  });
  return String(employee._id);
}

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  // The employee card fixtures need an organisation to hang off.
  const company = await Company.create({ code: 'MH', name: 'Монхорус ХХК' });
  const department = await Department.create({
    company: company._id,
    code: 'ELEC',
    name: 'Цахилгааны хэлтэс',
  });
  await Position.create({
    company: company._id,
    department: department._id,
    code: 'ENG',
    name: 'Цахилгааны инженер',
  });
});

/**
 * OWNER CASES 7-9 — an actor may never increase its own authority BY ANY ROUTE.
 *
 * `role-assignment.api.test.ts` proves this for the RBAC route, in both the escalating and
 * the narrowing direction. The remaining routes that can change what an account may do are
 * the legacy TIER on `PATCH /users/:userId` — where `head_admin` is an unconditional
 * superuser branch in `resolveEffectivePermissions`, so the tier alone is the whole
 * catalogue — and the employee access screen, which writes roles from a completely
 * different controller.
 */
describe('self-modification is refused on every route that can grant authority', () => {
  it('refuses an actor promoting its own legacy tier to head_admin', async () => {
    const actor = await createUserWithPermissions('sec-self-tier@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .patch(`${API}/users/${actor.userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'head_admin' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('SELF_ACTION_FORBIDDEN');
    expect(await storedTier(actor.userId)).toBe('admin');

    // The tier IS the authority for head_admin, so the decisive check is what the next
    // request resolves to, not the status code.
    const me = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.role).toBe('admin');
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.EMPLOYEE_MANAGE_SALARY);
  });

  /**
   * `rbac.manage_protected` is the authority OVER protected accounts. It is emphatically not
   * a licence to become one, and the self rule sits above it in the decision order.
   */
  it('refuses it even for an actor holding rbac.manage_protected', async () => {
    const actor = await createUserWithPermissions('sec-self-protected@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.RBAC_MANAGE_PROTECTED,
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const tierAttempt = await request(app)
      .patch(`${API}/users/${actor.userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'head_admin' });
    expect(tierAttempt.status).toBe(403);
    expect(tierAttempt.body.code).toBe('SELF_ACTION_FORBIDDEN');

    const roleAttempt = await request(app)
      .post(`${API}/rbac/users/${actor.userId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN)] });
    expect(roleAttempt.status).toBe(403);
    expect(roleAttempt.body.code).toBe('SELF_ACTION_FORBIDDEN');

    expect(await storedTier(actor.userId)).toBe('admin');
    expect(await storedRoles(actor.userId)).toHaveLength(1);
  });

  /**
   * The employee access screen is a SECOND endpoint that writes `user.roles`, reached from a
   * different controller with a different permission. An actor whose own login is linked to
   * an employee card must not be able to walk round the RBAC screen by using it.
   */
  it('refuses an actor rewriting its own roles through the employee access screen', async () => {
    const actor = await createUserWithPermissions('sec-self-employee@test.mn', [
      PERMISSIONS.EMPLOYEE_VIEW,
      PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const cardId = await createEmployeeCard({ code: 'SELF-1', systemUser: actor.userId });
    const strongRoleId = await createRole([
      PERMISSIONS.EMPLOYEE_VIEW_SALARY,
      PERMISSIONS.EMPLOYEE_MANAGE_SALARY,
    ]);

    const response = await request(app)
      .patch(`${API}/employees/${cardId}/system-access/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [strongRoleId] });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('SELF_ACTION_FORBIDDEN');
    expect(await storedRoles(actor.userId)).not.toContain(strongRoleId);

    const me = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.EMPLOYEE_MANAGE_SALARY);
  });

  /**
   * The self rule covers ORDINARY roles too, not only the protected ones. Nothing about
   * "protected" is what makes a self-grant an escalation.
   */
  it('refuses an actor granting itself an ordinary role stronger than the one it holds', async () => {
    const actor = await createUserWithPermissions('sec-self-ordinary@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const before = await storedRoles(actor.userId);
    const strongRoleId = await createRole([
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.EMPLOYEE_VIEW_SALARY,
      PERMISSIONS.SETTINGS_MANAGE,
    ]);

    const response = await request(app)
      .post(`${API}/rbac/users/${actor.userId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [strongRoleId] });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('SELF_ACTION_FORBIDDEN');
    expect(await storedRoles(actor.userId)).toEqual(before);

    const me = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.SETTINGS_MANAGE);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.EMPLOYEE_VIEW_SALARY);
  });
});

/**
 * OWNER CASE 12 — a lower actor cannot modify an account that already holds protected
 * authority, in EITHER direction.
 *
 * The granting direction is covered elsewhere. Removal is a separate branch of
 * `classifyProtection` and a separate attack: an actor who can strip SYSTEM_ADMIN from the
 * administrators can lock the installation out of its own governance, and there is no
 * self-service recovery in this product.
 */
describe('an account already holding the protected role is closed to a plain rbac.manage actor', () => {
  it('refuses the removal, leaves the roles untouched, and audits the refusal', async () => {
    const actor = await createUserWithPermissions('sec-stripper@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const systemAdminId = await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN);
    const technicianRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN);
    // Technician TIER so the legacy tier rule lets the actor act on the account at all;
    // the SYSTEM_ADMIN ROLE is what makes it protected, and that is the mechanism under test.
    const targetId = await createAccount({
      email: 'sec-hidden-admin@test.mn',
      role: 'technician',
      roles: [systemAdminId],
    });

    const response = await request(app)
      .post(`${API}/rbac/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [technicianRoleId] });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSUFFICIENT_PRIVILEGES');
    expect(await storedRoles(targetId)).toEqual([systemAdminId]);

    // A refusal is the only trace an attacker who is stopped leaves behind.
    const entry = await AuditLog.findOne({ entityType: 'User', entityId: targetId });
    expect(entry).not.toBeNull();
    expect(entry?.reason).toContain('REFUSED');
    expect(
      (entry?.oldValue as { removedProtectedRoles: string[] }).removedProtectedRoles,
    ).toEqual([SYSTEM_ROLE_KEYS.SYSTEM_ADMIN]);
    expect((entry?.newValue as { allowed: boolean }).allowed).toBe(false);
  });

  /**
   * Keeping the protected role and adding a second one alongside it is NOT a protected
   * mutation — nothing protected is added or removed — so it is the delegation ceiling that
   * must catch it. The requested SET carries the whole catalogue, which is far beyond what
   * an actor holding `rbac.manage` may delegate.
   */
  it('refuses adding an ordinary role alongside the protected one, on the ceiling', async () => {
    const actor = await createUserWithPermissions('sec-alongside@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const systemAdminId = await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN);
    const technicianRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN);
    const targetId = await createAccount({
      email: 'sec-hidden-admin2@test.mn',
      role: 'technician',
      roles: [systemAdminId],
    });

    const response = await request(app)
      .post(`${API}/rbac/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [systemAdminId, technicianRoleId] });

    expect(response.status).toBe(403);
    expect(await storedRoles(targetId)).toEqual([systemAdminId]);
  });
});

/**
 * OWNER CASES 13-18 — every path that can write a role reaches the SAME decision.
 *
 * There were seven of them and they had seven different (mostly absent) ideas of the rules.
 * The point of these cases is not that each returns 403 but that each returns 403 for the
 * SAME reason, and that a refusal on a PROVISIONING path leaves no account behind: a
 * half-built account with roles the policy refused is worse than no account.
 */
describe('every provisioning and edit path answers to the same policy', () => {
  /** CASE 13 — user creation. */
  it('refuses POST /users carrying the protected role, and creates nothing', async () => {
    const actor = await createUserWithPermissions('sec-creator@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Шинэ Ажилтан',
        email: 'sec-minted@test.mn',
        password: 'MintedPass2026x',
        role: 'technician',
        roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN)],
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSUFFICIENT_PRIVILEGES');
    // The decision runs to completion before a document is written.
    expect(await User.countDocuments({ email: 'sec-minted@test.mn' })).toBe(0);
  });

  /**
   * CASE 13, the tier form. `head_admin` is the same authority as the SYSTEM_ADMIN role, so
   * the legacy tier rule has to hold even for an actor carrying the protected permission —
   * `rbac.manage_protected` governs role writes, it does not lift `assertCanManageRole`.
   */
  it('refuses an admin-tier actor minting a head_admin, protected permission or not', async () => {
    const actor = await createUserWithPermissions('sec-tier-creator@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.RBAC_MANAGE_PROTECTED,
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Шинэ Ерөнхий Админ',
        email: 'sec-newhead@test.mn',
        password: 'NewHeadPass2026x',
        role: 'head_admin',
      });

    expect(response.status).toBe(403);
    expect(await User.countDocuments({ email: 'sec-newhead@test.mn' })).toBe(0);
  });

  /** CASE 14 — the user edit, in its most dangerous form: a tier promotion to the superuser. */
  it('refuses PATCH /users/:userId promoting an account to head_admin', async () => {
    const actor = await createUserWithPermissions('sec-promoter@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.RBAC_MANAGE_PROTECTED,
      PERMISSIONS.USER_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const targetId = await createAccount({ email: 'sec-pawn@test.mn', role: 'technician' });

    const response = await request(app)
      .patch(`${API}/users/${targetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'head_admin' });

    expect(response.status).toBe(403);
    expect(await storedTier(targetId)).toBe('technician');
  });

  /** CASE 15 — the employee access screen provisioning a brand new login. */
  it('refuses CREATE_NEW carrying the protected role, and leaves the employee unlinked', async () => {
    const actor = await createUserWithPermissions('sec-access-creator@test.mn', [
      PERMISSIONS.EMPLOYEE_VIEW,
      PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const cardId = await createEmployeeCard({ code: 'ACC-1' });

    const response = await request(app)
      .post(`${API}/employees/${cardId}/system-access`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        mode: 'CREATE_NEW',
        email: 'sec-access-minted@test.mn',
        password: 'AccessPass2026x',
        role: 'technician',
        roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN)],
      });

    expect(response.status).toBe(403);
    expect(await User.countDocuments({ email: 'sec-access-minted@test.mn' })).toBe(0);
    const card = await Employee.findById(cardId).select('systemUser');
    expect(card?.systemUser ?? null).toBeNull();
  });

  /** CASE 16 — the employee access screen editing an existing login's roles. */
  it('refuses PATCH system-access/roles adding the protected role', async () => {
    const actor = await createUserWithPermissions('sec-access-editor@test.mn', [
      PERMISSIONS.EMPLOYEE_VIEW,
      PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const technicianRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN);
    const targetId = await createAccount({
      email: 'sec-linked@test.mn',
      role: 'technician',
      roles: [technicianRoleId],
    });
    const cardId = await createEmployeeCard({ code: 'ACC-2', systemUser: targetId });

    const response = await request(app)
      .patch(`${API}/employees/${cardId}/system-access/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN)] });

    expect(response.status).toBe(403);
    expect(await storedRoles(targetId)).toEqual([technicianRoleId]);
  });

  /**
   * CASE 17 — customer-account creation.
   *
   * `user.api.test.ts` already refuses a staff ROLE on a customer account. What is asserted
   * here is the consequence the refusal exists to prevent: the account that IS created holds
   * portal keys only, and portal keys reach no staff endpoint. Tenant scoping keys off the
   * legacy tier alone, so a customer holding a staff key would be a customer at a staff
   * guard with no filter behind it.
   */
  it('creates a customer that holds the portal contract only and reaches no staff endpoint', async () => {
    const superUser = await createSuperUser('sec-super-a@test.mn');
    const adminToken = await loginAs(superUser.email, superUser.password);
    const customer = await Customer.create({ code: 'CT', name: 'Central Tower ХХК' });

    const created = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Харилцагчийн Хэрэглэгч',
        email: 'sec-portal@test.mn',
        password: 'PortalPass2026x',
        role: 'customer',
        customerId: String(customer._id),
        requirePasswordChange: false,
      });
    expect(created.status).toBe(201);

    const portalToken = await loginAs('sec-portal@test.mn', 'PortalPass2026x');
    const me = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(me.status).toBe(200);

    // Exactly the seeded CUSTOMER contract, nothing added by the creation path. The
    // contract is portal keys plus `notification.view`, whose list is per-recipient and
    // carries no other tenant's data.
    const permissions = (me.body.data.permissions as string[]).slice().sort();
    expect(permissions).toEqual(
      [...SYSTEM_ROLE_DEFAULT_PERMISSIONS[SYSTEM_ROLE_KEYS.CUSTOMER]].sort(),
    );

    // Named explicitly rather than inferred from the prefix: these are the staff reads
    // whose scope predicates a customer must never be in a position to test.
    for (const forbiddenKey of [
      PERMISSIONS.EMPLOYEE_VIEW,
      PERMISSIONS.OBJECT_VIEW,
      PERMISSIONS.CUSTOMER_VIEW,
      PERMISSIONS.SERVICE_REQUEST_VIEW,
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.INVOICE_VIEW,
      PERMISSIONS.AUDIT_VIEW,
    ]) {
      expect(permissions, `customer holds the staff key ${forbiddenKey}`).not.toContain(
        forbiddenKey,
      );
    }

    for (const path of [`${API}/employees`, `${API}/users`, `${API}/rbac/roles`]) {
      const response = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${portalToken}`);
      expect(response.status, `${path} answered a customer`).toBe(403);
    }
  });

  /**
   * CASE 18 — the direct RBAC route, on the axis its own suite does not cover: the ENTRY
   * gate. `rbac.manage_protected` is authority over protected roles, not a second way in.
   * An actor holding it without `rbac.manage` is refused at the router, before the
   * chokepoint is even reached.
   */
  it('refuses the RBAC assignment route to an actor holding only rbac.manage_protected', async () => {
    const actor = await createUserWithPermissions('sec-protected-only@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE_PROTECTED,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const targetId = await createAccount({ email: 'sec-target-x@test.mn', role: 'technician' });

    const response = await request(app)
      .post(`${API}/rbac/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN)] });

    expect(response.status).toBe(403);
    expect(await storedRoles(targetId)).toEqual([]);
  });
});
