import type {
  DevicePlatform,
  NotificationEvent,
  NotificationSeverity,
} from '../constants/notification';

export interface NotificationDto {
  id: string;
  event: NotificationEvent;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  /** Where the notification came from, so the row can link back to it. */
  entityType: string | null;
  entityId: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListQuery {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
  event?: NotificationEvent;
}

export interface NotificationUnreadCountDto {
  unread: number;
}

/**
 * A push registration for one app install.
 *
 * The token identifies the install, not the person: reinstalling the app, clearing its data
 * or restoring onto a new handset all produce a new token, and a handset handed to a
 * colleague keeps the old one. That is why the server keys on the token rather than on the
 * user, and why one user legitimately has several.
 *
 * The request shape lives in `deviceTokenRegisterSchema`; this is what comes back.
 */
export interface DeviceTokenDto {
  id: string;
  platform: DevicePlatform;
  appId: string | null;
  active: boolean;
  lastSeenAt: string;
  createdAt: string;
}
