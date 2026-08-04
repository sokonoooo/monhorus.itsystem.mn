/**
 * Converges the seeded TECHNICIAN role onto the permission set the employee mobile app
 * actually needs: WITHDRAWS `employee.view`, and adds `planned_work.change_status` and
 * `service_request.claim` if the role predates either.
 *
 * WHY A SCRIPT AND NOT THE SEED
 *
 * `seedRbac` is prune-only for every system role except SYSTEM_ADMIN, and that is by
 * design: an administrator may have trimmed a role deliberately, and a boot-time reconcile
 * would silently undo the edit. So editing `SYSTEM_ROLE_DEFAULT_PERMISSIONS.TECHNICIAN`
 * fixes a database seeded FROM NOW ON and does nothing at all for one whose TECHNICIAN
 * document already exists. Every environment already running is in that second state, which
 * is why the convergence is an explicit, audited, one-line-to-run migration.
 *
 * WHAT IT WITHDRAWS, AND WHY IT IS A REVOCATION THIS TIME
 *
 *   - `employee.view`. An earlier round of this same script GRANTED it, on the reasoning
 *     that the app had no other way to work out which employee was signed in. The
 *     consequence was live and confirmed: `GET /employees` returns the whole staff
 *     directory, so every technician in the field could read every colleague's registration
 *     number (Mongolian РД), phone and email. One real response carried
 *     "registrationNumber": "УЮ99081733".
 *
 *     The premise is now gone. `AuthContext.employeeId` resolves the user-to-employee link
 *     server-side on every request, and `GET /employees/me` returns the caller's own record
 *     on authentication alone, with no permission key at all. Colleague names on a job card
 *     come from the `EmployeeRefDto` embedded in the planned-work payload under
 *     `planned_work.view`. Nothing a technician does needs directory-wide read any more.
 *
 * WHAT IT STILL ADDS
 *
 *   - `planned_work.change_status`. START, PAUSE, RESUME, COMPLETE and PLAN all map to this
 *     one key in `PLANNED_WORK_ACTION_RULES`, so without it the Ажил tab's primary action
 *     is dead. It does NOT let a technician sign off their own conclusion: submitting is
 *     `planned_work.submit_report`, approving is `planned_work.approve_report`, cancelling
 *     is `planned_work.cancel` — none of which is granted here.
 *
 *   - `service_request.claim`. The same prune-only failure one release later, with the same
 *     symptom: the key is in the shipped TECHNICIAN default and
 *     `POST /service-requests/:id/claim` is routed and guarded on it, but a TECHNICIAN role
 *     document that predates the key never receives it, so on every upgraded database the
 *     "Өөртөө авах" button is drawn nowhere. The app reads the effective permission set to
 *     decide whether to draw it, so the failure is silent — no 403, no message, just an
 *     open queue the technician cannot take anything from. It is the narrowest key that
 *     could do the job: the endpoint takes no body and writes only the caller's own
 *     employee id onto a request that has none, so unlike `dispatch.assign` it cannot move
 *     a colleague's work.
 *
 * WHAT IT WILL NOT DO
 *
 *   - It never touches a role other than TECHNICIAN. A custom role an administrator built
 *     is reported when it grants a withdrawn key, and left exactly as it is: deciding that
 *     "Ахлах ажилтан" should keep directory access is a human judgement, and silently
 *     stripping it could take a working team lead offline.
 *   - It never writes `user.roles`. Removing a role from an account is the remote-lockout
 *     hazard the role-assignment chokepoint exists to govern, and a migration script is not
 *     the place for it. Accounts that still resolve a withdrawn key are REPORTED for manual
 *     remediation instead.
 *   - It never grants a key outside the closed `TECHNICIAN_APP_PERMISSIONS` list, so it
 *     cannot quietly widen the role beyond the few things the app cannot run without, and
 *     cannot put back something an administrator removed on purpose.
 *
 * ADDING TO THE LIST LATER. This file is the remedy for `seedRbac` being prune-only, so
 * every future addition to `SYSTEM_ROLE_DEFAULT_PERMISSIONS.TECHNICIAN` that the app cannot
 * function without belongs in `TECHNICIAN_APP_PERMISSIONS` as well — editing the default
 * alone fixes only databases seeded from that moment on. The alternative, making `seedRbac`
 * additive for system roles, is deliberately not taken: it would re-grant on every boot
 * whatever an administrator had removed on purpose, and there would be no way to remove
 * anything again.
 *
 * Idempotent: `$pull` and `$addToSet` both converge, so a second run reports zero changes
 * and writes nothing. Safe to run against a database in any state, including a fresh one.
 *
 * Usage: npm run migrate:technician-permissions --workspace @monhorus/backend
 *        npm run migrate:technician-permissions --workspace @monhorus/backend -- --dry-run
 */
import { PERMISSIONS, SYSTEM_ROLE_KEYS, type PermissionKey, type UserRole } from '@monhorus/shared';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { Role } from '../modules/rbac/role.model';
import { User } from '../modules/user/user.model';

/**
 * Keys this migration adds to TECHNICIAN. Deliberately a closed list rather than the
 * seeded defaults: re-applying the whole default set would resurrect anything an
 * administrator removed on purpose.
 */
export const TECHNICIAN_APP_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  PERMISSIONS.SERVICE_REQUEST_CLAIM,
];

/**
 * Keys this migration removes from TECHNICIAN, and looks for everywhere else.
 *
 * `employee.view` is directory-wide read of every colleague's personal data. Nothing a
 * field technician does requires it now that `GET /employees/me` exists.
 */
export const TECHNICIAN_WITHDRAWN_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.EMPLOYEE_VIEW,
];

/** A role other than TECHNICIAN that still grants a withdrawn key. Never modified. */
export interface RoleGrantingWithdrawn {
  roleId: string;
  key: string;
  name: string;
  isSystem: boolean;
  /** Which of the withdrawn keys this role grants. */
  grants: PermissionKey[];
}

/** A technician-tier account that still reaches a withdrawn key through some role. */
export interface AccountNeedingReview {
  userId: string;
  email: string;
  legacyRole: UserRole;
  /** The role keys responsible, so an operator knows what to edit. */
  viaRoles: string[];
}

export interface TechnicianConvergenceResult {
  /** False when no TECHNICIAN role exists yet; seeding creates it already converged. */
  roleFound: boolean;
  /** Keys added by this run. Empty on a second run. */
  granted: PermissionKey[];
  /** Keys removed by this run. Empty on a second run. */
  revoked: PermissionKey[];
  /** Keys from the add list the role already held. */
  alreadyHeld: PermissionKey[];
  /** Keys from the withdraw list the role already lacked. */
  alreadyAbsent: PermissionKey[];
  /** Dangerous definitions found elsewhere. Reported only — nothing is written. */
  otherRolesGrantingWithdrawn: RoleGrantingWithdrawn[];
  /** Accounts an operator must look at by hand. Reported only — nothing is written. */
  accountsNeedingReview: AccountNeedingReview[];
  dryRun: boolean;
}

/**
 * Converges TECHNICIAN and reports what the convergence could not reach.
 *
 * Exported so the behaviour is asserted by a test rather than only observed by running it
 * against a real database.
 */
export async function convergeTechnicianPermissions(
  options: { dryRun?: boolean } = {},
): Promise<TechnicianConvergenceResult> {
  const dryRun = options.dryRun ?? false;
  const role = await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN });

  if (!role) {
    return {
      roleFound: false,
      granted: [],
      revoked: [],
      alreadyHeld: [],
      alreadyAbsent: [],
      otherRolesGrantingWithdrawn: [],
      accountsNeedingReview: [],
      dryRun,
    };
  }

  const held = new Set<PermissionKey>(role.permissions);
  const granted = TECHNICIAN_APP_PERMISSIONS.filter((key) => !held.has(key));
  const alreadyHeld = TECHNICIAN_APP_PERMISSIONS.filter((key) => held.has(key));
  const revoked = TECHNICIAN_WITHDRAWN_PERMISSIONS.filter((key) => held.has(key));
  const alreadyAbsent = TECHNICIAN_WITHDRAWN_PERMISSIONS.filter((key) => !held.has(key));

  if (!dryRun) {
    // Two statements rather than one: Mongo refuses `$pull` and `$addToSet` on the same
    // path in a single update. Revocation goes first so that an interrupted run leaves the
    // role narrower than intended rather than wider.
    if (revoked.length > 0) {
      await Role.updateOne({ _id: role._id }, { $pull: { permissions: { $in: revoked } } });
    }
    if (granted.length > 0) {
      // `$addToSet` rather than a rewritten array: a concurrent edit from the access screen
      // loses nothing, and a repeat run is a no-op at the database level too.
      await Role.updateOne({ _id: role._id }, { $addToSet: { permissions: { $each: granted } } });
    }
  }

  const otherRolesGrantingWithdrawn = await findRolesGrantingWithdrawn(String(role._id));
  const accountsNeedingReview = await findAccountsNeedingReview(otherRolesGrantingWithdrawn);

  return {
    roleFound: true,
    granted: [...granted],
    revoked: [...revoked],
    alreadyHeld: [...alreadyHeld],
    alreadyAbsent: [...alreadyAbsent],
    otherRolesGrantingWithdrawn,
    accountsNeedingReview,
    dryRun,
  };
}

/**
 * Every role EXCEPT TECHNICIAN that grants one of the withdrawn keys.
 *
 * This is the detection half of the migration. Pulling `employee.view` off TECHNICIAN
 * closes nothing if an administrator built a "Ажилтан+" role carrying it, or if technicians
 * were handed MANAGEMENT as a second role. Those definitions are legitimate for the people
 * they were built for, so they are surfaced rather than edited.
 */
async function findRolesGrantingWithdrawn(
  technicianRoleId: string,
): Promise<RoleGrantingWithdrawn[]> {
  const roles = await Role.find({
    _id: { $ne: technicianRoleId },
    permissions: { $in: [...TECHNICIAN_WITHDRAWN_PERMISSIONS] },
  })
    .select('key name isSystem permissions')
    .lean();

  return roles.map((entry) => ({
    roleId: String(entry._id),
    key: entry.key,
    name: entry.name,
    isSystem: entry.isSystem,
    grants: TECHNICIAN_WITHDRAWN_PERMISSIONS.filter((key) => entry.permissions.includes(key)),
  }));
}

/**
 * Technician-tier accounts that still reach a withdrawn key through one of those roles.
 *
 * Scoped to the `technician` tier on purpose. An admin-tier account holding
 * `employee.view` is doing its job; a technician-tier one holding it is the leak this
 * migration exists to close, and is the list an operator has to work through by hand.
 */
async function findAccountsNeedingReview(
  offendingRoles: readonly RoleGrantingWithdrawn[],
): Promise<AccountNeedingReview[]> {
  if (offendingRoles.length === 0) return [];

  const keyById = new Map(offendingRoles.map((entry) => [entry.roleId, entry.key]));

  const users = await User.find({
    role: 'technician',
    roles: { $in: offendingRoles.map((entry) => entry.roleId) },
  })
    .select('email role roles')
    .lean();

  return users.map((user) => ({
    userId: String(user._id),
    email: user.email,
    legacyRole: user.role,
    viaRoles: user.roles.map(String).flatMap((id) => {
      const key = keyById.get(id);
      return key ? [key] : [];
    }),
  }));
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  await connectDatabase();

  const result = await convergeTechnicianPermissions({ dryRun });

  if (!result.roleFound) {
    logger.warn(
      { role: SYSTEM_ROLE_KEYS.TECHNICIAN },
      'No TECHNICIAN role in this database. Boot the server once so seedRbac creates it, which already excludes employee.view.',
    );
    await disconnectDatabase();
    return;
  }

  const changed = result.granted.length + result.revoked.length;

  logger.info(
    {
      dryRun,
      granted: result.granted,
      revoked: result.revoked,
      alreadyHeld: result.alreadyHeld,
      alreadyAbsent: result.alreadyAbsent,
    },
    changed === 0
      ? 'TECHNICIAN already matches the intended permission set; nothing to do'
      : dryRun
        ? 'Dry run: no changes written'
        : 'TECHNICIAN permissions converged',
  );

  // Reported one row at a time, not just counted: an operator closing this hole needs to
  // know exactly which definition to look at and who is affected by it.
  for (const entry of result.otherRolesGrantingWithdrawn) {
    logger.warn(
      { roleId: entry.roleId, roleKey: entry.key, roleName: entry.name, isSystem: entry.isSystem, grants: entry.grants },
      'Role still grants a withdrawn permission. Left untouched — review it in the access screen.',
    );
  }

  for (const account of result.accountsNeedingReview) {
    logger.warn(
      { userId: account.userId, email: account.email, tier: account.legacyRole, viaRoles: account.viaRoles },
      'Technician-tier account still reads the staff directory through another role. Manual remediation required.',
    );
  }

  if (result.accountsNeedingReview.length === 0 && result.otherRolesGrantingWithdrawn.length === 0) {
    logger.info('No other role or account reaches a withdrawn permission');
  }

  await disconnectDatabase();
}

// Only when run as a script. Importing this file from a test must not open a connection.
if (process.argv[1]?.includes('converge-technician-permissions')) {
  main().catch((error: unknown) => {
    logger.error({ error }, 'TECHNICIAN permission migration failed');
    process.exit(1);
  });
}
