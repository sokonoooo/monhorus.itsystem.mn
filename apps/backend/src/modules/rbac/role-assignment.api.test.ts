import { PERMISSIONS, SYSTEM_ROLE_KEYS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { hashPassword } from '../../utils/password.util';
import { AuditLog } from '../audit/audit-log.model';
import { User } from '../user/user.model';
import { Role } from './role.model';

/**
 * The chokepoint, exercised over real HTTP.
 *
 * Every case here is an escalation that was CONFIRMED against a running server before the
 * chokepoint existed, not a rule invented to have something to assert. They are driven
 * through `POST /api/v1/rbac/users/:userId/roles` and the role-editing endpoints because
 * that is how they were originally exploited; the same decision function serves
 * `POST /users`, `PATCH /users/:userId` and all three employee system-access actions, whose
 * own suites cover their own paths.
 */

const API = '/api/v1';
const FIXTURE_PASSWORD = 'FixturePass2026x';

let app: Express;

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
});

async function loginAs(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

/** The id of a seeded system role, which `resetDomainCollections` preserves. */
async function systemRoleId(key: string): Promise<string> {
  const role = await Role.findOne({ key }).select('_id');
  expect(role).not.toBeNull();
  return String(role?._id);
}

/**
 * A fixture account written straight to the collection.
 *
 * The API is the thing under test, so building a victim through it would make a failing
 * assertion ambiguous between the setup and the case.
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
    password: await hashPassword(FIXTURE_PASSWORD),
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

describe('POST /rbac/users/:userId/roles - self-modification', () => {
  /**
   * The exploit that made the self-target rule absolute: an actor holding nothing but
   * `rbac.manage` POSTed SYSTEM_ADMIN to its OWN user id and `/auth/me` returned the whole
   * catalogue on the next request.
   */
  it('refuses an actor assigning itself the superuser role', async () => {
    const actor = await createUserWithPermissions('selfpromote@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const before = await storedRoles(actor.userId);

    const response = await request(app)
      .post(`${API}/rbac/users/${actor.userId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN)] });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('SELF_ACTION_FORBIDDEN');
    expect(await storedRoles(actor.userId)).toEqual(before);

    // The decisive assertion: not the status code, but that nothing was actually gained.
    const me = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.EMPLOYEE_MANAGE_SALARY);
  });

  /**
   * Refused outright, not "refused unless it narrows".
   *
   * There is no self-demotion flow in either client — `updateUser`, `resetPasscode`,
   * `updateUserStatus` and every employee system-access action already refuse a self target
   * — so the rule has no legitimate case to carve out, and a "you may only narrow yourself"
   * exception would need the policy to compare permission sets it does not otherwise
   * compare. If such a flow is ever built it belongs in an explicit, separately named entry
   * point with its own test, not as a relaxation of this line.
   */
  it('refuses a self-directed change even when it only narrows the actor', async () => {
    const actor = await createUserWithPermissions('selfdemote@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/rbac/users/${actor.userId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [] });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('SELF_ACTION_FORBIDDEN');
    expect(await storedRoles(actor.userId)).toHaveLength(1);
  });
});

describe('POST /rbac/users/:userId/roles - protected roles', () => {
  it('refuses SYSTEM_ADMIN to a holder of rbac.manage alone, and audits the attempt', async () => {
    const actor = await createUserWithPermissions('promoter@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const victimId = await createAccount({ email: 'victim@test.mn', role: 'technician' });

    const response = await request(app)
      .post(`${API}/rbac/users/${victimId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN)] });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('INSUFFICIENT_PRIVILEGES');
    expect(await storedRoles(victimId)).toEqual([]);

    // A refusal is the ONLY visible trace of somebody probing for the superuser role: an
    // attacker who is stopped leaves no other evidence at all, so the refused attempt is
    // audited exactly like an allowed one.
    const entry = await AuditLog.findOne({ entityType: 'User', entityId: victimId });
    expect(entry).not.toBeNull();
    expect(entry?.reason).toContain('REFUSED');
    expect(entry?.reason).toContain('POST /rbac/users/:userId/roles');
    expect((entry?.newValue as { addedProtectedRoles: string[] }).addedProtectedRoles).toEqual([
      SYSTEM_ROLE_KEYS.SYSTEM_ADMIN,
    ]);
    expect((entry?.newValue as { allowed: boolean }).allowed).toBe(false);
  });

  it('allows it for a holder of rbac.manage_protected, and audits that too', async () => {
    const superUser = await createSuperUser();
    const token = await loginAs(superUser.email, superUser.password);
    const targetId = await createAccount({ email: 'newadmin@test.mn', role: 'admin' });
    const systemAdminId = await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN);

    const response = await request(app)
      .post(`${API}/rbac/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [systemAdminId] });

    expect(response.status).toBe(200);
    expect(await storedRoles(targetId)).toEqual([systemAdminId]);

    const entry = await AuditLog.findOne({
      entityType: 'User',
      entityId: targetId,
      reason: { $regex: 'allowed' },
    });
    expect(entry).not.toBeNull();
    expect((entry?.newValue as { allowed: boolean }).allowed).toBe(true);
  });

  /**
   * `head_admin` is the SAME authority under a different mechanism: it is an unconditional
   * superuser branch at the top of `resolveEffectivePermissions`, which returns everything
   * without reading `roles` at all. Guarding only the SYSTEM_ADMIN role key would leave this
   * account's roles rewritable by anyone holding plain `rbac.manage`.
   */
  it('refuses an admin-tier actor rewriting the head_admin’s roles', async () => {
    const actor = await createUserWithPermissions('rewriter@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const systemAdminId = await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN);
    // Given roles to strip, so this is a genuine change: a request that asks for the set the
    // account already holds is a no-op and is short-circuited before any authority gate,
    // which would make the assertion prove nothing.
    const headAdminId = await createAccount({
      email: 'head@test.mn',
      role: 'head_admin',
      roles: [systemAdminId],
    });

    const response = await request(app)
      .post(`${API}/rbac/users/${headAdminId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [] });

    expect(response.status).toBe(403);
    expect(await storedRoles(headAdminId)).toEqual([systemAdminId]);
  });

  /**
   * There is no self-registration and no self-service recovery in this product, and the
   * bootstrap script refuses to run once a head_admin exists, so an installation that loses
   * its last administrator needs direct database surgery to recover. It is therefore refused
   * outright rather than warned about.
   */
  it('refuses to remove the last active top-level administrator', async () => {
    // The actor deliberately holds the protected authority WITHOUT being an administrator
    // itself, so that the target really is the last one. Using a head_admin here would
    // defeat the case: it is an administrator, so a second one would exist and the rule
    // would correctly allow the demotion.
    const actor = await createUserWithPermissions('governor@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.RBAC_MANAGE_PROTECTED,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const systemAdminId = await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN);
    const technicianRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN);
    // Technician tier so the actor's own tier rules permit acting on it; the SYSTEM_ADMIN
    // role is what makes it an administrator, and that is the mechanism under test.
    const onlyAdminId = await createAccount({
      email: 'lastadmin@test.mn',
      role: 'technician',
      roles: [systemAdminId],
    });

    const response = await request(app)
      .post(`${API}/rbac/users/${onlyAdminId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [technicianRoleId] });

    expect(response.status).toBe(409);
    expect(await storedRoles(onlyAdminId)).toEqual([systemAdminId]);
  });

  it('allows the demotion once a second administrator exists', async () => {
    // Same shape as above, except the actor is a head_admin — an active administrator in its
    // own right — so the installation does not lose its last one.
    const superUser = await createSuperUser();
    const token = await loginAs(superUser.email, superUser.password);
    const systemAdminId = await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN);
    const adminRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.ADMIN);
    const oneOfTwoId = await createAccount({
      email: 'oneoftwo@test.mn',
      role: 'admin',
      roles: [systemAdminId],
    });

    const response = await request(app)
      .post(`${API}/rbac/users/${oneOfTwoId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [adminRoleId] });

    expect(response.status).toBe(200);
    expect(await storedRoles(oneOfTwoId)).toEqual([adminRoleId]);
  });
});

describe('POST /rbac/users/:userId/roles - tier and role must agree', () => {
  /**
   * Tenant scoping keys off the LEGACY TIER, not off permissions: `resolveCustomerScope`
   * branches on `auth.role === 'customer'` and every other tier resolves to
   * `{ mode: 'STAFF' }`, whose filter is `{}` — no filter at all. A staff-tier account
   * holding `portal.*` keys therefore passes every portal guard and is then confined by
   * nothing, and it needs no customer link to do it. That is what made the pairing look
   * harmless, and it produced a working reader of every organisation's records.
   */
  it('refuses the portal role on a staff-tier account, even for the head_admin', async () => {
    const superUser = await createSuperUser();
    const token = await loginAs(superUser.email, superUser.password);
    const technicianRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN);
    const targetId = await createAccount({
      email: 'tech@test.mn',
      role: 'technician',
      roles: [technicianRoleId],
    });

    const response = await request(app)
      .post(`${API}/rbac/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER)] });

    expect(response.status).toBe(400);
    expect(await storedRoles(targetId)).toEqual([technicianRoleId]);
  });

  /** The mirror image: a customer must stay inside the CUSTOMER contract. */
  it('refuses a staff role on a customer-tier account', async () => {
    const superUser = await createSuperUser();
    const token = await loginAs(superUser.email, superUser.password);
    const customerRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER);
    const targetId = await createAccount({
      email: 'buyer@test.mn',
      role: 'customer',
      roles: [customerRoleId],
    });

    const response = await request(app)
      .post(`${API}/rbac/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.ADMIN)] });

    expect(response.status).toBe(400);
    expect(await storedRoles(targetId)).toEqual([customerRoleId]);
  });
});

describe('POST /rbac/users/:userId/roles - stripping an account', () => {
  /**
   * A strip can never be an escalation, which is why it used to be ungated. It IS a remote
   * lockout, and it was reachable from the employee access screen by a caller holding only
   * `employee.manage_system_access`. Parking a login with no authority stays supported and
   * now asks for the key that governs what a login may do.
   */
  it('refuses an empty selection from a caller without rbac.manage', async () => {
    const actor = await createUserWithPermissions('stripper@test.mn', [PERMISSIONS.RBAC_VIEW]);
    const token = await loginAs(actor.email, actor.password);
    const dispatchRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.DISPATCH);
    const targetId = await createAccount({
      email: 'parked@test.mn',
      role: 'technician',
      roles: [dispatchRoleId],
    });

    const response = await request(app)
      .post(`${API}/rbac/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [] });

    // The router's own `rbac.manage` gate refuses this one before the service sees it, which
    // is the point: the two agree rather than the route being the weaker of the pair.
    expect(response.status).toBe(403);
    expect(await storedRoles(targetId)).toEqual([dispatchRoleId]);
  });

  it('still allows a caller holding rbac.manage to park a login', async () => {
    const actor = await createUserWithPermissions('parker@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const targetId = await createAccount({
      email: 'toPark@test.mn',
      role: 'technician',
      roles: [await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN)],
    });

    const response = await request(app)
      .post(`${API}/rbac/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [] });

    expect(response.status).toBe(200);
    expect(await storedRoles(targetId)).toEqual([]);
  });
});

describe('POST /rbac/users/:userId/roles - the delegation ceiling', () => {
  /**
   * `rbac.manage` is the key that lets an actor assign roles AT ALL. It is emphatically not
   * a licence to assign ANY role, which is the reading that made it the shortest path to
   * owning the installation.
   */
  it('refuses a role carrying permissions the actor does not itself hold', async () => {
    const actor = await createUserWithPermissions('capped@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const targetId = await createAccount({ email: 'target@test.mn', role: 'technician' });

    const response = await request(app)
      .post(`${API}/rbac/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      // FINANCE carries employee.view_salary and employee.manage_salary, which the actor
      // holds neither of.
      .send({ roleIds: [await systemRoleId(SYSTEM_ROLE_KEYS.FINANCE)] });

    expect(response.status).toBe(403);
    expect(await storedRoles(targetId)).toEqual([]);
  });

  /**
   * The ordinary workflow the cap must not break: the target tier's own default is grantable
   * because the actor could grant exactly that by staying silent at creation time, so
   * refusing it when named explicitly would be theatre.
   */
  it('allows the target tier’s own default', async () => {
    const actor = await createUserWithPermissions('delegator@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const technicianRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN);
    const targetId = await createAccount({ email: 'freshtech@test.mn', role: 'technician' });

    const response = await request(app)
      .post(`${API}/rbac/users/${targetId}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roleIds: [technicianRoleId] });

    expect(response.status).toBe(200);
    expect(await storedRoles(targetId)).toEqual([technicianRoleId]);
  });
});

/**
 * Capping which ROLES may be assigned is worthless on its own, because a role's permission
 * set is editable. An actor holding nothing but `rbac.manage` rewrote ITS OWN role to add
 * `employee.view_salary` and `employee.manage_salary` and held both on the very next
 * request — no assignment involved, and every assignment-time cap bypassed in one call.
 */
describe('role editing is capped by the same ceiling', () => {
  it('refuses an actor adding a permission it does not hold to its own role', async () => {
    const actor = await createUserWithPermissions('selfedit@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const ownRoleId = (await storedRoles(actor.userId))[0];

    const response = await request(app)
      .patch(`${API}/rbac/roles/${ownRoleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        permissions: [
          PERMISSIONS.RBAC_VIEW,
          PERMISSIONS.RBAC_MANAGE,
          PERMISSIONS.DASHBOARD_VIEW,
          PERMISSIONS.EMPLOYEE_VIEW_SALARY,
          PERMISSIONS.EMPLOYEE_MANAGE_SALARY,
        ],
      });

    expect(response.status).toBe(403);

    // Again the assertion that matters is what the actor can do afterwards, not the code.
    const me = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${token}`);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.EMPLOYEE_VIEW_SALARY);
  });

  /**
   * Adding `portal.*` to a staff role reaches the unfiltered cross-tenant reader from the
   * other end: no assignment happens, the role changes underneath the accounts that already
   * hold it, and every "capped" assignment path then mints readers while passing its checks.
   */
  it('refuses adding a portal key to a role that staff-tier accounts hold', async () => {
    const superUser = await createSuperUser();
    const token = await loginAs(superUser.email, superUser.password);
    const technicianRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN);
    await createAccount({
      email: 'holder@test.mn',
      role: 'technician',
      roles: [technicianRoleId],
    });

    const role = await Role.findById(technicianRoleId);
    const response = await request(app)
      .patch(`${API}/rbac/roles/${technicianRoleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permissions: [...(role?.permissions ?? []), PERMISSIONS.PORTAL_PROJECT_VIEW] });

    expect(response.status).toBe(400);
    const after = await Role.findById(technicianRoleId);
    expect(after?.permissions).not.toContain(PERMISSIONS.PORTAL_PROJECT_VIEW);
  });

  it('refuses editing the protected role without rbac.manage_protected', async () => {
    const actor = await createUserWithPermissions('roleeditor@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const systemAdminId = await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN);

    const response = await request(app)
      .patch(`${API}/rbac/roles/${systemAdminId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed' });

    expect(response.status).toBe(403);
    expect((await Role.findById(systemAdminId))?.name).not.toBe('Renamed');
  });

  it('refuses deleting the protected role without rbac.manage_protected', async () => {
    const actor = await createUserWithPermissions('roledeleter@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const systemAdminId = await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN);

    const response = await request(app)
      .delete(`${API}/rbac/roles/${systemAdminId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(await Role.findById(systemAdminId)).not.toBeNull();
  });

  it('refuses minting a NEW role carrying permissions the actor does not hold', async () => {
    const actor = await createUserWithPermissions('rolecreator@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/rbac/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        key: 'SNEAKY',
        name: 'Sneaky',
        permissions: [PERMISSIONS.EMPLOYEE_MANAGE_SALARY],
      });

    expect(response.status).toBe(403);
    expect(await Role.findOne({ key: 'SNEAKY' })).toBeNull();
  });

  /** Narrowing a role is not an escalation, so only the ADDED keys are capped. */
  it('allows removing a key the actor does not itself hold', async () => {
    const actor = await createUserWithPermissions('narrower@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);
    const financeRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.FINANCE);

    const response = await request(app)
      .patch(`${API}/rbac/roles/${financeRoleId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ permissions: [PERMISSIONS.INVOICE_VIEW] });

    expect(response.status).toBe(200);
    expect((await Role.findById(financeRoleId))?.permissions).toEqual([PERMISSIONS.INVOICE_VIEW]);
  });
});

/**
 * The superuser exemption inside the tier/role coherence rule, pinned from the outside.
 *
 * SYSTEM_ADMIN's contract is the whole catalogue, `portal.*` included, so a coherence rule
 * that refuses portal keys to every non-customer tier without exception makes the superuser
 * role unassignable and takes the documented `head_admin -> SYSTEM_ADMIN` default with it.
 * The failure mode is quiet and total: no administrator can be provisioned at all.
 */
describe('provisioning a top-level administrator still works', () => {
  it('creates a head_admin carrying the full catalogue', async () => {
    const superUser = await createSuperUser();
    const token = await loginAs(superUser.email, superUser.password);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Хоёр дахь админ',
        email: 'second.head@test.mn',
        password: 'SecondHead2026x',
        role: 'head_admin',
        requirePasswordChange: false,
      });

    expect(response.status).toBe(201);
    const created = await User.findOne({ email: 'second.head@test.mn' });
    expect(created?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN),
    ]);

    // Provisioned and immediately usable, which is the whole point of the tier default.
    const newToken = await loginAs('second.head@test.mn', 'SecondHead2026x');
    const me = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${newToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.permissions).toContain(PERMISSIONS.RBAC_MANAGE_PROTECTED);
  });

  it('refuses an admin-tier actor trying to provision one', async () => {
    const actor = await createUserWithPermissions('wannabe@test.mn', [
      PERMISSIONS.RBAC_VIEW,
      PERMISSIONS.RBAC_MANAGE,
    ]);
    const token = await loginAs(actor.email, actor.password);

    const response = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Хууль бус админ',
        email: 'sneaky.head@test.mn',
        password: 'SneakyHead2026x',
        role: 'head_admin',
        requirePasswordChange: false,
      });

    expect(response.status).toBe(403);
    expect(await User.findOne({ email: 'sneaky.head@test.mn' })).toBeNull();
  });
});

describe('rbac.manage_protected is seeded on SYSTEM_ADMIN only', () => {
  it('appears in the SYSTEM_ADMIN contract and in no other system role', async () => {
    const roles = await Role.find({ isSystem: true }).select('key permissions');
    const holders = roles
      .filter((role) => role.permissions.includes(PERMISSIONS.RBAC_MANAGE_PROTECTED))
      .map((role) => role.key);

    expect(holders).toEqual([SYSTEM_ROLE_KEYS.SYSTEM_ADMIN]);
  });
});
