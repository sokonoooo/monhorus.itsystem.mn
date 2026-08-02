import crypto from 'node:crypto';

import jwt, { type SignOptions } from 'jsonwebtoken';
import { Types } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { RequestContext } from '../../common/utils/request-context.util';
import { env } from '../../config/env';
import { RefreshToken, type RefreshTokenDocument } from '../user/refresh-token.model';
import type { AccessTokenClaims } from './auth.types';

const REFRESH_TOKEN_BYTES = 48;

// -- Access tokens ----------------------------------------------------------

export function signAccessToken(claims: AccessTokenClaims): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    subject: claims.sub,
  };

  return jwt.sign(
    {
      role: claims.role,
      perms: claims.perms,
      org: claims.org,
      office: claims.office,
      sid: claims.sid,
    },
    env.JWT_ACCESS_SECRET,
    options,
  );
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

    if (typeof decoded === 'string' || !decoded.sub) {
      throw AppError.unauthorized(ERROR_CODES.TOKEN_INVALID);
    }

    return {
      sub: String(decoded.sub),
      role: decoded.role,
      perms: Array.isArray(decoded.perms) ? decoded.perms : [],
      org: decoded.org ?? null,
      office: decoded.office ?? null,
      sid: decoded.sid ?? '',
    } as AccessTokenClaims;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized(ERROR_CODES.TOKEN_EXPIRED);
    }
    throw AppError.unauthorized(ERROR_CODES.TOKEN_INVALID);
  }
}

/** Seconds until an access token expires, derived from the signed token itself. */
export function getAccessTokenLifetimeSeconds(token: string): number {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string' || !decoded.exp) {
    return 0;
  }
  return Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
}

// -- Refresh tokens ---------------------------------------------------------

/** SHA-256 is correct here: the input is 48 bytes of entropy, not a guessable secret. */
export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export interface IssuedRefreshToken {
  rawToken: string;
  family: string;
  expiresAt: Date;
}

export async function issueRefreshToken(
  userId: Types.ObjectId,
  context: RequestContext,
  family?: string,
): Promise<IssuedRefreshToken> {
  const rawToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  const tokenFamily = family ?? crypto.randomUUID();
  const expiresAt = new Date(Date.now() + env.refreshTokenTtlMs);

  await RefreshToken.create({
    user: userId,
    tokenHash: hashRefreshToken(rawToken),
    family: tokenFamily,
    issuedAt: new Date(),
    expiresAt,
    channel: context.channel,
    userAgent: context.userAgent,
    appVersion: context.appVersion,
    deviceId: context.deviceId,
    ip: context.ip,
  });

  return { rawToken, family: tokenFamily, expiresAt };
}

export async function findRefreshToken(rawToken: string): Promise<RefreshTokenDocument | null> {
  return RefreshToken.findOne({ tokenHash: hashRefreshToken(rawToken) });
}

export async function revokeRefreshTokenById(
  id: Types.ObjectId,
  reason: string,
  replacedByHash: string | null = null,
): Promise<void> {
  await RefreshToken.updateOne(
    { _id: id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason, replacedByHash } },
  );
}

/**
 * Revokes every token in a rotation family. Called when a rotated token is replayed,
 * which indicates the refresh token was captured.
 */
export async function revokeTokenFamily(family: string, reason: string): Promise<number> {
  const result = await RefreshToken.updateMany(
    { family, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  return result.modifiedCount;
}

/** Used on password change and on administrative suspension. */
export async function revokeAllUserSessions(
  userId: Types.ObjectId,
  reason: string,
): Promise<number> {
  const result = await RefreshToken.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  return result.modifiedCount;
}

// -- Invitation tokens ------------------------------------------------------

export interface IssuedInvitationToken {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

export function generateInvitationToken(): IssuedInvitationToken {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  return {
    rawToken,
    tokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
    expiresAt: new Date(Date.now() + env.invitationTtlMs),
  };
}

export function hashInvitationToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
