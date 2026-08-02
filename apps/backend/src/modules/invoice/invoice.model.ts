import {
  INVOICE_BILLING_TYPES,
  INVOICE_LINE_SOURCES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  type InvoiceBillingType,
  type InvoiceLineSource,
  type InvoiceStatus,
  type PaymentMethod,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * Invoice, requirements section 12.
 *
 * Two shapes are deliberately absent.
 *
 * There is no Payment collection: 12.1 excludes partial payment from V1 and 12.3 requires
 * the payment amount to equal the invoice total, so a settled invoice carries exactly one
 * payment and it is embedded. Adding partial payment later means adding the collection,
 * not unpicking a wrong one.
 *
 * There is no stored OVERDUE status: 12.3 defines it against the due date, and a stored
 * flag would need a scheduler to flip rows at midnight and would disagree with the clock
 * in between. The effective status is derived on read.
 */
export interface IInvoiceLine {
  _id: Types.ObjectId;
  source: InvoiceLineSource;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface IInvoiceStatusHistory {
  _id: Types.ObjectId;
  fromStatus: InvoiceStatus | null;
  toStatus: InvoiceStatus;
  reason: string | null;
  changedBy: Types.ObjectId | null;
  changedByName: string | null;
  changedAt: Date;
}

export interface IInvoice {
  invoiceNumber: string;
  customer: Types.ObjectId;
  serviceAgreement: Types.ObjectId | null;

  billingType: InvoiceBillingType;
  /** `YYYY-MM`. Stored as a string so the uniqueness index in 12.3 is a plain compound. */
  billingPeriod: string;

  issueDate: Date;
  dueDate: Date;

  lines: IInvoiceLine[];
  subtotal: number;
  /** The rate in force when the invoice was produced, kept so a later rate change cannot rewrite history. */
  taxPercent: number;
  taxAmount: number;
  total: number;
  currency: string;

  status: InvoiceStatus;
  statusHistory: IInvoiceStatusHistory[];

  sentAt: Date | null;

  paidAt: Date | null;
  paymentMethod: PaymentMethod | null;
  paymentReference: string | null;
  paymentAmount: number | null;
  paymentRecordedBy: Types.ObjectId | null;
  paymentRecordedByName: string | null;

  cancelledAt: Date | null;
  cancelReason: string | null;

  /** Section 12.3: a replacement keeps the reference of the invoice it supersedes. */
  replacesInvoice: Types.ObjectId | null;

  notes: string | null;

  createdBy: Types.ObjectId | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const lineSchema = new Schema<IInvoiceLine>(
  {
    source: { type: String, enum: INVOICE_LINE_SOURCES, required: true },
    description: { type: String, required: true, trim: true, maxlength: 300 },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: true },
);

const statusHistorySchema = new Schema<IInvoiceStatusHistory>(
  {
    fromStatus: { type: String, enum: [...INVOICE_STATUSES, null], default: null },
    toStatus: { type: String, enum: INVOICE_STATUSES, required: true },
    reason: { type: String, default: null, maxlength: 1000 },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    changedByName: { type: String, default: null },
    changedAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: true },
);

const invoiceSchema = new Schema<IInvoice>(
  {
    invoiceNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    serviceAgreement: { type: Schema.Types.ObjectId, ref: 'ServiceAgreement', default: null },

    billingType: { type: String, enum: INVOICE_BILLING_TYPES, required: true },
    billingPeriod: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },

    issueDate: { type: Date, required: true },
    dueDate: { type: Date, required: true },

    lines: { type: [lineSchema], default: [] },
    subtotal: { type: Number, required: true, min: 0 },
    taxPercent: { type: Number, required: true, min: 0, max: 100 },
    taxAmount: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'MNT' },

    status: { type: String, enum: INVOICE_STATUSES, required: true, default: 'DRAFT', index: true },
    statusHistory: { type: [statusHistorySchema], default: [] },

    sentAt: { type: Date, default: null },

    paidAt: { type: Date, default: null },
    paymentMethod: { type: String, enum: [...PAYMENT_METHODS, null], default: null },
    paymentReference: { type: String, default: null, trim: true, maxlength: 120 },
    paymentAmount: { type: Number, default: null, min: 0 },
    paymentRecordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    paymentRecordedByName: { type: String, default: null },

    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null, maxlength: 1000 },

    replacesInvoice: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },

    notes: { type: String, default: null, maxlength: 2000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: null },
  },
  { timestamps: true },
);

/**
 * Requirements 12.3: no duplicate invoice on the same customer, billing period and
 * billing type.
 *
 * The index is partial so a cancelled invoice frees its slot. Without that, cancelling a
 * wrong invoice would permanently block the correct one for that period, which is the
 * opposite of what the same clause asks for when it requires a replacement to carry the
 * cancelled invoice's reference.
 */
invoiceSchema.index(
  { customer: 1, billingPeriod: 1, billingType: 1 },
  { unique: true, partialFilterExpression: { status: { $ne: 'CANCELLED' } } },
);

invoiceSchema.index({ dueDate: 1, status: 1 });
invoiceSchema.index({ billingPeriod: 1 });

export const Invoice: Model<IInvoice> = model<IInvoice>('Invoice', invoiceSchema);

/**
 * `INV-YYYYMM-NNNN`, matching the SR- and PW- document numbers already in use.
 *
 * The sequence is per issue month, not per billing period, so a late invoice for an
 * earlier period still numbers in the order it was actually raised.
 */
export async function nextInvoiceNumber(now: Date = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `INV-${year}${month}-`;

  const latest = await Invoice.findOne({ invoiceNumber: new RegExp(`^${prefix}`) })
    .sort({ invoiceNumber: -1 })
    .select('invoiceNumber')
    .lean();

  const lastSequence = latest ? Number.parseInt(latest.invoiceNumber.slice(prefix.length), 10) : 0;
  const next = Number.isFinite(lastSequence) ? lastSequence + 1 : 1;

  return `${prefix}${String(next).padStart(4, '0')}`;
}
