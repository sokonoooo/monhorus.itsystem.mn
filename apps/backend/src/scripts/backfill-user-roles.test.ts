import { PERMISSIONS, SYSTEM_ROLE_KEYS } from '@monhorus/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Role } from '../modules/rbac/role.model';
import { User } from '../modules/user/user.model';
import { resetDomainCollections, startTestApp, stopTestApp } from '../test/helpers';
import { hashPassword } from '../utils/password.util';
import { backfillUserRoles } from './backfill-user-roles';

const PASSWORD = 'BackfillPassword2026x';

beforeAll(async () => {
  await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
});

async function systemRoleId(key: string): Promise<string> {
  const role = await Role.findOne({ key }).select('_id');
  expect(role, `system role '${key}' is not seeded`).not.toBeNull();
  return String(role?._id);
}

/** An account written straight to the collection, the way a legacy row looks. */
async function legacyAccount(options: {
  email: string;
  role: 'customer' | 'technician' | 'admin' | 'head_admin';
  roles?: string[];
}): Promise<string> {
  const user = await User.create({
    fullName: `Test ${options.email}`,
    email: options.email,
    password: await hashPassword(PASSWORD),
    role: options.role,
    roles: options.roles ?? [],
    status: 'active',
    passwordChangedAt: new Date(),
  });
  return String(user._id);
}

/**
 * The accounts this repairs were written before POST /users resolved a default role, and
 * nothing in the system ever fixes them on its own: effective permissions come from `roles`
 * alone, and `seedRbac` creates the roles without assigning them to anybody. Such an account
 * signs in successfully and is then refused at every single guard.
 */
describe('backfillUserRoles', () => {
  it('gives each permissionless account its own tier default', async () => {
    const technicianId = await legacyAccount({ email: 'tech@test.mn', role: 'technician' });
    const customerId = await legacyAccount({ email: 'cust@test.mn', role: 'customer' });
    const adminId = await legacyAccount({ email: 'admin@test.mn', role: 'admin' });

    const result = await backfillUserRoles();

    expect(result.backfilled).toHaveLength(3);
    expect(result.byTier).toEqual({ technician: 1, customer: 1, admin: 1 });

    expect((await User.findById(technicianId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);
    expect((await User.findById(customerId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER),
    ]);
    // The back-office set, not the superuser one: the tier means "runs the back office".
    expect((await User.findById(adminId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.ADMIN),
    ]);
  });

  it('skips head_admin, which is already an unconditional superuser', async () => {
    const headAdminId = await legacyAccount({ email: 'head@test.mn', role: 'head_admin' });

    const result = await backfillUserRoles();

    expect(result.scanned).toBe(1);
    expect(result.skippedHeadAdmins).toBe(1);
    expect(result.backfilled).toEqual([]);
    expect((await User.findById(headAdminId))?.roles).toEqual([]);
  });

  it('leaves an account that already holds a role alone', async () => {
    // A deliberate assignment: a technician given the DISPATCH role by an administrator.
    const dispatchRoleId = await systemRoleId(SYSTEM_ROLE_KEYS.DISPATCH);
    const assignedId = await legacyAccount({
      email: 'lead@test.mn',
      role: 'technician',
      roles: [dispatchRoleId],
    });

    const result = await backfillUserRoles();

    expect(result.scanned).toBe(0);
    expect(result.backfilled).toEqual([]);
    expect((await User.findById(assignedId))?.roles.map(String)).toEqual([dispatchRoleId]);
  });

  it('is idempotent: a second run finds nothing to do', async () => {
    await legacyAccount({ email: 'tech@test.mn', role: 'technician' });

    const first = await backfillUserRoles();
    const second = await backfillUserRoles();

    expect(first.backfilled).toHaveLength(1);
    expect(second.scanned).toBe(0);
    expect(second.backfilled).toEqual([]);
  });

  it('writes nothing on a dry run but reports what it would change', async () => {
    const technicianId = await legacyAccount({ email: 'tech@test.mn', role: 'technician' });

    const result = await backfillUserRoles({ dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.backfilled).toHaveLength(1);
    expect(result.backfilled[0]?.email).toBe('tech@test.mn');
    expect(result.backfilled[0]?.roleIds).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);
    expect((await User.findById(technicianId))?.roles).toEqual([]);
  });

  it('changes nothing except the roles array', async () => {
    const customerId = await legacyAccount({ email: 'cust@test.mn', role: 'customer' });
    await User.updateOne({ _id: customerId }, { $set: { status: 'suspended' } });

    await backfillUserRoles();

    const user = await User.findById(customerId);
    // Suspended accounts are backfilled too: the status already gates what they may do,
    // and leaving them permissionless only defers the repair to their reactivation.
    expect(user?.status).toBe('suspended');
    expect(user?.role).toBe('customer');
    expect(user?.roles.map(String)).toEqual([await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER)]);
  });

  /**
   * NEVER SILENTLY GRANT A STRONGER ROLE.
   *
   * The script's premise is "the tier default is the least this account should have", which
   * holds only while the role document still means what the seeded table says. A TECHNICIAN
   * role somebody has widened to include `rbac.manage` would otherwise be handed to every
   * permissionless technician at once — a mass privilege grant with no actor and no audit
   * row.
   */
  it('refuses to hand out a tier default that has been widened beyond its contract', async () => {
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.TECHNICIAN },
      { $addToSet: { permissions: PERMISSIONS.RBAC_MANAGE } },
    );
    const technicianId = await legacyAccount({ email: 'tech@test.mn', role: 'technician' });
    // An unaffected tier in the same run still gets repaired.
    const customerId = await legacyAccount({ email: 'cust@test.mn', role: 'customer' });

    const result = await backfillUserRoles();

    expect(result.dangerousTierDefaults).toHaveLength(1);
    expect(result.dangerousTierDefaults[0]?.legacyRole).toBe('technician');
    expect(result.dangerousTierDefaults[0]?.excess).toContain(PERMISSIONS.RBAC_MANAGE);

    const flagged = result.needingRemediation.find((entry) => entry.email === 'tech@test.mn');
    expect(flagged?.reason).toBe('DANGEROUS_TIER_DEFAULT');

    expect((await User.findById(technicianId))?.roles).toEqual([]);
    expect((await User.findById(customerId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.CUSTOMER),
    ]);

    // Restore the role for the suites that follow: `resetDomainCollections` keeps roles.
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.TECHNICIAN },
      { $pull: { permissions: PERMISSIONS.RBAC_MANAGE } },
    );
  });

  /** A trimmed role is an administrator's deliberate customisation, not a danger. */
  it('still hands out a tier default that has been narrowed', async () => {
    const original = (await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN }))?.permissions ?? [];
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.TECHNICIAN },
      { $set: { permissions: [PERMISSIONS.DASHBOARD_VIEW] } },
    );
    const technicianId = await legacyAccount({ email: 'tech@test.mn', role: 'technician' });

    const result = await backfillUserRoles();

    expect(result.dangerousTierDefaults).toEqual([]);
    expect((await User.findById(technicianId))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);

    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.TECHNICIAN },
      { $set: { permissions: original } },
    );
  });

  /**
   * A deleted role leaves its holders resolving to no permissions while their `roles` array
   * still looks populated, so the `$size: 0` filter cannot see them. Reported, never
   * repaired: what such an account should hold instead is a human decision.
   */
  it('reports accounts whose roles point at deleted role documents, without writing them', async () => {
    const doomed = await Role.create({
      key: 'DELETED_ROLE_TEST',
      name: 'Устгагдсан',
      description: null,
      permissions: [PERMISSIONS.DASHBOARD_VIEW],
      isSystem: false,
    });
    const orphanId = await legacyAccount({
      email: 'orphan@test.mn',
      role: 'technician',
      roles: [String(doomed._id)],
    });
    await Role.deleteOne({ _id: doomed._id });

    const result = await backfillUserRoles();

    const flagged = result.needingRemediation.find((entry) => entry.email === 'orphan@test.mn');
    expect(flagged?.reason).toBe('DANGLING_ROLE_REFERENCES');
    expect(flagged?.detail).toContain('NO permissions');

    // Untouched: not backfilled, not pruned.
    expect(result.backfilled).toEqual([]);
    expect((await User.findById(orphanId))?.roles.map(String)).toEqual([String(doomed._id)]);
  });

  it('backfills a document written before the roles field existed at all', async () => {
    const id = await legacyAccount({ email: 'ancient@test.mn', role: 'technician' });
    await User.collection.updateOne(
      { _id: (await User.findById(id))?._id },
      { $unset: { roles: '' } },
    );

    const result = await backfillUserRoles();

    expect(result.backfilled).toHaveLength(1);
    expect((await User.findById(id))?.roles.map(String)).toEqual([
      await systemRoleId(SYSTEM_ROLE_KEYS.TECHNICIAN),
    ]);
  });
});
