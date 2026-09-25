import type { PaginatedData, UserDto, UserRole } from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { CREATOR_POPULATE } from '../../common/utils/creator.util';
import { assertCanManageRole } from '../../middlewares/authorize.middleware';
import { hashPassword } from '../../utils/password.util';
import { recordAudit, type RequestMeta } from '../audit/audit.service';
import { toUserDto } from '../auth/auth.service';
import { Customer } from '../objects/object.models';
import {
  applyRoleAssignment,
  createAccountWithRoles,
  requestedRolesForNewAccount,
} from '../rbac/role-assignment.service';
import { Session } from './session.model';
import { User, type IUser } from './user.model';
import type {
  CreateUserBody,
  ListUsersQuery,
  UpdateUserBody,
  UpdateUserStatusBody,
} from './user.validation';

/** Fields pulled onto the DTO so the admin console can show the organisation by name. */
const CUSTOMER_POPULATE = { path: 'customer', select: 'name' } as const;

// -- Customer link -----------------------------------------------------------

/**
 * Decides what the `customer` field must become, and refuses every state that would leave
 * the tenant binding inconsistent.
 *
 * The link is the security boundary for every customer-owned read, so it is resolved here
 * once and the same way on create and on update. Three rules, each chosen deliberately:
 *
 *   1. A `customer` account must end up linked. An unlinked customer cannot be scoped and
 *      the scope resolver refuses it at request time, so letting one be created or left
 *      behind by an edit only defers the failure to the customer's first login.
 *   2. An explicit link sent for a staff role is REJECTED, not silently dropped. An admin
 *      who picks an organisation for a technician has misunderstood something, and an
 *      ignored field would leave them believing a link exists that does not. Note this is
 *      only about an explicit request: a role change from customer to staff that says
 *      nothing about the link CLEARS it, because the account has stopped being a tenant
 *      and keeping a stale reference is exactly the inconsistency rule 2 exists to stop.
 *   3. The organisation must exist. A dangling reference would populate as null and read
 *      as "unlinked" everywhere except the raw document.
 */
async function resolveCustomerLink(params: {
  role: UserRole;
  /** What the request asked for: undefined when it said nothing, null to clear. */
  requested: string | null | undefined;
  /** The link the account carries today. Null when creating. */
  current: Types.ObjectId | null;
}): Promise<Types.ObjectId | null> {
  const { role, requested, current } = params;

  if (role !== 'customer') {
    if (requested) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Зөвхөн харилцагчийн эрхтэй хэрэглэгчийг байгууллагад холбоно.',
        [
          {
            field: 'customerId',
            message: 'Зөвхөн харилцагчийн эрхтэй хэрэглэгчийг байгууллагад холбоно.',
          },
        ],
      );
    }
    return null;
  }

  // Explicit null is a request to unlink, which rule 1 forbids while the role is customer,
  // so it collapses into the same "no organisation" failure as omitting it on create.
  const targetId = requested === null ? null : (requested ?? (current ? String(current) : null));

  if (!targetId) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Харилцагч эрхтэй хэрэглэгчид байгууллага заавал сонгоно.',
      [{ field: 'customerId', message: 'Байгууллага заавал сонгоно.' }],
    );
  }

  const exists = await Customer.exists({ _id: new Types.ObjectId(targetId) });
  if (!exists) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Сонгосон байгууллага олдсонгүй.', [
      { field: 'customerId', message: 'Сонгосон байгууллага олдсонгүй.' },
    ]);
  }

  return new Types.ObjectId(targetId);
}

// -- Create user (admin / head_admin) ----------------------------------------

export interface ProvisionResult {
  user: UserDto;
  temporaryPassword: string;
}

/**
 * The only path by which an account comes into existence. There is no public
 * self-registration endpoint anywhere in the API.
 *
 * The plaintext passcode is echoed back exactly once so the admin can hand it to
 * the user out of band. It is never persisted in plaintext and never logged.
 */
export async function createUser(
  input: CreateUserBody,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ProvisionResult> {
  // A plain admin may not mint another admin or a head_admin.
  assertCanManageRole(actor.role, input.role);

  const email = input.email.trim().toLowerCase();

  const existing = await User.findOne({ email }).select('_id');
  if (existing) {
    throw AppError.conflict(ERROR_CODES.EMAIL_ALREADY_EXISTS);
  }

  // Resolved before the account is written, so a customer account never exists in an
  // unlinked state, not even briefly.
  const customer = await resolveCustomerLink({
    role: input.role,
    requested: input.customerId,
    current: null,
  });

  // The account and its roles are written together by the RBAC chokepoint rather than by a
  // `User.create({ ..., roles })` here.
  //
  // Effective permissions are derived from the dynamic `roles` array alone, so an account
  // written without one resolves to an empty set and is refused by every guard — which is
  // why the tier default is supplied rather than `[]`. And choosing those roles is role
  // ASSIGNMENT, subject to the same authority rules as every other assignment path: the
  // router above mounts `authorize('admin', 'head_admin')`, a legacy-tier check that asks
  // for no permission at all, so without the chokepoint this endpoint was a way around
  // POST /rbac/users/:userId/roles for any admin-tier account. `createAccountWithRoles`
  // decides the whole role set before it writes a document, so a refused selection leaves
  // no account behind and an accepted one is never briefly permissionless.
  const user = await createAccountWithRoles(
    {
      fullName: input.fullName.trim(),
      email,
      password: await hashPassword(input.password),
      phone: input.phone ?? null,
      role: input.role,
      customer,
      status: input.requirePasswordChange ? 'must_change_password' : 'active',
      passwordChangedAt: new Date(),
      createdBy: new Types.ObjectId(actor.userId),
    },
    requestedRolesForNewAccount(input.roleIds),
    { actor, meta, source: 'POST /users', reason: 'account provisioned' },
  );

  const roles = user.roles;

  await recordAudit({
    entityType: 'User',
    entityId: user._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: {
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      customerId: customer ? String(customer) : null,
      // What the account can actually do is decided by these, so the creation row carries
      // them: without it the audit trail cannot tell a defaulted grant from a chosen one.
      roleIds: roles.map((roleId) => String(roleId)),
    },
  });

  await user.populate(CUSTOMER_POPULATE);

  return { user: toUserDto(user), temporaryPassword: input.password };
}

// -- Update user (admin / head_admin) ----------------------------------------

/** The account fields this endpoint may change, in the shape the audit trail records. */
interface UserSnapshot {
  fullName: string;
  phone: string | null;
  role: UserRole;
  customerId: string | null;
}

function snapshot(user: {
  fullName: string;
  phone: string | null;
  role: UserRole;
  customer: Types.ObjectId | null;
}): UserSnapshot {
  return {
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    customerId: user.customer ? String(user.customer) : null,
  };
}

/** The keys that differ, so the audit row carries the change and not the whole record. */
function changedKeys(before: UserSnapshot, after: UserSnapshot): (keyof UserSnapshot)[] {
  return (Object.keys(before) as (keyof UserSnapshot)[]).filter(
    (key) => before[key] !== after[key],
  );
}

function pick(source: UserSnapshot, keys: (keyof UserSnapshot)[]): Partial<UserSnapshot> {
  const result: Partial<UserSnapshot> = {};
  for (const key of keys) {
    // Assigning through the union keeps the value type tied to its own key.
    (result as Record<string, unknown>)[key] = source[key];
  }
  return result;
}

/**
 * Administrative edit of an account, including the customer organisation it belongs to.
 *
 * The tenant link is the reason this endpoint exists, so it is guarded like one: only a
 * caller who already passed the module's admin gate reaches here, the target-role rule is
 * applied to both the old and the new role, and every change is audited with its old and
 * new value.
 *
 * A tier change also re-maps the dynamic roles, and that is a security fix rather than a
 * tidy-up. Tenant scoping keys off the LEGACY tier, not off permissions: `resolveCustomerScope`
 * branches on `auth.role === 'customer'` and every other value resolves to `{ mode: 'STAFF' }`,
 * whose filter is `{}` — no filter at all. So an account left holding the CUSTOMER role while
 * its tier moved to staff kept its portal keys, which the portal endpoints accept, but lost
 * the predicate that confined those keys to one organisation: it became an unfiltered reader
 * of every tenant's projects, buildings, floors and service requests. The reverse direction is
 * the same class of mistake in the other direction — a demoted admin keeping ADMIN.
 *
 * Re-mapping to the new tier's default is what keeps "what tier is this" and "what may it do"
 * from disagreeing. It is the default rather than a translation of the old set on purpose: the
 * old permissions belonged to a different tier, and carrying any of them across is precisely
 * the thing that goes wrong. An account that needs more than its tier's default is given it
 * afterwards through POST /rbac/users/:userId/roles, which asks for `rbac.manage`.
 *
 * That re-map is itself a permission grant, so it answers to the same authority rules as
 * creation rather than riding along on the router's coarse tier check, and it goes through
 * `applyRoleAssignment` — the single chokepoint every role write in the backend passes
 * through — to get them. Without that, an admin-tier account holding nothing but
 * `dashboard.view` could flip a customer to `technician` and hand out the whole TECHNICIAN
 * set: a grant it could make through no other endpoint.
 *
 * Live sessions are deliberately NOT revoked, for the link or for the roles. The authenticate
 * middleware re-reads `customer`, `role` and `roles` from the account on every single request
 * and recomputes the permission set from them, so a session established before the change is
 * already scoped and gated by the new values on its next call.
 */
export async function updateUser(
  targetUserId: string,
  input: UpdateUserBody,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<UserDto> {
  if (targetUserId === actor.userId) {
    throw AppError.forbidden(
      ERROR_CODES.SELF_ACTION_FORBIDDEN,
      'Өөрийн бүртгэлийн эрх, байгууллагыг өөрчлөх боломжгүй.',
    );
  }

  const target = await User.findById(targetUserId);
  if (!target) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хэрэглэгч олдсонгүй.');
  }

  // Checked against the role the account has now, so a plain admin cannot edit an
  // administrator, and against the role it would gain, so it cannot promote one either.
  assertCanManageRole(actor.role, target.role);
  if (input.role) {
    assertCanManageRole(actor.role, input.role);
  }

  const before = snapshot(target);
  const rolesBefore = target.roles.map((roleId) => String(roleId));
  const nextRole = input.role ?? target.role;
  const tierChanged = nextRole !== target.role;

  const customer = await resolveCustomerLink({
    role: nextRole,
    requested: input.customerId,
    current: target.customer,
  });

  // Resolved after the link, so a tier change that the link rules reject — a promotion to
  // customer with no organisation, say — throws before the roles are touched and leaves the
  // account exactly as it was rather than half-migrated.
  //
  // The re-map is a permission GRANT and answers to the same authority rules as every other
  // one, so it goes through the RBAC chokepoint rather than reading the default table here:
  // `applyRoleAssignment` refuses an actor who neither holds `rbac.manage` nor already holds
  // everything the new tier's default carries, refuses a protected mutation without
  // `rbac.manage_protected`, and refuses a pairing that would make the account an unfiltered
  // cross-tenant reader. Nothing is written yet at this point — `target.save()` is below and
  // the chokepoint deliberately does not save on its own behalf — so a refusal leaves the
  // account exactly as it was.
  //
  // An edit that does not move the tier passes UNCHANGED rather than skipping the call.
  // Going through the chokepoint unconditionally is what stops this endpoint quietly growing
  // a second, ungoverned role write later; UNCHANGED short-circuits before any authority
  // gate, so an ordinary name edit still needs no RBAC permission.
  //
  // Called BEFORE `target.role` is reassigned, because the chokepoint reads the account's
  // CURRENT tier from the document and is told the tier it will hold afterwards separately.
  // A half-applied document would have it deciding against a state that may never persist.
  await applyRoleAssignment({
    target,
    targetTier: nextRole,
    requested: tierChanged ? { kind: 'TIER_DEFAULT' } : { kind: 'UNCHANGED' },
    actor,
    meta,
    source: 'PATCH /users/:userId',
    reason: input.reason ?? null,
  });

  if (input.fullName !== undefined) target.fullName = input.fullName.trim();
  if (input.phone !== undefined) target.phone = input.phone ?? null;
  target.role = nextRole;
  target.customer = customer;
  await target.save();

  const after = snapshot(target);
  const rolesAfter = target.roles.map((roleId) => String(roleId));
  const changed = changedKeys(before, after);
  // Compared as joined strings because the arrays are fresh objects either way; order is
  // significant and stable, since both sides come from a single stored sequence.
  const rolesChanged = rolesBefore.join(',') !== rolesAfter.join(',');

  if (changed.length > 0 || rolesChanged) {
    await recordAudit({
      entityType: 'User',
      entityId: target._id,
      action: 'Updated',
      actor: { id: actor.userId, role: actor.role, label: actor.fullName },
      meta,
      reason: input.reason ?? null,
      // The re-map is recorded in the same shape the creation row uses, because what an
      // account may do is the part of this edit an auditor most needs to be able to see.
      oldValue: { ...pick(before, changed), ...(rolesChanged ? { roleIds: rolesBefore } : {}) },
      newValue: { ...pick(after, changed), ...(rolesChanged ? { roleIds: rolesAfter } : {}) },
    });
  }

  await target.populate(CUSTOMER_POPULATE);

  return toUserDto(target);
}

// -- Reset passcode ----------------------------------------------------------

/**
 * Administrative credential reset. V1 has no self-service recovery, so this is the
 * only way a locked-out user regains access.
 *
 * Three effects, all deliberate:
 *   1. The new passcode is stored hashed and the target is forced to change it.
 *   2. Any brute-force lock on the target is cleared.
 *   3. Every live session for the target is revoked, so a session established with
 *      the old credential cannot outlive the reset.
 */
export async function resetPasscode(
  targetUserId: string,
  newPassword: string,
  reason: string | undefined,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ProvisionResult> {
  if (targetUserId === actor.userId) {
    throw AppError.forbidden(
      ERROR_CODES.SELF_ACTION_FORBIDDEN,
      'Өөрийн нууц үгийг "Нууц үг солих" цэсээр солино уу.',
    );
  }

  const target = await User.findById(targetUserId);
  if (!target) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хэрэглэгч олдсонгүй.');
  }

  assertCanManageRole(actor.role, target.role);

  const previousStatus = target.status;

  target.password = await hashPassword(newPassword);
  target.passwordChangedAt = new Date();
  target.status = 'must_change_password';
  target.failedLoginAttempts = 0;
  target.lockedUntil = null;
  await target.save();

  const revoked = await Session.updateMany(
    { user: target._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'Passcode reset by administrator' } },
  );

  await recordAudit({
    entityType: 'User',
    entityId: target._id,
    action: 'PasscodeReset',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: reason ?? null,
    oldValue: { status: previousStatus },
    newValue: { status: target.status, revokedSessions: revoked.modifiedCount },
  });

  await target.populate(CUSTOMER_POPULATE);

  return { user: toUserDto(target), temporaryPassword: newPassword };
}

// -- Suspend / reactivate ----------------------------------------------------

export async function updateUserStatus(
  targetUserId: string,
  input: UpdateUserStatusBody,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<UserDto> {
  if (targetUserId === actor.userId) {
    throw AppError.forbidden(
      ERROR_CODES.SELF_ACTION_FORBIDDEN,
      'Өөрийн бүртгэлийн төлөвийг өөрчлөх боломжгүй.',
    );
  }

  const target = await User.findById(targetUserId);
  if (!target) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хэрэглэгч олдсонгүй.');
  }

  assertCanManageRole(actor.role, target.role);

  const previousStatus = target.status;
  target.status = input.status;
  await target.save();

  if (input.status === 'suspended') {
    await Session.updateMany(
      { user: target._id, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'Account suspended' } },
    );
  }

  await recordAudit({
    entityType: 'User',
    entityId: target._id,
    action: 'StatusChanged',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: input.reason ?? null,
    oldValue: { status: previousStatus },
    newValue: { status: target.status },
  });

  await target.populate(CUSTOMER_POPULATE);

  return toUserDto(target);
}

// -- Queries -----------------------------------------------------------------

export async function listUsers(query: ListUsersQuery): Promise<PaginatedData<UserDto>> {
  const filter: FilterQuery<IUser> = {};

  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status;
  if (query.customerId) filter.customer = new Types.ObjectId(query.customerId);
  if (query.search) {
    // Escaped so a user-supplied string cannot inject regex metacharacters.
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [{ fullName: pattern }, { email: pattern }, { phone: pattern }];
  }

  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    // The organisation name rides along so the admin list can show the link without a
    // second round trip per row.
    User.find(filter)
      .populate(CUSTOMER_POPULATE)
      .populate(CREATOR_POPULATE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(query.limit),
    User.countDocuments(filter),
  ]);

  return {
    items: items.map(toUserDto),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getUserById(userId: string): Promise<UserDto> {
  const user = await User.findById(userId).populate(CUSTOMER_POPULATE).populate(CREATOR_POPULATE);
  if (!user) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хэрэглэгч олдсонгүй.');
  }
  return toUserDto(user);
}
