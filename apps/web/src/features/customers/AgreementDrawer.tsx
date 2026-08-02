import {
  SERVICE_FREQUENCIES,
  SERVICE_FREQUENCY_LABELS,
  SLA_HOURS_STANDARD,
  SLA_HOURS_URGENT,
  createServiceAgreementSchema,
  type CreateServiceAgreementInput,
  type DispatchCandidateDto,
  type ServiceFrequency,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { serviceAgreementService } from '../../services/service-agreement.service';
import { dispatchService } from '../../services/service-request.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';

interface AgreementDrawerProps {
  open: boolean;
  customerId: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Creates a service agreement (Үйлчилгээний нөхцөл).
 *
 * Requirements 6.2 fields, with the section 8.1 SLA windows as defaults. New
 * agreements start as DRAFT; only an ACTIVE agreement permits calendar generation and
 * invoicing (requirements 6.3), and that transition is a separate status action.
 */
export function AgreementDrawer({
  open,
  customerId,
  onClose,
  onSaved,
}: AgreementDrawerProps): ReactElement {
  const { notify } = useToast();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [slaUrgentHours, setSlaUrgentHours] = useState(String(SLA_HOURS_URGENT));
  const [slaStandardHours, setSlaStandardHours] = useState(String(SLA_HOURS_STANDARD));
  const [frequency, setFrequency] = useState<ServiceFrequency | ''>('MONTHLY');
  const [calendarRule, setCalendarRule] = useState('');
  const [monthlyFee, setMonthlyFee] = useState('');
  const [responsibleEmployeeId, setResponsibleEmployeeId] = useState('');
  const [notes, setNotes] = useState('');

  const [employees, setEmployees] = useState<DispatchCandidateDto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return undefined;

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
  }, [open]);

  function reset(): void {
    setStartDate('');
    setEndDate('');
    setServiceType('');
    setSlaUrgentHours(String(SLA_HOURS_URGENT));
    setSlaStandardHours(String(SLA_HOURS_STANDARD));
    setFrequency('MONTHLY');
    setCalendarRule('');
    setMonthlyFee('');
    setResponsibleEmployeeId('');
    setNotes('');
    setFormError(null);
    setFieldErrors({});
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const payload: CreateServiceAgreementInput = {
      customerId,
      startDate,
      endDate,
      serviceType: serviceType.trim(),
      slaUrgentHours: Number(slaUrgentHours || SLA_HOURS_URGENT),
      slaStandardHours: Number(slaStandardHours || SLA_HOURS_STANDARD),
      frequency: frequency || null,
      calendarRule: calendarRule.trim() || null,
      monthlyFee: Number(monthlyFee || '0'),
      responsibleEmployeeId: responsibleEmployeeId || null,
      notes: notes.trim() || null,
    };

    const parsed = createServiceAgreementSchema.safeParse(payload);
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
      await serviceAgreementService.create(parsed.data);
      notify('Үйлчилгээний нөхцөл үүслээ. Төлөв: Ноорог.', 'success');
      reset();
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
      title="Шинэ үйлчилгээний нөхцөл"
      onClose={handleClose}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            Үүсгэх
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        <Alert variant="info">
          Шинэ нөхцөл Ноорог төлөвтэй үүснэ. Зөвхөн Идэвхтэй болсны дараа calendar
          болон нэхэмжлэл үүсэх боломжтой.
        </Alert>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Эхлэх огноо" required error={fieldErrors.startDate}>
            <TextInput type="date" value={startDate} onChange={setStartDate} disabled={submitting} />
          </Field>
          <Field label="Дуусах огноо" required error={fieldErrors.endDate}>
            <TextInput type="date" value={endDate} onChange={setEndDate} disabled={submitting} />
          </Field>
        </div>

        <Field label="Үйлчилгээний төрөл" required error={fieldErrors.serviceType}>
          <TextInput
            value={serviceType}
            onChange={setServiceType}
            placeholder="Жишээ: Урьдчилан сэргийлэх үзлэг, засвар"
            disabled={submitting}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Яаралтай SLA (цаг)"
            required
            error={fieldErrors.slaUrgentHours}
            hint={`Шаардлагын үндсэн утга: ${SLA_HOURS_URGENT} цаг`}
          >
            <TextInput
              type="number"
              value={slaUrgentHours}
              onChange={setSlaUrgentHours}
              disabled={submitting}
            />
          </Field>
          <Field
            label="Энгийн SLA (цаг)"
            required
            error={fieldErrors.slaStandardHours}
            hint={`Шаардлагын үндсэн утга: ${SLA_HOURS_STANDARD} цаг`}
          >
            <TextInput
              type="number"
              value={slaStandardHours}
              onChange={setSlaStandardHours}
              disabled={submitting}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Давтамж" error={fieldErrors.frequency}>
            <SelectInput
              value={frequency}
              onChange={(value) => setFrequency(value as ServiceFrequency)}
              placeholder="Сонгохгүй"
              options={SERVICE_FREQUENCIES.map((entry) => ({
                value: entry,
                label: SERVICE_FREQUENCY_LABELS[entry],
              }))}
              disabled={submitting}
            />
          </Field>
          <Field
            label="Calendar rule"
            error={fieldErrors.calendarRule}
            required={frequency === 'CUSTOM'}
            hint={frequency === 'CUSTOM' ? 'Custom давтамжид заавал' : 'Сонголттой'}
          >
            <TextInput value={calendarRule} onChange={setCalendarRule} disabled={submitting} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Сарын төлбөр" required error={fieldErrors.monthlyFee}>
            <TextInput type="number" value={monthlyFee} onChange={setMonthlyFee} disabled={submitting} />
          </Field>
          <Field label="Хариуцагч" error={fieldErrors.responsibleEmployeeId}>
            <SelectInput
              value={responsibleEmployeeId}
              onChange={setResponsibleEmployeeId}
              placeholder="Сонгохгүй"
              options={employees.map((employee) => ({
                value: employee.id,
                label: `${employee.lastName} ${employee.firstName}`,
              }))}
              disabled={submitting}
            />
          </Field>
        </div>

        <div>
          <label htmlFor="agreement-notes" className={FILTER_LABEL}>
            Тэмдэглэл
          </label>
          <textarea
            id="agreement-notes"
            rows={3}
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
