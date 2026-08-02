import { EMPLOYEE_STATUSES, type EmployeeStatus } from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * Append-only employee status trail. Separate from the general audit log because the
 * employee detail page renders it as a first-class timeline and needs to query it by
 * employee without scanning the audit collection.
 */
export interface IEmployeeStatusHistory {
  employee: Types.ObjectId;
  fromStatus: EmployeeStatus | null;
  toStatus: EmployeeStatus;
  reason: string | null;
  changedBy: Types.ObjectId | null;
  changedByName: string | null;
  createdAt: Date;
}

const schema = new Schema<IEmployeeStatusHistory>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    fromStatus: { type: String, enum: [...EMPLOYEE_STATUSES, null], default: null },
    toStatus: { type: String, enum: EMPLOYEE_STATUSES, required: true },
    reason: { type: String, default: null, trim: true, maxlength: 500 },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    changedByName: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

schema.index({ employee: 1, createdAt: -1 });

const IMMUTABLE = new Error('Ажилтны төлөвийн түүхийг өөрчлөх боломжгүй.');

for (const hook of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany'] as const) {
  schema.pre(hook, function block(next) {
    next(IMMUTABLE);
  });
}

export const EmployeeStatusHistory: Model<IEmployeeStatusHistory> =
  model<IEmployeeStatusHistory>('EmployeeStatusHistory', schema);
