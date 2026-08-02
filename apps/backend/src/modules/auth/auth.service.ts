import type { AuthSession, AuthTokens, UserDto } from '@monhorus/shared';
import { Types } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { env } from '../../config/env';
import {
  getTokenLifetimeSeconds,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt.util';
import { burnPasswordCycle, comparePassword, hashPassword } from '../../utils/password.util';
import { recordAudit, type RequestMeta } from '../audit/audit.service';
import { Session } from '../user/session.model';
import { User, type IUser, type UserDocument } from '../user/user.model';

export type { RequestMeta };

export function toUserDto(user: UserDocument | (IUser & { _id: Types.ObjectId })): UserDto {
  // `customer` may arrive populated (the admin list shows the organisation name) or as a
  // bare id. Both are read here so a caller does not have to know which it received.
  const customer = user.customer as
    | Types.ObjectId
    | { _id: Types.ObjectId; name?: string }
    | null
    | undefined;
  const populated =
    customer && typeof customer === 'object' && '_id' in customer
      ? (customer as { _id: Types.ObjectId; name?: string })
      : null;

  return {
    id: String(user._id),
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    customerId: customer ? String(populated ? populated._id : customer) : null,
    customerName: populated?.name ?? null,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdBy: user.createdBy ? String(user.createdBy) : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

async function issueTokens(user: UserDocument, meta: RequestMeta): Promise<AuthTokens> {
  const accessToken = signAccessToken(String(user._id), user.role);
  const { token: refreshToken } = signRefreshToken(String(user._id));

  await Session.create({
    user: user._id,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + env.refreshTokenTtlMs),
    userAgent: meta.userAgent,
    ip: meta.ip,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: getTokenLifetimeSeconds(accessToken),
    tokenType: 'Bearer',
  };
}

// -- Login -------------------------------------------------------------------

export interface LoginInput {
  email: string;
  password: string;
}

export async function login(input: LoginInput, meta: RequestMeta): Promise<AuthSession> {
  const email = input.email.trim().toLowerCase();
  const user = await User.findOne({ email }).select('+password');

  // Unknown email: burn an equivalent bcrypt cycle, then return the exact error the
  // wrong-password path returns. The caller cannot enumerate registered addresses.
  if (!user) {
    await burnPasswordCycle(input.password);
    await recordAudit({
      entityType: 'User',
      action: 'LoginFailed',
      meta,
      reason: 'Unknown email',
      newValue: { email },
    });
    throw AppError.unauthorized(ERROR_CODES.INVALID_CREDENTIALS);
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw AppError.unauthorized(ERROR_CODES.ACCOUNT_LOCKED);
  }

  const passwordMatches = await comparePassword(input.password, user.password);

  if (!passwordMatches) {
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = attempts >= env.MAX_FAILED_LOGIN_ATTEMPTS;

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          failedLoginAttempts: shouldLock ? 0 : attempts,
          lockedUntil: shouldLock ? new Date(Date.now() + env.accountLockMs) : null,
        },
      },
    );

    await recordAudit({
      entityType: 'User',
      entityId: user._id,
      action: shouldLock ? 'AccountLocked' : 'LoginFailed',
      actor: { id: user._id, role: user.role, label: user.fullName },
      meta,
      reason: shouldLock
        ? `${env.MAX_FAILED_LOGIN_ATTEMPTS} удаа буруу оролдсон`
        : 'Нууц үг буруу',
    });

    throw AppError.unauthorized(
      shouldLock ? ERROR_CODES.ACCOUNT_LOCKED : ERROR_CODES.INVALID_CREDENTIALS,
    );
  }

  // Password verified. Only now is account status revealed.
  if (user.status === 'suspended') {
    await recordAudit({
      entityType: 'User',
      entityId: user._id,
      action: 'LoginFailed',
      actor: { id: user._id, role: user.role, label: user.fullName },
      meta,
      reason: 'Бүртгэл түр хаагдсан',
    });
    throw AppError.forbidden(ERROR_CODES.ACCOUNT_SUSPENDED);
  }

  const tokens = await issueTokens(user, meta);

  await User.updateOne(
    { _id: user._id },
    { $set: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } },
  );
  user.lastLoginAt = new Date();

  await recordAudit({
    entityType: 'User',
    entityId: user._id,
    action: 'LoginSucceeded',
    actor: { id: user._id, role: user.role, label: user.fullName },
    meta,
  });

  return {
    user: toUserDto(user),
    tokens,
    mustChangePassword: user.status === 'must_change_password',
  };
}

// -- Refresh -----------------------------------------------------------------

export async function refreshSession(
  rawRefreshToken: string,
  meta: RequestMeta,
): Promise<AuthSession> {
  const claims = verifyRefreshToken(rawRefreshToken);
  const session = await Session.findOne({ tokenHash: hashToken(rawRefreshToken) });

  if (!session) {
    throw AppError.unauthorized(ERROR_CODES.REFRESH_TOKEN_INVALID);
  }

  // Replay of an already-rotated token means the token leaked. Kill every session
  // for that user rather than only this one.
  if (session.revokedAt) {
    await Session.updateMany(
      { user: session.user, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'Refresh token reuse detected' } },
    );
    await recordAudit({
      entityType: 'User',
      entityId: session.user,
      action: 'TokenReuseDetected',
      meta,
      reason: 'Хүчингүй болсон refresh token дахин ашиглагдсан',
    });
    throw AppError.unauthorized(ERROR_CODES.REFRESH_TOKEN_INVALID);
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    throw AppError.unauthorized(ERROR_CODES.REFRESH_TOKEN_INVALID);
  }

  const user = await User.findById(claims.sub);
  if (!user) {
    throw AppError.unauthorized(ERROR_CODES.REFRESH_TOKEN_INVALID);
  }

  if (user.status === 'suspended') {
    await Session.updateMany(
      { user: user._id, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'Account suspended' } },
    );
    throw AppError.forbidden(ERROR_CODES.ACCOUNT_SUSPENDED);
  }

  // Rotate: issue the successor, then retire the presented token.
  const tokens = await issueTokens(user, meta);
  session.revokedAt = new Date();
  session.revokedReason = 'Rotated';
  await session.save();

  return {
    user: toUserDto(user),
    tokens,
    mustChangePassword: user.status === 'must_change_password',
  };
}

// -- Logout ------------------------------------------------------------------

export async function logout(rawRefreshToken: string, meta: RequestMeta): Promise<void> {
  const session = await Session.findOne({ tokenHash: hashToken(rawRefreshToken) });

  // Idempotent: an unknown or already-revoked token still yields a clean logout.
  if (session && !session.revokedAt) {
    session.revokedAt = new Date();
    session.revokedReason = 'User logout';
    await session.save();

    await recordAudit({
      entityType: 'User',
      entityId: session.user,
      action: 'LoggedOut',
      meta,
    });
  }
}

// -- Self-service password change --------------------------------------------

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * The ONLY self-service credential operation in V1. A forgotten password cannot be
 * recovered by the user; an administrator must reset it. See user.service.resetPasscode.
 */
export async function changePassword(
  input: ChangePasswordInput,
  auth: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  const user = await User.findById(auth.userId).select('+password');
  if (!user) {
    throw AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED);
  }

  const matches = await comparePassword(input.currentPassword, user.password);
  if (!matches) {
    throw AppError.unauthorized(ERROR_CODES.INVALID_CREDENTIALS);
  }

  const previousStatus = user.status;

  user.password = await hashPassword(input.newPassword);
  user.passwordChangedAt = new Date();
  // Clearing the forced-change flag is the whole point of this call.
  if (user.status === 'must_change_password') {
    user.status = 'active';
  }
  await user.save();

  // Every existing session dies, including the caller's own.
  await Session.updateMany(
    { user: user._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'Password changed' } },
  );

  await recordAudit({
    entityType: 'User',
    entityId: user._id,
    action: 'PasswordChanged',
    actor: { id: auth.userId, role: auth.role, label: auth.fullName },
    meta,
    oldValue: { status: previousStatus },
    newValue: { status: user.status },
  });
}

// -- Current user ------------------------------------------------------------

export async function getCurrentUser(userId: string): Promise<UserDto> {
  // The organisation name is populated so a customer client can print who they are signed in
  // as without a second call. The id alone would leave the portal showing a generic label.
  const user = await User.findById(userId).populate('customer', 'name');
  if (!user) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND);
  }
  return toUserDto(user);
}
