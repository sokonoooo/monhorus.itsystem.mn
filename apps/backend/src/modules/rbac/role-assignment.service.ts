import {
  PERMISSIONS,
  SYSTEM_ROLE_DEFAULT_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  permissionModuleOf,
  type AccountStatus,
  type PermissionKey,
  type UserRole,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { assertCanManageRole } from '../../middlewares/authorize.middleware';
import { recordAudit } from '../audit/audit.service';
import { User, type UserDocument } from '../user/user.model';
import {
  assertRolesExist,
  defaultPermissionsForTier,
  isProtectedRoleKey,
  resolveDefaultRoleIds,
  roleKeysOf,
  unionPermissionsOf,
} from './rbac.service';
import { Role } from './role.model';

/**
 * THE ROLE-MUTATION CHOKEPOINT.
 *
 * Every write to a user's `roles` array in the whole backend happens in this file, and
 * `role-assignment.invariant.test.ts` fails the build if a second one appears anywhere in
 * `src/`. That is not tidiness: `roles` is the ONLY input to
 * `resolveEffectivePermissions` for every account that is not the hardcoded `head_admin`
 * superuser, so a write to it is a grant of authority, and seven separate endpoints were
 * making that grant with seven different (and mostly absent) rules.
 *
 * What was actually reachable before this existed, each confirmed against a running
 * server rather than reasoned about:
 *
 *   - POST /api/v1/rbac/users/:userId/roles did `user.roles = roleIds; await user.save()`
 *     with no cap of any kind. An actor holding nothing but `rbac.manage` assigned
 *     SYSTEM_ADMIN to a victim AND TO ITSELF, and `/auth/me` then returned the entire
 *     catalogue on the next request. The same endpoint assigned the portal-only CUSTOMER
 *     role to a technician-tier account, which is an unfiltered cross-tenant reader (see
 *     the tier/role coherence section below), rewrote the head_admin's roles from an
 *     admin-tier session, and accepted `roleIds: []` to strip an account to nothing.
 *   - POST /users and the employee system-access screen each had a partial, separately
 *     maintained subset of the rules, and the portal ceiling existed only as a private
 *     function inside `employee-access.service.ts`, so `POST /users` never applied it.
 *
 * The rules below therefore live in ONE decision function that every caller must pass
 * through, and it always receives the full decision input: the actor's identity, tier,
 * effective permissions and own roles; the target's identity, tier and current roles; the
 * roles being requested; and the tier the account will hold when the operation completes.
 * There is deliberately no convenience overload that omits the actor — an unauthenticated
 * or actor-less role write is not a use case, it is the bug.
 *
 * Scripts that run outside a request (bootstrap, backfill, dev seed) are the documented
 * exception and are allowlisted by path in the invariant test: they have no actor because
 * they are the operator acting directly on the database, and they are not reachable over
 * the network.
 */

// -- The vocabulary a caller speaks -------------------------------------------

/**
 * What the caller is asking for. Spelled as a discriminated union rather than as
 * `roleIds?: string[]` because the three cases have genuinely different authority rules
 * and the difference between "no selection" and "an empty selection" is a security
 * decision, not a null check:
 *
 *   EXPLICIT with a non-empty list  — a grant. Needs `rbac.manage` and passes the cap.
 *   EXPLICIT with an empty list     — a STRIP. Needs `rbac.manage` too: narrowing is not
 *                                     an escalation, but it is a remote lockout, and it
 *                                     was reachable from the employee screen by a caller
 *                                     holding only `employee.manage_system_access`.
 *   TIER_DEFAULT                    — the tier's own default role. This is what staying
 *                                     silent grants at creation, so it is NOT behind
 *                                     `rbac.manage`; it is capped instead.
 *   UNCHANGED                       — leave the set exactly as it is. Used by edits that
 *                                     touch other fields, so they still pass through here
 *                                     and cannot quietly grow a role write later.
 */
export type RequestedRoles =
  | { kind: 'EXPLICIT'; roleIds: readonly string[] }
  | { kind: 'TIER_DEFAULT' }
  | { kind: 'UNCHANGED' };

/**
 * How a PROVISIONING endpoint reads its optional `roleIds` field.
 *
 * Both account-creation paths — `POST /users` and the employee access screen's CREATE_NEW —
 * ask for `roleIds` as an optional array, and both must read it identically or the two
 * screens grant different things for the same request body. The rule, stated once here:
 *
 *   absent  -> TIER_DEFAULT. The caller expressed no opinion, so the tier's own default
 *              applies. Without this an account is written with `roles: []`, which resolves
 *              to an EMPTY permission set and is refused by every guard — a provisioned
 *              account that cannot do anything at all.
 *   empty   -> TIER_DEFAULT as well, NOT a strip. The role picker submits the field whether
 *              or not anything is ticked, so an untouched picker sends `[]`, and there is
 *              nothing to strip on an account that does not exist yet. Reading it as an
 *              explicit selection would put the ordinary "create a technician" flow behind
 *              `rbac.manage` while preventing no escalation whatsoever.
 *   named   -> EXPLICIT. A hand-picked selection, and therefore role assignment: it needs
 *              `rbac.manage` and it is capped by the actor's delegation ceiling.
 *
 * Note the asymmetry with an EXISTING account, which is deliberate and lives at the call
 * sites rather than here: for an account that already has roles, an empty list is a STRIP
 * (the documented way an administrator parks a login), so those callers pass EXPLICIT.
 */
export function requestedRolesForNewAccount(
  roleIds: readonly string[] | undefined,
): RequestedRoles {
  return roleIds && roleIds.length > 0 ? { kind: 'EXPLICIT', roleIds } : { kind: 'TIER_DEFAULT' };
}

/**
 * The endpoint that asked for the change. Recorded on every audit row this service
 * writes, so a protected-role attempt can be traced to the route that made it rather than
 * only to the account it touched.
 */
export type RoleMutationSource =
  | 'POST /users'
  | 'PATCH /users/:userId'
  | 'POST /rbac/users/:userId/roles'
  | 'POST /employees/:employeeId/system-access [CREATE_NEW]'
  | 'POST /employees/:employeeId/system-access [LINK_EXISTING]'
  | 'PATCH /employees/:employeeId/system-access/roles';

/** Everything a new account is written with EXCEPT its roles, which this service decides. */
export interface NewAccountFields {
  fullName: string;
  email: string;
  /** Already hashed by the caller. A plaintext password must never reach this service. */
  password: string;
  phone: string | null;
  /** The coarse legacy tier. Tenant scoping keys off this and nothing else. */
  role: UserRole;
  customer?: Types.ObjectId | null;
  status: AccountStatus;
  passwordChangedAt: Date;
  createdBy: Types.ObjectId | null;
}

export interface RoleMutationContext {
  actor: AuthContext;
  meta: RequestMeta;
  source: RoleMutationSource;
  reason?: string | null;
}

export interface RoleAssignmentRequest extends RoleMutationContext {
  /** The account being changed, already loaded by the caller. */
  target: UserDocument;
  /**
   * The tier the account will hold once the WHOLE operation completes.
   *
   * Passed explicitly rather than read from `target.role`, because `PATCH /users/:userId`
   * mutates the tier on the in-memory document before saving, and a policy that inferred
   * the tier from a half-applied document would be deciding against a state that may never
   * be persisted.
   */
  targetTier: UserRole;
  requested: RequestedRoles;
}

export interface RoleAssignmentOutcome {
  before: string[];
  after: string[];
  changed: boolean;
}

// -- Errors -------------------------------------------------------------------

/**
 * The refusal every policy failure ends in, apart from the ones that were already
 * distinguishable before this service existed.
 *
 * Deliberately uniform and deliberately vague: "you may not do this", never "you may not
 * do this BECAUSE the role you named is the superuser role" or "...because you are two
 * permissions short". A probing caller must not be able to map the permission catalogue,
 * or discover which accounts are administrators, by reading refusal messages. The detail
 * goes to the audit log, which only `audit.view` can read.
 */
function forbidden(): never {
  throw AppError.forbidden(
    ERROR_CODES.INSUFFICIENT_PRIVILEGES,
    'Энэ үйлдлийг хийх эрх байхгүй байна.',
  );
}

// -- Protected-role detection --------------------------------------------------

/**
 * Whether this mutation touches PROTECTED authority, in either of the two forms the
 * codebase actually has.
 *
 * There is no HEAD_ADMIN role key here and none was invented. The same authority exists
 * twice, under two different mechanisms, and guarding only one of them guards nothing:
 *
 *   - SYSTEM_ADMIN is an RBAC role key whose seeded contract is the ENTIRE permission
 *     catalogue, resynchronised on every boot. Holding it is holding everything.
 *   - `head_admin` is a legacy tier in `USER_ROLES` and an unconditional superuser branch
 *     at the top of `resolveEffectivePermissions`, which returns `ALL_PERMISSIONS` for it
 *     without reading `roles` at all. An account at that tier is a superuser even with
 *     `roles: []`.
 *
 * So a mutation is protected when it assigns or removes a SYSTEM_ADMIN role, when the
 * account is ALREADY at the `head_admin` tier (its roles are still worth guarding, and
 * rewriting them is an attack on the top administrator), or when the account is being
 * moved TO that tier.
 */
async function classifyProtection(params: {
  currentRoleIds: readonly Types.ObjectId[];
  nextRoleIds: readonly Types.ObjectId[];
  currentTier: UserRole | null;
  nextTier: UserRole;
}): Promise<{ protectedMutation: boolean; addedProtected: string[]; removedProtected: string[] }> {
  const { currentRoleIds, nextRoleIds, currentTier, nextTier } = params;

  const currentIds = new Set(currentRoleIds.map(String));
  const nextIds = new Set(nextRoleIds.map(String));

  const added = [...nextIds].filter((id) => !currentIds.has(id)).map((id) => new Types.ObjectId(id));
  const removed = [...currentIds]
    .filter((id) => !nextIds.has(id))
    .map((id) => new Types.ObjectId(id));

  const addedProtected = (await roleKeysOf(added)).filter(isProtectedRoleKey);
  const removedProtected = (await roleKeysOf(removed)).filter(isProtectedRoleKey);

  const protectedMutation =
    addedProtected.length > 0 ||
    removedProtected.length > 0 ||
    currentTier === 'head_admin' ||
    nextTier === 'head_admin';

  return { protectedMutation, addedProtected, removedProtected };
}

/**
 * Writes the audit row for a protected attempt, allowed or refused.
 *
 * Both outcomes are recorded, and the refused one matters more: a refusal is the only
 * visible trace of somebody probing for the superuser role, and an attacker who is
 * stopped leaves no other evidence at all. `recordAudit` swallows its own failures by
 * design, so this can never turn a correct refusal into a 500 or a correct grant into one.
 */
async function auditProtectedAttempt(params: {
  context: RoleMutationContext;
  targetUserId: string | null;
  targetEmail: string;
  currentTier: UserRole | null;
  nextTier: UserRole;
  addedProtected: string[];
  removedProtected: string[];
  allowed: boolean;
}): Promise<void> {
  const { context, allowed } = params;

  await recordAudit({
    entityType: 'User',
    entityId: params.targetUserId,
    action: 'Updated',
    actor: {
      id: context.actor.userId,
      role: context.actor.role,
      label: context.actor.fullName,
    },
    meta: context.meta,
    reason: allowed
      ? `protected role assignment allowed (${context.source})`
      : `protected role assignment REFUSED (${context.source})`,
    oldValue: {
      targetEmail: params.targetEmail,
      tier: params.currentTier,
      removedProtectedRoles: params.removedProtected,
    },
    newValue: {
      tier: params.nextTier,
      addedProtectedRoles: params.addedProtected,
      actorHeldProtectedAuthority: context.actor.permissions.has(
        PERMISSIONS.RBAC_MANAGE_PROTECTED,
      ),
      allowed,
    },
  });
}

// -- The last administrator ----------------------------------------------------

/** An active account that can reach every corner of the system, by either mechanism. */
async function holdsProtectedRole(roleIds: readonly Types.ObjectId[]): Promise<boolean> {
  return (await roleKeysOf(roleIds)).some(isProtectedRoleKey);
}

/**
 * Refuses the change that would leave the installation with nobody able to administer it.
 *
 * There is no self-registration and no self-service recovery in this product, and the
 * bootstrap script refuses to run once a head_admin exists. So an installation that loses
 * its last administrator is not recoverable through any supported path — it needs direct
 * database surgery. Demoting the final administrator is therefore refused outright rather
 * than warned about, and the message says exactly why: this is an operational fact about
 * the installation, not a fact about the caller's privileges, so being specific leaks
 * nothing a caller with `rbac.manage_protected` does not already know.
 */
async function assertNotLastAdministrator(params: {
  targetId: Types.ObjectId;
  currentStatus: AccountStatus;
  currentTier: UserRole;
  currentRoleIds: readonly Types.ObjectId[];
  nextTier: UserRole;
  nextRoleIds: readonly Types.ObjectId[];
}): Promise<void> {
  const isAdministratorNow =
    params.currentStatus === 'active' &&
    (params.currentTier === 'head_admin' || (await holdsProtectedRole(params.currentRoleIds)));
  if (!isAdministratorNow) return;

  const staysAdministrator =
    params.nextTier === 'head_admin' || (await holdsProtectedRole(params.nextRoleIds));
  if (staysAdministrator) return;

  const protectedRoles = await Role.find({ key: SYSTEM_ROLE_KEYS.SYSTEM_ADMIN })
    .select('_id')
    .lean();

  const others = await User.countDocuments({
    _id: { $ne: params.targetId },
    status: 'active',
    $or: [
      { role: 'head_admin' },
      ...(protectedRoles.length > 0
        ? [{ roles: { $in: protectedRoles.map((role) => role._id) } }]
        : []),
    ],
  });

  if (others === 0) {
    throw AppError.conflict(
      ERROR_CODES.FORBIDDEN,
      'Системд сүүлчийн идэвхтэй ерөнхий админы эрхийг хасах боломжгүй.',
    );
  }
}

// -- Tier / role coherence -----------------------------------------------------

/**
 * The pairing rule, enforced in BOTH directions on the FINAL set, on every path.
 *
 * Tenant scoping keys off the LEGACY TIER and nothing else. `resolveCustomerScope`
 * branches on `auth.role === 'customer'`; every other tier resolves to `{ mode: 'STAFF' }`,
 * and `customerScopeFilter` returns `{}` for that — no filter at all. Consequences, one
 * per direction:
 *
 *   1. A NON-CUSTOMER tier holding `portal.*` keys passes every portal guard and is then
 *      confined by nothing. It reads every organisation's projects, buildings, floors and
 *      service requests, and it does not even need a customer link to do it. This was
 *      reachable as head_admin through `POST /users` with
 *      `{ role: 'technician', roleIds: [CUSTOMER] }`, because the ceiling that stops it
 *      lived only inside the employee module.
 *   2. A CUSTOMER tier holding staff keys is the mirror image: the CUSTOMER role is
 *      defined as portal keys only precisely so that a customer is refused at the guard
 *      even where a scope predicate was missed, and an account is not allowed past it.
 *
 * The actor's own permission cap CANNOT catch case 1, which is why it is a rule of its
 * own: a head_admin holds every key including the portal ones, so a portal role is
 * trivially "within the actor's own set" and sails through.
 *
 * Case 1 reads the permissions the roles ACTUALLY carry rather than a static default,
 * because the grant is whatever the stored roles hold — a portal key added to a staff role
 * from the access screen builds the same unfiltered reader by a longer route. Case 2 caps
 * against the STATIC contract instead, so that widening the stored CUSTOMER role from the
 * access screen cannot widen what a customer account may hold.
 */
async function assertTierRoleCoherence(
  tier: UserRole,
  roleIds: readonly Types.ObjectId[],
): Promise<void> {
  const granted = await unionPermissionsOf(roleIds);

  if (tier !== 'customer') {
    /**
     * The superuser is exempt, and has to be, in both of the forms it takes.
     *
     * SYSTEM_ADMIN's contract is the ENTIRE permission catalogue — `seedRbac` resynchronises
     * it to `ALL_PERMISSIONS` on every boot — and the catalogue contains the `portal.*` keys.
     * So without this the rule below refuses SYSTEM_ADMIN to EVERY account, which is not a
     * hardening: it makes the role unassignable, and it breaks the documented
     * `head_admin -> SYSTEM_ADMIN` tier default outright, so `POST /users` could no longer
     * create a top-level administrator at all. The `head_admin` tier is exempt for the
     * matching reason: `resolveEffectivePermissions` returns `ALL_PERMISSIONS` for it
     * WITHOUT READING `roles`, so it holds the portal keys whatever this rule decides, and
     * refusing them here would forbid a state the account is already in.
     *
     * Nothing is given away by the exemption. The rule exists because `portal.*` keys look
     * scoped and are not scoped for a staff tier, which turns an otherwise ordinary account
     * into an unfiltered cross-tenant reader. An account holding the whole catalogue is not
     * an ordinary account: it already reads every tenant through the staff endpoints, so the
     * portal ones add no reach. And this is the single most heavily gated grant in the
     * system — it is protected in the sense of `rbac.manage_protected`, which the caller has
     * had to satisfy several steps above before reaching here.
     */
    const isSuperuserGrant =
      tier === 'head_admin' || (await roleKeysOf(roleIds)).some(isProtectedRoleKey);
    if (isSuperuserGrant) return;

    const portalKeys = [...granted].filter((key) => permissionModuleOf(key) === 'portal');
    if (portalKeys.length > 0) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Ажилтны бүртгэлд харилцагчийн эрх олгох боломжгүй.',
        [
          {
            field: 'roleIds',
            message: 'Харилцагчийн эрхийг зөвхөн харилцагчийн бүртгэлд олгоно.',
          },
        ],
      );
    }
    return;
  }

  const contract = new Set<PermissionKey>(
    SYSTEM_ROLE_DEFAULT_PERMISSIONS[SYSTEM_ROLE_KEYS.CUSTOMER],
  );
  const beyondPortal = [...granted].filter((key) => !contract.has(key));
  if (beyondPortal.length > 0) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Харилцагчийн бүртгэлд зөвхөн харилцагчийн эрх олгоно.',
      [{ field: 'roleIds', message: 'Харилцагчид ажилтны эрх олгох боломжгүй.' }],
    );
  }
}

// -- The delegation ceiling ----------------------------------------------------

/**
 * An actor may only hand out what it is authorised to delegate. `rbac.manage` is the key
 * that lets you assign roles AT ALL; it is emphatically not a licence to assign any role.
 *
 * For a HAND-PICKED selection the ceiling is the actor's own effective permissions plus
 * whatever the target tier's default role already carries. The default is included
 * because the actor can grant exactly that by staying silent — refusing it when they name
 * it explicitly would be theatre — and it is what lets an admin who holds no portal key
 * deliberately choose CUSTOMER for a customer account.
 */
async function assertWithinExplicitCeiling(params: {
  actorPermissions: ReadonlySet<PermissionKey>;
  targetTier: UserRole;
  requestedRoleIds: readonly Types.ObjectId[];
}): Promise<void> {
  const requested = await unionPermissionsOf(params.requestedRoleIds);
  const grantable = await defaultPermissionsForTier(params.targetTier);
  for (const permission of params.actorPermissions) {
    grantable.add(permission);
  }

  const beyond = [...requested].filter((key) => !grantable.has(key));
  if (beyond.length > 0) {
    forbidden();
  }
}

/**
 * The ceiling for the TIER DEFAULT ON AN ACCOUNT THAT ALREADY EXISTS, which is a different
 * question from a hand-picked selection and gets a different answer.
 *
 * `PATCH /users/:userId` re-maps an account's roles when its tier changes, so that "what
 * tier is this account" and "what may it do" cannot drift apart. That re-map is itself a
 * GRANT, and the router in front of it mounts only `authorize('admin', 'head_admin')` — a
 * coarse tier check that asks for no permission whatsoever — so without a rule here an
 * admin-tier account holding nothing but `dashboard.view` could flip a customer to
 * `technician` and hand out the entire TECHNICIAN set.
 *
 * The default is NOT put behind `rbac.manage`. Demanding it would mean an ordinary admin
 * could create a technician from scratch but not correct the tier of one that exists — and
 * would then be left changing the tier while the roles stayed behind, which is exactly the
 * disagreement the re-map exists to prevent.
 *
 * What is enforced instead: the actor either holds `rbac.manage` — the system's own
 * authority for assigning roles — or already holds everything the default carries, so the
 * change gives away nothing they do not have.
 *
 * WHY PROVISIONING IS NOT CAPPED THE SAME WAY, which is a real asymmetry and not an
 * oversight. Creating an account is already gated by the tier rules: the router admits only
 * `admin` and `head_admin`, and `assertCanManageRole` decides which tiers each may mint. The
 * tier's default IS what that tier means, so an actor entitled to create a technician is by
 * definition entitled to create a working one; capping it against the actor's own permission
 * set would leave a plain admin able to create only accounts weaker than itself, i.e. unable
 * to provision a technician at all, which is the ordinary back-office workflow. A tier change
 * is a different act — the account and its authority already exist, and the actor is
 * REDIRECTING authority rather than establishing it — so it is capped and provisioning is
 * not. Both behaviours are pinned by tests in `user.api.test.ts`.
 *
 * Worth recording plainly, because it bounds what this ceiling claims: provisioning does
 * therefore let an actor bring into existence an account stronger than itself, and
 * `POST /users` hands the creator the temporary passcode. That is pre-existing, deliberate
 * product behaviour bounded by the tier rules, not something this service loosened; closing
 * it would mean changing what creating an account requires, which is a product decision
 * rather than a policy one.
 *
 * The CUSTOMER contract is the one carve-out within the capped path. No staff role holds a
 * portal key, by design, so capping against the actor's own set would make moving an account
 * to the customer tier impossible for anyone but a superuser. A portal key confers no
 * authority over staff data: it only permits reading records that the customer scope
 * resolver confines to that account's own organisation, and the same actor can provision
 * such an account from scratch today. The STATIC contract is used rather than the stored
 * CUSTOMER role, so widening CUSTOMER from the access screen cannot widen this too.
 */
async function assertWithinTierDefaultCeiling(params: {
  actorPermissions: ReadonlySet<PermissionKey>;
  defaultRoleIds: readonly Types.ObjectId[];
}): Promise<void> {
  if (params.actorPermissions.has(PERMISSIONS.RBAC_MANAGE)) return;

  const granted = await unionPermissionsOf(params.defaultRoleIds);
  const portalContract = new Set<PermissionKey>(
    SYSTEM_ROLE_DEFAULT_PERMISSIONS[SYSTEM_ROLE_KEYS.CUSTOMER],
  );

  const beyond = [...granted].filter(
    (key) => !params.actorPermissions.has(key) && !portalContract.has(key),
  );
  if (beyond.length > 0) {
    forbidden();
  }
}

// -- The decision --------------------------------------------------------------

interface DecisionInput {
  actor: AuthContext;
  /** Null when the account does not exist yet. */
  targetUserId: string | null;
  targetEmail: string;
  /** Null when the account does not exist yet. */
  currentTier: UserRole | null;
  currentStatus: AccountStatus | null;
  currentRoleIds: readonly Types.ObjectId[];
  nextTier: UserRole;
  requested: RequestedRoles;
  context: RoleMutationContext;
}

/**
 * Decides the role set, or throws. Writes nothing.
 *
 * The order of the checks is part of the policy, not an accident:
 *
 *   1. Self-target, first, so that no other rule can be argued around on the way to it.
 *   2. Resolve what is actually being asked for.
 *   3. No-op short circuit, so an edit that does not touch roles is not gated by role
 *      rules and an unrelated `PATCH` does not need `rbac.manage`.
 *   4. Tier authority (`assertCanManageRole`) on both the current and the next tier.
 *   5. PROTECTED, before the ordinary authority gate, so that the audit row for a
 *      protected attempt is written even when the caller would have been refused by the
 *      cheaper check underneath it. An attempt that never reaches the protected branch is
 *      an attempt that leaves no trace.
 *   6. Ordinary authority: `rbac.manage` for a hand-picked set or a strip.
 *   7. The delegation ceiling.
 *   8. Tier/role coherence, both directions.
 *   9. The last-administrator rule, last, because it is the only check that queries other
 *      accounts and it should not run for a request that was going to be refused anyway.
 */
async function decideRoleSet(input: DecisionInput): Promise<Types.ObjectId[]> {
  const { actor, requested, context } = input;

  // 1. SELF-MODIFICATION.
  //
  // An actor may never increase its own authority by any route. The exploit that made
  // this a hard rule was direct: an actor with only `rbac.manage` POSTed SYSTEM_ADMIN to
  // its OWN user id and held all 64 permissions on the next request.
  //
  // Refused outright rather than "refused unless it is a demotion". Every existing
  // product flow that touches an account's roles is administrative and already refuses a
  // self target — `updateUser`, `resetPasscode`, `updateUserStatus` and every employee
  // system-access action all raise SELF_ACTION_FORBIDDEN — and there is no self-demotion
  // screen in either client. A "you may only narrow yourself" carve-out would need the
  // policy to compare permission sets it does not otherwise need to compare, and would be
  // exploitable the moment a role's own permissions changed underneath it. If such a flow
  // is ever built, it belongs here as an explicit, separately named entry point with its
  // own test, not as a relaxation of this line.
  if (
    input.targetUserId !== null &&
    input.targetUserId === actor.userId &&
    requested.kind !== 'UNCHANGED'
  ) {
    throw AppError.forbidden(
      ERROR_CODES.SELF_ACTION_FORBIDDEN,
      'Өөрийн эрхээ өөрчлөх боломжгүй.',
    );
  }

  // 2. What is being asked for.
  const nextRoleIds =
    requested.kind === 'EXPLICIT'
      ? await assertRolesExist(requested.roleIds)
      : requested.kind === 'TIER_DEFAULT'
        ? await resolveDefaultRoleIds(input.nextTier)
        : [...input.currentRoleIds];

  // 3. A change that changes nothing is not a grant. Order is ignored: the set is what
  //    matters, and two callers may legitimately send the same roles in a different order.
  const currentKey = [...input.currentRoleIds].map(String).sort().join(',');
  const nextKey = [...nextRoleIds].map(String).sort().join(',');
  const tierChanged = input.currentTier !== null && input.currentTier !== input.nextTier;
  if (currentKey === nextKey && !tierChanged && input.currentTier !== null) {
    return nextRoleIds;
  }

  // 4. Tier authority. Applied to the tier the account has AND the tier it would gain, so
  //    a plain admin can neither act on an administrator nor mint one. The callers apply
  //    this too; it is repeated here because this service is the boundary and a future
  //    caller that forgets must still be refused.
  if (input.currentTier !== null) {
    assertCanManageRole(actor.role, input.currentTier);
  }
  assertCanManageRole(actor.role, input.nextTier);

  // 5. PROTECTED.
  const protection = await classifyProtection({
    currentRoleIds: input.currentRoleIds,
    nextRoleIds,
    currentTier: input.currentTier,
    nextTier: input.nextTier,
  });

  if (protection.protectedMutation) {
    const allowed = actor.permissions.has(PERMISSIONS.RBAC_MANAGE_PROTECTED);

    await auditProtectedAttempt({
      context,
      targetUserId: input.targetUserId,
      targetEmail: input.targetEmail,
      currentTier: input.currentTier,
      nextTier: input.nextTier,
      addedProtected: protection.addedProtected,
      removedProtected: protection.removedProtected,
      allowed,
    });

    if (!allowed) {
      forbidden();
    }
  }

  // 6. Ordinary authority for a hand-picked set.
  //
  // An EXPLICIT selection is role assignment, and role assignment answers to
  // `rbac.manage`. An EXPLICIT EMPTY selection — a strip — needs it too. Stripping can
  // never be an escalation, which is why it used to be ungated, but it IS a remote
  // lockout: a caller holding only `employee.manage_system_access` could reduce any
  // linked account, including an administrator's, to zero permissions from the employee
  // screen. Parking a login with no authority is a real workflow, so it is kept; it now
  // requires the key that governs what a login may do.
  if (requested.kind === 'EXPLICIT' && !actor.permissions.has(PERMISSIONS.RBAC_MANAGE)) {
    forbidden();
  }

  // 7. The delegation ceiling.
  if (requested.kind === 'EXPLICIT') {
    await assertWithinExplicitCeiling({
      actorPermissions: actor.permissions,
      targetTier: input.nextTier,
      requestedRoleIds: nextRoleIds,
    });
  } else if (requested.kind === 'TIER_DEFAULT' && input.currentTier !== null) {
    // Only for an account that ALREADY EXISTS, i.e. a tier change. Provisioning is governed
    // by the tier rules instead — see the function's own comment for why the two differ and
    // for what that leaves unclosed.
    await assertWithinTierDefaultCeiling({
      actorPermissions: actor.permissions,
      defaultRoleIds: nextRoleIds,
    });
  }

  // 8. Tier/role coherence, both directions, on the final set. Checked even for the tier
  //    default, which satisfies it by construction on a freshly seeded database but not
  //    necessarily after an administrator has edited the stored role.
  await assertTierRoleCoherence(input.nextTier, nextRoleIds);

  // 9. The last administrator.
  if (input.targetUserId !== null && input.currentTier !== null && input.currentStatus !== null) {
    await assertNotLastAdministrator({
      targetId: new Types.ObjectId(input.targetUserId),
      currentStatus: input.currentStatus,
      currentTier: input.currentTier,
      currentRoleIds: input.currentRoleIds,
      nextTier: input.nextTier,
      nextRoleIds,
    });
  }

  return nextRoleIds;
}

// -- The two public mutation entry points --------------------------------------

/**
 * Provisions an account, roles included, in one step.
 *
 * Account creation lives here rather than in `user.service` because the alternative is a
 * `User.create({ ..., roles })` in every module that can provision one, which is exactly
 * the pattern the chokepoint exists to remove — and the invariant test cannot tell a
 * capped `roles:` from an uncapped one at a call site it does not own.
 *
 * The decision runs to completion BEFORE the document is written, so a refused role
 * selection leaves no account behind at all, and an accepted one is never briefly
 * permissionless. Callers keep their own pre-flight checks (duplicate email, tenant link,
 * tier authority); those decide whether an account should exist, this decides what it may
 * do.
 */
export async function createAccountWithRoles(
  fields: NewAccountFields,
  requested: RequestedRoles,
  context: RoleMutationContext,
): Promise<UserDocument> {
  if (requested.kind === 'UNCHANGED') {
    // A new account has no roles to leave unchanged. Unreachable through the callers, and
    // an internal error rather than a forbidden: it is a programming mistake, not a
    // privilege decision.
    throw AppError.internal('UNCHANGED is not a valid role request for a new account.');
  }

  const roles = await decideRoleSet({
    actor: context.actor,
    targetUserId: null,
    targetEmail: fields.email,
    currentTier: null,
    currentStatus: null,
    currentRoleIds: [],
    nextTier: fields.role,
    requested,
    context,
  });

  return User.create({
    fullName: fields.fullName,
    email: fields.email,
    password: fields.password,
    phone: fields.phone,
    role: fields.role,
    roles,
    customer: fields.customer ?? null,
    status: fields.status,
    passwordChangedAt: fields.passwordChangedAt,
    createdBy: fields.createdBy,
  });
}

/**
 * Applies a role change to an account that already exists.
 *
 * Mutates `target.roles` in place and DOES NOT SAVE. That is deliberate: `PATCH
 * /users/:userId` changes the tier, the tenant link and the roles in one operation and
 * must persist them in a single `save()`, and a service that saved on its own behalf
 * would either write twice or leave a window in which the tier had moved and the roles
 * had not. Callers own the `save()`; every one of them performs it immediately after.
 *
 * A refusal throws before anything is assigned, so the in-memory document is left exactly
 * as the caller had it and an un-saved refusal cannot half-migrate an account.
 */
export async function applyRoleAssignment(
  request: RoleAssignmentRequest,
): Promise<RoleAssignmentOutcome> {
  const { target, targetTier, requested, ...context } = request;

  const before = target.roles.map((id) => String(id));

  const roles = await decideRoleSet({
    actor: context.actor,
    targetUserId: String(target._id),
    targetEmail: target.email,
    currentTier: target.role,
    currentStatus: target.status,
    currentRoleIds: target.roles,
    nextTier: targetTier,
    requested,
    context,
  });

  // THE ONLY WRITE TO `user.roles` IN THE BACKEND. See the invariant test.
  target.roles = roles;

  const after = roles.map((id) => String(id));
  return { before, after, changed: before.join(',') !== after.join(',') };
}
