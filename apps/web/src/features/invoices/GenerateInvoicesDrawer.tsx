import {
  TAX_UNSET_NOTE,
  generateMonthlyInvoicesSchema,
  type InvoiceGenerationCandidateDto,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import {
  INVOICE_FINANCE_UNAVAILABLE_NOTE,
  useInvoiceFinance,
} from '../../hooks/use-invoice-finance';
import { ApiError } from '../../lib/api-client';
import { addDays, currentMonthKey, todayDateKey } from '../../lib/business-day';
import { invoiceService } from '../../services/invoice.service';
import { Field, TextInput } from '../employees/FormControls';

/**
 * Monthly invoice run (requirements 12.1).
 *
 * The preview shows exactly what would be produced before anything is written, including
 * the customers that are already invoiced for the period. Requirements 12.3 forbids a
 * duplicate, so those are shown as blocked rather than being silently dropped.
 *
 * The due date defaults to `finance.invoice_due_days`, the same setting the single-invoice
 * drawer reads. This drawer used to hardcode 30, so a tenant with a 14-day term got 14 on
 * a one-off invoice and 30 on the whole monthly run — the two paths disagreed on the term
 * for the same customer. It then kept that 30 as a silent fallback when the read failed,
 * which is the same bug wearing a different hat, so a failed read now states no term at all.
 *
 * The tax rate is taken from the preview rather than from the settings, because the preview
 * is computed by the very call that will produce the invoices: it is the rate the server
 * will apply, not this screen's reading of the rate the server will apply.
 */
export function GenerateInvoicesDrawer({
  open,
  onClose,
  onGenerated,
}: {
  open: boolean;
  onClose: () => void;
  onGenerated: () => void;
}): ReactElement {
  const { notify } = useToast();

  const [billingPeriod, setBillingPeriod] = useState(() => currentMonthKey());
  const [issueDate, setIssueDate] = useState(() => todayDateKey());
  // Empty until `finance.invoice_due_days` is known — never a term nobody configured.
  const [dueDate, setDueDate] = useState('');

  const [candidates, setCandidates] = useState<InvoiceGenerationCandidateDto[]>([]);
  /** The run's rate, straight from the preview. Null while unknown — never assumed to be 0. */
  const [taxPercent, setTaxPercent] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The due-day default comes from the finance settings, exactly as `InvoiceFormDrawer`
  // reads it, so neither path hardcodes the term and neither invents one on failure.
  const finance = useInvoiceFinance(open);

  useEffect(() => {
    if (!open) return;
    setDueDate('');
  }, [open]);

  useEffect(() => {
    if (finance.status !== 'ready') return;
    setDueDate(addDays(todayDateKey(), finance.dueDays));
  }, [finance]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTaxPercent(null);

    invoiceService
      .generationPreview(billingPeriod)
      .then((preview) => {
        if (cancelled) return;
        setCandidates(preview.candidates as InvoiceGenerationCandidateDto[]);
        setTaxPercent(Number.isFinite(preview.taxPercent) ? preview.taxPercent : null);
        // Anything already invoiced starts unselected: it cannot be created again.
        setSelected(
          new Set(
            preview.candidates
              .filter((candidate) => candidate.existingInvoiceId === null)
              .map((candidate) => candidate.customerId),
          ),
        );
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setCandidates([]);
          setSelected(new Set());
          setError(caught instanceof ApiError ? caught.message : 'Урьдчилан харах боломжгүй.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, billingPeriod]);

  function toggle(customerId: string): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(customerId)) next.delete(customerId);
      else next.add(customerId);
      return next;
    });
  }

  async function handleSubmit(): Promise<void> {
    // The button is already disabled; this is the guard that does not depend on the button.
    if (finance.status !== 'ready') return;

    setError(null);
    const parsed = generateMonthlyInvoicesSchema.safeParse({
      billingPeriod,
      issueDate: `${issueDate}T00:00:00.000Z`,
      dueDate: `${dueDate}T00:00:00.000Z`,
      customerIds: [...selected],
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await invoiceService.generateMonthly(parsed.data);
      notify(
        result.skipped.length > 0
          ? `${result.created.length} нэхэмжлэл үүслээ. ${result.skipped.length} алгасагдлаа.`
          : `${result.created.length} нэхэмжлэл үүслээ.`,
        result.created.length > 0 ? 'success' : 'error',
      );
      onGenerated();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Боловсруулж чадсангүй.');
    } finally {
      setSubmitting(false);
    }
  }

  const selectable = candidates.filter((candidate) => candidate.existingInvoiceId === null);

  return (
    <Drawer
      open={open}
      title="Сарын нэхэмжлэл боловсруулах"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            loading={submitting}
            disabled={selected.size === 0 || finance.status !== 'ready'}
          >
            {selected.size} нэхэмжлэл үүсгэх
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        {finance.status === 'unavailable' && (
          <Alert variant="warning">{INVOICE_FINANCE_UNAVAILABLE_NOTE}</Alert>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Тайлант үе" required>
            <TextInput type="month" value={billingPeriod} onChange={setBillingPeriod} disabled={submitting} />
          </Field>
          <Field label="Огноо" required>
            <TextInput type="date" value={issueDate} onChange={setIssueDate} disabled={submitting} />
          </Field>
          <Field label="Төлөх хугацаа" required>
            <TextInput type="date" value={dueDate} onChange={setDueDate} disabled={submitting} />
          </Field>
        </div>

        {/*
          A zero rate is legal and the run still goes ahead; it is only made visible here,
          where the invoices are created, rather than in a help panel. Not an
          `Alert variant="info"` — every blue info notice was withdrawn from this app.
        */}
        {taxPercent === 0 && (
          <p className="text-xs font-medium text-amber-700">{TAX_UNSET_NOTE}</p>
        )}

        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : candidates.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
            Идэвхтэй үйлчилгээний нөхцөлтэй харилцагч алга.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {candidates.map((candidate) => {
              const blocked = candidate.existingInvoiceId !== null;
              return (
                <li
                  key={candidate.customerId}
                  className={`flex items-center gap-2 rounded-lg p-2 ring-1 ring-inset ${
                    blocked ? 'bg-slate-50 ring-slate-200' : 'bg-white ring-slate-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    id={`candidate-${candidate.customerId}`}
                    checked={selected.has(candidate.customerId)}
                    onChange={() => toggle(candidate.customerId)}
                    disabled={blocked || submitting}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <label htmlFor={`candidate-${candidate.customerId}`} className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-900">
                      {candidate.customerName}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {candidate.serviceAgreementNumber} ·{' '}
                      {candidate.monthlyFee.toLocaleString('mn-MN')} {candidate.currency}
                    </span>
                  </label>
                  {blocked && (
                    <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 ring-1 ring-inset ring-amber-200">
                      {candidate.existingInvoiceNumber} үүссэн
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {selectable.length > 0 && (
          <p className="text-xs text-slate-500">
            Боломжит {selectable.length}, сонгосон {selected.size}.
          </p>
        )}
      </div>
    </Drawer>
  );
}
