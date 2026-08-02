import {
  createCustomerSchema,
  type CreateCustomerInput,
  type DispatchCandidateDto,
} from '@monhorus/shared';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { FILTER_INPUT, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { dispatchService } from '../../services/service-request.service';
import { Field, Section, SelectInput, TextInput } from '../employees/FormControls';

interface FormState {
  code: string;
  name: string;
  registrationNumber: string;
  taxNumber: string;
  phone: string;
  email: string;
  address: string;
  contactPerson: string;
  responsibleEmployeeId: string;
  notes: string;
  isActive: boolean;
}

const EMPTY: FormState = {
  code: '', name: '', registrationNumber: '', taxNumber: '', phone: '', email: '',
  address: '', contactPerson: '', responsibleEmployeeId: '', notes: '', isActive: true,
};

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Customer create and edit.
 *
 * Requirements rule 17.2 fixes the V1 customer to an organisation, so there is
 * deliberately no individual-customer option even though the admin prototype shows
 * one. The conflict is recorded in docs/WEB_ADMIN_PHASE_1.md.
 */
export function CustomerFormPage(): ReactElement {
  const { customerId } = useParams<{ customerId: string }>();
  const isEdit = Boolean(customerId);
  const navigate = useNavigate();
  const { notify } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [employees, setEmployees] = useState<DispatchCandidateDto[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  }

  // The responsible person is an internal employee. The dispatch candidate endpoint
  // already returns only ACTIVE employees, which is exactly the eligible set.
  useEffect(() => {
    let cancelled = false;
    dispatchService
      .employeeCandidates({})
      .then((result) => {
        if (!cancelled) setEmployees(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!customerId) return undefined;

    let cancelled = false;
    setLoading(true);

    objectService
      .getCustomer(customerId)
      .then((customer) => {
        if (cancelled) return;
        setForm({
          code: customer.code,
          name: customer.name,
          registrationNumber: customer.registrationNumber ?? '',
          taxNumber: customer.taxNumber ?? '',
          phone: customer.phone ?? '',
          email: customer.email ?? '',
          address: customer.address ?? '',
          contactPerson: customer.contactPerson ?? '',
          responsibleEmployeeId: customer.responsibleEmployeeId ?? '',
          notes: customer.notes ?? '',
          isActive: customer.isActive,
        });
        setDirty(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setFormError(caught instanceof ApiError ? caught.message : 'Мэдээлэл ачаалж чадсангүй.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customerId]);

  useEffect(() => {
    if (!dirty) return undefined;
    function warn(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const payload: CreateCustomerInput = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      registrationNumber: nullable(form.registrationNumber),
      taxNumber: nullable(form.taxNumber),
      phone: nullable(form.phone),
      email: nullable(form.email),
      address: nullable(form.address),
      contactPerson: nullable(form.contactPerson),
      responsibleEmployeeId: nullable(form.responsibleEmployeeId),
      notes: nullable(form.notes),
    };

    // Same schema the API validates with.
    const parsed = createCustomerSchema.safeParse(payload);
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
      const saved = isEdit && customerId
        ? await objectService.updateCustomer(customerId, { ...parsed.data, isActive: form.isActive })
        : await objectService.createCustomer(parsed.data);
      setDirty(false);
      notify(isEdit ? 'Харилцагч шинэчлэгдлээ.' : 'Харилцагч үүслээ.', 'success');
      navigate(`/customers/${saved.id}`, { replace: true });
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

  function handleCancel(): void {
    if (dirty && !window.confirm('Хадгалаагүй өөрчлөлт байна. Гарах уу?')) return;
    navigate(isEdit && customerId ? `/customers/${customerId}` : '/customers');
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={isEdit ? 'Харилцагчийн мэдээлэл засах' : 'Шинэ харилцагч бүртгэх'}
        backTo={{ to: '/customers', label: 'Харилцагчийн жагсаалт руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Харилцагч', to: '/customers' },
          { label: isEdit ? 'Засах' : 'Шинэ' },
        ]}
      />

      <form onSubmit={handleSubmit} noValidate>
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="space-y-6 p-5">
            {formError && <Alert variant="error">{formError}</Alert>}

            <Section title="Байгууллагын мэдээлэл">
              <Field label="Код" required error={fieldErrors.code} hint="Жишээ: CT">
                <TextInput
                  value={form.code}
                  onChange={(value) => update('code', value.toUpperCase())}
                  disabled={submitting || isEdit}
                />
              </Field>
              <Field label="Байгууллагын нэр" required error={fieldErrors.name}>
                <TextInput value={form.name} onChange={(v) => update('name', v)} disabled={submitting} />
              </Field>
              <Field label="Регистрийн дугаар (РД)" error={fieldErrors.registrationNumber}>
                <TextInput
                  value={form.registrationNumber}
                  onChange={(v) => update('registrationNumber', v)}
                  disabled={submitting}
                />
              </Field>
              <Field label="Татвар төлөгчийн дугаар (ТТД)" error={fieldErrors.taxNumber}>
                <TextInput value={form.taxNumber} onChange={(v) => update('taxNumber', v)} disabled={submitting} />
              </Field>
              <Field label="Утас" error={fieldErrors.phone} hint="Жишээ: 7711-0000">
                <TextInput value={form.phone} onChange={(v) => update('phone', v)} disabled={submitting} />
              </Field>
              <Field label="Имэйл" error={fieldErrors.email}>
                <TextInput type="email" value={form.email} onChange={(v) => update('email', v)} disabled={submitting} />
              </Field>
              <Field label="Хаяг" error={fieldErrors.address}>
                <TextInput value={form.address} onChange={(v) => update('address', v)} disabled={submitting} />
              </Field>
            </Section>

            <Section title="Хариуцлага">
              <Field label="Холбоо барих хүн" error={fieldErrors.contactPerson}>
                <TextInput
                  value={form.contactPerson}
                  onChange={(v) => update('contactPerson', v)}
                  disabled={submitting}
                />
              </Field>
              <Field
                label="Хариуцсан ажилтан"
                error={fieldErrors.responsibleEmployeeId}
                hint="Зөвхөн идэвхтэй ажилтан"
              >
                <SelectInput
                  value={form.responsibleEmployeeId}
                  onChange={(v) => update('responsibleEmployeeId', v)}
                  placeholder="Сонгохгүй"
                  options={employees.map((employee) => ({
                    value: employee.id,
                    label: `${employee.lastName} ${employee.firstName}`,
                  }))}
                  disabled={submitting}
                />
              </Field>
              {isEdit && (
                <Field label="Төлөв">
                  <SelectInput
                    value={form.isActive ? 'true' : 'false'}
                    onChange={(v) => update('isActive', v === 'true')}
                    options={[
                      { value: 'true', label: 'Идэвхтэй' },
                      { value: 'false', label: 'Идэвхгүй' },
                    ]}
                    disabled={submitting}
                  />
                </Field>
              )}
            </Section>

            <div>
              <label htmlFor="customer-notes" className={FILTER_LABEL}>
                Тэмдэглэл
              </label>
              <textarea
                id="customer-notes"
                rows={4}
                value={form.notes}
                onChange={(event) => update('notes', event.target.value)}
                disabled={submitting}
                className={FILTER_INPUT}
              />
              {fieldErrors.notes && <p className="mt-1 text-xs text-red-600">{fieldErrors.notes}</p>}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <Button type="button" variant="secondary" onClick={handleCancel} disabled={submitting}>
              Цуцлах
            </Button>
            <Button type="submit" loading={submitting}>
              {isEdit ? 'Хадгалах' : 'Харилцагч үүсгэх'}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
