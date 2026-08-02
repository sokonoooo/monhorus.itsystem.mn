import { PERMISSIONS, SYSTEM_ROLE_KEYS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../test/helpers';
import { Employee } from '../modules/employee/employee.model';
import { Company, Department, Position } from '../modules/org/org.models';
import { Role } from '../modules/rbac/role.model';
import { User } from '../modules/user/user.model';
import { hashPassword } from '../utils/password.util';

/**
 * THE ROLE EDITOR — the other half of the chokepoint.
 *
 * Capping WHICH roles may be assigned is worthless while a role's permission SET is
 * editable: the assignment gate asks which role is being granted, and the danger is in what
 * the role now contains. The live escalation was one call — an actor holding nothing but
 * `rbac.manage` rewrote ITS OWN role to add `employee.view_salary` and
 * `employee.manage_salary`, and held both on its very next request.
 *
 * `role-assignment.api.test.ts` covers the general shape of the ceiling (adding a key the
 * actor lacks, adding a portal key to a staff-held role, editing and deleting the protected
 * role, and the permitted narrowing edit). This file covers the two CONCRETE escalations the
 * owner named, and it asserts them end to end — not "the PATCH was refused" but "the actor
 * still cannot read a salary" and "a technician still cannot read the directory". A test
 * that stops at the status code would still pass if the refusal were cosmetic.
 */

const API = '/api/v1';
const PASSWORD = 'TestPassword2026x';

let app: Express;
let roleSequence = 0;

async function loginAs(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status, `login failed for ${email}`).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

async function systemRole(key: string): Promise<InstanceType<typeof Role>> {
  const role = await Role.findOne({ key });
  expect(role, `seedRbac did not create ${key}`).not.toBeNull();
  return role!;
}

/** The single bespoke role `createUserWithPermissions` built for this actor. */
async function ownRoleIdOf(userId: string): Promise<string> {
  const user = await User.findById(userId).select('roles');
  expect(user?.roles).toHaveLength(1);
  return String(user!.roles[0]);
}

async function permissionsOfRole(roleId: string): Promise<string[]> {
  const role = await Role.findById(roleId).select('permissions');
  return [...(role?.permissions ?? [])].sort();
}

async function createOrdinaryRole(permissions: readonly PermissionKey[]): Promise<string> {
  roleSequence += 1;
  const role = await Role.create({
    key: `SECURITY_EDIT_${roleSequence}`,
    name: `Editor fixture ${roleSequence}`,
    description: null,
    permissions: [...permissions],
    isSystem: false,
  });
  return String(role._id);
}

/** An employee card, so the salary endpoints have something real to be refused against. */
async function seedEmployeeCard(): Promise<string> {
  const company = await Company.create({ code: 'MH', name: 'Монхорус ХХК' });
  const department = await Department.create({
    company: company._id,
    code: 'ELEC',
    name: 'Цахилгааны хэлтэс',
  });
  const position = await Position.create({
    company: company._id,
    department: department._id,
    code: 'ENG',
    name: 'Цахилгааны инженер',
  });

  const employee = await Employee.create({
    employeeCode: 'EMP-2001',
    firstName: 'Мөнхзул',
    lastName: 'Чулуун',
    registrationNumber: 'УЮ99081733',
    company: company._id,
    department: department._id,
    position: position._id,
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-15'),
    status: 'ACTIVE',
  });
  return String(employee._id);
}

/** A technician-tier account on the SEEDED TECHNICIAN role — the real field contract. */
async function createSeededTechnician(email: string): Promise<string> {
  const role = await systemRole(SYSTEM_ROLE_KEYS.TECHNICIAN);
  await User.create({
    fullName: `Test ${email}`,
    email,
    password: await hashPassword(PASSWORD),
    role: 'technician',
    roles: [role._id],
    status: 'active',
    passwordChangedAt: new Date(),
  });
  return loginAs(email, PASSWORD);
}

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
});

/**
 * OWNER CASE 22 — an actor cannot add salary access to the role it holds.
 *
 * This is the exact escalation that was live, named by the exact permissions it used.
 */
describe('an actor cannot widen the role it holds', () => {
  it('refuses adding salary permissions to its own role, and the salary stays unreadable', async () => {
    const actor = await createUserWithPermissions('sec-salary-grab@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.EMPLOYEE_VIEW,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const ownRoleId = await ownRoleIdOf(actor.userId);
    const before = await permissionsOfRole(ownRoleId);
    const employeeId = await seedEmployeeCard();

    // Refused BEFORE the edit, so the case cannot pass because the salary happens to be absent.
    const beforeRead = await request(app)
      .get(`${API}/employees/${employeeId}/salary`)
      .set('Authorization', `Bearer ${token}`);
    expect(beforeRead.status).toBe(403);

    const response = await request(app)
      .patch(`${API}/rbac/roles/${ownRoleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        permissions: [
          PERMISSIONS.RBAC_VIEW,
          PERMISSIONS.RBAC_MANAGE,
          PERMISSIONS.EMPLOYEE_VIEW,
          PERMISSIONS.EMPLOYEE_VIEW_SALARY,
          PERMISSIONS.EMPLOYEE_MANAGE_SALARY,
        ],
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSUFFICIENT_PRIVILEGES');
    // A refused edit assigns nothing: the whole permission set is checked before a single
    // field is written, so the role must be byte-for-byte what it was.
    expect(await permissionsOfRole(ownRoleId)).toEqual(before);

    // The assertion that actually matters. Permissions are re-resolved on every request, so
    // if the edit had landed the very next call would already carry it.
    const me = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.EMPLOYEE_VIEW_SALARY);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.EMPLOYEE_MANAGE_SALARY);

    const afterRead = await request(app)
      .get(`${API}/employees/${employeeId}/salary`)
      .set('Authorization', `Bearer ${token}`);
    expect(afterRead.status).toBe(403);

    const afterWrite = await request(app)
      .post(`${API}/employees/${employeeId}/salary`)
      .set('Authorization', `Bearer ${token}`)
      .send({ baseSalary: 3_000_000, effectiveFrom: '2026-01-01' });
    expect(afterWrite.status).toBe(403);
  });

  /**
   * The same cap applies to a role the actor does NOT hold, and to a brand-new one. An
   * actor that could not widen its own role but could mint a wide one and assign it has
   * gained nothing but a second step.
   */
  it('refuses minting a new role carrying a permission the actor does not hold', async () => {
    const actor = await createUserWithPermissions('sec-mint-wide@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/rbac/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'SECURITY_WIDE',
        name: 'Хэт өргөн эрх',
        permissions: [PERMISSIONS.EMPLOYEE_VIEW, PERMISSIONS.EMPLOYEE_VIEW_SALARY],
      });

    expect(response.status).toBe(403);
    expect(await Role.countDocuments({ key: 'SECURITY_WIDE' })).toBe(0);
  });
});

/**
 * OWNER CASE 23 — TECHNICIAN cannot be turned back into a global employee-reader.
 *
 * This is the leak arriving from the other end. Nothing needs to be ASSIGNED: editing the
 * role that every technician already holds hands the directory to the entire field force in
 * one call, and every assignment-time cap is bypassed because no assignment happens.
 */
describe('the technician role cannot be rewritten into a directory reader', () => {
  it('refuses adding employee.view to TECHNICIAN, and technicians still cannot list staff', async () => {
    const actor = await createUserWithPermissions('sec-tech-widener@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const technicianRole = await systemRole(SYSTEM_ROLE_KEYS.TECHNICIAN);
    const roleId = String(technicianRole._id);
    const before = await permissionsOfRole(roleId);
    expect(before).not.toContain(PERMISSIONS.EMPLOYEE_VIEW);

    const technicianToken = await createSeededTechnician('sec-field-tech@test.mn');
    await seedEmployeeCard();

    const response = await request(app)
      .patch(`${API}/rbac/roles/${roleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permissions: [...technicianRole.permissions, PERMISSIONS.EMPLOYEE_VIEW] });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSUFFICIENT_PRIVILEGES');
    expect(await permissionsOfRole(roleId)).toEqual(before);

    // The consequence, checked on a real technician session rather than on the role document.
    const list = await request(app)
      .get(`${API}/employees`)
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(list.status).toBe(403);

    const me = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.EMPLOYEE_VIEW);
  });

  /**
   * The delegation ceiling is a cap on DELEGATION, not a ban on the key. An actor that
   * legitimately holds `employee.view` may pass it on — that is what delegation means — and
   * this is recorded so the boundary of the previous case is not misread as broader than it
   * is. If TECHNICIAN must never carry the key regardless of who is asking, that is a
   * separate rule and it does not exist today.
   */
  it('documents the boundary: an actor who holds employee.view may delegate it', async () => {
    const actor = await createUserWithPermissions('sec-hr-widener@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.EMPLOYEE_VIEW,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const targetRoleId = await createOrdinaryRole([PERMISSIONS.DASHBOARD_VIEW]);

    const response = await request(app)
      .patch(`${API}/rbac/roles/${targetRoleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permissions: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.EMPLOYEE_VIEW] });

    expect(response.status).toBe(200);
    expect(await permissionsOfRole(targetRoleId)).toEqual(
      [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.EMPLOYEE_VIEW].sort(),
    );
  });
});

/**
 * OWNER CASE 24 — the protected role, on the axis its own suite does not cover.
 *
 * Editing and deleting SYSTEM_ADMIN are already refused elsewhere. The remaining route to
 * the same authority is to CREATE it: on an installation where the seed has not run, or
 * after somebody has removed the document, `POST /rbac/roles` with that key would mint the
 * superuser role from an ordinary `rbac.manage` session.
 */
describe('the protected role key is closed to an ordinary rbac.manage holder', () => {
  it('refuses creating a role under the protected key, in any casing', async () => {
    const actor = await createUserWithPermissions('sec-key-squatter@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    for (const key of ['SYSTEM_ADMIN', 'system_admin']) {
      const response = await request(app)
        .post(`${API}/rbac/roles`)
        .set('Authorization', `Bearer ${token}`)
        .send({ key, name: 'Хуурамч системийн админ', permissions: [] });

      expect(response.status, `key ${key} was not refused`).toBe(403);
      expect(response.body.code).toBe('INSUFFICIENT_PRIVILEGES');
    }

    // Exactly one SYSTEM_ADMIN document, and it is still the seeded one.
    expect(await Role.countDocuments({ key: SYSTEM_ROLE_KEYS.SYSTEM_ADMIN })).toBe(1);
    const seeded = await systemRole(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN);
    expect(seeded.isSystem).toBe(true);
    expect(seeded.permissions.length).toBeGreaterThan(0);
  });
});

/**
 * OWNER CASE 25 — the ordinary work still works.
 *
 * A hardening round that made the RBAC screen unusable would be reverted, and the reverting
 * commit would take the rules with it. These are the edits an administrator makes every day.
 */
describe('safe lower-privilege edits are unaffected', () => {
  it('renames a role and adds a permission the actor holds', async () => {
    const actor = await createUserWithPermissions('sec-safe-editor@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.NOTIFICATION_VIEW,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const targetRoleId = await createOrdinaryRole([PERMISSIONS.DASHBOARD_VIEW]);

    const response = await request(app)
      .patch(`${API}/rbac/roles/${targetRoleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Шинэчилсэн нэр',
        permissions: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.NOTIFICATION_VIEW],
      });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Шинэчилсэн нэр');
    expect(await permissionsOfRole(targetRoleId)).toEqual(
      [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.NOTIFICATION_VIEW].sort(),
    );
  });

  it('creates an ordinary role entirely within the actor’s own set', async () => {
    const actor = await createUserWithPermissions('sec-safe-creator@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.PLANNED_WORK_VIEW,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/rbac/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'SECURITY_SAFE',
        name: 'Аюулгүй role',
        permissions: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.PLANNED_WORK_VIEW],
      });

    expect(response.status).toBe(201);
    const created = await Role.findOne({ key: 'SECURITY_SAFE' }).select('permissions isSystem');
    expect(created).not.toBeNull();
    expect(created?.isSystem).toBe(false);
    expect([...(created?.permissions ?? [])].sort()).toEqual(
      [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.PLANNED_WORK_VIEW].sort(),
    );
  });
});
