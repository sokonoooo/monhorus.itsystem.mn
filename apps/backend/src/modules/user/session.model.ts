import { Schema, Types, model, type HydratedDocument, type Model } from 'mongoose';

/**
 * Server-side refresh session. Only the SHA-256 digest of the refresh token is
 * persisted, so a database leak cannot be replayed as a login. Rows expire
 * automatically through the TTL index on `expiresAt`.
 */
export interface ISession {
  user: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionDocument = HydratedDocument<ISession>;

const sessionSchema = new Schema<ISession>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

// MongoDB purges expired sessions automatically.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Bulk revocation and "list this user's live devices".
sessionSchema.index({ user: 1, revokedAt: 1 });

export const Session: Model<ISession> = model<ISession>('Session', sessionSchema);
