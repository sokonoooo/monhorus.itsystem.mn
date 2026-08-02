import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_LABELS,
  SYSTEM_ROLE_DEFAULT_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLE_LABELS,
  permissionModuleOf,
  type PermissionKey,
  type RoleDto,
  type SystemRoleKey,
  type UserRole,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { logger } from '../../config/logger';
import { invalidateRecipientCache } from '../notification/notification.service';
import { User } from '../user/user.model';
import { Permission } from './permission.model';
import { Role, type IRole } from './role.model';

export function toRoleDto(role: IRole & { _id: Types.ObjectId }, userCount?: number): RoleDto {
  return {
    id: String(role._id),
    key: role.key,
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    isSystem: role.isSystem,
    ...(userCount === undefined ? {} : { userCount }),
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

/**
 * Idempotently materialises the shared permission catalogue and the system roles.
 *
 * Runs on every boot, and has to reconcile two competing requirements.
 *
 * An administrator may legitimately have customised a role's permission set, so the
 * seed must not overwrite it. But SYSTEM_ADMIN is DEFINED as every permission, and
 * without resynchronising it, adding a key to the catalogue would silently leave the
 * superuser role short of it. That is how the role ends up not being a superuser at all
 * after an upgrade, which is worse than losing a hypothetical edit to a role whose whole
 * point is to hold everything.
 *
 * The rules are therefore:
 *
 *   - SYSTEM_ADMIN is always resynchronised to the full catalogue.
 *   - The other system roles keep whatever they currently hold. A newly introduced
 *     permission is NOT granted to them automatically, because widening a role's
 *     authority on upgrade should be a deliberate administrator action. The shortfall is
 *     logged so an operator can see it and grant it from the access screen.
 *   - Every role has keys that no longer exist in the catalogue pruned, so a stale key
 *     cannot linger in a role document after the permission itself has been removed.
 */
export async function seedRbac(): Promise<void> {
  const permissionOps = ALL_PERMISSIONS.map((key) => ({
    updateOne: {
      filter: { key },
      update: { $set: { key, module: permissionModuleOf(key), label: PERMISSION_LABELS[key] } },
      upsert: true,
    },
  }));
  await Permission.bulkWrite(permissionOps, { ordered: false });

  // Remove permissions that no longer exist in the catalogue, so the admin picker
  // never offers a key the backend cannot enforce.
  await Permission.deleteMany({ key: { $nin: [...ALL_PERMISSIONS] } });

  // The same prune across every role, custom ones included. The system-role loop below
  // only covers the seeded keys, so without this an administrator-created role would keep
  // a key of a removed module: inert, because nothing checks it, but misrepresenting the
  // role's authority on the access screen.
  await Role.updateMany({}, { $pull: { permissions: { $nin: [...ALL_PERMISSIONS] } } });

  const catalogue = new Set<PermissionKey>(ALL_PERMISSIONS);

  let createdRoles = 0;
  let resyncedRoles = 0;
  const rolesMissingDefaults: Record<string, PermissionKey[]> = {};

  for (const key of Object.values(SYSTEM_ROLE_KEYS)) {
    const defaults = SYSTEM_ROLE_DEFAULT_PERMISSIONS[key as SystemRoleKey];
    const existing = await Role.findOne({ key });

    if (!existing) {
      await Role.create({
        key,
        name: SYSTEM_ROLE_LABELS[key as SystemRoleKey],
        description: null,
        permissions: [...defaults],
        isSystem: true,
      });
      createdRoles += 1;
      continue;
    }

    if (key === SYSTEM_ROLE_KEYS.SYSTEM_ADMIN) {
      // Its contract is "everything", so it is resynchronised rather than preserved.
      const missing = ALL_PERMISSIONS.filter((entry) => !existing.permissions.includes(entry));
      const stale = existing.permissions.filter((entry) => !catalogue.has(entry));
      if (missing.length > 0 || stale.length > 0) {
        existing.permissions = [...ALL_PERMISSIONS];
        await existing.save();
        resyncedRoles += 1;
        logger.info(
          { role: key, granted: missing.length, pruned: stale.length },
          'SYSTEM_ADMIN resynchronised to the full permission catalogue',
        );
      }
      continue;
    }

    // Prune only. A key the catalogue no longer defines cannot be enforced, so leaving it
    // on the role would misrepresent what the role can actually do.
    const pruned = existing.permissions.filter((entry) => catalogue.has(entry));
    if (pruned.length !== existing.permissions.length) {
      existing.permissions = pruned;
      await existing.save();
    }

    const shortfall = defaults.filter((entry) => !pruned.includes(entry));
    if (shortfall.length > 0) {
      rolesMissingDefaults[key] = shortfall;
    }
  }

  if (Object.keys(rolesMissingDefaults).length > 0) {
    // Not an error: an administrator may have removed these deliberately. Surfaced so a
    // newly introduced permission does not go unnoticed after an upgrade.
    logger.warn(
      { rolesMissingDefaults },
      'System roles do not hold all of their default permissions; grant them from the access screen if intended',
    );
  }

  logger.info(
    { permissions: ALL_PERMISSIONS.length, createdRoles, resyncedRoles },
    'RBAC catalogue synchronised',
  );
}

/**
 * Computes a user's effective permission set.
 *
 * head_admin is an unconditional superuser: requirements section 3 gives the admin
 * role full system configuration rights, and without this the very first bootstrap
 * account could not reach the RBAC screen to grant itself anything.
 */
export async function resolveEffectivePermissions(
  legacyRole: UserRole,
  roleIds: readonly Types.ObjectId[],
): Promise<Set<PermissionKey>> {
  if (legacyRole === 'head_admin') {
    return new Set(ALL_PERMISSIONS);
  }

  return unionPermissionsOf(roleIds);
}

/** The union of the permission sets held by the given roles. No legacy-role shortcut. */
export async function unionPermissionsOf(
  roleIds: readonly Types.ObjectId[],
): Promise<Set<PermissionKey>> {
  if (roleIds.length === 0) {
    return new Set();
  }

  const roles = await Role.find({ _id: { $in: roleIds } }).select('permissions').lean();
  const effective = new Set<PermissionKey>();
  for (const role of roles) {
    for (const permission of role.permissions) {
      effective.add(permission);
    }
  }
  return effective;
}

// -- Provisioning a new account with dynamic roles ---------------------------

/**
 * The system role an account is provisioned with when the administrator creating it does
 * not pick one explicitly.
 *
 * Effective permissions come only from the dynamic `roles` array, so an account created
 * with none resolves to an EMPTY set and is refused at every guard. The coarse legacy
 * role is the only thing the creation endpoint asks for, so it has to carry a default,
 * otherwise every account is born locked out until someone remembers to call
 * POST /rbac/users/:userId/roles.
 *
 * The mapping is deliberately the narrowest role that matches the tier, never a wider one:
 *
 *   - `customer` gets CUSTOMER, whose contract is portal keys only. This is the case the
 *     portal depends on: a customer with no roles cannot read their own objects.
 *   - `technician` gets TECHNICIAN: see the work, record progress and material usage,
 *     write and submit the conclusion, and nothing that decides who does the work. This
 *     tier used to map to null, which meant every technician account was born with an
 *     empty permission set and could not use the employee mobile app at all — the exact
 *     lockout this table exists to prevent, left in place for one tier. Pointing it at
 *     DISPATCH instead would have handed every technician `dispatch.assign` and
 *     `dispatch.extend_sla`, so a role matching the duty was seeded rather than an
 *     existing one stretched to cover it.
 *   - `admin` gets ADMIN, the seeded back-office set. Not SYSTEM_ADMIN: the legacy tier
 *     means "runs the back office", not "may rewrite the permission model".
 *   - `head_admin` gets SYSTEM_ADMIN. It is already an unconditional superuser in
 *     `resolveEffectivePermissions`, so this grants nothing new; it is recorded so the
 *     account's roles describe what it can actually do rather than looking empty.
 *
 * The value type is NOT nullable, so a tier added to `USER_ROLES` later cannot compile
 * without an answer here. A null would be a permissionless account, and that is a defect
 * rather than a configuration choice.
 */
const DEFAULT_SYSTEM_ROLE_BY_USER_ROLE: Record<UserRole, SystemRoleKey> = {
  customer: SYSTEM_ROLE_KEYS.CUSTOMER,
  technician: SYSTEM_ROLE_KEYS.TECHNICIAN,
  admin: SYSTEM_ROLE_KEYS.ADMIN,
  head_admin: SYSTEM_ROLE_KEYS.SYSTEM_ADMIN,
};

async function findSystemRoleId(key: SystemRoleKey): Promise<Types.ObjectId> {
  const role = await Role.findOne({ key }).select('_id').lean();
  if (!role) {
    // Seeded on every boot, so its absence means the database was not seeded rather than
    // that this account happens to need no permissions. Failing here is the point: the
    // alternative is quietly writing another permissionless account.
    throw AppError.internal(
      `Системийн '${key}' role олдсонгүй. RBAC seed ажиллаагүй байна.`,
    );
  }
  return role._id;
}

/**
 * The roles an account of this legacy tier receives when none are chosen.
 *
 * Used both when provisioning an account and when an existing account's tier changes, so
 * that "what tier is this account" and "what may it do" cannot drift apart.
 */
export async function resolveDefaultRoleIds(legacyRole: UserRole): Promise<Types.ObjectId[]> {
  return [await findSystemRoleId(DEFAULT_SYSTEM_ROLE_BY_USER_ROLE[legacyRole])];
}

/** The permissions the tier's default role carries today, read from the stored role. */
export async function defaultPermissionsForTier(
  legacyRole: UserRole,
): Promise<Set<PermissionKey>> {
  return unionPermissionsOf(await resolveDefaultRoleIds(legacyRole));
}

/** The stored `key` of each of the given roles. Unknown ids are simply absent. */
export async function roleKeysOf(roleIds: readonly Types.ObjectId[]): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const roles = await Role.find({ _id: { $in: roleIds } })
    .select('key')
    .lean();
  return roles.map((role) => role.key);
}

/**
 * Whether this role key is PROTECTED, i.e. whether holding it is holding the system.
 *
 * SYSTEM_ADMIN and nothing else. Its seeded contract is the entire permission catalogue
 * and `seedRbac` resynchronises it to the full catalogue on every boot, so it cannot be
 * narrowed into an ordinary role by editing it — which is precisely why assigning it,
 * editing it or deleting it needs `rbac.manage_protected` rather than plain `rbac.manage`.
 *
 * The other `isSystem` roles are deliberately NOT protected. ADMIN, MANAGEMENT, DISPATCH,
 * FINANCE, SALES, TECHNICIAN and CUSTOMER are seeded defaults that an administrator is
 * expected to tune from the access screen, and they are held to the ordinary rules: the
 * delegation ceiling stops an actor adding a permission it does not itself hold, and the
 * tier/role coherence rule stops a portal key being added to a role that staff hold.
 */
export function isProtectedRoleKey(key: string): boolean {
  return key === SYSTEM_ROLE_KEYS.SYSTEM_ADMIN;
}

/**
 * Deciding WHICH roles an account holds is not done here.
 *
 * It lives in `role-assignment.service.ts`, the single chokepoint through which every
 * write to `user.roles` in the backend passes. This module keeps only the primitives that
 * decision is built from — the catalogue seed, the effective-permission resolver, the tier
 * default table and the protected-role predicate — so that there is exactly one place
 * where the authority rules are stated and no second, weaker copy can drift into
 * existence beside it.
 */

export async function listRoles(): Promise<RoleDto[]> {
  const roles = await Role.find().sort({ isSystem: -1, name: 1 });
  const counts = await User.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $unwind: '$roles' },
    { $group: { _id: '$roles', count: { $sum: 1 } } },
  ]);
  const countByRole = new Map(counts.map((entry) => [String(entry._id), entry.count]));

  return roles.map((role) => toRoleDto(role, countByRole.get(String(role._id)) ?? 0));
}

export async function getRoleById(roleId: string): Promise<RoleDto> {
  const role = await Role.findById(roleId);
  if (!role) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Role олдсонгүй.');
  }
  return toRoleDto(role);
}

// -- Editing the roles themselves ---------------------------------------------

/**
 * THE OTHER HALF OF THE CHOKEPOINT.
 *
 * Capping which ROLES may be assigned to an account is worthless on its own, because a
 * role's permission set is editable. An actor holding nothing but `rbac.manage` rewrote
 * ITS OWN role to add `employee.view_salary` and `employee.manage_salary` and held both on
 * the very next request — no assignment involved, and every assignment-time cap bypassed
 * in one call. Adding `portal.*` to TECHNICIAN does the same thing more quietly: the
 * "capped" creation paths then mint unfiltered cross-tenant readers while passing every
 * check, because the check asks which ROLE is being granted and the danger is in what the
 * role now CONTAINS.
 *
 * So role editing answers to the same three questions as role assignment:
 *
 *   1. Is this a PROTECTED role? SYSTEM_ADMIN may only be edited or deleted with
 *      `rbac.manage_protected`.
 *   2. Does the edit hand out anything the actor does not hold? An actor may only put
 *      into a role what it could already delegate — its own effective permission set.
 *      Only the ADDED keys are capped: renaming a role, or REMOVING a key the actor does
 *      not itself hold, narrows the role and is not an escalation.
 *   3. Would the resulting role break the tier/role pairing for the accounts that already
 *      hold it? Portal keys on a role held by staff-tier accounts is the cross-tenant
 *      reader again, arrived at from the other end.
 *
 * Question 2 also answers self-escalation, and does so exactly: the actor's ceiling is its
 * CURRENT effective set, which already includes everything this role grants it today, so
 * nothing it can add is anything it does not already have. An actor therefore cannot raise
 * its own authority by editing a role it holds — which is the escalation that was live.
 */
async function assertRoleEditWithinCeiling(params: {
  actor: AuthContext;
  currentPermissions: readonly PermissionKey[];
  nextPermissions: readonly PermissionKey[];
}): Promise<void> {
  const held = new Set<PermissionKey>(params.currentPermissions);
  const added = params.nextPermissions.filter((key) => !held.has(key));

  const beyond = added.filter((key) => !params.actor.permissions.has(key));
  if (beyond.length > 0) {
    // Uniform refusal: naming the keys would let a caller enumerate the catalogue and
    // discover exactly where its own ceiling sits.
    throw AppError.forbidden(
      ERROR_CODES.INSUFFICIENT_PRIVILEGES,
      'Өөрт байхгүй эрхийг role-д нэмэх боломжгүй.',
    );
  }
}

/**
 * Refuses an edit that would make an existing role illegal for the accounts holding it.
 *
 * Tenant scoping keys off the legacy tier alone, so a staff-tier account holding a
 * `portal.*` key is an unfiltered reader of every organisation, and a customer-tier
 * account holding a staff key is a customer at a staff guard. The assignment path refuses
 * both pairings, but only at assignment time — editing the role underneath accounts that
 * already hold it reaches the same state without any assignment happening.
 */
async function assertRoleEditKeepsHoldersCoherent(
  roleId: Types.ObjectId,
  nextPermissions: readonly PermissionKey[],
): Promise<void> {
  const holderTiers = (await User.distinct('role', { roles: roleId })) as UserRole[];
  if (holderTiers.length === 0) return;

  const portalKeys = nextPermissions.filter((key) => permissionModuleOf(key) === 'portal');
  const contract = new Set<PermissionKey>(
    SYSTEM_ROLE_DEFAULT_PERMISSIONS[SYSTEM_ROLE_KEYS.CUSTOMER],
  );
  const beyondPortal = nextPermissions.filter((key) => !contract.has(key));

  if (portalKeys.length > 0 && holderTiers.some((tier) => tier !== 'customer')) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Энэ role-г ажилтны бүртгэлүүд эзэмшиж байгаа тул харилцагчийн эрх нэмэх боломжгүй.',
      [{ field: 'permissions', message: 'Харилцагчийн эрхийг ажилтанд олгох боломжгүй.' }],
    );
  }

  if (beyondPortal.length > 0 && holderTiers.includes('customer')) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Энэ role-г харилцагчийн бүртгэлүүд эзэмшиж байгаа тул ажилтны эрх нэмэх боломжгүй.',
      [{ field: 'permissions', message: 'Харилцагчид ажилтны эрх олгох боломжгүй.' }],
    );
  }
}

export interface CreateRoleServiceInput {
  key: string;
  name: string;
  description?: string | null;
  permissions: PermissionKey[];
}

export async function createRole(
  input: CreateRoleServiceInput,
  actor: AuthContext,
): Promise<RoleDto> {
  const key = input.key.toUpperCase();

  if (isProtectedRoleKey(key) && !actor.permissions.has(PERMISSIONS.RBAC_MANAGE_PROTECTED)) {
    throw AppError.forbidden(
      ERROR_CODES.INSUFFICIENT_PRIVILEGES,
      'Энэ үйлдлийг хийх эрх байхгүй байна.',
    );
  }

  const existing = await Role.findOne({ key }).select('_id');
  if (existing) {
    throw AppError.conflict(ERROR_CODES.DUPLICATE_KEY, 'Энэ key-тэй role аль хэдийн байна.');
  }

  // A new role starts empty, so every requested key is an addition and is capped.
  await assertRoleEditWithinCeiling({
    actor,
    currentPermissions: [],
    nextPermissions: input.permissions,
  });

  const role = await Role.create({
    key,
    name: input.name,
    description: input.description ?? null,
    permissions: input.permissions,
    isSystem: false,
  });

  return toRoleDto(role);
}

export async function updateRole(
  roleId: string,
  input: { name?: string; description?: string | null; permissions?: PermissionKey[] },
  actor: AuthContext,
): Promise<{ before: RoleDto; after: RoleDto }> {
  const role = await Role.findById(roleId);
  if (!role) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Role олдсонгүй.');
  }

  if (
    isProtectedRoleKey(role.key) &&
    !actor.permissions.has(PERMISSIONS.RBAC_MANAGE_PROTECTED)
  ) {
    throw AppError.forbidden(
      ERROR_CODES.INSUFFICIENT_PRIVILEGES,
      'Энэ үйлдлийг хийх эрх байхгүй байна.',
    );
  }

  const before = toRoleDto(role);

  // Both checks run against the RESULTING permission set, and both run before a single
  // field is assigned, so a refused edit leaves the role document exactly as it was.
  if (input.permissions !== undefined) {
    await assertRoleEditWithinCeiling({
      actor,
      currentPermissions: role.permissions,
      nextPermissions: input.permissions,
    });
    await assertRoleEditKeepsHoldersCoherent(role._id, input.permissions);
  }

  if (input.name !== undefined) role.name = input.name;
  if (input.description !== undefined) role.description = input.description;
  if (input.permissions !== undefined) role.permissions = input.permissions;
  await role.save();

  // A role's permission set decides who receives which notification, so the cached
  // resolution is dropped now rather than being left to lapse on its own.
  invalidateRecipientCache();

  return { before, after: toRoleDto(role) };
}

export async function deleteRole(roleId: string, actor: AuthContext): Promise<RoleDto> {
  const role = await Role.findById(roleId);
  if (!role) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Role олдсонгүй.');
  }
  if (
    isProtectedRoleKey(role.key) &&
    !actor.permissions.has(PERMISSIONS.RBAC_MANAGE_PROTECTED)
  ) {
    throw AppError.forbidden(
      ERROR_CODES.INSUFFICIENT_PRIVILEGES,
      'Энэ үйлдлийг хийх эрх байхгүй байна.',
    );
  }
  if (role.isSystem) {
    throw AppError.forbidden(ERROR_CODES.FORBIDDEN, 'Системийн role-г устгах боломжгүй.');
  }

  const assigned = await User.countDocuments({ roles: role._id });
  if (assigned > 0) {
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      `Энэ role ${assigned} хэрэглэгчид оноогдсон тул устгах боломжгүй.`,
    );
  }

  const dto = toRoleDto(role);
  await Role.deleteOne({ _id: role._id });
  return dto;
}

export async function listPermissions(): Promise<
  Array<{ key: PermissionKey; module: string; label: string }>
> {
  const permissions = await Permission.find().sort({ module: 1, key: 1 }).lean();
  return permissions.map((entry) => ({
    key: entry.key,
    module: entry.module,
    label: entry.label,
  }));
}

/** Validates that every supplied role id exists before assignment. */
export async function assertRolesExist(roleIds: readonly string[]): Promise<Types.ObjectId[]> {
  if (roleIds.length === 0) return [];

  const objectIds = roleIds.map((id) => new Types.ObjectId(id));
  const found = await Role.countDocuments({ _id: { $in: objectIds } });
  if (found !== objectIds.length) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Сонгосон role олдсонгүй.');
  }
  return objectIds;
}
