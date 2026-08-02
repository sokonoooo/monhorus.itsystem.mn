import type { NotificationEvent, NotificationSeverity } from '../constants/notification';

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
