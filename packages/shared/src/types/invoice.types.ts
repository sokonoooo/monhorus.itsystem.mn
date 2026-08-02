import type {
  InvoiceBillingType,
  InvoiceEffectiveStatus,
  InvoiceLineSource,
  InvoiceStatus,
  PaymentMethod,
} from '../constants/invoice';

/** One row of requirements 12.2. Amounts are whole currency units, never cents. */
export interface InvoiceLineDto {
  id: string;
  source: InvoiceLineSource;
  description: string;
  quantity: number;
  unitPrice: number;
  /** `quantity * unitPrice`, computed by the backend so the client never disagrees. */
  amount: number;
}

export interface InvoiceStatusHistoryDto {
  id: string;
  fromStatus: InvoiceStatus | null;
  toStatus: InvoiceStatus;
  reason: string | null;
  changedByName: string | null;
  changedAt: string;
}

export interface InvoicePaymentDto {
  paidAt: string;
  method: PaymentMethod;
  reference: string;
  amount: number;
  recordedByName: string | null;
}

export interface InvoiceListItemDto {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string | null;
  billingType: InvoiceBillingType;
  /** `YYYY-MM`, the period being billed rather than the date of issue. */
  billingPeriod: string;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  currency: string;
  status: InvoiceStatus;
  /** Section 12.3 OVERDUE, derived from the due date at read time. */
  effectiveStatus: InvoiceEffectiveStatus;
  /** Days past the due date on an unpaid invoice; null when not overdue. */
  overdueDays: number | null;
  createdAt: string;
}

export interface InvoiceDetailDto extends InvoiceListItemDto {
  serviceAgreementId: string | null;
  serviceAgreementNumber: string | null;
  lines: readonly InvoiceLineDto[];
  taxPercent: number;
  notes: string | null;
  sentAt: string | null;
  payment: InvoicePaymentDto | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** Section 12.3: a replacement carries the cancelled invoice it supersedes. */
  replacesInvoiceId: string | null;
  replacesInvoiceNumber: string | null;
  replacedByInvoiceId: string | null;
  replacedByInvoiceNumber: string | null;
  statusHistory: readonly InvoiceStatusHistoryDto[];
  createdByName: string | null;
  updatedAt: string;
  /** Reasons deletion is refused. Empty means deletion is allowed. */
  deleteBlockers: readonly string[];
}

export interface InvoiceListQuery {
  page?: number;
  limit?: number;
  search?: string;
  customerId?: string;
  status?: InvoiceEffectiveStatus;
  billingType?: InvoiceBillingType;
  /** `YYYY-MM`. */
  periodFrom?: string;
  periodTo?: string;
}

/** Receivables roll-up for the list header and the section 15.2 invoice report. */
export interface InvoiceSummaryDto {
  draftCount: number;
  sentCount: number;
  paidCount: number;
  overdueCount: number;
  cancelledCount: number;
  /** Issued but unpaid, section 15.3 "Авлага". */
  receivableTotal: number;
  overdueTotal: number;
  paidTotal: number;
  currency: string;
}

/**
 * What a monthly invoice would contain before it is created.
 *
 * Requirements 12.3 forbids a second invoice for the same customer, period and billing
 * type, so the preview reports the clash instead of letting the create fail late.
 */
export interface InvoiceGenerationCandidateDto {
  customerId: string;
  customerName: string;
  serviceAgreementId: string;
  serviceAgreementNumber: string;
  monthlyFee: number;
  currency: string;
  /** Non-null when an invoice already exists for this customer and period. */
  existingInvoiceId: string | null;
  existingInvoiceNumber: string | null;
}

export interface InvoiceGenerationPreviewDto {
  billingPeriod: string;
  taxPercent: number;
  candidates: readonly InvoiceGenerationCandidateDto[];
}
