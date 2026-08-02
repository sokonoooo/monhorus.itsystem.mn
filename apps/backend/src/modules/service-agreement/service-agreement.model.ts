import {
  SERVICE_AGREEMENT_STATUSES,
  SERVICE_FREQUENCIES,
  type ServiceAgreementStatus,
  type ServiceFrequency,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * Service agreement (Үйлчилгээний нөхцөл), requirements 6.2 and 6.3.
 *
 * Test case TC-002 states no separate contract module is created: the agreement is
 * part of the customer record. It is a child collection rather than an embedded array
 * because an agreement is renewed over time and each period must remain queryable.
 *
 * Only an ACTIVE agreement permits calendar generation and invoicing (requirements
 * 5.1 step 5, 6.3).
 */
export interface IServiceAgreementStatusHistory {
  _id: Types.ObjectId;
  fromStatus: ServiceAgreementStatus | null;
  toStatus: ServiceAgreementStatus;
  reason: string | null;
  changedBy: Types.ObjectId | null;
  changedByName: string | null;
  changedAt: Date;
}

export interface IServiceAgreement {
  agreementNumber: string;
  customer: Types.ObjectId;

  startDate: Date;
  endDate: Date;
  serviceType: string;

  /** Requirements 6.2 SLA, per agreement, defaulting to the section 8.1 values. */
  slaUrgentHours: number;
  slaStandardHours: number;

  frequency: ServiceFrequency | null;
  calendarRule: string | null;

  monthlyFee: number;
  currency: string;

  responsibleEmployee: Types.ObjectId | null;

  status: ServiceAgreementStatus;
  statusReason: string | null;
  statusHistory: IServiceAgreementStatusHistory[];

  attachments: Types.ObjectId[];
  notes: string | null;

  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const statusHistorySchema = new Schema<IServiceAgreementStatusHistory>(
  {
    fromStatus: { type: String, enum: [...SERVICE_AGREEMENT_STATUSES, null], default: null },
    toStatus: { type: String, enum: SERVICE_AGREEMENT_STATUSES, required: true },
    reason: { type: String, default: null, maxlength: 1000 },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    changedByName: { type: String, default: null },
    changedAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: true },
);

const serviceAgreementSchema = new Schema<IServiceAgreement>(
  {
    agreementNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    serviceType: { type: String, required: true, trim: true, maxlength: 200 },

    slaUrgentHours: { type: Number, required: true, min: 1 },
    slaStandardHours: { type: Number, required: true, min: 1 },

    frequency: { type: String, enum: [...SERVICE_FREQUENCIES, null], default: null },
    calendarRule: { type: String, default: null, trim: true, maxlength: 500 },

    monthlyFee: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'MNT' },

    responsibleEmployee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },

    status: { type: String, enum: SERVICE_AGREEMENT_STATUSES, default: 'DRAFT', index: true },
    statusReason: { type: String, default: null, maxlength: 1000 },
    statusHistory: { type: [statusHistorySchema], default: [] },

    attachments: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },
    notes: { type: String, default: null, trim: true, maxlength: 2000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

// Customer detail tab: newest agreement first.
serviceAgreementSchema.index({ customer: 1, startDate: -1 });
// Expiry sweep and the active-agreement dashboard counter.
serviceAgreementSchema.index({ status: 1, endDate: 1 });

export const ServiceAgreement: Model<IServiceAgreement> = model<IServiceAgreement>(
  'ServiceAgreement',
  serviceAgreementSchema,
);

/** Generates SA-YYYY-NNNN. Collisions are rejected by the unique index. */
export async function nextAgreementNumber(now: Date = new Date()): Promise<string> {
  const prefix = `SA-${now.getUTCFullYear()}-`;

  const latest = await ServiceAgreement.findOne({ agreementNumber: new RegExp(`^${prefix}`) })
    .sort({ agreementNumber: -1 })
    .select('agreementNumber')
    .lean();

  const lastSequence = latest
    ? Number.parseInt(latest.agreementNumber.slice(prefix.length), 10)
    : 0;
  const next = Number.isFinite(lastSequence) ? lastSequence + 1 : 1;

  return `${prefix}${String(next).padStart(4, '0')}`;
}
