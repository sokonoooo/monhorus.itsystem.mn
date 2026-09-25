import { reschedulePlannedWorkSchema, type PlannedWorkDto } from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { plannedWorkService } from '../../services/planned-work.service';
import { Field, TextInput } from '../employees/FormControls';

interface RescheduleDrawerProps {
  work: PlannedWorkDto;
  open: boolean;
  onClose: () => void;
  onSaved: (work: PlannedWorkDto) => void;
}

/**
 * Authorised schedule change.
 *
 * This is the only way the planned end date moves, and therefore the only way an overdue
 * state is lifted. The reason is mandatory and is written to the audit trail together with
 * the old and the new date. Pausing never extends a deadline, so the paused duration shown
 * here is informational: an extension has to be requested explicitly.
 */
export function RescheduleDrawer({
  work,
  open,
  onClose,
  onSaved,
}: RescheduleDrawerProps): ReactElement {
  const { notify } = useToast();

  const [plannedEndDate, setPlannedEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setPlannedEndDate(work.plannedEndDate.slice(0, 10));
    setReason('');
    setFormError(null);
    setFieldErrors({});
  }, [open, work.plannedEndDate]);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const parsed = reschedulePlannedWorkSchema.safeParse({
      plannedEndDate: plannedEndDate ? `${plannedEndDate}T00:00:00.000Z` : '',
      reason: reason.trim(),
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
      const updated = await plannedWorkService.reschedule(work.id, parsed.data);
      notify('Хугацаа сунгагдлаа.', 'success');
      onSaved(updated);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError([caught.message, ...caught.issues.map((issue) => issue.message)].join(' '));
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
      title="Хугацаа сунгах"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            Сунгах
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        <Alert variant="warning">
          Хугацаа сунгах нь audit log-д бүртгэгдэх ажиллагаа. Эх хугацаа{' '}
          {work.originalPlannedEndDate.slice(0, 10)} хэвээр хадгалагдана.
        </Alert>

        <Field
          label="Одоогийн дуусах огноо"
          error={undefined}
          hint="Зөвхөн харах"
        >
          <TextInput value={work.plannedEndDate.slice(0, 10)} onChange={() => undefined} disabled />
        </Field>

        <Field label="Шинэ дуусах огноо" required error={fieldErrors.plannedEndDate}>
          <TextInput
            type="date"
            value={plannedEndDate}
            onChange={setPlannedEndDate}
            disabled={submitting}
          />
        </Field>

        <div>
          <label htmlFor="reschedule-reason" className={FILTER_LABEL}>
            Шалтгаан
            <span className="ml-0.5 text-red-600">*</span>
          </label>
          <textarea
            id="reschedule-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={submitting}
            className={FIELD_TEXTAREA}
          />
          {fieldErrors.reason && <p className="mt-1 text-xs text-red-600">{fieldErrors.reason}</p>}
        </div>
      </div>
    </Drawer>
  );
}
