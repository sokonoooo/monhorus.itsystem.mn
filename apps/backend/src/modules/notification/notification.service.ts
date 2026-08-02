import {
  NOTIFICATION_EVENT_SEVERITIES,
  type NotificationDto,
  type NotificationEvent,
  type NotificationListQueryInput,
  type PaginatedData,
  type PermissionKey,
} from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { logger } from '../../config/logger';
import { Role } from '../rbac/role.model';
import { User } from '../user/user.model';
import { Notification, type INotification } from './notification.model';

type WithId<T> = T & { _id: Types.ObjectId };

export interface NotifyInput {
  event: NotificationEvent;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: Types.ObjectId | string | null;
  linkPath?: string | null;
  /**
   * Requirements 14.3 names recipients by duty ("админ", "менежер"), not by user. A duty
   * is expressed here as the permission that duty holds, which is the only definition of
   * a role the system actually enforces. Roles are editable, so this stays correct after
   * an administrator rearranges them.
   */
  permission?: PermissionKey;
  /** Specific people, for example the employee a job was assigned to. */
  userIds?: readonly (Types.ObjectId | string)[];
  /** Never notify the person who caused the event. */
  excludeUserId?: Types.ObjectId | string | null;
}

function toObjectId(value: Types.ObjectId | string | null | undefined): Types.ObjectId | null {
  if (!value) return null;
  return value instanceof Types.ObjectId ? value : new Types.ObjectId(value);
}

/**
 * Short-lived cache of the permission-to-recipient resolution.
 *
 * Recipients are resolved on every notified domain event: every status change, assignment
 * and assessment. Re-deriving the role graph each time turns two extra queries into a
 * measurable cost on every write path, and the answer barely changes minute to minute.
 *
 * The window matches the settings cache, so a role edit takes effect within seconds
 * rather than needing a restart. Nothing here is an authorisation decision: access is
 * still checked per request by the middleware, and a stale entry can only mean a
 * notification lands in the wrong inbox for a few seconds, never that a request is let
 * through.
 */
const RECIPIENT_CACHE_TTL_MS = 15_000;

const recipientCache = new Map<string, { ids: Types.ObjectId[]; expiresAt: number }>();

/** Test seam, and used whenever roles or users are known to have changed. */
export function invalidateRecipientCache(): void {
  recipientCache.clear();
}

/**
 * Everyone who currently holds a permission.
 *
 * head_admin is included unconditionally, matching the superuser rule the authorisation
 * middleware applies, so a system with no configured roles still notifies someone.
 */
async function recipientsByPermission(permission: PermissionKey): Promise<Types.ObjectId[]> {
  const now = Date.now();
  const cached = recipientCache.get(permission);
  if (cached && cached.expiresAt > now) return cached.ids;

  const roles = await Role.find({ permissions: permission }).select('_id').lean();
  const roleIds = roles.map((role: { _id: Types.ObjectId }) => role._id);

  const users = await User.find({
    status: 'active',
    $or: [{ role: 'head_admin' }, ...(roleIds.length > 0 ? [{ roles: { $in: roleIds } }] : [])],
  })
    .select('_id')
    .lean();

  const ids = users.map((user) => user._id);
  recipientCache.set(permission, { ids, expiresAt: now + RECIPIENT_CACHE_TTL_MS });
  return ids;
}

/**
 * Writes one notification per recipient.
 *
 * Deliberately swallows its own failures, exactly as the audit writer does: a
 * notification must never turn a successful business operation into a 500. Failures are
 * logged so they surface in monitoring.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const recipients = new Map<string, Types.ObjectId>();

    if (input.permission) {
      for (const id of await recipientsByPermission(input.permission)) {
        recipients.set(String(id), id);
      }
    }
    for (const raw of input.userIds ?? []) {
      const id = toObjectId(raw);
      if (id) recipients.set(String(id), id);
    }

    const excluded = toObjectId(input.excludeUserId);
    if (excluded) recipients.delete(String(excluded));

    if (recipients.size === 0) return;

    const entityId = toObjectId(input.entityId);
    await Notification.insertMany(
      [...recipients.values()].map((recipient) => ({
        recipient,
        event: input.event,
        severity: NOTIFICATION_EVENT_SEVERITIES[input.event],
        title: input.title,
        body: input.body ?? null,
        entityType: input.entityType ?? null,
        entityId,
        linkPath: input.linkPath ?? null,
        readAt: null,
      })),
    );
  } catch (error) {
    logger.error({ err: error, event: input.event }, 'Failed to write notifications');
  }
}

function toDto(row: WithId<INotification>): NotificationDto {
  return {
    id: String(row._id),
    event: row.event,
    severity: row.severity,
    title: row.title,
    body: row.body,
    entityType: row.entityType,
    entityId: row.entityId ? String(row.entityId) : null,
    linkPath: row.linkPath,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotifications(
  query: NotificationListQueryInput,
  actor: AuthContext,
): Promise<PaginatedData<NotificationDto>> {
  // A notification is addressed to one person, so the recipient filter is not optional
  // and no permission grants sight of somebody else's inbox.
  const filter: FilterQuery<INotification> = { recipient: new Types.ObjectId(actor.userId) };
  if (query.unreadOnly) filter.readAt = null;
  if (query.event) filter.event = query.event;

  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(query.limit)
      .lean<WithId<INotification>[]>(),
    Notification.countDocuments(filter),
  ]);

  return {
    items: rows.map(toDto),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function unreadCount(actor: AuthContext): Promise<{ unread: number }> {
  const unread = await Notification.countDocuments({
    recipient: new Types.ObjectId(actor.userId),
    readAt: null,
  });
  return { unread };
}

export async function markRead(
  notificationId: string,
  actor: AuthContext,
): Promise<NotificationDto> {
  const row = await Notification.findOneAndUpdate(
    { _id: notificationId, recipient: new Types.ObjectId(actor.userId), readAt: null },
    { $set: { readAt: new Date() } },
    { new: true },
  ).lean<WithId<INotification> | null>();

  if (!row) {
    // Either it does not exist, belongs to somebody else, or was already read. All three
    // answer the same way, so one caller cannot probe another's inbox.
    const existing = await Notification.findOne({
      _id: notificationId,
      recipient: new Types.ObjectId(actor.userId),
    }).lean<WithId<INotification> | null>();
    if (existing) return toDto(existing);
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Мэдэгдэл олдсонгүй.');
  }

  return toDto(row);
}

export async function markAllRead(actor: AuthContext): Promise<{ updated: number }> {
  const result = await Notification.updateMany(
    { recipient: new Types.ObjectId(actor.userId), readAt: null },
    { $set: { readAt: new Date() } },
  );
  return { updated: result.modifiedCount };
}
