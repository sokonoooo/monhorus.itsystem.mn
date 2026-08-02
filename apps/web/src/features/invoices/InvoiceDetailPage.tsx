import {
  INVOICE_BILLING_TYPE_LABELS,
  INVOICE_LINE_SOURCE_LABELS,
  INVOICE_STATUS_LABELS,
  OVERDUE_ACTION_UNAPPROVED_NOTE,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PERMISSIONS,
  cancelInvoiceSchema,
  recordInvoicePaymentSchema,
  type InvoiceDetailDto,
  type PaymentMethod,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Drawer } from '../../components/ui/Drawer';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { invoiceService } from '../../services/invoice.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';
import { BillingTypeBadge, InvoiceStatusBadge, Money } from './InvoiceBadges';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-sm text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * Payment capture, requirements 12.3.
 *
 * The amount is prefilled with the invoice total and the backend rejects anything else:
 * V1 has no partial payment, so this is a confirmation rather than an open field.
 */
function PaymentDrawer({
  invoice,
  open,
  onClose,
  onSaved,
}: {
  invoice: InvoiceDetailDto;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { notify } = useToast();
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setPaidAt(new Date().toISOString().slice(0, 10));
    setMethod('BANK_TRANSFER');
    setReference('');
    setFormError(null);
    setFieldErrors({});
  }, [open]);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const parsed = recordInvoicePaymentSchema.safeParse({
      paidAt: `${paidAt}T00:00:00.000Z`,
      method,
      reference: reference.trim(),
      amount: invoice.total,
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
      await invoiceService.recordPayment(invoice.id, parsed.data);
      notify('Төлбөр бүртгэгдлээ.', 'success');
      onSaved();
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
      title="Төлбөр бүртгэх"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            Бүртгэх
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}
        <Alert variant="info">
          Төлбөр нэхэмжлэлийг бүрэн хаана. Хэсэгчлэн төлөлт V1-д байхгүй.
        </Alert>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Төлсөн огноо" required error={fieldErrors.paidAt}>
            <TextInput type="date" value={paidAt} onChange={setPaidAt} disabled={submitting} />
          </Field>
          <Field label="Хэлбэр" required error={fieldErrors.method}>
            <SelectInput
              value={method}
              onChange={(value) => setMethod(value as PaymentMethod)}
              options={PAYMENT_METHODS.map((entry) => ({
                value: entry,
                label: PAYMENT_METHOD_LABELS[entry],
              }))}
              disabled={submitting}
            />
          </Field>
          <Field label="Гүйлгээний дугаар" required error={fieldErrors.reference}>
            <TextInput value={reference} onChange={setReference} disabled={submitting} />
          </Field>
          <Field label="Дүн" hint="Нэхэмжлэлийн нийт дүнтэй тэнцүү">
            <TextInput
              value={`${invoice.total.toLocaleString('mn-MN')} ${invoice.currency}`}
              onChange={() => undefined}
              disabled
            />
          </Field>
        </div>
      </div>
    </Drawer>
  );
}

function CancelDrawer({
  invoice,
  open,
  onClose,
  onSaved,
}: {
  invoice: InvoiceDetailDto;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { notify } = useToast();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setFormError(null);
    }
  }, [open]);

  async function handleSubmit(): Promise<void> {
    const parsed = cancelInvoiceSchema.safeParse({ reason: reason.trim() });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Шалтгаан заавал.');
      return;
    }

    setSubmitting(true);
    try {
      await invoiceService.cancel(invoice.id, parsed.data);
      notify('Нэхэмжлэл цуцлагдлаа.', 'success');
      onSaved();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Цуцалж чадсангүй.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={open}
      title="Нэхэмжлэл цуцлах"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Болих
          </Button>
          <Button variant="danger" onClick={() => void handleSubmit()} loading={submitting}>
            Цуцлах
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}
        <Alert variant="warning">
          Цуцалсны дараа энэ тайлант үед шинэ нэхэмжлэл үүсгэж болно. Шинэ нэхэмжлэл дээр
          цуцалсан нэхэмжлэлийн дугаар хадгалагдана.
        </Alert>
        <div>
          <label htmlFor="cancel-reason" className={FILTER_LABEL}>
            Шалтгаан <span className="text-red-600">*</span>
          </label>
          <textarea
            id="cancel-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={submitting}
            className={FIELD_TEXTAREA}
          />
        </div>
      </div>
    </Drawer>
  );
}

export function InvoiceDetailPage(): ReactElement {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify } = useToast();

  const canSend = can(PERMISSIONS.INVOICE_SEND);
  const canPay = can(PERMISSIONS.INVOICE_RECORD_PAYMENT);
  const canCancel = can(PERMISSIONS.INVOICE_CANCEL);

  const [invoice, setInvoice] = useState<InvoiceDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!invoiceId) return;
    setLoading(true);
    setError(null);
    try {
      setInvoice(await invoiceService.getById(invoiceId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Нэхэмжлэл ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSend(): Promise<void> {
    if (!invoice) return;
    try {
      await invoiceService.send(invoice.id);
      notify('Нэхэмжлэл илгээгдлээ.', 'success');
      setSendOpen(false);
      await load();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Илгээж чадсангүй.', 'error');
      setSendOpen(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !invoice) return <ErrorState description={error ?? 'Нэхэмжлэл олдсонгүй.'} />;

  return (
    <>
      <PageHeader
        title={invoice.invoiceNumber}
        description={`${invoice.customerName ?? '-'} · ${INVOICE_BILLING_TYPE_LABELS[invoice.billingType]} · ${invoice.billingPeriod}`}
        backTo={{ to: '/invoices', label: 'Нэхэмжлэлийн жагсаалт руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Нэхэмжлэл ба төлбөр', to: '/invoices' },
          { label: invoice.invoiceNumber },
        ]}
        actions={
          <>
            {canSend && invoice.status === 'DRAFT' && (
              <Button onClick={() => setSendOpen(true)}>Илгээх</Button>
            )}
            {canPay && invoice.status === 'SENT' && (
              <Button onClick={() => setPaymentOpen(true)}>Төлбөр бүртгэх</Button>
            )}
            {canCancel && (invoice.status === 'DRAFT' || invoice.status === 'SENT') && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Цуцлах
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {invoice.effectiveStatus === 'OVERDUE' && (
          <Alert variant="warning" title={`${invoice.overdueDays} хоног хугацаа хэтэрсэн`}>
            {OVERDUE_ACTION_UNAPPROVED_NOTE}
          </Alert>
        )}

        {invoice.status === 'CANCELLED' && invoice.cancelReason && (
          <Alert variant="error" title="Цуцалсан">
            {invoice.cancelReason}
          </Alert>
        )}

        {invoice.replacesInvoiceNumber && (
          <Alert variant="info">
            Энэ нэхэмжлэл {invoice.replacesInvoiceNumber} нэхэмжлэлийг орлуулж үүссэн.
          </Alert>
        )}
        {invoice.replacedByInvoiceNumber && (
          <Alert variant="info">
            Энэ нэхэмжлэлийг {invoice.replacedByInvoiceNumber} нэхэмжлэл орлуулсан.
          </Alert>
        )}

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge status={invoice.effectiveStatus} overdueDays={invoice.overdueDays} />
            <BillingTypeBadge type={invoice.billingType} />
          </div>

          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Row label="Харилцагч">{invoice.customerName ?? '-'}</Row>
            <Row label="Үйлчилгээний нөхцөл">{invoice.serviceAgreementNumber ?? '-'}</Row>
            <Row label="Тайлант үе">{invoice.billingPeriod}</Row>
            <Row label="Огноо">{formatDate(invoice.issueDate)}</Row>
            <Row label="Төлөх хугацаа">{formatDate(invoice.dueDate)}</Row>
            <Row label="Илгээсэн">{formatDateTime(invoice.sentAt)}</Row>
            <Row label="Үүсгэсэн">{invoice.createdByName ?? '-'}</Row>
          </dl>

          {invoice.notes && (
            <p className="mt-4 whitespace-pre-wrap border-t border-slate-200 pt-4 text-sm text-slate-700">
              {invoice.notes}
            </p>
          )}
        </div>

        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold text-slate-900">
            Нэхэмжлэлийн мөр
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-5 py-2 text-left font-medium">Тайлбар</th>
                  <th className="px-5 py-2 text-left font-medium">Эх үүсвэр</th>
                  <th className="px-5 py-2 text-right font-medium">Тоо</th>
                  <th className="px-5 py-2 text-right font-medium">Нэгж үнэ</th>
                  <th className="px-5 py-2 text-right font-medium">Дүн</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="px-5 py-2.5 text-slate-900">{line.description}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-500">
                      {INVOICE_LINE_SOURCE_LABELS[line.source]}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-slate-700">
                      {line.quantity.toLocaleString('mn-MN')}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-slate-700">
                      {line.unitPrice.toLocaleString('mn-MN')}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-slate-900">
                      {line.amount.toLocaleString('mn-MN')}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50">
                <tr>
                  <td colSpan={4} className="px-5 py-2 text-right text-xs text-slate-600">
                    Дүн
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums text-slate-900">
                    {invoice.subtotal.toLocaleString('mn-MN')}
                  </td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-5 py-2 text-right text-xs text-slate-600">
                    Татвар ({invoice.taxPercent}%)
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums text-slate-900">
                    {invoice.taxAmount.toLocaleString('mn-MN')}
                  </td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-5 py-2 text-right text-sm font-semibold text-slate-900">
                    Нийт
                  </td>
                  <td className="px-5 py-2 text-right text-sm font-semibold">
                    <Money amount={invoice.total} currency={invoice.currency} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {invoice.payment && (
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Төлбөр</h2>
            <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Row label="Төлсөн огноо">{formatDate(invoice.payment.paidAt)}</Row>
              <Row label="Хэлбэр">{PAYMENT_METHOD_LABELS[invoice.payment.method]}</Row>
              <Row label="Гүйлгээний дугаар">{invoice.payment.reference}</Row>
              <Row label="Дүн">
                <Money amount={invoice.payment.amount} currency={invoice.currency} />
              </Row>
              <Row label="Бүртгэсэн">{invoice.payment.recordedByName ?? '-'}</Row>
            </dl>
          </div>
        )}

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Төлвийн түүх</h2>
                    <ul className="space-y-2">
            {invoice.statusHistory.map((entry) => (
              <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm text-slate-900">
                    {entry.fromStatus ? `${INVOICE_STATUS_LABELS[entry.fromStatus]} → ` : ''}
                    {INVOICE_STATUS_LABELS[entry.toStatus]}
                  </span>
                  <span className="text-xs text-slate-500">{formatDateTime(entry.changedAt)}</span>
                  <span className="text-xs text-slate-500">{entry.changedByName ?? '-'}</span>
                </div>
                {entry.reason && <p className="text-xs text-slate-600">{entry.reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <PaymentDrawer
        invoice={invoice}
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        onSaved={() => {
          setPaymentOpen(false);
          void load();
        }}
      />

      <CancelDrawer
        invoice={invoice}
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onSaved={() => {
          setCancelOpen(false);
          void load();
        }}
      />

      <ConfirmDialog
        open={sendOpen}
        title="Нэхэмжлэл илгээх"
        message={`"${invoice.invoiceNumber}" нэхэмжлэлийг илгээх үү? Илгээсний дараа зөвхөн цуцлах боломжтой.`}
        confirmLabel="Илгээх"
        onCancel={() => setSendOpen(false)}
        onConfirm={() => handleSend()}
      />

      <div className="mt-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/invoices')}>
          Жагсаалт руу буцах
        </Button>
      </div>
    </>
  );
}
