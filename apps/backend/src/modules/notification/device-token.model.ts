import { DEVICE_PLATFORMS, type DevicePlatform } from '@monhorus/shared';
import { Schema, Types, model, type HydratedDocument, type Model } from 'mongoose';

/**
 * A push registration for one app install.
 *
 * The unit of identity is the token, not the user. A registration token belongs to an app
 * install on a handset: reinstalling, clearing app data or restoring onto a new phone mints
 * a new one, and Google may rotate one at any time without being asked. One person with a
 * phone and a tablet has two; one phone passed to a colleague carries a token that must
 * follow the new owner, not the old.
 *
 * That is why `token` is unique and `user` is not. Registration upserts on the token and
 * overwrites the owner, so a device that logs in as somebody else stops receiving the
 * previous user's notifications on the next registration rather than at some later cleanup.
 * Storing one token per user — the obvious shape — would silently drop push for every
 * additional device the person owns.
 */
export interface IDeviceToken {
  user: Types.ObjectId;

  /**
   * The customer organisation of the owning user, copied at registration.
   *
   * Denormalised deliberately. Push is addressed per user and inherits that user's
   * isolation, so nothing reads this to decide delivery — it exists so an operator
   * inspecting the collection can tell whose devices these are without joining, and so a
   * customer's registrations can be removed wholesale if their account is closed.
   * Null for staff, exactly as on the user record.
   */
  customer: Types.ObjectId | null;

  token: string;
  platform: DevicePlatform;

  /** Application identifier, so an employee install is distinguishable from a customer one. */
  appId: string | null;

  /**
   * False once FCM has told us the token is dead, or once the user has signed out.
   *
   * Rows are deactivated rather than deleted so a token that comes back — the same install
   * signing in again — keeps its history, and so a delivery failure can be told apart from
   * a device that was never registered.
   */
  active: boolean;

  /** Refreshed on every registration, which the apps repeat on each launch. */
  lastSeenAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type DeviceTokenDocument = HydratedDocument<IDeviceToken>;

const deviceTokenSchema = new Schema<IDeviceToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    token: { type: String, required: true, unique: true, trim: true, maxlength: 4096 },
    platform: { type: String, enum: DEVICE_PLATFORMS, required: true },
    appId: { type: String, default: null, trim: true, maxlength: 200 },
    active: { type: Boolean, required: true, default: true },
    lastSeenAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
);

/** Dispatch reads this: every live token for a set of recipients, on one platform. */
deviceTokenSchema.index({ user: 1, active: 1, platform: 1 });

export const DeviceToken: Model<IDeviceToken> = model<IDeviceToken>(
  'DeviceToken',
  deviceTokenSchema,
);
