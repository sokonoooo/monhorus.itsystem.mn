import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../common/errors/app-error';
import { ERROR_CODES } from '../common/errors/error-codes';
import { Employee } from '../modules/employee/employee.model';
import { resolveEffectivePermissions } from '../modules/rbac/rbac.service';
import { User } from '../modules/user/user.model';
import { verifyAccessToken } from '../utils/jwt.util';

function extractBearerToken(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;

  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;

  return token.trim();
}

/**
 * Verifies the Bearer JWT, then re-reads the user from the database.
 *
 * The extra read is deliberate. A 15-minute token would otherwise let a suspended
 * account or a demoted role keep acting on stale claims until the token expired.
 * One indexed lookup per request is the correct trade for a console that gates
 * user provisioning and credential resets.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      throw AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED);
    }

    const claims = verifyAccessToken(token);

    const user = await User.findById(claims.sub).select(
      'email fullName role roles status passwordChangedAt customer',
    );
    if (!user) {
      throw AppError.unauthorized(ERROR_CODES.TOKEN_INVALID);
    }

    if (user.status === 'suspended') {
      throw AppError.forbidden(ERROR_CODES.ACCOUNT_SUSPENDED);
    }

    // Revoking refresh sessions does not invalidate an access token already in the
    // wild, so a stolen one would outlive a password change or an administrative
    // passcode reset by up to its full TTL. Any token minted before the credential
    // changed is rejected. The one-second slack absorbs the fact that `iat` has
    // whole-second resolution while passwordChangedAt is a millisecond timestamp.
    if (user.passwordChangedAt) {
      const changedAtSeconds = Math.floor(user.passwordChangedAt.getTime() / 1000);
      if (claims.issuedAt + 1 < changedAtSeconds) {
        throw AppError.unauthorized(
          ERROR_CODES.TOKEN_INVALID,
          'Нууц үг өөрчлөгдсөн тул дахин нэвтэрнэ үү.',
        );
      }
    }

    // Resolved together so the employee link costs no extra round trip: the permission
    // union and the link lookup are independent reads.
    const [permissions, employeeLink] = await Promise.all([
      resolveEffectivePermissions(user.role, user.roles),
      // THE ONE PLACE the user-to-employee relationship is resolved. Every caller reads
      // `req.auth.employeeId`; no controller performs its own employee lookup, so there
      // is a single definition of "which employee is signed in" and a single query to
      // keep an eye on.
      //
      // Cost: one covered lookup on the unique partial index over `Employee.systemUser`,
      // projected to `_id` and returned lean, so nothing is hydrated into a Mongoose
      // document. Read every request rather than cached in the token because a re-link
      // must take effect immediately — see the note on `AuthContext.employeeId`.
      Employee.findOne({ systemUser: user._id }).select('_id').lean(),
    ]);

    req.auth = {
      userId: String(user._id),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      // Re-read every request, like the permission set and for the same reason: a customer
      // link changed by an administrator must take effect at once, not when the token expires.
      customerId: user.customer ? String(user.customer) : null,
      employeeId: employeeLink ? String(employeeLink._id) : null,
      roleIds: user.roles.map((roleId) => String(roleId)),
      permissions,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Blocks a must_change_password user from reaching anything except the endpoints
 * needed to resolve that state. Mount AFTER `authenticate`.
 *
 * Without this, an admin-issued temporary passcode would grant full access for as
 * long as the holder simply never visited the change-password screen.
 */
export async function enforcePasswordChange(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = req.auth;
    if (!auth) {
      throw AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED);
    }

    const user = await User.findById(auth.userId).select('status');
    if (user?.status === 'must_change_password') {
      throw AppError.forbidden(ERROR_CODES.PASSWORD_CHANGE_REQUIRED);
    }

    next();
  } catch (error) {
    next(error);
  }
}

/** Type-narrowing guard for handlers that always run behind `authenticate`. */
export function requireAuth(req: Pick<Request, 'auth'>): NonNullable<Request['auth']> {
  if (!req.auth) {
    throw AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED);
  }
  return req.auth;
}
