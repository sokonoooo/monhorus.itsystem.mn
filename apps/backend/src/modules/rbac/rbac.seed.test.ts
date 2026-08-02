import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLE_KEYS, USER_ROLES } from '@monhorus/shared';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { convergeTechnicianPermissions } from '../../scripts/converge-technician-permissions';
import { resetDomainCollections, startTestApp, stopTestApp } from '../../test/helpers';
import { User } from '../user/user.model';
import { Role } from './role.model';
import { resolveDefaultRoleIds, seedRbac } from './rbac.service';

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

describe('seedRbac', () => {
  it('is idempotent and creates no duplicate system roles', async () => {
    await seedRbac();
    await seedRbac();

    const keys = Object.values(SYSTEM_ROLE_KEYS);
    for (const key of keys) {
      expect(await Role.countDocuments({ key })).toBe(1);
    }
    expect(app).toBeDefined();
  });

  it('gives SYSTEM_ADMIN the whole catalogue on first seed', async () => {
    const role = await Role.findOne({ key: SYSTEM_ROLE_KEYS.SYSTEM_ADMIN });
    expect(role?.permissions).toHaveLength(ALL_PERMISSIONS.length);
  });

  /**
   * The regression this exists for: a permission added to the catalogue after the roles
   * were first seeded used to leave SYSTEM_ADMIN short of it, so the role that is defined
   * as "everything" silently stopped being a superuser after an upgrade.
   */
  it('resynchronises SYSTEM_ADMIN when the catalogue has grown since the last seed', async () => {
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.SYSTEM_ADMIN },
      { $set: { permissions: [PERMISSIONS.DASHBOARD_VIEW] } },
    );

    await seedRbac();

    const role = await Role.findOne({ key: SYSTEM_ROLE_KEYS.SYSTEM_ADMIN });
    expect(role?.permissions).toHaveLength(ALL_PERMISSIONS.length);
    expect(role?.permissions).toContain(PERMISSIONS.PLANNED_WORK_APPROVE_REPORT);
  });

  it('preserves an administrator edit to a non-superuser system role', async () => {
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.DISPATCH },
      { $set: { permissions: [PERMISSIONS.DASHBOARD_VIEW] } },
    );

    await seedRbac();

    const role = await Role.findOne({ key: SYSTEM_ROLE_KEYS.DISPATCH });
    // Deliberately NOT widened back to the defaults: granting new authority on upgrade
    // must be an explicit administrator action.
    expect(role?.permissions).toEqual([PERMISSIONS.DASHBOARD_VIEW]);
  });

  it('prunes a key that the catalogue no longer defines', async () => {
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.MANAGEMENT },
      { $set: { permissions: [PERMISSIONS.DASHBOARD_VIEW, 'legacy.removed_key'] } },
    );

    await seedRbac();

    const role = await Role.findOne({ key: SYSTEM_ROLE_KEYS.MANAGEMENT });
    expect(role?.permissions).toEqual([PERMISSIONS.DASHBOARD_VIEW]);
  });

  it('grants the planned-work approval permission to the three intended roles by default', async () => {
    // Seed from scratch: `resetDomainCollections` preserves roles, and the tests above
    // deliberately mutate some of them, so the assertion must not read that leftover state.
    await Role.deleteMany({ isSystem: true });
    await seedRbac();

    const roles = await Role.find({
      key: {
        $in: [
          SYSTEM_ROLE_KEYS.SYSTEM_ADMIN,
          SYSTEM_ROLE_KEYS.ADMIN,
          SYSTEM_ROLE_KEYS.MANAGEMENT,
          SYSTEM_ROLE_KEYS.DISPATCH,
          SYSTEM_ROLE_KEYS.FINANCE,
          SYSTEM_ROLE_KEYS.SALES,
        ],
      },
    });

    const canApprove = new Set(
      roles
        .filter((role) => role.permissions.includes(PERMISSIONS.PLANNED_WORK_APPROVE_REPORT))
        .map((role) => role.key),
    );

    expect(canApprove).toEqual(
      new Set([
        SYSTEM_ROLE_KEYS.SYSTEM_ADMIN,
        SYSTEM_ROLE_KEYS.ADMIN,
        SYSTEM_ROLE_KEYS.MANAGEMENT,
      ]),
    );
  });

  /**
   * The tier existed with no role of its own, so `technician` had no default and every
   * technician account was created with an empty permission set.
   */
  it('seeds a TECHNICIAN role that can do field work but not direct it', async () => {
    await Role.deleteMany({ isSystem: true });
    await seedRbac();

    const role = await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN });
    expect(role?.isSystem).toBe(true);

    const held = new Set(role?.permissions ?? []);
    for (const key of [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS,
      PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
      PERMISSIONS.SERVICE_REQUEST_VIEW,
      PERMISSIONS.SERVICE_REQUEST_UPDATE,
      PERMISSIONS.OBJECT_MASTER_ASSESS,
      PERMISSIONS.NOTIFICATION_VIEW,
      /**
       * START/PAUSE/RESUME/COMPLETE/PLAN — a statement about the work, not about its
       * report, which is why granting it does not collapse the section 9.2 separation
       * asserted just below. The seeded default was missing it while the dev database held
       * it only because somebody PATCHed it in by hand, so a reseed shipped an app whose
       * Ажил tab could not move a job.
       */
      PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
    ]) {
      expect(held).toContain(key);
    }

    // The reason DISPATCH could not simply be reused, plus the section 9.2 separation
    // between submitting a conclusion and signing one off. Note that submitting and
    // approving are the two keys that separation actually rests on: a technician submits,
    // and only MANAGEMENT/ADMIN/SYSTEM_ADMIN approve.
    for (const key of [
      /**
       * Directory-wide read of every colleague's registration number, phone and email.
       * It was granted once so the mobile app could find its own employee row, and the
       * leak was live. `AuthContext.employeeId` plus `GET /employees/me` replaced that
       * workaround, so the key has no remaining justification here.
       */
      PERMISSIONS.EMPLOYEE_VIEW,
      PERMISSIONS.DISPATCH_ASSIGN,
      PERMISSIONS.DISPATCH_EXTEND_SLA,
      PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS,
      PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
      PERMISSIONS.PLANNED_WORK_CANCEL,
      PERMISSIONS.EMPLOYEE_VIEW_SALARY,
      PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS,
      PERMISSIONS.INVOICE_MANAGE,
      PERMISSIONS.RBAC_MANAGE,
    ]) {
      expect(held).not.toContain(key);
    }

    // Portal keys are the customer's, and a staff account holding one would be read
    // cross-tenant, because scoping keys off the legacy tier rather than the permission.
    expect([...held].filter((key) => key.startsWith('portal.'))).toEqual([]);
  });

  /**
   * The guarantee the whole default table exists for: no legacy tier may resolve to an
   * empty role set, because effective permissions come from `roles` alone and an account
   * written without one is refused at every guard.
   */
  it('gives every legacy tier a non-empty default role', async () => {
    await Role.deleteMany({ isSystem: true });
    await seedRbac();

    for (const legacyRole of USER_ROLES) {
      const defaults = await resolveDefaultRoleIds(legacyRole);
      expect(defaults, `no default system role for '${legacyRole}'`).toHaveLength(1);

      const role = await Role.findById(defaults[0]).select('permissions');
      expect(role?.permissions.length, `'${legacyRole}' default grants nothing`).toBeGreaterThan(0);
    }
  });
});

/**
 * The convergence path for a database seeded while the TECHNICIAN default still carried
 * `employee.view`.
 *
 * `seedRbac` is prune-only for non-superuser system roles by design, so NARROWING the shared
 * default does nothing whatsoever to a TECHNICIAN document that already exists — the key
 * stays granted, and every technician keeps reading the staff directory. Every environment
 * already running is in that state; this migration is how they converge.
 */
describe('convergeTechnicianPermissions', () => {
  /** A TECHNICIAN role as an older database left it: holding the key that is now withdrawn. */
  async function seedLegacyTechnicianRole(): Promise<void> {
    await Role.deleteMany({ isSystem: true });
    await seedRbac();
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.TECHNICIAN },
      {
        $pull: { permissions: { $in: [PERMISSIONS.PLANNED_WORK_CHANGE_STATUS] } },
      },
    );
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.TECHNICIAN },
      { $addToSet: { permissions: PERMISSIONS.EMPLOYEE_VIEW } },
    );
  }

  it('withdraws employee.view and grants the app key a role document predates', async () => {
    await seedLegacyTechnicianRole();

    // The premise: a reseed does NOT fix this, which is why the script exists.
    await seedRbac();
    const beforeMigration = await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN });
    expect(beforeMigration?.permissions).toContain(PERMISSIONS.EMPLOYEE_VIEW);
    expect(beforeMigration?.permissions).not.toContain(PERMISSIONS.PLANNED_WORK_CHANGE_STATUS);

    const result = await convergeTechnicianPermissions();

    expect(result.roleFound).toBe(true);
    expect(result.revoked).toEqual([PERMISSIONS.EMPLOYEE_VIEW]);
    expect(result.granted).toEqual([PERMISSIONS.PLANNED_WORK_CHANGE_STATUS]);

    const role = await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN });
    expect(role?.permissions).not.toContain(PERMISSIONS.EMPLOYEE_VIEW);
    expect(role?.permissions).toContain(PERMISSIONS.PLANNED_WORK_CHANGE_STATUS);
    // Nothing else moves: the keys the role already held are untouched, and nothing that
    // was deliberately withheld is granted along the way.
    expect(role?.permissions).toContain(PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT);
    expect(role?.permissions).not.toContain(PERMISSIONS.PLANNED_WORK_APPROVE_REPORT);
  });

  it('is a no-op on a second run', async () => {
    await seedLegacyTechnicianRole();

    await convergeTechnicianPermissions();
    const second = await convergeTechnicianPermissions();

    expect(second.granted).toEqual([]);
    expect(second.revoked).toEqual([]);
    expect(second.alreadyHeld).toEqual([PERMISSIONS.PLANNED_WORK_CHANGE_STATUS]);
    expect(second.alreadyAbsent).toEqual([PERMISSIONS.EMPLOYEE_VIEW]);

    const role = await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN });
    const occurrences = role?.permissions.filter(
      (key) => key === PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
    );
    expect(occurrences).toHaveLength(1);
  });

  it('writes nothing on a dry run', async () => {
    await seedLegacyTechnicianRole();

    const result = await convergeTechnicianPermissions({ dryRun: true });

    expect(result.revoked).toEqual([PERMISSIONS.EMPLOYEE_VIEW]);
    expect(result.granted).toEqual([PERMISSIONS.PLANNED_WORK_CHANGE_STATUS]);

    const role = await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN });
    expect(role?.permissions).toContain(PERMISSIONS.EMPLOYEE_VIEW);
    expect(role?.permissions).not.toContain(PERMISSIONS.PLANNED_WORK_CHANGE_STATUS);
  });

  it('touches no role other than TECHNICIAN', async () => {
    await seedLegacyTechnicianRole();
    // A deliberate administrator customisation elsewhere, which prune-only seeding exists
    // to protect. The migration must not disturb it either.
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.DISPATCH },
      { $set: { permissions: [PERMISSIONS.DASHBOARD_VIEW] } },
    );

    await convergeTechnicianPermissions();

    const dispatch = await Role.findOne({ key: SYSTEM_ROLE_KEYS.DISPATCH });
    expect(dispatch?.permissions).toEqual([PERMISSIONS.DASHBOARD_VIEW]);
  });

  /**
   * Pulling the key off TECHNICIAN closes nothing if a second role puts it back. The
   * migration will not edit somebody's custom role for them, so it has to say so out loud.
   */
  it('reports a custom role that still grants the withdrawn key, and leaves it alone', async () => {
    await seedLegacyTechnicianRole();
    const custom = await Role.create({
      key: 'TEAM_LEAD_TEST',
      name: 'Ахлах ажилтан',
      description: null,
      permissions: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.EMPLOYEE_VIEW],
      isSystem: false,
    });

    const result = await convergeTechnicianPermissions();

    const reported = result.otherRolesGrantingWithdrawn.find(
      (entry) => entry.key === 'TEAM_LEAD_TEST',
    );
    expect(reported).toBeDefined();
    expect(reported?.grants).toEqual([PERMISSIONS.EMPLOYEE_VIEW]);

    const untouched = await Role.findById(custom._id);
    expect(untouched?.permissions).toContain(PERMISSIONS.EMPLOYEE_VIEW);

    await Role.deleteOne({ _id: custom._id });
  });

  /**
   * The remediation list. A technician-tier account reaching the directory through a second
   * role is exactly the case the role edit cannot fix, and stripping the role from the
   * account is the remote-lockout hazard the chokepoint exists to govern — so it is
   * reported, never written.
   */
  it('reports technician-tier accounts that still reach the directory, without touching them', async () => {
    await seedLegacyTechnicianRole();
    const custom = await Role.create({
      key: 'TEAM_LEAD_TEST_2',
      name: 'Ахлах ажилтан 2',
      description: null,
      permissions: [PERMISSIONS.EMPLOYEE_VIEW],
      isSystem: false,
    });
    const user = await User.create({
      fullName: 'Ахлагч',
      email: 'lead@test.mn',
      password: 'irrelevant-hash',
      role: 'technician',
      roles: [custom._id],
      status: 'active',
      passwordChangedAt: new Date(),
    });

    const result = await convergeTechnicianPermissions();

    const flagged = result.accountsNeedingReview.find((entry) => entry.email === 'lead@test.mn');
    expect(flagged).toBeDefined();
    expect(flagged?.viaRoles).toEqual(['TEAM_LEAD_TEST_2']);

    // Reported only. The account keeps every role it had.
    expect((await User.findById(user._id))?.roles.map(String)).toEqual([String(custom._id)]);

    await Role.deleteOne({ _id: custom._id });
  });

  it('reports rather than throws when the database has no TECHNICIAN role yet', async () => {
    await Role.deleteMany({ key: SYSTEM_ROLE_KEYS.TECHNICIAN });

    const result = await convergeTechnicianPermissions();

    expect(result.roleFound).toBe(false);
    expect(result.granted).toEqual([]);
    expect(result.revoked).toEqual([]);

    // Left as the suites after this one expect to find it.
    await seedRbac();
  });
});
