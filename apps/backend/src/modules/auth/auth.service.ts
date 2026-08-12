import { randomBytes } from 'node:crypto';

import type { AuthSession, AuthTokens, UserDto } from '@monhorus/shared';
import { Types } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import {
  getTokenLifetimeSeconds,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt.util';
import { burnPasswordCycle, comparePassword, hashPassword } from '../../utils/password.util';
import { recordAudit, type RequestMeta } from '../audit/audit.service';
import { sendMail } from '../mail/mail.service';
import { PasswordResetToken } from '../user/password-reset-token.model';
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
 * Changing a known password from inside a session.
 *
 * No longer the only self-service credential operation: `requestPasswordReset` and
 * `resetPassword` below recover a forgotten one over email. This remains the only one that
 * proves possession of the current password, which is why it alone can be called while
 * signed in.
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

// -- Password reset over email -----------------------------------------------

/**
 * The raw token handed to the reader, and only to them.
 *
 * 32 bytes from the CSPRNG. base64url so it survives a URL path untouched — no escaping,
 * no `+`/`/` to be mangled by a mail client that decides to be helpful with the link.
 */
function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

function resetLinkFor(token: string): string {
  // The base URL is normalised without a trailing slash so the join cannot double it.
  return `${env.APP_WEB_BASE_URL.replace(/\/+$/, '')}/reset-password/${token}`;
}

function resetEmail(fullName: string, link: string): { subject: string; text: string; html: string } {
  const minutes = env.PASSWORD_RESET_TTL_MINUTES;
  const subject = 'Monhorus: нууц үг сэргээх';
  const text = [
    `Сайн байна уу, ${fullName}.`,
    '',
    'Таны бүртгэлийн нууц үгийг сэргээх хүсэлт ирлээ. Доорх холбоосоор орж шинэ нууц үгээ тохируулна уу:',
    link,
    '',
    `Энэ холбоос ${minutes} минутын дараа хүчингүй болно, зөвхөн нэг удаа ашиглагдана.`,
    'Хэрэв та энэ хүсэлтийг илгээгээгүй бол энэ захидлыг үл тоомсорлоно уу. Таны нууц үг хэвээр байна.',
  ].join('\n');

  // Hand-written and deliberately plain: there is no template engine in this project, and
  // a reset mail that renders as text in an old client is better than one that does not
  // render at all. The link is repeated as visible text because some clients strip hrefs.
  const html = [
    '<p>Сайн байна уу, ' + escapeHtml(fullName) + '.</p>',
    '<p>Таны бүртгэлийн нууц үгийг сэргээх хүсэлт ирлээ. Доорх холбоосоор орж шинэ нууц үгээ тохируулна уу:</p>',
    `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    `<p>Энэ холбоос ${minutes} минутын дараа хүчингүй болно, зөвхөн нэг удаа ашиглагдана.</p>`,
    '<p>Хэрэв та энэ хүсэлтийг илгээгээгүй бол энэ захидлыг үл тоомсорлоно уу. Таны нууц үг хэвээр байна.</p>',
  ].join('\n');

  return { subject, text, html };
}

/** The name is user-controlled and lands in an HTML body; five characters is the whole job. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Asks for a reset link.
 *
 * Returns nothing, always, and takes the same path whether or not the address belongs to
 * anybody. That is the entire security property of this endpoint: a caller who can tell a
 * registered address from an unregistered one has been handed a way to harvest the user
 * list, and a login form that resists enumeration is undone by a reset form that does not.
 *
 * The equalisation is deliberate on two axes. The response is identical — the controller
 * sends one fixed message for every outcome. And the WORK is comparable: the unknown-address
 * path burns a bcrypt cycle, exactly as `login` does, so the reply cannot be timed apart
 * from the path that hashes and stores a token.
 */
export async function requestPasswordReset(email: string, meta: RequestMeta): Promise<void> {
  const user = await User.findOne({ email });

  /**
   * A suspended account is treated as absent.
   *
   * Letting one reset its password would end with a working credential that still cannot
   * sign in, which reads to the user as a broken system, and it would also confirm the
   * address exists. `must_change_password` is NOT excluded: that status means the password
   * must change, and this is one of the two ways to change it.
   */
  if (!user || user.status === 'suspended') {
    // Same cost as the hashing branch, so the two cannot be told apart by a stopwatch.
    await burnPasswordCycle(email);
    logger.info({ ip: meta.ip }, 'Password reset requested for an address with no active account');
    return;
  }

  /**
   * Older outstanding links die when a new one is issued.
   *
   * Otherwise every request a user makes while hunting through their inbox leaves another
   * live key to the account lying in it, and the oldest is the one most likely to have been
   * forwarded or logged. One request, one live link.
   */
  await PasswordResetToken.updateMany(
    { user: user._id, consumedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'Superseded by a newer request' } },
  );

  const token = generateResetToken();
  await PasswordResetToken.create({
    user: user._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + env.passwordResetTtlMs),
    requestedUserAgent: meta.userAgent ?? null,
    requestedIp: meta.ip ?? null,
  });

  const { subject, text, html } = resetEmail(user.fullName, resetLinkFor(token));
  // Awaited but never throwing: see `sendMail`. A mail failure must not change what this
  // endpoint answers, or the failure itself becomes the enumeration oracle.
  await sendMail({ to: user.email, subject, text, html });

  await recordAudit({
    entityType: 'User',
    entityId: user._id,
    action: 'PasswordResetRequested',
    // No actor: nobody is signed in, and the person who typed the address is not yet known
    // to be the account holder. The request metadata is what identifies the caller.
    meta,
  });
}

export interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

/**
 * Redeems a reset link and sets the new password.
 *
 * Every failure — unknown token, expired, already used, revoked, or belonging to an account
 * that has since been suspended — answers with the same `RESET_TOKEN_INVALID`. Telling them
 * apart would let a holder of a leaked link learn whether it had already been spent.
 */
export async function resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
  const grant = await PasswordResetToken.findOne({ tokenHash: hashToken(input.token) });

  // `expiresAt` is compared here rather than trusted to the TTL index, which sweeps on its
  // own schedule and can leave an expired row readable for up to a minute.
  const usable =
    grant !== null &&
    grant.consumedAt === null &&
    grant.revokedAt === null &&
    grant.expiresAt.getTime() > Date.now();

  if (!grant || !usable) {
    throw AppError.badRequest(ERROR_CODES.RESET_TOKEN_INVALID);
  }

  const user = await User.findById(grant.user).select('+password');
  if (!user || user.status === 'suspended') {
    throw AppError.badRequest(ERROR_CODES.RESET_TOKEN_INVALID);
  }

  const previousStatus = user.status;

  /**
   * Consumed BEFORE the password is written.
   *
   * The update is conditional on the grant still being unconsumed, so two requests racing
   * with the same link produce one winner: the loser matches nothing and is refused. Doing
   * it in this order means the worst case is a spent token and an unchanged password — the
   * user asks for another link — rather than a changed password and a token still open for
   * a second, different change.
   */
  const claimed = await PasswordResetToken.updateOne(
    { _id: grant._id, consumedAt: null, revokedAt: null },
    { $set: { consumedAt: new Date() } },
  );
  if (claimed.modifiedCount !== 1) {
    throw AppError.badRequest(ERROR_CODES.RESET_TOKEN_INVALID);
  }

  user.password = await hashPassword(input.newPassword);
  user.passwordChangedAt = new Date();
  // Recovering the password is what the forced change was asking for, and it also clears a
  // lockout: somebody who has proved control of the registered mailbox should not be held
  // out by failed guesses that are very likely what sent them here.
  if (user.status === 'must_change_password') {
    user.status = 'active';
  }
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  // Any other outstanding link is now stale.
  await PasswordResetToken.updateMany(
    { user: user._id, consumedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'Password reset' } },
  );

  /**
   * Every session dies.
   *
   * A forgotten password is indistinguishable from a stolen one, so the reset has to end
   * whatever sessions exist — the whole point may be to evict somebody. `passwordChangedAt`
   * above closes the same door on outstanding access tokens.
   */
  await Session.updateMany(
    { user: user._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: 'Password reset' } },
  );

  await recordAudit({
    entityType: 'User',
    entityId: user._id,
    action: 'PasswordResetCompleted',
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
