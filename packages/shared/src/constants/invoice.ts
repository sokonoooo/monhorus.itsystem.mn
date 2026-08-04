/**
 * Invoicing vocabulary, requirements section 12.
 *
 * Scope is fixed by 12.1: V1 has no payment gateway and no partial payment. Finance
 * approves a payment by hand and a payment always settles the invoice in full, which is
 * why there is no payment collection and no outstanding-balance field anywhere here.
 */

/**
 * Requirements 12.3.
 *
 * OVERDUE is deliberately absent from the stored set. It is derived at read time from the
 * due date, exactly as the planned-work module derives its overdue state: storing it would
 * need a scheduler to flip rows at midnight, and the row would then disagree with the clock
 * between runs. `InvoiceEffectiveStatus` below is what callers see.
 */
export const INVOICE_STATUSES = ['DRAFT', 'SENT', 'PAID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Ноорог',
  SENT: 'Илгээсэн',
  PAID: 'Төлөгдсөн',
  CANCELLED: 'Цуцалсан',
};

/**
 * Which invoices count as revenue, kept beside the statuses so the dashboard and the
 * report cannot drift apart — they are two code paths for one number.
 *
 * This is the stored form of `KPI_FORMULAS.MONTHLY_REVENUE`, "Илгээсэн болон төлөгдсөн
 * нэхэмжлэлийн нийт дүн". A DRAFT is excluded because it has not been issued and can still
 * be edited or dropped; CANCELLED is excluded because it was withdrawn. OVERDUE needs no
 * entry: it is not stored, it is a SENT invoice past its due date, and it is already in.
 */
export const INVOICE_REVENUE_STATUSES: readonly InvoiceStatus[] = ['SENT', 'PAID'];

export const INVOICE_EFFECTIVE_STATUSES = [
  'DRAFT',
  'SENT',
  'OVERDUE',
  'PAID',
  'CANCELLED',
] as const;
export type InvoiceEffectiveStatus = (typeof INVOICE_EFFECTIVE_STATUSES)[number];

export const INVOICE_EFFECTIVE_STATUS_LABELS: Record<InvoiceEffectiveStatus, string> = {
  DRAFT: 'Ноорог',
  SENT: 'Илгээсэн',
  OVERDUE: 'Хугацаа хэтэрсэн',
  PAID: 'Төлөгдсөн',
  CANCELLED: 'Цуцалсан',
};

/**
 * Requirements 12.3 forbids a duplicate invoice on the same customer, billing period and
 * billing type, so the billing type is part of the identity of an invoice rather than a
 * free-text label.
 */
export const INVOICE_BILLING_TYPES = ['MONTHLY_SERVICE', 'ADDITIONAL_SERVICE'] as const;
export type InvoiceBillingType = (typeof INVOICE_BILLING_TYPES)[number];

export const INVOICE_BILLING_TYPE_LABELS: Record<InvoiceBillingType, string> = {
  MONTHLY_SERVICE: 'Сарын үйлчилгээ',
  ADDITIONAL_SERVICE: 'Нэмэлт үйлчилгээ',
};

/**
 * Where a line came from.
 *
 * Requirements 12.2 names the monthly fee and the tax as the two generated components.
 * Everything else is entered by finance, so it is marked MANUAL and carries no hidden
 * charging rule: section 15.3 counts additional services and materials toward monthly
 * revenue but never states which ones become billable.
 */
export const INVOICE_LINE_SOURCES = ['AGREEMENT_MONTHLY_FEE', 'MANUAL'] as const;
export type InvoiceLineSource = (typeof INVOICE_LINE_SOURCES)[number];

export const INVOICE_LINE_SOURCE_LABELS: Record<InvoiceLineSource, string> = {
  AGREEMENT_MONTHLY_FEE: 'Үйлчилгээний нөхцөлөөс',
  MANUAL: 'Гараар нэмсэн',
};

/** Requirements 12.3: a paid invoice must carry the method and the reference. */
export const PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'CARD', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  BANK_TRANSFER: 'Банкны шилжүүлэг',
  CASH: 'Бэлэн мөнгө',
  CARD: 'Карт',
  OTHER: 'Бусад',
};

/**
 * Permitted transitions, requirements 12.3.
 *
 * A sent invoice is never edited back into a draft: it has already left the building. The
 * correction path is CANCELLED with a reason plus a replacement that carries the cancelled
 * invoice's reference, which 12.3 requires explicitly.
 */
export const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['PAID', 'CANCELLED'],
  PAID: [],
  CANCELLED: [],
};

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[from].includes(to);
}

/**
 * Section 19.2 leaves the overdue action unapproved: remind only, flag as risky, or
 * suspend service. Nothing is done automatically, and the screens say why.
 */
export const OVERDUE_ACTION_UNAPPROVED_NOTE =
  'Хугацаа хэтэрсэн нэхэмжлэлд авах арга хэмжээ батлагдаагүй тул систем автоматаар үйлдэл хийхгүй.';

/**
 * Requirements 12.2 sources tax from the finance settings but states no rate. Until
 * finance sets one, invoices are produced untaxed and the screens say so rather than
 * applying a rate nobody approved.
 */
export const TAX_UNSET_NOTE =
  'Татварын хувь 0 байна. Тохиргоо хэсэгт бодит хувийг оруулна уу.';
