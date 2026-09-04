import {
  INVOICE_BILLING_TYPES,
  INVOICE_BILLING_TYPE_LABELS,
  TAX_UNSET_NOTE,
  createInvoiceSchema,
  type CustomerDto,
  type InvoiceBillingType,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { addDaysToToday, currentMonthInput, todayDateInput } from '../../lib/calendar-date';
import {
  INVOICE_FINANCE_UNAVAILABLE_NOTE,
  useInvoiceFinance,
} from '../../hooks/use-invoice-finance';
import { invoiceTotals } from '../../lib/invoice-totals';
import { invoiceService } from '../../services/invoice.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';

interface LineDraft {
  description: string;
  quantity: string;
  unitPrice: string;
}

function emptyLine(): LineDraft {
  return { description: '', quantity: '1', unitPrice: '' };
}

function toNumber(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** Today plus the configured due-day count, as a `yyyy-mm-dd` value for a date input. */
function addDays(days: number): string {
  return addDaysToToday(days);
}

/**
 * Creates a one-off invoice (requirements 12.2).
 *
 * Lines are entered by hand. Section 15.3 counts additional services and materials toward
 * monthly revenue but never states which become billable, so nothing is pulled in
 * automatically: finance decides what goes on the invoice and the system records it.
 */
export function InvoiceFormDrawer({
  open,
  customers,
  onClose,
  onSaved,
}: {
  open: boolean;
  customers: readonly CustomerDto[];
  onClose: () => void;
  onSaved: (invoiceId: string) => void;
}): ReactElement {
  const { notify } = useToast();

  const [customerId, setCustomerId] = useState('');
  const [billingType, setBillingType] = useState<InvoiceBillingType>('ADDITIONAL_SERVICE');
  const [billingPeriod, setBillingPeriod] = useState(() => currentMonthInput());
  const [issueDate, setIssueDate] = useState(() => todayDateInput());
  // Empty until `finance.invoice_due_days` is known. It deliberately does not start at 30:
  // a term nobody configured, printed on a document the customer is expected to pay by
  // that date, is a figure this drawer has no business inventing.
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /**
   * Tax and the due-day default come from the finance settings and from nowhere else.
   *
   * A null rate means the settings could not be read, which is a different state from a
   * rate of zero and is rendered as one: no percentage, no total, and no submission.
   */
  const finance = useInvoiceFinance(open);
  const taxPercent = finance.status === 'ready' ? finance.taxPercent : null;

  useEffect(() => {
    if (!open) return;
    setCustomerId('');
    setBillingType('ADDITIONAL_SERVICE');
    setBillingPeriod(currentMonthInput());
    setIssueDate(todayDateInput());
    setDueDate('');
    setNotes('');
    setLines([emptyLine()]);
    setFormError(null);
    setFieldErrors({});
  }, [open]);

  // Fires once per successful read, because the hook produces one state object per fetch.
  // A due date the user has since typed over is therefore never clobbered.
  useEffect(() => {
    if (finance.status !== 'ready') return;
    setDueDate(addDays(finance.dueDays));
  }, [finance]);

  function updateLine(index: number, patch: Partial<LineDraft>): void {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, ...patch } : line)),
    );
  }

  // Only the subtotal is knowable without the rate; the tax and total below are rendered
  // as a dash until one is, rather than as a zero the server would disagree with.
  const { subtotal, taxAmount, total } = invoiceTotals(
    lines.map((line) => ({
      quantity: toNumber(line.quantity),
      unitPrice: toNumber(line.unitPrice),
    })),
    taxPercent ?? 0,
  );

  async function handleSubmit(): Promise<void> {
    // The button is already disabled; this is the guard that does not depend on the button.
    if (finance.status !== 'ready') return;

    setFormError(null);
    setFieldErrors({});

    const parsed = createInvoiceSchema.safeParse({
      customerId,
      billingType,
      billingPeriod,
      issueDate: `${issueDate}T00:00:00.000Z`,
      dueDate: `${dueDate}T00:00:00.000Z`,
      lines: lines.map((line) => ({
        description: line.description.trim(),
        quantity: toNumber(line.quantity),
        unitPrice: toNumber(line.unitPrice),
      })),
      notes: notes.trim() || null,
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await invoiceService.create(parsed.data);
      notify('Нэхэмжлэл үүслээ.', 'success');
      onSaved(created.id);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setFormError('Гэнэтийн алдаа гарлаа.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={open}
      title="Шинэ нэхэмжлэл"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            loading={submitting}
            disabled={finance.status !== 'ready'}
          >
            Хадгалах
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}
        {finance.status === 'unavailable' && (
          <Alert variant="warning">{INVOICE_FINANCE_UNAVAILABLE_NOTE}</Alert>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Харилцагч" required error={fieldErrors.customerId}>
            <SelectInput
              value={customerId}
              onChange={setCustomerId}
              placeholder="Харилцагч сонгох"
              options={customers.map((customer) => ({ value: customer.id, label: customer.name }))}
              disabled={submitting}
            />
          </Field>
          <Field label="Төрөл" required error={fieldErrors.billingType}>
            <SelectInput
              value={billingType}
              onChange={(value) => setBillingType(value as InvoiceBillingType)}
              options={INVOICE_BILLING_TYPES.map((type) => ({
                value: type,
                label: INVOICE_BILLING_TYPE_LABELS[type],
              }))}
              disabled={submitting}
            />
          </Field>
          <Field
            label="Тайлант үе"
            required
            error={fieldErrors.billingPeriod}
            hint="Нэг харилцагчид нэг үед нэг л нэхэмжлэл"
          >
            <TextInput type="month" value={billingPeriod} onChange={setBillingPeriod} disabled={submitting} />
          </Field>
          <Field label="Огноо" required error={fieldErrors.issueDate}>
            <TextInput type="date" value={issueDate} onChange={setIssueDate} disabled={submitting} />
          </Field>
          <Field label="Төлөх хугацаа" required error={fieldErrors.dueDate}>
            <TextInput type="date" value={dueDate} onChange={setDueDate} disabled={submitting} />
          </Field>
        </div>

        <fieldset aria-label="Нэхэмжлэлийн мөр">
          <legend className="mb-2 w-full border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-900">
            Мөрүүд
          </legend>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div
                key={index}
                className="grid grid-cols-1 gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-[1fr_80px_120px_auto]"
              >
                <TextInput
                  value={line.description}
                  onChange={(value) => updateLine(index, { description: value })}
                  placeholder="Тайлбар"
                  disabled={submitting}
                />
                <TextInput
                  type="number"
                  value={line.quantity}
                  onChange={(value) => updateLine(index, { quantity: value })}
                  disabled={submitting}
                />
                <TextInput
                  type="number"
                  value={line.unitPrice}
                  onChange={(value) => updateLine(index, { unitPrice: value })}
                  placeholder="Нэгж үнэ"
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  disabled={submitting || lines.length === 1}
                  className="rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-40"
                >
                  Хасах
                </button>
              </div>
            ))}
          </div>
          {fieldErrors.lines && <p className="mt-1 text-xs text-red-600">{fieldErrors.lines}</p>}
          <div className="mt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLines((current) => [...current, emptyLine()])}
              disabled={submitting}
            >
              Мөр нэмэх
            </Button>
          </div>
        </fieldset>

        <div>
          <dl className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Дүн</dt>
              <dd className="tabular-nums text-slate-900">{subtotal.toLocaleString('mn-MN')}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">
                {taxPercent === null ? 'Татвар' : `Татвар (${taxPercent}%)`}
              </dt>
              <dd className="tabular-nums text-slate-900">
                {taxPercent === null ? '—' : taxAmount.toLocaleString('mn-MN')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Нийт</dt>
              <dd className="font-semibold tabular-nums text-slate-900">
                {taxPercent === null ? '—' : total.toLocaleString('mn-MN')}
              </dd>
            </div>
          </dl>
          {/*
            A zero rate is legal and is left working; it is only made impossible to miss,
            beside the figure it explains. Not an `Alert variant="info"`: every blue info
            notice was withdrawn from this app on purpose and the pattern does not come back.
          */}
          {taxPercent === 0 && (
            <p className="mt-1.5 text-xs font-medium text-amber-700">{TAX_UNSET_NOTE}</p>
          )}
        </div>

        <div>
          <label htmlFor="invoice-notes" className={FILTER_LABEL}>
            Тэмдэглэл
          </label>
          <textarea
            id="invoice-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={submitting}
            className={FIELD_TEXTAREA}
          />
        </div>
      </div>
    </Drawer>
  );
}
