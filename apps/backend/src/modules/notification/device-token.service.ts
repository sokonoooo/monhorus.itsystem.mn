import type { DeviceTokenDto, DeviceTokenRegisterInput } from '@monhorus/shared';
import { PUSH_ENABLED_PLATFORMS } from '@monhorus/shared';
import { Types } from 'mongoose';

import { logger } from '../../config/logger';
import type { AuthContext } from '../../common/types/express';
import { User } from '../user/user.model';
import { DeviceToken, type IDeviceToken } from './device-token.model';
import { getPushTransport, type PushMessage } from './push.service';

function toDto(row: IDeviceToken & { _id: Types.ObjectId }): DeviceTokenDto {
  return {
    id: String(row._id),
    platform: row.platform,
    appId: row.appId,
    active: row.active,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Records this install against the calling user.
 *
 * Upserts on the token rather than on the user, because the token identifies the install.
 * Two consequences follow, both deliberate:
 *
 *  - One user may hold many rows. A person with a phone and a tablet gets push on both.
 *    Keying on the user would have silently kept only the device that registered last.
 *  - A token already held by somebody else is reassigned, not rejected. That is a real
 *    situation — a shared or handed-on handset — and the previous owner must stop receiving
 *    notifications on it the moment the new one registers, not whenever a cleanup runs.
 *
 * The apps call this on every launch, so it doubles as the liveness signal that keeps
 * `lastSeenAt` current.
 */
export async function registerDevice(
  input: DeviceTokenRegisterInput,
  actor: AuthContext,
): Promise<DeviceTokenDto> {
  const owner = await User.findById(actor.userId).select('customer').lean();

  const now = new Date();
  const row = await DeviceToken.findOneAndUpdate(
    { token: input.token },
    {
      $set: {
        user: new Types.ObjectId(actor.userId),
        customer: owner?.customer ?? null,
        platform: input.platform,
        appId: input.appId ?? null,
        active: true,
        lastSeenAt: now,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  return toDto(row as IDeviceToken & { _id: Types.ObjectId });
}

/**
 * Retires one registration, on sign-out.
 *
 * Scoped to the caller's own rows: a token string is guessable in principle, and without
 * the ownership predicate anyone holding one could silence somebody else's device. A token
 * that is absent or owned by another user reports success anyway — there is nothing for the
 * caller to do differently, and distinguishing the two would confirm that a token exists.
 */
export async function unregisterDevice(
  token: string,
  actor: AuthContext,
): Promise<{ deactivated: number }> {
  const result = await DeviceToken.updateOne(
    { token, user: new Types.ObjectId(actor.userId), active: true },
    { $set: { active: false } },
  );
  return { deactivated: result.modifiedCount };
}

/** Every live registration for these users, on a platform push is actually delivered to. */
export async function activeTokensFor(
  userIds: readonly Types.ObjectId[],
): Promise<(IDeviceToken & { _id: Types.ObjectId })[]> {
  if (userIds.length === 0) return [];
  return DeviceToken.find({
    user: { $in: userIds },
    active: true,
    platform: { $in: PUSH_ENABLED_PLATFORMS },
  }).lean() as Promise<(IDeviceToken & { _id: Types.ObjectId })[]>;
}

/**
 * Dispatches one notification to every device the recipients have registered.
 *
 * Never throws. Push is a secondary delivery: the notification row is already written and
 * is what the user sees when they open the app, so a failure here must not turn a
 * successfully recorded event into a failed request. Errors are logged and swallowed, the
 * same contract `notify()` itself keeps.
 */
export async function dispatchPush(
  recipients: readonly Types.ObjectId[],
  message: { title: string; body: string | null; event: string; linkPath: string | null },
): Promise<{ sent: number; deactivated: number }> {
  try {
    const devices = await activeTokensFor(recipients);
    if (devices.length === 0) return { sent: 0, deactivated: 0 };

    const payloads: PushMessage[] = devices.map((device) => ({
      token: device.token,
      title: message.title,
      body: message.body,
      /*
       * FCM data values must be strings, and the client reads these to route a tap. Nulls
       * are dropped rather than stringified, because "null" is a path the app would try.
       */
      data: {
        event: message.event,
        ...(message.linkPath ? { linkPath: message.linkPath } : {}),
      },
    }));

    const outcomes = await getPushTransport().send(payloads);

    /*
     * Only tokens FCM positively identified as dead are retired. A transient failure leaves
     * the registration alone — deactivating on any error would unsubscribe the whole estate
     * during an outage, and nothing would re-subscribe until each user reopened their app.
     */
    const dead = outcomes
      .filter((outcome) => outcome.status === 'unregistered')
      .map((outcome) => outcome.token);

    let deactivated = 0;
    if (dead.length > 0) {
      const result = await DeviceToken.updateMany(
        { token: { $in: dead } },
        { $set: { active: false } },
      );
      deactivated = result.modifiedCount;
    }

    const sent = outcomes.filter((outcome) => outcome.status === 'sent').length;
    const failed = outcomes.filter((outcome) => outcome.status === 'failed');
    if (failed.length > 0) {
      logger.warn(
        { event: message.event, failed: failed.length, reasons: failed.map((f) => f.reason) },
        'Some push deliveries failed',
      );
    }

    return { sent, deactivated };
  } catch (error) {
    logger.error({ err: error, event: message.event }, 'Push dispatch failed');
    return { sent: 0, deactivated: 0 };
  }
}
