import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_SEVERITIES,
  type NotificationEvent,
  type NotificationSeverity,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * In-app notification, requirements section 14.3.
 *
 * One row per recipient rather than one row with a recipient list: read state is per
 * person, and a shared row would need a parallel read-receipt collection to express the
 * same thing.
 *
 * There is no delivery-status field. Section 19.2 leaves the delivery channel open, so
 * nothing is sent outside the system and there is no external delivery to track.
 */
export interface INotification {
  recipient: Types.ObjectId;
  event: NotificationEvent;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: Types.ObjectId | null;
  linkPath: string | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    event: { type: String, enum: NOTIFICATION_EVENTS, required: true },
    severity: { type: String, enum: NOTIFICATION_SEVERITIES, required: true, default: 'INFO' },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    body: { type: String, default: null, maxlength: 2000 },
    entityType: { type: String, default: null },
    entityId: { type: Schema.Types.ObjectId, default: null },
    linkPath: { type: String, default: null, maxlength: 500 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/** The notification list is always "mine, newest first", optionally unread only. */
notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ entityType: 1, entityId: 1, event: 1 });

export const Notification: Model<INotification> = model<INotification>(
  'Notification',
  notificationSchema,
);
