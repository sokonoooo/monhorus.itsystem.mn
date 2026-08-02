import { Schema, Types, model, type HydratedDocument, type Model } from 'mongoose';

import { AUDIT_CHANNELS, type AuditChannel } from '../../common/constants/audit.constant';

/**
 * Server-side session record. The raw refresh token never touches the database;
 * only its SHA-256 digest is stored, so a database leak cannot be replayed as a login.
 *
 * Tokens rotate on every refresh. All rotations of one login share a `family`.
 * Presenting an already-rotated token means the token was stolen, so the whole
 * family is revoked at once (req 16.2 - token/session хугацаатай).
 */
export interface IRefreshToken {
  user: Types.ObjectId;
  tokenHash: string;
  family: string;

  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  /** Hash of the token that superseded this one; used for reuse detection. */
  replacedByHash: string | null;

  channel: AuditChannel;
  userAgent: string | null;
  appVersion: string | null;
  deviceId: string | null;
  ip: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export type RefreshTokenDocument = HydratedDocument<IRefreshToken>;

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },

    issuedAt: { type: Date, required: true, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    replacedByHash: { type: String, default: null },

    channel: { type: String, enum: AUDIT_CHANNELS, default: 'WEB' },
    userAgent: { type: String, default: null },
    appVersion: { type: String, default: null },
    deviceId: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

// MongoDB purges expired sessions automatically.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// "List this user's live devices" and bulk revocation.
refreshTokenSchema.index({ user: 1, revokedAt: 1 });

export const RefreshToken: Model<IRefreshToken> = model<IRefreshToken>(
  'RefreshToken',
  refreshTokenSchema,
);
