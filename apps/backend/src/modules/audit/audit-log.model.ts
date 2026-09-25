import type { UserRole } from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * Requirements section 14.4 defines the base vocabulary; the authentication and
 * dispatch lifecycle actions are added because section 18.1 requires a log entry for
 * every create, update and delete.
 */
export const AUDIT_ACTIONS = [
  'Created',
  'Updated',
  'StatusChanged',
  'Assigned',
  'Submitted',
  'Approved',
  'Returned',
  // The canonical report chain ends one step past approval: publication is what makes a
  // report customer-visible, and that release has to be filterable apart from the
  // approval that merely settled it internally.
  'Published',
  'Closed',
  'Cancelled',
  'PasscodeReset',
  'PasswordChanged',
  'LoginSucceeded',
  'LoginFailed',
  'LoggedOut',
  'AccountLocked',
  'TokenReuseDetected',
  // Self-service password recovery. Request and completion are separate rows because they
  // are separate events with different actors: the request is made by whoever typed an
  // address into a public form and is not proof of anything, while the completion is the
  // one that actually changed a credential. A request with no matching completion is the
  // signal worth looking for, and folding them together would hide it.
  'PasswordResetRequested',
  'PasswordResetCompleted',
  // Planned work. These are named rather than folded into the generic vocabulary
  // because each is a distinct governance event that must be filterable on its own:
  // an overdue breach is written by the system with no human actor, and the report
  // workflow is a separate approval chain from the work lifecycle.
  'PLANNED_WORK_BECAME_OVERDUE',
  'PLANNED_WORK_RESCHEDULED',
  'PLANNED_WORK_ARCHIVED',
  'REPORT_CREATED',
  'REPORT_UPDATED',
  'REPORT_SUBMITTED',
  'REPORT_RETURNED',
  'REPORT_APPROVED',
  // Consolidated inspection report (requirements 7-11). Named separately from the
  // planned-work report actions because the two are distinct documents with distinct
  // approval chains, and the change history for one must be filterable without the other.
  'INSPECTION_REPORT_GENERATED',
  'INSPECTION_REPORT_UPDATED',
  'INSPECTION_REPORT_SUBMITTED',
  'INSPECTION_REPORT_APPROVED',
  'INSPECTION_REPORT_RETURNED',
  'INSPECTION_REPORT_FINALISED',
  'INSPECTION_REPORT_REOPENED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Immutable audit trail. Every update and delete path is blocked at the Mongoose
 * layer. Revoke update and delete privileges on this collection at the database
 * user level as well, before going to production.
 */
export interface IAuditLog {
  entityType: string;
  entityId: Types.ObjectId | null;
  action: AuditAction;
  user: Types.ObjectId | null;
  userRole: UserRole | null;
  /** Denormalised so the log stays readable if the user is later renamed. */
  userLabel: string | null;
  userAgent: string | null;
  ip: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    userRole: { type: String, default: null },
    userLabel: { type: String, default: null },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
    oldValue: { type: Schema.Types.Mixed, default: null },
    newValue: { type: Schema.Types.Mixed, default: null },
    reason: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

const IMMUTABLE = new Error('Audit log бичлэгийг өөрчлөх, устгах боломжгүй.');

for (const hook of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndReplace',
] as const) {
  auditLogSchema.pre(hook, function blockMutation(next) {
    next(IMMUTABLE);
  });
}

auditLogSchema.pre('save', function blockResave(next) {
  if (!this.isNew) {
    return next(IMMUTABLE);
  }
  return next();
});

export const AuditLog: Model<IAuditLog> = model<IAuditLog>('AuditLog', auditLogSchema);
