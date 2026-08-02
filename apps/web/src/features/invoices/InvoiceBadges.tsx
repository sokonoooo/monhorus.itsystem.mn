import {
  INVOICE_BILLING_TYPE_LABELS,
  INVOICE_EFFECTIVE_STATUS_LABELS,
  type InvoiceBillingType,
  type InvoiceEffectiveStatus,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

const BASE =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap';

const STATUS_STYLES: Record<InvoiceEffectiveStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-200',
  SENT: 'bg-blue-50 text-blue-700 ring-blue-200',
  OVERDUE: 'bg-red-50 text-red-700 ring-red-200',
  PAID: 'bg-green-50 text-green-700 ring-green-200',
  CANCELLED: 'bg-stone-800 text-stone-50 ring-stone-700',
};

/**
 * Requirements 12.3.
 *
 * The label comes from the effective status, so an unpaid invoice past its due date reads
 * as OVERDUE even though the stored status is still SENT.
 */
export function InvoiceStatusBadge({
  status,
  overdueDays,
}: {
  status: InvoiceEffectiveStatus;
  overdueDays?: number | null;
}): ReactElement {
  return (
    <span className={`${BASE} ${STATUS_STYLES[status]}`}>
      {INVOICE_EFFECTIVE_STATUS_LABELS[status]}
      {status === 'OVERDUE' && typeof overdueDays === 'number' ? ` (${overdueDays} хоног)` : ''}
    </span>
  );
}

export function BillingTypeBadge({ type }: { type: InvoiceBillingType }): ReactElement {
  return (
    <span className={`${BASE} bg-violet-50 text-violet-700 ring-violet-200`}>
      {INVOICE_BILLING_TYPE_LABELS[type]}
    </span>
  );
}

/** Whole currency units; MNT has no minor unit in practice. */
export function Money({
  amount,
  currency = 'MNT',
}: {
  amount: number;
  currency?: string;
}): ReactElement {
  return (
    <span className="whitespace-nowrap tabular-nums text-slate-900">
      {amount.toLocaleString('mn-MN')} {currency}
    </span>
  );
}
