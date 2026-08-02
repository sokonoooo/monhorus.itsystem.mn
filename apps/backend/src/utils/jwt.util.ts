import crypto from 'node:crypto';

import type { UserRole } from '@monhorus/shared';
import jwt, { type SignOptions } from 'jsonwebtoken';

import { AppError } from '../common/errors/app-error';
import { ERROR_CODES } from '../common/errors/error-codes';
import { env } from '../config/env';

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  /** Discriminator so a refresh token can never be presented as an access token. */
  type: 'access';
  /**
   * Issued-at, in seconds. Compared against the user's passwordChangedAt so a token
   * minted before a credential change is rejected for the remainder of its life.
   */
  issuedAt: number;
}

export interface RefreshTokenClaims {
  sub: string;
  jti: string;
  type: 'refresh';
}

export function signAccessToken(userId: string, role: UserRole): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    subject: userId,
  };
  return jwt.sign({ role, type: 'access' }, env.JWT_ACCESS_SECRET, options);
}

export function signRefreshToken(userId: string): { token: string; jti: string } {
  const jti = crypto.randomUUID();
  const options: SignOptions = {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    subject: userId,
    jwtid: jti,
  };
  const token = jwt.sign({ type: 'refresh' }, env.JWT_REFRESH_SECRET, options);
  return { token, jti };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

    if (typeof decoded === 'string' || !decoded.sub || decoded.type !== 'access') {
      throw AppError.unauthorized(ERROR_CODES.TOKEN_INVALID);
    }

    return {
      sub: String(decoded.sub),
      role: decoded.role as UserRole,
      type: 'access',
      issuedAt: typeof decoded.iat === 'number' ? decoded.iat : 0,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw AppError.unauthorized(ERROR_CODES.TOKEN_EXPIRED);
    }
    throw AppError.unauthorized(ERROR_CODES.TOKEN_INVALID);
  }
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

    if (typeof decoded === 'string' || !decoded.sub || decoded.type !== 'refresh') {
      throw AppError.unauthorized(ERROR_CODES.REFRESH_TOKEN_INVALID);
    }

    return { sub: String(decoded.sub), jti: String(decoded.jti ?? ''), type: 'refresh' };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.unauthorized(ERROR_CODES.REFRESH_TOKEN_INVALID);
  }
}

/** SHA-256 is correct here: the input is a signed JWT, not a guessable secret. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Seconds remaining on a signed access token, read back from the token itself. */
export function getTokenLifetimeSeconds(token: string): number {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded === 'string' || !decoded.exp) return 0;
  return Math.max(0, decoded.exp - Math.floor(Date.now() / 1000));
}
