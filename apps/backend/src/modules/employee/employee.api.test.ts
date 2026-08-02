import { PERMISSIONS, SYSTEM_ROLE_KEYS, type SystemRoleKey } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createOrgFixture,
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type OrgFixture,
} from '../../test/helpers';
import { AuditLog } from '../audit/audit-log.model';
import { Role } from '../rbac/role.model';
import { Session } from '../user/session.model';
import { User } from '../user/user.model';
import { Employee } from './employee.model';

const API = '/api/v1';

let app: Express;
let org: OrgFixture;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

function validEmployee(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    employeeCode: 'EMP-001',
    firstName: 'Энхтөр',
    lastName: 'Батаа',
    registrationNumber: 'АА12345678',
    phone: '9911-2233',
    companyId: org.companyId,
    departmentId: org.departmentId,
    positionId: org.positionId,
    employeeType: 'FULL_TIME',
    employmentStartDate: '2024-01-15',
    status: 'ACTIVE',
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
  org = await createOrgFixture();
});

describe('employee authentication and authorization', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(app).get(`${API}/employees`);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a caller without employee.view', async () => {
    const user = await createUserWithPermissions('noperm@test.mn', [PERMISSIONS.DASHBOARD_VIEW]);
    const token = await login(user.email, user.password);

    const response = await request(app).get(`${API}/employees`).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(403);
  });

  it('allows a caller holding employee.view', async () => {
    const user = await createUserWithPermissions('viewer@test.mn', [PERMISSIONS.EMPLOYEE_VIEW]);
    const token = await login(user.email, user.password);

    const response = await request(app).get(`${API}/employees`).set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual([]);
  });

  it('refuses creation to a caller holding only employee.view', async () => {
    const user = await createUserWithPermissions('viewonly@test.mn', [PERMISSIONS.EMPLOYEE_VIEW]);
    const token = await login(user.email, user.password);

    const response = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${token}`)
      .send(validEmployee());

    expect(response.status).toBe(403);
  });
});

describe('employee creation and validation', () => {
  let token: string;

  beforeEach(async () => {
    const admin = await createSuperUser();
    token = await login(admin.email, admin.password);
  });

  it('creates an employee with valid input', async () => {
    const response = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${token}`)
      .send(validEmployee());

    expect(response.status).toBe(201);
    expect(response.body.data.employeeCode).toBe('EMP-001');
    expect(response.body.data.status).toBe('ACTIVE');
  });

  it('rejects a duplicate employee code', async () => {
    await request(app).post(`${API}/employees`).set('Authorization', `Bearer ${token}`).send(validEmployee());

    const response = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${token}`)
      .send(validEmployee({ registrationNumber: 'АА99999999' }));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DUPLICATE_KEY');
  });

  it('rejects a duplicate registration number', async () => {
    await request(app).post(`${API}/employees`).set('Authorization', `Bearer ${token}`).send(validEmployee());

    const response = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${token}`)
      .send(validEmployee({ employeeCode: 'EMP-002' }));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DUPLICATE_KEY');
  });

  it('requires the organisational fields when status is ACTIVE', async () => {
    const response = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeCode: 'EMP-003', firstName: 'A', lastName: 'B', status: 'ACTIVE' });

    expect(response.status).toBe(400);
    const fields = (response.body.issues as Array<{ field: string }>).map((issue) => issue.field);
    expect(fields).toEqual(
      expect.arrayContaining(['companyId', 'departmentId', 'positionId', 'employeeType', 'employmentStartDate']),
    );
  });

  it('rejects a department belonging to another company', async () => {
    const response = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${token}`)
      .send(validEmployee({ departmentId: org.otherDepartmentId, positionId: null }));

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('requires a termination date and reason for TERMINATED', async () => {
    const response = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${token}`)
      .send(validEmployee({ employeeCode: 'EMP-004', registrationNumber: null, status: 'TERMINATED' }));

    expect(response.status).toBe(400);
    const fields = (response.body.issues as Array<{ field: string }>).map((issue) => issue.field);
    expect(fields).toEqual(expect.arrayContaining(['terminationDate', 'terminationReason']));
  });

  it('rejects a termination date earlier than the employment start date', async () => {
    const response = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${token}`)
      .send(
        validEmployee({
          employeeCode: 'EMP-005',
          registrationNumber: null,
          status: 'TERMINATED',
          terminationDate: '2023-01-01',
          terminationReason: 'Өөрийн хүсэлтээр',
        }),
      );

    expect(response.status).toBe(400);
    const fields = (response.body.issues as Array<{ field: string }>).map((issue) => issue.field);
    expect(fields).toContain('terminationDate');
  });

  it('writes an audit record when an employee is created', async () => {
    const created = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${token}`)
      .send(validEmployee());

    const entries = await AuditLog.find({ entityType: 'Employee', action: 'Created' });

    expect(entries).toHaveLength(1);
    expect(String(entries[0]?.entityId)).toBe(created.body.data.id);
  });
});

describe('employee status transitions', () => {
  let token: string;

  beforeEach(async () => {
    const admin = await createSuperUser();
    token = await login(admin.email, admin.password);
  });

  it('records status history and audits the change', async () => {
    const created = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${token}`)
      .send(validEmployee({ status: 'DRAFT' }));

    const employeeId = created.body.data.id as string;

    const response = await request(app)
      .post(`${API}/employees/${employeeId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE', reason: 'Гэрээ баталгаажсан' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ACTIVE');
    // Creation writes the first entry, the transition writes the second.
    expect(response.body.data.statusHistory.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses ACTIVE when organisational fields are missing', async () => {
    const created = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${token}`)
      .send({ employeeCode: 'EMP-010', firstName: 'A', lastName: 'B', status: 'DRAFT' });

    const response = await request(app)
      .post(`${API}/employees/${created.body.data.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });

    expect(response.status).toBe(400);
  });
});

describe('employee system access lifecycle', () => {
  const NEW_ACCOUNT = {
    mode: 'CREATE_NEW',
    email: 'enkhtur@monhorus.mn',
    password: 'FirstPasscode2026',
    role: 'technician',
  } as const;

  let adminToken: string;
  let adminUserId: string;
  let employeeId: string;
  let dispatchRoleId: string;
  let financeRoleId: string;

  beforeEach(async () => {
    const admin = await createSuperUser();
    adminUserId = admin.userId;
    adminToken = await login(admin.email, admin.password);

    const created = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validEmployee());
    employeeId = created.body.data.id as string;

    // The seeded system roles survive resetDomainCollections, so they are a stable
    // source of real role ids without inventing extra fixtures.
    dispatchRoleId = String((await Role.findOne({ key: 'DISPATCH' }))?._id);
    financeRoleId = String((await Role.findOne({ key: 'FINANCE' }))?._id);
  });

  async function createAccess(overrides: Record<string, unknown> = {}): Promise<string> {
    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...NEW_ACCOUNT, roleIds: [dispatchRoleId], ...overrides });

    expect(response.status).toBe(200);
    return response.body.data.userId as string;
  }

  it('creates a login for the employee and reports the access state', async () => {
    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...NEW_ACCOUNT, roleIds: [dispatchRoleId] });

    expect(response.status).toBe(200);
    expect(response.body.data.hasAccount).toBe(true);
    expect(response.body.data.email).toBe('enkhtur@monhorus.mn');
    // Admin-issued passcode: the holder must replace it at first login.
    expect(response.body.data.accountStatus).toBe('must_change_password');
    expect(response.body.data.roles).toHaveLength(1);
    expect(response.body.data.roles[0].key).toBe('DISPATCH');
    expect(response.body.data.isSelf).toBe(false);

    const audits = await AuditLog.find({ entityType: 'Employee', reason: 'system access created' });
    expect(audits).toHaveLength(1);
  });

  it('refuses a second account for an employee that already has one', async () => {
    await createAccess();

    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...NEW_ACCOUNT, email: 'second@monhorus.mn' });

    expect(response.status).toBe(409);
  });

  it('links an existing account to the employee', async () => {
    const existing = await createUserWithPermissions('linkme@test.mn', [PERMISSIONS.DASHBOARD_VIEW]);

    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'LINK_EXISTING', userId: existing.userId, roleIds: [financeRoleId] });

    expect(response.status).toBe(200);
    expect(response.body.data.userId).toBe(existing.userId);
    expect(response.body.data.roles[0].key).toBe('FINANCE');
  });

  it('changes the assigned roles and audits the change', async () => {
    await createAccess();

    const response = await request(app)
      .patch(`${API}/employees/${employeeId}/system-access/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleIds: [financeRoleId], reason: 'Санхүүгийн үүрэг нэмэгдсэн' });

    expect(response.status).toBe(200);
    expect(response.body.data.roleIds).toEqual([financeRoleId]);
    expect(response.body.data.roles[0].key).toBe('FINANCE');

    const audit = await AuditLog.findOne({
      entityType: 'Employee',
      reason: 'Санхүүгийн үүрэг нэмэгдсэн',
    });
    expect(audit).not.toBeNull();
    expect((audit?.oldValue as { roleIds: string[] }).roleIds).toEqual([dispatchRoleId]);
  });

  it('rejects an unknown role id', async () => {
    await createAccess();

    const response = await request(app)
      .patch(`${API}/employees/${employeeId}/system-access/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleIds: ['507f1f77bcf86cd799439011'] });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('suspends the login, cuts live sessions and blocks the token', async () => {
    const userId = await createAccess();
    const holderToken = await login('enkhtur@monhorus.mn', 'FirstPasscode2026');

    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Чөлөө авсан' });

    expect(response.status).toBe(200);
    expect(response.body.data.accountStatus).toBe('suspended');

    expect(await Session.countDocuments({ user: userId, revokedAt: null })).toBe(0);

    const blocked = await request(app)
      .get(`${API}/employees`)
      .set('Authorization', `Bearer ${holderToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('ACCOUNT_SUSPENDED');

    const audit = await AuditLog.findOne({ entityType: 'Employee', reason: 'Чөлөө авсан' });
    expect(audit?.action).toBe('StatusChanged');
  });

  it('refuses to suspend an already suspended login', async () => {
    await createAccess();
    await request(app)
      .post(`${API}/employees/${employeeId}/system-access/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(response.status).toBe(400);
  });

  it('restores a suspended login', async () => {
    await createAccess();
    await request(app)
      .post(`${API}/employees/${employeeId}/system-access/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Ажилдаа эргэн орсон' });

    expect(response.status).toBe(200);
    expect(response.body.data.accountStatus).toBe('active');

    const audit = await AuditLog.findOne({ entityType: 'Employee', reason: 'Ажилдаа эргэн орсон' });
    expect(audit?.action).toBe('StatusChanged');
  });

  it('refuses to restore a login that is not suspended', async () => {
    await createAccess();

    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(response.status).toBe(400);
  });

  it('revokes access while keeping the employee, the account and the audit trail', async () => {
    const userId = await createAccess();

    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Ажлаас гарсан' });

    expect(response.status).toBe(200);
    expect(response.body.data.hasAccount).toBe(false);

    const employee = await Employee.findById(employeeId);
    expect(employee).not.toBeNull();
    expect(employee?.systemUser).toBeNull();

    // The account itself survives, suspended, so every audit row that points at it
    // still resolves to a real user.
    const user = await User.findById(userId);
    expect(user?.status).toBe('suspended');
    expect(await Session.countDocuments({ user: userId, revokedAt: null })).toBe(0);

    const audits = await AuditLog.find({ entityType: 'Employee', entityId: employeeId });
    expect(audits.length).toBeGreaterThanOrEqual(2);
    expect(audits.some((entry) => entry.reason === 'Ажлаас гарсан')).toBe(true);
  });

  it('refuses to act on the caller own account', async () => {
    const linkSelf = await request(app)
      .post(`${API}/employees/${employeeId}/system-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'LINK_EXISTING', userId: adminUserId, roleIds: [financeRoleId] });

    expect(linkSelf.status).toBe(403);
    expect(linkSelf.body.code).toBe('SELF_ACTION_FORBIDDEN');

    // Already linked, for instance by another administrator: every lifecycle action
    // must still refuse to touch the caller's own access.
    await Employee.updateOne({ _id: employeeId }, { $set: { systemUser: adminUserId } });

    for (const path of ['suspend', 'restore', 'revoke']) {
      const response = await request(app)
        .post(`${API}/employees/${employeeId}/system-access/${path}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('SELF_ACTION_FORBIDDEN');
    }

    const roles = await request(app)
      .patch(`${API}/employees/${employeeId}/system-access/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleIds: [financeRoleId] });
    expect(roles.status).toBe(403);
    expect(roles.body.code).toBe('SELF_ACTION_FORBIDDEN');
  });

  it('refuses every access endpoint without employee.manage_system_access', async () => {
    await createAccess();

    const user = await createUserWithPermissions('noaccess@test.mn', [PERMISSIONS.EMPLOYEE_VIEW]);
    const token = await login(user.email, user.password);

    const base = `${API}/employees/${employeeId}/system-access`;

    const link = await request(app)
      .post(base)
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'LINK_EXISTING', userId: user.userId });
    expect(link.status).toBe(403);

    const roles = await request(app)
      .patch(`${base}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [] });
    expect(roles.status).toBe(403);

    for (const path of ['suspend', 'restore', 'revoke']) {
      const response = await request(app)
        .post(`${base}/${path}`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(response.status).toBe(403);
    }
  });

  it('allows the lifecycle for a caller holding employee.manage_system_access', async () => {
    await createAccess();

    const user = await createUserWithPermissions('access@test.mn', [
      PERMISSIONS.EMPLOYEE_VIEW,
      PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS,
    ]);
    const token = await login(user.email, user.password);

    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access/suspend`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.accountStatus).toBe('suspended');
  });

  it('exposes the access state on the employee detail payload', async () => {
    await createAccess();

    const response = await request(app)
      .get(`${API}/employees/${employeeId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.body.data.systemAccess.hasAccount).toBe(true);
    expect(response.body.data.systemAccess.roles[0].key).toBe('DISPATCH');
  });
});

/**
 * Privilege escalation through the employee system-access screen.
 *
 * Every route in this module is gated by `employee.manage_system_access`, which is authority
 * over who has a login — not over what that login may do. Three paths here write the dynamic
 * `roles` array, and while they were ungated the permission was effectively a superuser key:
 * an actor holding exactly {employee.view, employee.create, employee.manage_system_access}
 * and NOT rbac.manage could mint a technician-tier account carrying SYSTEM_ADMIN, sign in as
 * it and read the RBAC screen it was never allowed to see.
 *
 * The escape is the same on all three, so all three are exercised against the same actor.
 */
describe('employee system access - role assignment requires rbac.manage', () => {
  const NEW_ACCOUNT = {
    mode: 'CREATE_NEW',
    email: 'minted@monhorus.mn',
    password: 'FirstPasscode2026',
    role: 'technician',
  } as const;

  /** Exactly the set the reported exploit ran with: the employee screen and nothing more. */
  const EXPLOIT_PERMISSIONS = [
    PERMISSIONS.EMPLOYEE_VIEW,
    PERMISSIONS.EMPLOYEE_CREATE,
    PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS,
  ] as const;

  let adminToken: string;
  let employeeId: string;

  async function systemRoleId(key: SystemRoleKey): Promise<string> {
    return String((await Role.findOne({ key }))?._id);
  }

  beforeEach(async () => {
    const admin = await createSuperUser();
    adminToken = await login(admin.email, admin.password);

    const created = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validEmployee());
    employeeId = created.body.data.id as string;
  });

  /** Provisions the login this employee already has, as the superuser. */
  async function createAccess(
    roleKey: SystemRoleKey = SYSTEM_ROLE_KEYS.TECHNICIAN,
  ): Promise<string> {
    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...NEW_ACCOUNT, roleIds: [await systemRoleId(roleKey)] });

    expect(response.status).toBe(200);
    return response.body.data.userId as string;
  }

  it('refuses CREATE_NEW carrying roleIds from a caller without rbac.manage', async () => {
    const actor = await createUserWithPermissions('minter@test.mn', [...EXPLOIT_PERMISSIONS]);
    const token = await login(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...NEW_ACCOUNT, roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN)] });

    expect(response.status).toBe(403);
    // Refused means not written: no superuser login is left behind by the attempt, and the
    // employee is not half-linked to one either.
    expect(await User.findOne({ email: NEW_ACCOUNT.email })).toBeNull();
    expect((await Employee.findById(employeeId))?.systemUser).toBeNull();
  });

  it('refuses LINK_EXISTING carrying roleIds from a caller without rbac.manage', async () => {
    const actor = await createUserWithPermissions('linker@test.mn', [...EXPLOIT_PERMISSIONS]);
    const token = await login(actor.email, actor.password);

    const target = await createUserWithPermissions('linktarget@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const rolesBefore = (await User.findById(target.userId))?.roles.map(String);

    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        mode: 'LINK_EXISTING',
        userId: target.userId,
        roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN)],
      });

    expect(response.status).toBe(403);
    // The account keeps the single dashboard role it was created with.
    expect((await User.findById(target.userId))?.roles.map(String)).toEqual(rolesBefore);
  });

  it('refuses PATCH system-access/roles from a caller without rbac.manage', async () => {
    const userId = await createAccess();
    const actor = await createUserWithPermissions('patcher@test.mn', [...EXPLOIT_PERMISSIONS]);
    const token = await login(actor.email, actor.password);

    const response = await request(app)
      .patch(`${API}/employees/${employeeId}/system-access/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN)] });

    expect(response.status).toBe(403);
    expect((await User.findById(userId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);
  });

  it('refuses a role carrying permissions the caller does not hold, even with rbac.manage', async () => {
    // rbac.manage is granted here so the case exercises the permission CAP rather than the
    // gate above it: holding the key to assign roles is not holding the roles.
    const userId = await createAccess();
    const actor = await createUserWithPermissions('capped@test.mn', [
      ...EXPLOIT_PERMISSIONS,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await login(actor.email, actor.password);

    const response = await request(app)
      .patch(`${API}/employees/${employeeId}/system-access/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.FINANCE)] });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSUFFICIENT_PRIVILEGES');
    expect((await User.findById(userId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);
  });

  /**
   * Parking a login is a ROLE WRITE and now needs `rbac.manage` like any other.
   *
   * This case used to expect 200, on the reasoning that an empty selection can only ever
   * narrow an account. That reasoning was wrong in the direction that matters: stripping an
   * account to zero permissions is a remote lockout, and the caller could aim it at any
   * linked account including an administrator's, holding nothing but
   * `employee.manage_system_access`. Suspending an account is the action that screen offers
   * for "stop this person working today", and it is separately keyed.
   *
   * The parking workflow itself is not gone — see the companion case below, and
   * `role-assignment.api.test.ts` > 'still allows a caller holding rbac.manage to park a
   * login'.
   */
  it('refuses to strip a login to zero roles without rbac.manage', async () => {
    const userId = await createAccess();
    const actor = await createUserWithPermissions('parker@test.mn', [...EXPLOIT_PERMISSIONS]);
    const token = await login(actor.email, actor.password);

    const response = await request(app)
      .patch(`${API}/employees/${employeeId}/system-access/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [], reason: 'Түр эрхгүй болгов' });

    expect(response.status).toBe(403);
    // The account keeps exactly what it had; a refused strip must not half-apply.
    expect((await User.findById(userId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);
  });

  it('lets a caller holding rbac.manage park a login with no authority', async () => {
    const userId = await createAccess();
    const actor = await createUserWithPermissions('parker2@test.mn', [
      ...EXPLOIT_PERMISSIONS,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await login(actor.email, actor.password);

    const response = await request(app)
      .patch(`${API}/employees/${employeeId}/system-access/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [], reason: 'Түр эрхгүй болгов' });

    expect(response.status).toBe(200);
    expect((await User.findById(userId))?.roles).toHaveLength(0);
  });

  /**
   * CREATE_NEW used to write `roles: roleIds ?? []`, so an account provisioned without a
   * role selection resolved to an EMPTY permission set: the holder could sign in and then
   * be refused by every guard, including the employee mobile app's first call.
   */
  it('mints a working technician when CREATE_NEW names no roles', async () => {
    const actor = await createUserWithPermissions('provisioner@test.mn', [...EXPLOIT_PERMISSIONS]);
    const token = await login(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access`)
      .set('Authorization', `Bearer ${token}`)
      .send(NEW_ACCOUNT);

    expect(response.status).toBe(200);
    expect(response.body.data.roles).toHaveLength(1);
    expect(response.body.data.roles[0].key).toBe('TECHNICIAN');
    expect((await User.findOne({ email: NEW_ACCOUNT.email }))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);

    // The admin issues the passcode, so the holder replaces it before anything else is
    // reachable; that is the whole journey from provisioning to doing the work.
    const firstToken = await login(NEW_ACCOUNT.email, NEW_ACCOUNT.password);
    const changed = await request(app)
      .post(`${API}/auth/change-password`)
      .set('Authorization', `Bearer ${firstToken}`)
      .send({ currentPassword: NEW_ACCOUNT.password, newPassword: 'OwnPasscode2026x' });
    expect(changed.status).toBe(200);

    const workingToken = await login(NEW_ACCOUNT.email, 'OwnPasscode2026x');

    const me = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${workingToken}`);
    expect(me.body.data.permissions).toContain(PERMISSIONS.PLANNED_WORK_VIEW);
    expect(me.body.data.permissions).toContain(PERMISSIONS.OBJECT_MASTER_ASSESS);
    // The tier default is the narrowest role that matches, never a wider one.
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.DISPATCH_ASSIGN);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.RBAC_MANAGE);

    // The work list the mobile app opens on: reachable with no second administrative call.
    const work = await request(app)
      .get(`${API}/planned-work`)
      .set('Authorization', `Bearer ${workingToken}`);
    expect(work.status).toBe(200);
  });
});

/**
 * The tier/role pairing that builds an unfiltered cross-tenant reader.
 *
 * Tenant scoping keys off the legacy tier alone: anything that is not `customer` resolves to
 * STAFF scope, whose filter is `{}`. A staff-tier account holding portal keys is therefore
 * accepted by every portal guard and confined by nothing, and reads every organisation's
 * records. It does not even need a customer link to do it.
 */
describe('employee system access - tier and role must agree', () => {
  const NEW_ACCOUNT = {
    mode: 'CREATE_NEW',
    email: 'mismatch@monhorus.mn',
    password: 'FirstPasscode2026',
    role: 'technician',
  } as const;

  let adminToken: string;
  let employeeId: string;
  let customerRoleId: string;
  let technicianRoleId: string;

  beforeEach(async () => {
    const admin = await createSuperUser();
    adminToken = await login(admin.email, admin.password);

    const created = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validEmployee());
    employeeId = created.body.data.id as string;

    customerRoleId = String((await Role.findOne({ key: SYSTEM_ROLE_KEYS.CUSTOMER }))?._id);
    technicianRoleId = String((await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN }))?._id);
  });

  it('refuses a portal role on a staff-tier account at creation, even for the head_admin', async () => {
    const response = await request(app)
      .post(`${API}/employees/${employeeId}/system-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...NEW_ACCOUNT, roleIds: [customerRoleId] });

    expect(response.status).toBe(400);
    expect(response.body.issues).toContainEqual({
      field: 'roleIds',
      message: 'Харилцагчийн эрхийг зөвхөн харилцагчийн бүртгэлд олгоно.',
    });
    expect(await User.findOne({ email: NEW_ACCOUNT.email })).toBeNull();
  });

  it('refuses a portal role on an existing staff-tier account', async () => {
    const created = await request(app)
      .post(`${API}/employees/${employeeId}/system-access`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...NEW_ACCOUNT, roleIds: [technicianRoleId] });
    expect(created.status).toBe(200);
    const userId = created.body.data.userId as string;

    const response = await request(app)
      .patch(`${API}/employees/${employeeId}/system-access/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleIds: [customerRoleId] });

    expect(response.status).toBe(400);
    // The account keeps the staff role it had, so no unfiltered portal reader exists even
    // for the moment between the write and the response.
    expect((await User.findById(userId))?.roles.map(String)).toEqual([technicianRoleId]);
  });
});

describe('salary permission enforcement', () => {
  let employeeId: string;
  let adminToken: string;

  beforeEach(async () => {
    const admin = await createSuperUser();
    adminToken = await login(admin.email, admin.password);

    const created = await request(app)
      .post(`${API}/employees`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validEmployee());
    employeeId = created.body.data.id as string;

    await request(app)
      .post(`${API}/employees/${employeeId}/salary`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        baseSalary: 2_500_000,
        currency: 'MNT',
        calculationType: 'MONTHLY',
        effectiveFrom: '2024-01-15',
        transportAllowance: 0,
        mealAllowance: 0,
        phoneAllowance: 0,
        otherAllowance: 0,
        socialInsurance: true,
        personalIncomeTax: true,
      });
  });

  it('omits the salary field entirely for a caller without employee.view_salary', async () => {
    const user = await createUserWithPermissions('nosalary@test.mn', [PERMISSIONS.EMPLOYEE_VIEW]);
    const token = await login(user.email, user.password);

    const response = await request(app)
      .get(`${API}/employees/${employeeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    // Absent, not null: the client cannot tell whether a salary exists at all.
    expect(response.body.data).not.toHaveProperty('currentSalary');
  });

  it('includes the salary for a caller holding employee.view_salary', async () => {
    const user = await createUserWithPermissions('salary@test.mn', [
      PERMISSIONS.EMPLOYEE_VIEW,
      PERMISSIONS.EMPLOYEE_VIEW_SALARY,
    ]);
    const token = await login(user.email, user.password);

    const response = await request(app)
      .get(`${API}/employees/${employeeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.currentSalary.baseSalary).toBe(2_500_000);
  });

  it('refuses the salary endpoints without the salary permissions', async () => {
    const user = await createUserWithPermissions('nosalary2@test.mn', [PERMISSIONS.EMPLOYEE_VIEW]);
    const token = await login(user.email, user.password);

    const read = await request(app)
      .get(`${API}/employees/${employeeId}/salary`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(403);

    const write = await request(app)
      .post(`${API}/employees/${employeeId}/salary`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        baseSalary: 1,
        currency: 'MNT',
        calculationType: 'MONTHLY',
        effectiveFrom: '2025-01-01',
        transportAllowance: 0,
        mealAllowance: 0,
        phoneAllowance: 0,
        otherAllowance: 0,
        socialInsurance: true,
        personalIncomeTax: true,
      });
    expect(write.status).toBe(403);
  });

  it('closes the previous period instead of overwriting it', async () => {
    await request(app)
      .post(`${API}/employees/${employeeId}/salary`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        baseSalary: 3_000_000,
        currency: 'MNT',
        calculationType: 'MONTHLY',
        effectiveFrom: '2025-01-01',
        transportAllowance: 0,
        mealAllowance: 0,
        phoneAllowance: 0,
        otherAllowance: 0,
        socialInsurance: true,
        personalIncomeTax: true,
      });

    const history = await request(app)
      .get(`${API}/employees/${employeeId}/salary`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(history.body.data).toHaveLength(2);
    const current = history.body.data.filter((row: { isCurrent: boolean }) => row.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0].baseSalary).toBe(3_000_000);
  });
});
