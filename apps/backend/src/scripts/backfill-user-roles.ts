/**
 * Gives every permissionless account its legacy tier's default dynamic role.
 *
 * WHY THIS EXISTS
 *
 * Effective permissions are the union of the roles in `user.roles` — `resolveEffectivePermissions`
 * reads nothing else, with head_admin the single hardcoded exception. Accounts created
 * before POST /users learned to resolve a default were written with `roles: []`, which
 * means an EMPTY permission set and a 403 at every guard: they can sign in and then do
 * nothing. `seedRbac` does not help them, because it creates the role documents and assigns
 * them to nobody. Nothing else in the system ever repairs such an account, so it stays
 * locked out until an administrator remembers to call POST /rbac/users/:userId/roles by
 * hand for each one.
 *
 * WHAT IT DOES
 *
 * For every account holding no roles at all, assigns exactly what creation would assign
 * today: `resolveDefaultRoleIds(user.role)`, the one system role that matches the tier.
 * Nothing else is touched — not the tier, not the customer link, not the status — and no
 * account that already holds a role is modified, so this cannot overwrite a deliberate
 * assignment and is safe to run repeatedly.
 *
 * `head_admin` accounts are skipped. They are unconditional superusers in
 * `resolveEffectivePermissions`, so `roles: []` is not a lockout for them and writing
 * SYSTEM_ADMIN onto them would change nothing except the audit surface.
 *
 * Suspended and must_change_password accounts ARE backfilled: their status already gates
 * what they can do, and leaving them permissionless only defers this same repair to the
 * moment someone reactivates them.
 *
 * WHAT IT REFUSES TO DO
 *
 * It never hands out a role that is stronger than its own seeded contract. Before granting
 * a tier default, the stored role is compared against `SYSTEM_ROLE_DEFAULT_PERMISSIONS`; if
 * somebody has widened it — `rbac.manage` added to TECHNICIAN, say — every account on that
 * tier is reported instead of written, because a mass privilege grant performed by a
 * migration has no actor, no audit row and no way to review it. A role that has been
 * NARROWED is honoured as-is: that is the administrator customisation prune-only seeding
 * exists to protect.
 *
 * It also reports, without repairing, accounts whose `roles` point at role documents that
 * have since been deleted. Those accounts resolve to no permissions but do not look empty,
 * so the `$size: 0` filter cannot see them, and choosing what they should hold instead is a
 * human decision — see `findDanglingRoleReferences`.
 *
 * Usage: npm run backfill:user-roles --workspace @monhorus/backend
 *        npm run backfill:user-roles --workspace @monhorus/backend -- --dry-run
 */
import {
  SYSTEM_ROLE_DEFAULT_PERMISSIONS,
  type PermissionKey,
  type SystemRoleKey,
  type UserRole,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { Role } from '../modules/rbac/role.model';
import { resolveDefaultRoleIds, roleKeysOf, unionPermissionsOf } from '../modules/rbac/rbac.service';
import { User } from '../modules/user/user.model';

/** One account the backfill would change, or did. */
export interface BackfilledAccount {
  userId: string;
  email: string;
  legacyRole: UserRole;
  roleIds: string[];
}

/** An account the backfill deliberately refused to repair, and the reason. */
export interface AccountNeedingRemediation {
  userId: string;
  email: string;
  legacyRole: UserRole;
  reason: 'DANGEROUS_TIER_DEFAULT' | 'DANGLING_ROLE_REFERENCES';
  detail: string;
}

/** A tier whose default role has been edited into something wider than its contract. */
export interface DangerousTierDefault {
  legacyRole: UserRole;
  roleKey: string;
  /** Keys the stored role holds that the seeded default for that role does not. */
  excess: PermissionKey[];
}

export interface BackfillUserRolesResult {
  /** Accounts found holding no dynamic role at all, head_admin included. */
  scanned: number;
  /** head_admin rows left alone: already superusers, so `roles: []` locks nobody out. */
  skippedHeadAdmins: number;
  /** Accounts written (or that would be written, on a dry run). */
  backfilled: BackfilledAccount[];
  /** Per-tier counts, for the run report. */
  byTier: Partial<Record<UserRole, number>>;
  /**
   * Tier defaults that have been widened beyond their seeded contract. The backfill
   * refuses to hand these out — see `assertTierDefaultIsSafe`.
   */
  dangerousTierDefaults: DangerousTierDefault[];
  /** Accounts a human has to look at, because this script would not touch them safely. */
  needingRemediation: AccountNeedingRemediation[];
  dryRun: boolean;
}

/**
 * Whether a tier's stored default role is still narrower than or equal to its seeded
 * contract.
 *
 * WHY THE BACKFILL CHECKS THIS
 *
 * The whole script rests on "the tier default is the least this account should have". That
 * is only true while the role document still means what `SYSTEM_ROLE_DEFAULT_PERMISSIONS`
 * says it means. Roles are editable from the access screen: if somebody added `rbac.manage`
 * to TECHNICIAN, then handing that role to a hundred permissionless technician accounts
 * would be a mass privilege grant performed by a migration, silently, with no audit row and
 * no actor. Refusing and reporting is the only safe answer — the operator either narrows the
 * role or assigns roles by hand through the endpoint that records who did it.
 *
 * A role that is NARROWER than its default is fine and is not reported: an administrator
 * trimming a role is exactly the customisation prune-only seeding exists to protect.
 */
async function inspectTierDefault(
  legacyRole: UserRole,
): Promise<{ roleIds: Types.ObjectId[]; danger: DangerousTierDefault | null }> {
  // Throws when the RBAC seed has not run. Failing loudly is right: the alternative is
  // reporting a successful backfill that granted nothing.
  const roleIds = await resolveDefaultRoleIds(legacyRole);
  const [roleKey] = await roleKeysOf(roleIds);
  const stored = await unionPermissionsOf(roleIds);

  const contract = new Set<PermissionKey>(
    SYSTEM_ROLE_DEFAULT_PERMISSIONS[roleKey as SystemRoleKey] ?? [],
  );
  const excess = [...stored].filter((key) => !contract.has(key));

  return {
    roleIds,
    danger:
      excess.length > 0 ? { legacyRole, roleKey: roleKey ?? '(unknown)', excess } : null,
  };
}

/**
 * Assigns the tier default to every account holding no roles.
 *
 * Exported so the behaviour is asserted by a test rather than only by running it against a
 * real database.
 */
export async function backfillUserRoles(
  options: { dryRun?: boolean } = {},
): Promise<BackfillUserRolesResult> {
  const dryRun = options.dryRun ?? false;

  // Both spellings of "no roles": an empty array, and a document written before the field
  // existed at all.
  const candidates = await User.find({
    $or: [{ roles: { $size: 0 } }, { roles: { $exists: false } }],
  })
    .select('_id email role')
    .lean();

  const result: BackfillUserRolesResult = {
    scanned: candidates.length,
    skippedHeadAdmins: 0,
    backfilled: [],
    byTier: {},
    dangerousTierDefaults: [],
    needingRemediation: [],
    dryRun,
  };

  // One lookup per tier rather than per account: the default table is tiny and the role
  // documents do not move during the run.
  const defaultsByTier = new Map<UserRole, Types.ObjectId[] | null>();

  for (const candidate of candidates) {
    if (candidate.role === 'head_admin') {
      result.skippedHeadAdmins += 1;
      continue;
    }

    let roleIds = defaultsByTier.get(candidate.role);
    if (roleIds === undefined) {
      const inspected = await inspectTierDefault(candidate.role);
      if (inspected.danger) {
        result.dangerousTierDefaults.push(inspected.danger);
        roleIds = null;
      } else {
        roleIds = inspected.roleIds;
      }
      defaultsByTier.set(candidate.role, roleIds);
    }

    if (roleIds === null) {
      // The tier default carries more than its contract. Granting it here would be a
      // silent, unaudited privilege escalation performed by a migration.
      const danger = result.dangerousTierDefaults.find(
        (entry) => entry.legacyRole === candidate.role,
      );
      result.needingRemediation.push({
        userId: String(candidate._id),
        email: candidate.email,
        legacyRole: candidate.role,
        reason: 'DANGEROUS_TIER_DEFAULT',
        detail: `Role '${danger?.roleKey ?? '?'}' grants more than its seeded contract: ${(danger?.excess ?? []).join(', ')}. Narrow the role, or assign roles through POST /rbac/users/:userId/roles so the grant is audited.`,
      });
      continue;
    }

    if (!dryRun) {
      // Guarded on the account still being empty, so a role assigned by an administrator
      // while this runs is not overwritten.
      await User.updateOne(
        { _id: candidate._id, $or: [{ roles: { $size: 0 } }, { roles: { $exists: false } }] },
        { $set: { roles: roleIds } },
      );
    }

    result.backfilled.push({
      userId: String(candidate._id),
      email: candidate.email,
      legacyRole: candidate.role,
      roleIds: roleIds.map(String),
    });
    result.byTier[candidate.role] = (result.byTier[candidate.role] ?? 0) + 1;
  }

  result.needingRemediation.push(...(await findDanglingRoleReferences()));

  return result;
}

/**
 * Accounts whose `roles` array points at role documents that no longer exist.
 *
 * A deleted role leaves its holders with a non-empty `roles` array that resolves to nothing,
 * so `unionPermissionsOf` returns an empty set and the holder is refused at every guard —
 * the same lockout the backfill repairs, wearing a disguise that the `$size: 0` filter
 * cannot see.
 *
 * REPORTED, NEVER REPAIRED. Two reasons. Pruning the dead ids would leave the account with
 * whatever survived, which may be nothing, so the repair does not repair. Substituting the
 * tier default would mean deciding that an account someone deliberately gave a bespoke role
 * should now hold the standard one, which is a judgement with an owner, and that owner is
 * not a migration script.
 */
async function findDanglingRoleReferences(): Promise<AccountNeedingRemediation[]> {
  const holders = await User.find({ roles: { $exists: true, $not: { $size: 0 } } })
    .select('_id email role roles')
    .lean();
  if (holders.length === 0) return [];

  const referenced = [...new Set(holders.flatMap((user) => user.roles.map(String)))];
  const live = await Role.find({ _id: { $in: referenced } })
    .select('_id')
    .lean();
  const liveIds = new Set(live.map((role) => String(role._id)));

  const broken: AccountNeedingRemediation[] = [];
  for (const user of holders) {
    const dangling = user.roles.map(String).filter((id) => !liveIds.has(id));
    if (dangling.length === 0) continue;

    const allDead = dangling.length === user.roles.length;
    broken.push({
      userId: String(user._id),
      email: user.email,
      legacyRole: user.role,
      reason: 'DANGLING_ROLE_REFERENCES',
      detail: allDead
        ? `Every assigned role is missing (${dangling.join(', ')}), so this account resolves to NO permissions. Reassign roles through POST /rbac/users/:userId/roles.`
        : `Some assigned roles are missing (${dangling.join(', ')}). The account still works, but holds less than intended.`,
    });
  }

  return broken;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  await connectDatabase();

  const result = await backfillUserRoles({ dryRun });

  logger.info(
    {
      dryRun,
      scanned: result.scanned,
      skippedHeadAdmins: result.skippedHeadAdmins,
      backfilled: result.backfilled.length,
      byTier: result.byTier,
    },
    result.backfilled.length === 0
      ? 'No permissionless accounts found; nothing to backfill'
      : dryRun
        ? 'Dry run: no changes written'
        : 'Backfill complete',
  );

  // Listed individually as well as counted: an operator repairing access needs to be able
  // to see exactly whose permissions changed, and the list is bounded by how many accounts
  // were broken.
  for (const account of result.backfilled) {
    logger.info(
      { userId: account.userId, email: account.email, tier: account.legacyRole, roleIds: account.roleIds },
      dryRun ? 'Would grant tier default' : 'Granted tier default',
    );
  }

  // A widened tier default is a finding about the INSTALLATION, not about one account, so
  // it is reported once and loudly rather than repeated per affected row.
  for (const danger of result.dangerousTierDefaults) {
    logger.error(
      { tier: danger.legacyRole, roleKey: danger.roleKey, excess: danger.excess },
      'Tier default grants more than its seeded contract; accounts on this tier were NOT backfilled',
    );
  }

  for (const account of result.needingRemediation) {
    logger.warn(
      { userId: account.userId, email: account.email, tier: account.legacyRole, reason: account.reason },
      account.detail,
    );
  }

  if (result.needingRemediation.length === 0) {
    logger.info('No account needs manual remediation');
  }

  await disconnectDatabase();
}

// Only when run as a script. Importing this file from a test must not open a connection.
if (process.argv[1]?.includes('backfill-user-roles')) {
  main().catch((error: unknown) => {
    logger.error({ error }, 'User role backfill failed');
    process.exit(1);
  });
}
