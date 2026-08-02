import {
  type EmployeeSystemAccessDto,
  type LinkSystemAccessInput,
  type SystemAccessActionInput,
  type UpdateSystemAccessRolesInput,
} from '@monhorus/shared';
import { Types, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { assertCanManageRole } from '../../middlewares/authorize.middleware';
import { hashPassword } from '../../utils/password.util';
import { recordAudit } from '../audit/audit.service';
import {
  applyRoleAssignment,
  createAccountWithRoles,
  requestedRolesForNewAccount,
} from '../rbac/role-assignment.service';
import { Role } from '../rbac/role.model';
import { Session } from '../user/session.model';
import { User, type IUser } from '../user/user.model';
import { Employee, type IEmployee } from './employee.model';

const ENTITY = 'Employee';

type EmployeeDoc = HydratedDocument<IEmployee>;
type UserDoc = HydratedDocument<IUser>;

/**
 * Lifecycle of the login attached to an employee record.
 *
 * Employee and User stay separate entities: an employee may exist with no account at
 * all. Everything here is administrator-driven; the product has no self-registration
 * and no self-service password recovery, so this module is the only way an employee
 * gains, loses or changes system access.
 */

async function loadEmployee(employeeId: string): Promise<EmployeeDoc> {
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Ажилтан олдсонгүй.');
  }
  return employee;
}

/**
 * Resolves the account an action targets, and refuses when it is the caller's own.
 *
 * An administrator must not be able to widen their own permissions or lock themselves
 * out through this screen, so the check lives on the server rather than relying on the
 * UI hiding the control.
 */
async function loadLinkedUser(employee: EmployeeDoc, actor: AuthContext): Promise<UserDoc> {
  if (!employee.systemUser) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Энэ ажилтан системийн эрхгүй байна.',
    );
  }

  assertNotSelf(employee.systemUser, actor);

  const user = await User.findById(employee.systemUser);
  if (!user) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хэрэглэгч олдсонгүй.');
  }

  // A plain admin may not act on another admin or on the head_admin, exactly as in the
  // user administration module.
  assertCanManageRole(actor.role, user.role);

  return user;
}

function assertNotSelf(userId: Types.ObjectId | string, actor: AuthContext): void {
  if (String(userId) === actor.userId) {
    throw AppError.forbidden(
      ERROR_CODES.SELF_ACTION_FORBIDDEN,
      'Өөрийн системийн эрхийг энэ дэлгэцээс өөрчлөх боломжгүй.',
    );
  }
}

/** Suspension has to bite immediately, not when the access token happens to expire. */
async function revokeSessions(userId: Types.ObjectId, reason: string): Promise<number> {
  const result = await Session.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  return result.modifiedCount;
}

function actorOf(actor: AuthContext): { id: string; role: AuthContext['role']; label: string } {
  return { id: actor.userId, role: actor.role, label: actor.fullName };
}

// -- Which dynamic roles this screen may write --------------------------------

/**
 * NONE OF THE ROLE RULES LIVE IN THIS FILE ANY MORE.
 *
 * This module used to carry its own partial copy of them, including a private
 * `assertTierPortalCeiling` that was the ONLY place in the backend refusing the pairing that
 * produces an unfiltered cross-tenant reader — which meant `POST /users` never applied it,
 * and `{ role: 'technician', roleIds: [CUSTOMER] }` sailed through there as head_admin and
 * produced a working reader of every organisation's records.
 *
 * Every rule now lives once, in `role-assignment.service.ts`, and all three role-writing
 * actions below go through it: CREATE_NEW via `createAccountWithRoles`, LINK_EXISTING and
 * `updateSystemAccessRoles` via `applyRoleAssignment`. Restating any of them here is what
 * let the two screens drift apart in the first place, so nothing is restated. What that
 * service enforces, in summary: a hand-picked selection is role assignment and needs
 * `rbac.manage`; nothing may be granted beyond the actor's own delegation ceiling; a
 * SYSTEM_ADMIN role or a head_admin account needs `rbac.manage_protected`; the tier and the
 * role set must agree in both directions; and the last active administrator cannot be
 * demoted.
 *
 * The one thing this file still decides is what an EMPTY `roleIds` MEANS, and it differs by
 * path for a reason:
 *
 *   CREATE_NEW  — `requestedRolesForNewAccount` reads absent-or-empty as the TIER DEFAULT.
 *                 There is nothing to strip on an account that does not exist, and the
 *                 `roles: roleIds ?? []` this replaced minted accounts with an EMPTY
 *                 permission set: a technician provisioned from this screen could sign in
 *                 and then be refused by every guard, including the mobile app's first call.
 *   the other two — an EXPLICIT selection, so an empty list is a STRIP: the documented way
 *                 an administrator parks a login with no authority. Routing it through the
 *                 new-account reading instead would re-GRANT the tier default and hand a
 *                 caller a way to re-arm an account that was parked on purpose.
 *
 * Note that a strip is no longer free. It can never be an escalation, which is why it used
 * to be ungated, but it IS a remote lockout: a caller holding only
 * `employee.manage_system_access` could reduce any linked account to zero permissions from
 * this screen. It is still supported and now asks for `rbac.manage`, the key that governs
 * what a login may do.
 */

/**
 * Links an employee to a system login.
 *
 * Three modes:
 *   LINK_EXISTING  attach an existing account
 *   CREATE_NEW     provision an account with an admin-issued passcode
 *   DEACTIVATE     retained alias for the suspend action
 *
 * A raw password is never written to the employee record; account creation reuses
 * the existing bcrypt hashing and the must_change_password flow.
 */
export async function manageSystemAccess(
  employeeId: string,
  input: LinkSystemAccessInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<EmployeeSystemAccessDto> {
  const employee = await loadEmployee(employeeId);

  if (input.mode === 'LINK_EXISTING') {
    if (!input.userId) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Холбох хэрэглэгч заавал.');
    }

    // Linking carries an optional role assignment, so the self check applies here too.
    assertNotSelf(input.userId, actor);

    const user = await User.findById(input.userId);
    if (!user) {
      throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хэрэглэгч олдсонгүй.');
    }

    assertCanManageRole(actor.role, user.role);

    // One user maps to at most one employee; the model has a unique partial index,
    // but checking here produces a readable message instead of a duplicate-key error.
    const alreadyLinked = await Employee.findOne({
      systemUser: user._id,
      _id: { $ne: employee._id },
    }).select('employeeCode');
    if (alreadyLinked) {
      throw AppError.conflict(
        ERROR_CODES.DUPLICATE_KEY,
        `Энэ хэрэглэгч ${alreadyLinked.employeeCode} ажилтанд аль хэдийн холбогдсон байна.`,
      );
    }

    // Decided against the tier the account already has, so linking cannot be used to hand it
    // roles the caller is not entitled to assign. The chokepoint mutates the document and
    // leaves the `save` to this caller; a refusal throws before anything is assigned.
    if (input.roleIds) {
      await applyRoleAssignment({
        target: user,
        // Linking never changes the tier; the account keeps the one it has and the
        // tier/role coherence rule is applied against it.
        targetTier: user.role,
        requested: { kind: 'EXPLICIT', roleIds: input.roleIds },
        actor,
        meta,
        source: 'POST /employees/:employeeId/system-access [LINK_EXISTING]',
        reason: 'system user linked',
      });
      await user.save();
    }

    employee.systemUser = user._id;
    await employee.save();

    await recordAudit({
      entityType: ENTITY,
      entityId: employee._id,
      action: 'Updated',
      actor: actorOf(actor),
      meta,
      reason: 'system user linked',
      newValue: {
        userId: String(user._id),
        email: user.email,
        roleIds: user.roles.map((id) => String(id)),
      },
    });

    return buildSystemAccessDto(employee.systemUser, actor);
  }

  if (input.mode === 'CREATE_NEW') {
    if (!input.email || !input.password || !input.role) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Имэйл, түр нууц үг, эрх заавал.',
      );
    }

    if (employee.systemUser) {
      throw AppError.conflict(
        ERROR_CODES.DUPLICATE_KEY,
        'Энэ ажилтанд системийн эрх аль хэдийн үүссэн байна.',
      );
    }

    // A plain admin must not be able to mint an account above their own tier.
    assertCanManageRole(actor.role, input.role);

    const existing = await User.findOne({ email: input.email }).select('_id');
    if (existing) {
      throw AppError.conflict(ERROR_CODES.EMAIL_ALREADY_EXISTS);
    }

    // The account and its roles are written together by the chokepoint, which decides the
    // whole role set before it writes a document: a refused selection leaves no account
    // behind at all, and an accepted one is never briefly permissionless.
    const user = await createAccountWithRoles(
      {
        fullName: `${employee.lastName} ${employee.firstName}`.trim(),
        email: input.email,
        password: await hashPassword(input.password),
        phone: employee.phone,
        role: input.role,
        // The admin issues the passcode, so the holder must replace it at first login.
        status: 'must_change_password',
        passwordChangedAt: new Date(),
        createdBy: new Types.ObjectId(actor.userId),
      },
      requestedRolesForNewAccount(input.roleIds),
      {
        actor,
        meta,
        source: 'POST /employees/:employeeId/system-access [CREATE_NEW]',
        reason: 'system access created',
      },
    );

    employee.systemUser = user._id;
    await employee.save();

    await recordAudit({
      entityType: ENTITY,
      entityId: employee._id,
      action: 'Updated',
      actor: actorOf(actor),
      meta,
      reason: 'system access created',
      newValue: {
        userId: String(user._id),
        email: user.email,
        role: user.role,
        roleIds: user.roles.map((id) => String(id)),
      },
    });

    return buildSystemAccessDto(user._id, actor);
  }

  // DEACTIVATE is the original spelling of the suspend action and is kept working so
  // existing callers do not break.
  return suspendSystemAccess(employeeId, {}, actor, meta);
}

/**
 * Replaces the dynamic roles held by the linked account.
 *
 * The legacy coarse `role` is deliberately untouched: it is set when the account is
 * provisioned and changing a user's tier belongs to the user administration module,
 * which enforces its own privilege rules.
 *
 * Naming roles here is role assignment like anywhere else, so it answers to the chokepoint
 * in `role-assignment.service.ts` and not to any rule of this screen's own.
 */
export async function updateSystemAccessRoles(
  employeeId: string,
  input: UpdateSystemAccessRolesInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<EmployeeSystemAccessDto> {
  const employee = await loadEmployee(employeeId);
  const user = await loadLinkedUser(employee, actor);

  const outcome = await applyRoleAssignment({
    target: user,
    // This screen deliberately never moves the tier, so the coherence rule is applied
    // against the one the account already has.
    targetTier: user.role,
    requested: { kind: 'EXPLICIT', roleIds: input.roleIds },
    actor,
    meta,
    source: 'PATCH /employees/:employeeId/system-access/roles',
    reason: input.reason ?? 'system access roles changed',
  });
  await user.save();

  await recordAudit({
    entityType: ENTITY,
    entityId: employee._id,
    action: 'Updated',
    actor: actorOf(actor),
    meta,
    reason: input.reason ?? 'system access roles changed',
    oldValue: { userId: String(user._id), roleIds: outcome.before },
    newValue: { userId: String(user._id), roleIds: outcome.after },
  });

  return buildSystemAccessDto(user._id, actor);
}

/** Temporarily closes the login. The account, and its audit trail, are preserved. */
export async function suspendSystemAccess(
  employeeId: string,
  input: SystemAccessActionInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<EmployeeSystemAccessDto> {
  const employee = await loadEmployee(employeeId);
  const user = await loadLinkedUser(employee, actor);

  if (user.status === 'suspended') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Энэ бүртгэл аль хэдийн түр хаагдсан байна.',
    );
  }

  const previousStatus = user.status;
  user.status = 'suspended';
  await user.save();

  const revokedSessions = await revokeSessions(user._id, 'Employee system access suspended');

  await recordAudit({
    entityType: ENTITY,
    entityId: employee._id,
    action: 'StatusChanged',
    actor: actorOf(actor),
    meta,
    reason: input.reason ?? 'system access suspended',
    oldValue: { userId: String(user._id), accountStatus: previousStatus },
    newValue: { userId: String(user._id), accountStatus: user.status, revokedSessions },
  });

  return buildSystemAccessDto(user._id, actor);
}

/**
 * Reopens a suspended login.
 *
 * Only a suspended account can be restored, so an active account cannot be pushed
 * through this path and have some other state silently overwritten.
 */
export async function restoreSystemAccess(
  employeeId: string,
  input: SystemAccessActionInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<EmployeeSystemAccessDto> {
  const employee = await loadEmployee(employeeId);
  const user = await loadLinkedUser(employee, actor);

  if (user.status !== 'suspended') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Зөвхөн түр хаагдсан бүртгэлийг сэргээнэ.',
    );
  }

  user.status = 'active';
  // A brute-force lock from before the suspension would otherwise survive it and make
  // the restore look like it had failed.
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  await recordAudit({
    entityType: ENTITY,
    entityId: employee._id,
    action: 'StatusChanged',
    actor: actorOf(actor),
    meta,
    reason: input.reason ?? 'system access restored',
    oldValue: { userId: String(user._id), accountStatus: 'suspended' },
    newValue: { userId: String(user._id), accountStatus: user.status },
  });

  return buildSystemAccessDto(user._id, actor);
}

/**
 * Permanently withdraws system access from the employee.
 *
 * The employee record survives, and so does the user document with everything that
 * references it: audit rows, created-by pointers and session history all keep pointing
 * at a real account. Deleting the user would tear holes in the audit trail, which is
 * exactly what the trail exists to prevent. Instead the account is suspended, its live
 * sessions are cut, and the employee link is removed, which leaves the login unusable
 * while the history stays readable.
 */
export async function revokeSystemAccess(
  employeeId: string,
  input: SystemAccessActionInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<EmployeeSystemAccessDto> {
  const employee = await loadEmployee(employeeId);
  const user = await loadLinkedUser(employee, actor);

  const previousStatus = user.status;
  user.status = 'suspended';
  await user.save();

  const revokedSessions = await revokeSessions(user._id, 'Employee system access revoked');

  employee.systemUser = null;
  await employee.save();

  await recordAudit({
    entityType: ENTITY,
    entityId: employee._id,
    action: 'StatusChanged',
    actor: actorOf(actor),
    meta,
    reason: input.reason ?? 'system access revoked',
    oldValue: {
      userId: String(user._id),
      email: user.email,
      accountStatus: previousStatus,
      linked: true,
    },
    newValue: { accountStatus: user.status, linked: false, revokedSessions },
  });

  return buildSystemAccessDto(null, actor);
}

/**
 * Current access state, including the names of the assigned roles.
 *
 * Names are resolved here so no consumer has to join against the role catalogue,
 * which it may not even be permitted to read.
 */
export async function buildSystemAccessDto(
  userId: Types.ObjectId | null,
  actor: AuthContext,
): Promise<EmployeeSystemAccessDto> {
  const empty: EmployeeSystemAccessDto = {
    hasAccount: false,
    userId: null,
    email: null,
    fullName: null,
    role: null,
    roleIds: [],
    roles: [],
    accountStatus: null,
    lastLoginAt: null,
    isSelf: false,
  };

  if (!userId) return empty;

  const user = await User.findById(userId).select('fullName email role roles status lastLoginAt');
  if (!user) return empty;

  const roles = await Role.find({ _id: { $in: user.roles } }).select('key name').sort({ name: 1 });

  return {
    hasAccount: true,
    userId: String(user._id),
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    roleIds: user.roles.map((id) => String(id)),
    roles: roles.map((role) => ({ id: String(role._id), key: role.key, name: role.name })),
    accountStatus: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    isSelf: String(user._id) === actor.userId,
  };
}
