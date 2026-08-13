import { Schema, Types, model, type HydratedDocument, type Model } from 'mongoose';

/**
 * A single-use password-reset grant, modelled on `Session`.
 *
 * Only the SHA-256 digest of the token is stored, for the same reason the refresh session
 * stores only a digest: a dump of this collection must not yield anything replayable. The
 * raw token exists exactly twice — in the mail, and in the link the reader clicks.
 *
 * `consumedAt` is what makes the link single-use. It is separate from `revokedAt` because
 * the two answer different questions: consumed means it did its job, revoked means it was
 * taken away (superseded by a newer request, or invalidated because the password changed by
 * another route). Both block a second use; keeping them apart is what lets the audit trail
 * say which happened.
 */
export interface IPasswordResetToken {
  user: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  /** Where the request came from, so a suspicious reset can be traced afterwards. */
  requestedUserAgent: string | null;
  requestedIp: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PasswordResetTokenDocument = HydratedDocument<IPasswordResetToken>;

const passwordResetTokenSchema = new Schema<IPasswordResetToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    requestedUserAgent: { type: String, default: null },
    requestedIp: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

/**
 * MongoDB purges expired grants automatically.
 *
 * The TTL is a floor cleaner, not the expiry check: Mongo's background sweep runs about
 * once a minute, so a row can outlive `expiresAt` briefly. Every read compares the date
 * itself rather than trusting the row's continued existence to mean it is live.
 */
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Superseding a user's outstanding grants when they ask again.
passwordResetTokenSchema.index({ user: 1, consumedAt: 1, revokedAt: 1 });

export const PasswordResetToken: Model<IPasswordResetToken> = model<IPasswordResetToken>(
  'PasswordResetToken',
  passwordResetTokenSchema,
);
