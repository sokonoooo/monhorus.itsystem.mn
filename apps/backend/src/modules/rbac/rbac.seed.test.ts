import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  SYSTEM_ROLE_DEFAULT_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  USER_ROLES,
} from '@monhorus/shared';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { convergeSystemRolePermissions } from '../../scripts/converge-system-role-permissions';
import { convergeTechnicianPermissions } from '../../scripts/converge-technician-permissions';
import { AuditLog } from '../audit/audit-log.model';
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
 * `employee.view` and did not yet carry the keys the mobile app needs.
 *
 * `seedRbac` is prune-only for non-superuser system roles by design, so neither NARROWING
 * nor WIDENING the shared default reaches a TECHNICIAN document that already exists: the
 * withdrawn key stays granted and every technician keeps reading the staff directory, while
 * a newly added key never arrives and whatever it powers is silently dead. Every environment
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
        $pull: {
          permissions: {
            $in: [PERMISSIONS.PLANNED_WORK_CHANGE_STATUS, PERMISSIONS.SERVICE_REQUEST_CLAIM],
          },
        },
      },
    );
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.TECHNICIAN },
      { $addToSet: { permissions: PERMISSIONS.EMPLOYEE_VIEW } },
    );
  }

  it('withdraws employee.view and grants the app keys a role document predates', async () => {
    await seedLegacyTechnicianRole();

    // The premise: a reseed does NOT fix this, which is why the script exists.
    await seedRbac();
    const beforeMigration = await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN });
    expect(beforeMigration?.permissions).toContain(PERMISSIONS.EMPLOYEE_VIEW);
    expect(beforeMigration?.permissions).not.toContain(PERMISSIONS.PLANNED_WORK_CHANGE_STATUS);
    // The claim key is the second instance of the same failure: it is in the shipped
    // default and `POST /service-requests/:id/claim` is routed on it, but an existing role
    // document never receives it, so the app draws no "Өөртөө авах" button at all.
    expect(beforeMigration?.permissions).not.toContain(PERMISSIONS.SERVICE_REQUEST_CLAIM);

    const result = await convergeTechnicianPermissions();

    expect(result.roleFound).toBe(true);
    expect(result.revoked).toEqual([PERMISSIONS.EMPLOYEE_VIEW]);
    expect(result.granted).toEqual([
      PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
      PERMISSIONS.SERVICE_REQUEST_CLAIM,
    ]);

    const role = await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN });
    expect(role?.permissions).not.toContain(PERMISSIONS.EMPLOYEE_VIEW);
    expect(role?.permissions).toContain(PERMISSIONS.PLANNED_WORK_CHANGE_STATUS);
    expect(role?.permissions).toContain(PERMISSIONS.SERVICE_REQUEST_CLAIM);
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
    expect(second.alreadyHeld).toEqual([
      PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
      PERMISSIONS.SERVICE_REQUEST_CLAIM,
    ]);
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
    expect(result.granted).toEqual([
      PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
      PERMISSIONS.SERVICE_REQUEST_CLAIM,
    ]);

    const role = await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN });
    expect(role?.permissions).toContain(PERMISSIONS.EMPLOYEE_VIEW);
    expect(role?.permissions).not.toContain(PERMISSIONS.PLANNED_WORK_CHANGE_STATUS);
    expect(role?.permissions).not.toContain(PERMISSIONS.SERVICE_REQUEST_CLAIM);
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

/**
 * The general form of the same repair, across every system role at once.
 *
 * `seedRbac` being prune-only means a role document that already exists never receives a
 * default added after it was created, so a live database drifts a little further from the
 * shipped catalogue with each release and the only evidence is one boot-time warning. This
 * migration is how those databases converge — and the asymmetry it is built around is the
 * point of most of what is asserted here: granting a missing default restores the shipped
 * contract, while withdrawing an extra key may be undoing a deliberate administrator grant,
 * so the two halves are behind two different flags and the second is never implied by the
 * first.
 */
describe('convergeSystemRolePermissions', () => {
  /** Every system role exactly as the shipped defaults define it. */
  async function reseedFromDefaults(): Promise<void> {
    await Role.deleteMany({ isSystem: true });
    await seedRbac();
  }

  const ADMIN_DEFAULTS = SYSTEM_ROLE_DEFAULT_PERMISSIONS[SYSTEM_ROLE_KEYS.ADMIN];

  async function permissionsOf(key: string): Promise<string[]> {
    const role = await Role.findOne({ key });
    return role?.permissions ?? [];
  }

  it('grants a system role the defaults its document predates', async () => {
    await reseedFromDefaults();
    // The measured live drift on ADMIN: the account-provisioning and material keys were
    // added to the shipped default after the role document was created, so the role that
    // is supposed to run the back office cannot manage a single user.
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.ADMIN },
      {
        $pull: {
          permissions: {
            $in: [PERMISSIONS.USER_VIEW, PERMISSIONS.USER_MANAGE, PERMISSIONS.MATERIAL_VIEW],
          },
        },
      },
    );

    // The premise: a reseed does NOT fix this, which is why the script exists.
    await seedRbac();
    expect(await permissionsOf(SYSTEM_ROLE_KEYS.ADMIN)).not.toContain(PERMISSIONS.USER_MANAGE);

    const result = await convergeSystemRolePermissions({ apply: true });

    const admin = result.roles.find((entry) => entry.key === SYSTEM_ROLE_KEYS.ADMIN);
    expect(admin?.granted).toEqual([
      PERMISSIONS.USER_VIEW,
      PERMISSIONS.USER_MANAGE,
      PERMISSIONS.MATERIAL_VIEW,
    ]);
    expect(admin?.converged).toBe(true);
    expect(result.unconverged).toEqual([]);

    const held = await permissionsOf(SYSTEM_ROLE_KEYS.ADMIN);
    expect(new Set(held)).toEqual(new Set(ADMIN_DEFAULTS));
  });

  it('is a no-op on a second run', async () => {
    await reseedFromDefaults();
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.ADMIN },
      { $pull: { permissions: PERMISSIONS.USER_MANAGE } },
    );

    await convergeSystemRolePermissions({ apply: true });
    const second = await convergeSystemRolePermissions({ apply: true });

    expect(second.roles.every((entry) => entry.granted.length === 0)).toBe(true);
    expect(second.roles.every((entry) => entry.revoked.length === 0)).toBe(true);
    expect(
      (await permissionsOf(SYSTEM_ROLE_KEYS.ADMIN)).filter(
        (key) => key === PERMISSIONS.USER_MANAGE,
      ),
    ).toHaveLength(1);
  });

  /**
   * The asymmetry the whole script is built around. An extra key is indistinguishable from
   * here between drift and an administrator's deliberate grant from the access screen —
   * the exact edit `seedRbac` is prune-only in order to protect — so it is reported and
   * left alone until somebody explicitly asks for it to go.
   */
  it('reports an extra key without withdrawing it, and withdraws it only with revokeExtra', async () => {
    await reseedFromDefaults();
    // The measured live drift on TECHNICIAN: `report.view` was granted at some point and
    // was bypassing the work-scoping policy until that hole was closed elsewhere.
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.TECHNICIAN },
      { $addToSet: { permissions: PERMISSIONS.REPORT_VIEW } },
    );

    const kept = await convergeSystemRolePermissions({ apply: true });
    const technicianKept = kept.roles.find((entry) => entry.key === SYSTEM_ROLE_KEYS.TECHNICIAN);
    expect(technicianKept?.extra).toEqual([PERMISSIONS.REPORT_VIEW]);
    expect(technicianKept?.revoked).toEqual([]);
    expect(technicianKept?.extraKept).toEqual([PERMISSIONS.REPORT_VIEW]);
    // Still granted, and still counted as converged: holding more than the default is not
    // a failure to converge unless revocation was asked for.
    expect(await permissionsOf(SYSTEM_ROLE_KEYS.TECHNICIAN)).toContain(PERMISSIONS.REPORT_VIEW);
    expect(technicianKept?.converged).toBe(true);

    const withdrawn = await convergeSystemRolePermissions({ apply: true, revokeExtra: true });
    const technicianWithdrawn = withdrawn.roles.find(
      (entry) => entry.key === SYSTEM_ROLE_KEYS.TECHNICIAN,
    );
    expect(technicianWithdrawn?.revoked).toEqual([PERMISSIONS.REPORT_VIEW]);
    expect(technicianWithdrawn?.extraKept).toEqual([]);

    const held = await permissionsOf(SYSTEM_ROLE_KEYS.TECHNICIAN);
    expect(held).not.toContain(PERMISSIONS.REPORT_VIEW);
    expect(new Set(held)).toEqual(
      new Set(SYSTEM_ROLE_DEFAULT_PERMISSIONS[SYSTEM_ROLE_KEYS.TECHNICIAN]),
    );
  });

  it('writes nothing on a dry run, which is the default', async () => {
    await reseedFromDefaults();
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.ADMIN },
      {
        $pull: { permissions: PERMISSIONS.USER_MANAGE },
      },
    );
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.ADMIN },
      { $addToSet: { permissions: PERMISSIONS.RBAC_MANAGE } },
    );

    // No options at all: the safe mode has to be what you get for free.
    const result = await convergeSystemRolePermissions({ revokeExtra: true });
    expect(result.dryRun).toBe(true);

    const admin = result.roles.find((entry) => entry.key === SYSTEM_ROLE_KEYS.ADMIN);
    // The diff is still computed in full — that is the point of a dry run.
    expect(admin?.granted).toEqual([PERMISSIONS.USER_MANAGE]);
    expect(admin?.revoked).toEqual([PERMISSIONS.RBAC_MANAGE]);
    // ...and reported as unconverged, so the exit code of a dry run cannot be mistaken for
    // the exit code of a run that actually fixed something.
    expect(result.unconverged).toContain(SYSTEM_ROLE_KEYS.ADMIN);

    const held = await permissionsOf(SYSTEM_ROLE_KEYS.ADMIN);
    expect(held).not.toContain(PERMISSIONS.USER_MANAGE);
    expect(held).toContain(PERMISSIONS.RBAC_MANAGE);
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it('never touches a custom role, which has no default to converge against', async () => {
    await reseedFromDefaults();
    const custom = await Role.create({
      key: 'TEAM_LEAD_CONVERGE_TEST',
      name: 'Ахлах ажилтан',
      description: null,
      // Both halves of the diff at once: keys no system default contains, and none of the
      // keys the roles around it are about to be granted.
      permissions: [PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.EMPLOYEE_VIEW],
      isSystem: false,
    });

    await convergeSystemRolePermissions({ apply: true, revokeExtra: true });

    const untouched = await Role.findById(custom._id);
    expect(untouched?.permissions).toEqual([PERMISSIONS.DASHBOARD_VIEW, PERMISSIONS.EMPLOYEE_VIEW]);

    await Role.deleteOne({ _id: custom._id });
  });

  /**
   * `seedRbac` resynchronises SYSTEM_ADMIN to the whole catalogue on every boot, which is
   * stronger than anything done here and runs far more often. Two mechanisms writing the
   * same document with the same intent is how they end up disagreeing.
   */
  it('leaves SYSTEM_ADMIN to the seed', async () => {
    await reseedFromDefaults();

    const result = await convergeSystemRolePermissions({ apply: true, revokeExtra: true });

    const superuser = result.roles.find((entry) => entry.key === SYSTEM_ROLE_KEYS.SYSTEM_ADMIN);
    expect(superuser?.skipped).toBe('seed-managed');
    expect(superuser?.granted).toEqual([]);
    expect(superuser?.revoked).toEqual([]);
    expect(await permissionsOf(SYSTEM_ROLE_KEYS.SYSTEM_ADMIN)).toHaveLength(ALL_PERMISSIONS.length);
  });

  /**
   * A permission set that changed without anyone opening the access screen still has to be
   * explicable from the audit log alone, so the row matches the shape
   * `PATCH /rbac/roles/:roleId` writes and names the migration in `reason`.
   */
  it('writes one audit row per role it changes, and none for a role it does not', async () => {
    await reseedFromDefaults();
    await Role.updateOne(
      { key: SYSTEM_ROLE_KEYS.ADMIN },
      { $pull: { permissions: PERMISSIONS.USER_MANAGE } },
    );
    // The audit collection is emptied by `resetDomainCollections` before every test, and
    // nothing else on this path writes to it — it cannot be cleared here, because the model
    // blocks every delete to keep the trail immutable.

    await convergeSystemRolePermissions({ apply: true });

    const rows = await AuditLog.find({ entityType: 'Permission' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('Updated');
    expect(rows[0]?.reason).toContain('migrate:system-role-permissions');
    expect(rows[0]?.user).toBeNull();
    const oldValue = rows[0]?.oldValue as { permissions: string[] };
    const newValue = rows[0]?.newValue as { permissions: string[] };
    expect(oldValue.permissions).not.toContain(PERMISSIONS.USER_MANAGE);
    expect(newValue.permissions).toContain(PERMISSIONS.USER_MANAGE);
  });

  it('counts a system role missing from the database as unconverged rather than creating it', async () => {
    await reseedFromDefaults();
    await Role.deleteMany({ key: SYSTEM_ROLE_KEYS.SALES });

    const result = await convergeSystemRolePermissions({ apply: true });

    const sales = result.roles.find((entry) => entry.key === SYSTEM_ROLE_KEYS.SALES);
    expect(sales?.roleFound).toBe(false);
    expect(sales?.converged).toBe(false);
    expect(result.unconverged).toEqual([SYSTEM_ROLE_KEYS.SALES]);
    expect(await Role.countDocuments({ key: SYSTEM_ROLE_KEYS.SALES })).toBe(0);

    // Left as the suites after this one expect to find it.
    await seedRbac();
  });
});
