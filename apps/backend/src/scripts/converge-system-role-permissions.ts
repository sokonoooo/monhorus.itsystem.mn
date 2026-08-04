/**
 * Converges EVERY system role onto `SYSTEM_ROLE_DEFAULT_PERMISSIONS`.
 *
 * The general form of `converge-technician-permissions.ts`. That script repairs one role
 * against a hand-written closed list, because the drift it fixes is specific and the
 * reasoning for each key had to be written down one key at a time. This one takes the
 * shipped defaults themselves as the target and applies them to all eight roles, which is
 * the tool you want once the drift is no longer one role and one release deep.
 *
 * WHY DRIFT ACCUMULATES AT ALL
 *
 * `seedRbac` is prune-only for every system role except SYSTEM_ADMIN (rbac.service.ts).
 * It removes keys the catalogue no longer defines, logs a shortfall warning for defaults a
 * role does not hold, and never grants. That is deliberate: an administrator may have
 * trimmed a role on purpose, and a boot-time reconcile would silently undo the edit.
 * The consequence is that adding a key to `SYSTEM_ROLE_DEFAULT_PERMISSIONS` fixes databases
 * seeded FROM THAT MOMENT ON and does nothing whatsoever to a role document that already
 * exists — so every environment already running drifts a little further from the shipped
 * defaults with each release, and the only evidence is one warning line at boot.
 *
 * GRANTING IS THE SAFE HALF. REVOKING IS NOT. HENCE TWO FLAGS.
 *
 * A MISSING default is a shortfall the catalogue says should not exist: the key is in the
 * shipped contract for the role, the endpoints are routed and guarded on it, and the role
 * simply never received it. Granting it restores what the release intended, and the failure
 * mode of getting it wrong is a role that can do something its own definition says it may.
 *
 * An EXTRA key is not the mirror image of that. It is indistinguishable, from here, between
 * drift and a deliberate administrator grant made from the access screen — the exact edit
 * `seedRbac` is prune-only in order to protect. Withdrawing it silently is the failure mode
 * the seed refuses to risk, and a migration script has no more standing to take a privilege
 * away than the seed does. So `--revoke-extra` is a SEPARATE, explicit opt-in: without it,
 * extras are reported in full and left exactly where they are.
 *
 * And nothing at all is written without `--apply`. A dry run is the default because the
 * output of this script is meant to be read by a person before it is a change to a database.
 * The per-role diff has the same shape in both modes, so an operator can run it dry, run it
 * applied, and diff the two.
 *
 * WHAT IT WILL NOT DO
 *
 *   - It never touches a custom role. Only a role whose `key` appears in
 *     `SYSTEM_ROLE_DEFAULT_PERMISSIONS` is considered; a role an administrator built has no
 *     default to be converged against, and inventing one for it would be this script
 *     deciding what somebody else's role is for.
 *   - It never writes SYSTEM_ADMIN. `seedRbac` already resynchronises it to the whole
 *     catalogue on every boot, which is stronger than anything done here and runs more
 *     often. Converging it too would be two mechanisms writing the same document with the
 *     same intent, and the one that runs on every boot wins anyway.
 *   - It never writes `user.roles`. Which roles an account holds is governed by the
 *     assignment chokepoint in `role-assignment.service.ts`, and a migration is not the
 *     place for the remote-lockout hazard that guards.
 *   - It never invents a role document. A system role missing from the database means the
 *     database was never seeded, not that the role needs creating here; `seedRbac` creates
 *     it already converged on the next boot. It is reported, and counted as unconverged.
 *
 * Every `extra` reported is a LIVE key. `seedRbac` prunes anything the catalogue no longer
 * defines from every role on every boot, so a key that no longer exists cannot reach this
 * script's diff in a database that has booted since it was removed.
 *
 * AUDIT. Each role actually written gets one audit row, in the same shape the access screen
 * writes when a human edits a role through `PATCH /rbac/roles/:roleId`: entityType
 * `Permission`, action `Updated`, the full before and after permission arrays. There is no
 * actor, because there is no human on this path — the `reason` field names the migration
 * instead, so a permission set that changed without anyone touching the screen is still
 * explicable from the audit log alone.
 *
 * Idempotent: `$pull` and `$addToSet` both converge, so a second applied run reports zero
 * changes, writes nothing and files no audit row.
 *
 * Usage: npm run migrate:system-role-permissions --workspace @monhorus/backend
 *          -> DRY RUN. Prints the per-role diff, writes nothing.
 *        ... -- --apply
 *          -> Grants every missing default. Leaves extras alone.
 *        ... -- --apply --revoke-extra
 *          -> Also withdraws every key not in the role's shipped default.
 *
 * Exits non-zero if `--apply` was given and any role did not end up converged.
 */
import {
  SYSTEM_ROLE_DEFAULT_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  type PermissionKey,
  type SystemRoleKey,
} from '@monhorus/shared';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { recordAudit } from '../modules/audit/audit.service';
import { Role } from '../modules/rbac/role.model';

/** Named so the audit row and the log line cannot drift apart. */
const MIGRATION_REASON = 'migrate:system-role-permissions';

/** What happened, or would have happened, to one system role. */
export interface RoleConvergence {
  key: SystemRoleKey;
  /** False when no role document with this key exists. Nothing is created. */
  roleFound: boolean;
  /**
   * Skipped without being diffed, and why. Only SYSTEM_ADMIN, which `seedRbac` already
   * resynchronises to the full catalogue on every boot.
   */
  skipped: 'seed-managed' | null;
  /** Defaults the role does not hold. Granted unless this is a dry run. */
  missing: PermissionKey[];
  /** Keys the role holds that are not in its default. Withdrawn only with --revoke-extra. */
  extra: PermissionKey[];
  /** What this run wrote, or would have written, as a grant. */
  granted: PermissionKey[];
  /** What this run wrote, or would have written, as a revocation. Empty without the flag. */
  revoked: PermissionKey[];
  /** Extras deliberately left in place because --revoke-extra was not given. */
  extraKept: PermissionKey[];
  /**
   * Whether the role ends this run matching its default — allowing for extras when
   * revocation was not asked for. False for a role document that does not exist.
   */
  converged: boolean;
}

export interface SystemRoleConvergenceResult {
  /** False only when `--apply` was passed. Nothing is written on a dry run. */
  dryRun: boolean;
  revokeExtra: boolean;
  /** One entry per key in `SYSTEM_ROLE_DEFAULT_PERMISSIONS`, in declaration order. */
  roles: RoleConvergence[];
  /** Roles that did not converge. Non-empty means a non-zero exit when applying. */
  unconverged: SystemRoleKey[];
}

/**
 * Diffs every system role against its shipped default and, when asked, writes the result.
 *
 * Exported so the behaviour is asserted by a test rather than only observed by running it
 * against a real database.
 */
export async function convergeSystemRolePermissions(
  options: { apply?: boolean; revokeExtra?: boolean } = {},
): Promise<SystemRoleConvergenceResult> {
  const dryRun = !(options.apply ?? false);
  const revokeExtra = options.revokeExtra ?? false;

  const roles: RoleConvergence[] = [];

  for (const key of Object.keys(SYSTEM_ROLE_DEFAULT_PERMISSIONS) as SystemRoleKey[]) {
    roles.push(await convergeOne(key, { dryRun, revokeExtra }));
  }

  return {
    dryRun,
    revokeExtra,
    roles,
    unconverged: roles.filter((entry) => !entry.converged).map((entry) => entry.key),
  };
}

async function convergeOne(
  key: SystemRoleKey,
  options: { dryRun: boolean; revokeExtra: boolean },
): Promise<RoleConvergence> {
  const empty = {
    key,
    missing: [] as PermissionKey[],
    extra: [] as PermissionKey[],
    granted: [] as PermissionKey[],
    revoked: [] as PermissionKey[],
    extraKept: [] as PermissionKey[],
  };

  if (key === SYSTEM_ROLE_KEYS.SYSTEM_ADMIN) {
    // Not diffed at all. `seedRbac` rewrites this role to `ALL_PERMISSIONS` whenever it
    // finds it short or stale, on every boot, so any diff this script produced would be
    // undone — or worse, applied twice by two mechanisms with the same intent.
    return { ...empty, roleFound: true, skipped: 'seed-managed', converged: true };
  }

  // Looked up by key, which is exactly the set of roles that HAS a default. A custom role
  // cannot be reached from here, and there is nothing to reconcile it against if it could.
  const role = await Role.findOne({ key });
  if (!role) {
    return { ...empty, roleFound: false, skipped: null, converged: false };
  }

  const defaults = SYSTEM_ROLE_DEFAULT_PERMISSIONS[key];
  const held = new Set<PermissionKey>(role.permissions);
  const intended = new Set<PermissionKey>(defaults);

  // Ordered by the shipped default rather than by whatever order the document happens to
  // store, so two runs against two databases produce comparable output.
  const missing = defaults.filter((entry) => !held.has(entry));
  const extra = role.permissions.filter((entry) => !intended.has(entry));

  const granted = missing;
  const revoked = options.revokeExtra ? extra : [];
  const extraKept = options.revokeExtra ? [] : extra;

  if (!options.dryRun && (granted.length > 0 || revoked.length > 0)) {
    const before = [...role.permissions];

    // Two statements rather than one: Mongo refuses `$pull` and `$addToSet` on the same
    // path in a single update. Revocation goes first so that an interrupted run leaves the
    // role narrower than intended rather than wider.
    if (revoked.length > 0) {
      await Role.updateOne({ _id: role._id }, { $pull: { permissions: { $in: revoked } } });
    }
    if (granted.length > 0) {
      // `$addToSet` rather than a rewritten array: a concurrent edit from the access
      // screen loses nothing, and a repeat run is a no-op at the database level too.
      await Role.updateOne({ _id: role._id }, { $addToSet: { permissions: { $each: granted } } });
    }

    // Re-read rather than reconstruct, so the audit row records what the database actually
    // holds and not what this script believes it should.
    const after = await Role.findById(role._id).select('permissions').lean();

    await recordAudit({
      entityType: 'Permission',
      entityId: role._id,
      action: 'Updated',
      reason: `${MIGRATION_REASON}: ${key} converged to SYSTEM_ROLE_DEFAULT_PERMISSIONS`,
      oldValue: { permissions: before },
      newValue: { permissions: after?.permissions ?? [] },
    });
  }

  return {
    ...empty,
    roleFound: true,
    skipped: null,
    missing: [...missing],
    extra: [...extra],
    granted: [...granted],
    revoked: [...revoked],
    extraKept: [...extraKept],
    // A dry run converges nothing, by definition. Reporting otherwise would make the exit
    // code of a dry run mean something different from the exit code of an applied run.
    converged: options.dryRun
      ? missing.length === 0 && (options.revokeExtra ? extra.length === 0 : true)
      : true,
  };
}

/**
 * Prints the per-role diff.
 *
 * Identical in shape whether or not anything was written: the same fields, in the same
 * order, for the same roles, so `--apply` output diffs cleanly against the dry run that
 * preceded it and the only lines that move are the ones that describe the mode.
 */
function report(result: SystemRoleConvergenceResult): void {
  logger.info(
    { dryRun: result.dryRun, revokeExtra: result.revokeExtra, roles: result.roles.length },
    result.dryRun
      ? 'DRY RUN — diffing system roles against SYSTEM_ROLE_DEFAULT_PERMISSIONS. Nothing will be written.'
      : 'APPLYING — converging system roles onto SYSTEM_ROLE_DEFAULT_PERMISSIONS.',
  );

  for (const entry of result.roles) {
    if (entry.skipped === 'seed-managed') {
      logger.info(
        { role: entry.key, grant: [], revoke: [], extraKept: [] },
        `${entry.key}: skipped — seedRbac resynchronises it to the full catalogue on every boot`,
      );
      continue;
    }

    if (!entry.roleFound) {
      logger.warn(
        { role: entry.key, grant: [], revoke: [], extraKept: [] },
        `${entry.key}: no role document in this database. Boot the server once so seedRbac creates it.`,
      );
      continue;
    }

    logger.info(
      {
        role: entry.key,
        grant: entry.granted,
        revoke: entry.revoked,
        extraKept: entry.extraKept,
      },
      `${entry.key}: grant ${entry.granted.length}, revoke ${entry.revoked.length}, extra kept ${entry.extraKept.length}`,
    );
  }

  const totalGranted = result.roles.reduce((sum, entry) => sum + entry.granted.length, 0);
  const totalRevoked = result.roles.reduce((sum, entry) => sum + entry.revoked.length, 0);
  const totalKept = result.roles.reduce((sum, entry) => sum + entry.extraKept.length, 0);

  if (totalKept > 0) {
    // Said once, out loud, rather than left to be inferred from the per-role lines: this is
    // the half of the drift the script has deliberately not touched.
    logger.warn(
      { extraKept: totalKept },
      'Keys held beyond the shipped default were left in place. They may be deliberate administrator grants — review them, then re-run with --revoke-extra to withdraw them.',
    );
  }

  logger.info(
    {
      dryRun: result.dryRun,
      revokeExtra: result.revokeExtra,
      granted: totalGranted,
      revoked: totalRevoked,
      extraKept: totalKept,
      unconverged: result.unconverged,
    },
    result.dryRun
      ? 'Dry run complete: nothing written. Re-run with --apply to write this diff.'
      : 'System role permissions converged',
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const revokeExtra = process.argv.includes('--revoke-extra');

  if (revokeExtra && !apply) {
    // Not a refusal: seeing the revocations listed is precisely what a dry run is for.
    logger.info('--revoke-extra will list revocations; it writes only together with --apply.');
  }

  await connectDatabase();

  const result = await convergeSystemRolePermissions({ apply, revokeExtra });
  report(result);

  await disconnectDatabase();

  // Only an applied run can fail: a dry run that reports a shortfall has done its job.
  if (apply && result.unconverged.length > 0) {
    logger.error(
      { unconverged: result.unconverged },
      'Some system roles did not converge. See the per-role lines above.',
    );
    process.exit(1);
  }
}

// Only when run as a script. Importing this file from a test must not open a connection.
if (process.argv[1]?.includes('converge-system-role-permissions')) {
  main().catch((error: unknown) => {
    logger.error({ error }, 'System role permission migration failed');
    process.exit(1);
  });
}
