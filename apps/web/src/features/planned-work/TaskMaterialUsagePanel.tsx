import {
  MATERIAL_UNIT_LABELS,
  recordTaskMaterialUsageSchema,
  type PlannedWorkDto,
  type PlannedWorkTaskDto,
} from '@monhorus/shared';
import { useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import { plannedWorkService } from '../../services/planned-work.service';
import { Field, SelectInput, TextInput, type Option } from '../employees/FormControls';

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

interface TaskMaterialUsagePanelProps {
  work: PlannedWorkDto;
  task: PlannedWorkTaskDto;
  /** `planned_work.record_progress`. Without it the panel reads, and offers nothing. */
  canRecord: boolean;
  /** The work is archived or cancelled, so nothing on it may be written any more. */
  isClosed: boolean;
  onSaved: (work: PlannedWorkDto) => void;
}

/**
 * What one sub-task drew from the work's registered materials, and the form that records it.
 *
 * Only materials REGISTERED ON THE WORK are offered: consumption draws against a pool the
 * plan defines, so there is nothing to draw from an item nobody registered. Registering one
 * is a separate, differently-permissioned act — see PlannedMaterialsDrawer.
 *
 * The quantity is what this sub-task has used IN TOTAL, so recording against the same
 * material twice corrects the figure instead of adding to it, and zero removes the row.
 * Selecting a material therefore fills the box with what is already recorded: the number in
 * front of the user is the number the server holds.
 *
 * NOTHING IS DISABLED ON A CALCULATED REMAINDER. The pool is shared by every sub-task, so
 * the remainder this screen last saw can be stale by the time the button is pressed; only
 * the server knows what is left at that instant, and its refusal — over-consumption, a
 * finished or skipped sub-task — is shown against the field it names rather than guessed at
 * here.
 */
export function TaskMaterialUsagePanel({
  work,
  task,
  canRecord,
  isClosed,
  onSaved,
}: TaskMaterialUsagePanelProps): ReactElement {
  const { notify } = useToast();

  const [materialItemId, setMaterialItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const options: readonly Option[] = work.materials.map((material) => ({
    value: material.materialItemId,
    label: `${material.name} (үлдэгдэл ${material.remainingQuantity.toLocaleString('mn-MN')} ${
      MATERIAL_UNIT_LABELS[material.unit]
    })`,
  }));

  function selectMaterial(nextId: string): void {
    setMaterialItemId(nextId);
    setFieldErrors({});
    setFormError(null);
    // Absolute, not an increment: the box starts on what this sub-task already has recorded.
    const existing = task.materialUsage.find((entry) => entry.materialItemId === nextId);
    setQuantity(existing ? String(existing.quantity) : '');
  }

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    if (quantity.trim() === '') {
      setFieldErrors({ quantity: 'Тоо хэмжээ оруулна уу.' });
      return;
    }

    const parsed = recordTaskMaterialUsageSchema.safeParse({
      materialItemId,
      quantity: Number(quantity),
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!errors[key]) errors[key] = issue.message;
      }
      if (materialItemId === '') errors.materialItemId = 'Материал сонгоно уу.';
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const updated = await plannedWorkService.recordMaterialUsage(work.id, task.id, parsed.data);
      // Zero is a deletion, and saying "recorded" after one would describe the opposite of
      // what happened.
      notify(
        parsed.data.quantity === 0
          ? 'Материалын зарцуулалт устлаа.'
          : 'Материалын зарцуулалт бүртгэгдлээ.',
        'success',
      );
      setMaterialItemId('');
      setQuantity('');
      onSaved(updated);
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
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs font-medium text-slate-600">
          Зарцуулсан материал ({task.materialUsage.length})
        </p>
        {task.materialUsage.length === 0 ? (
          <p className="text-xs text-slate-500">Энэ дэд ажилд материал зарцуулаагүй байна.</p>
        ) : (
          <ul className="space-y-1">
            {task.materialUsage.map((usage) => (
              <li
                key={usage.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-xs ring-1 ring-inset ring-slate-200"
              >
                <span className="text-slate-800">{usage.materialName}</span>
                <span className="font-medium text-slate-900">
                  {usage.quantity.toLocaleString('mn-MN')} {MATERIAL_UNIT_LABELS[usage.unit]}
                </span>
                <span className="text-slate-500">
                  {usage.recordedByName ?? '-'} · {formatDateTime(usage.recordedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {canRecord && !isClosed && (
        <div className="border-t border-slate-200 pt-3">
          {work.materials.length === 0 ? (
            <p className="text-xs text-slate-500">
              Ажилд материал бүртгэгдээгүй тул зарцуулалт бүртгэх боломжгүй. Эхлээд Материал
              засах хэсэгт материалаа бүртгэнэ.
            </p>
          ) : (
            <>
              {formError && <Alert variant="error">{formError}</Alert>}

              <div className="mt-2 grid grid-cols-1 items-start gap-2 sm:grid-cols-[2fr_1fr_auto]">
                <Field label="Материал" error={fieldErrors.materialItemId}>
                  <SelectInput
                    value={materialItemId}
                    onChange={selectMaterial}
                    options={options}
                    placeholder="Сонгох"
                    disabled={submitting}
                  />
                </Field>

                <Field
                  label="Зарцуулсан тоо хэмжээ"
                  error={fieldErrors.quantity}
                  hint="0 бол бүртгэл устна."
                >
                  <TextInput
                    value={quantity}
                    onChange={setQuantity}
                    type="number"
                    disabled={submitting}
                  />
                </Field>

                <div className="flex items-end pb-0.5 sm:pt-5">
                  <Button size="sm" onClick={() => void handleSubmit()} loading={submitting}>
                    Бүртгэх
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
