import {
  MATERIAL_UNITS,
  MATERIAL_UNIT_LABELS,
  createPlannedWorkTaskSchema,
  updatePlannedWorkTaskSchema,
  type DispatchCandidateDto,
  type MaterialUnit,
  type ObjectNodeDto,
  type PlannedWorkDto,
  type PlannedWorkTaskDto,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { plannedWorkService } from '../../services/planned-work.service';
import { dispatchService } from '../../services/service-request.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';

interface TaskFormDrawerProps {
  work: PlannedWorkDto;
  /** An existing task, the literal 'new', or null when closed. */
  target: PlannedWorkTaskDto | null | 'new';
  onClose: () => void;
  onSaved: (work: PlannedWorkDto) => void;
}

function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Create and edit a sub-task.
 *
 * There is no status field: task status is derived by the backend from completed quantity
 * plus the evidence gate. Completed quantity is not editable here either, so a planner
 * cannot award progress; that happens on the progress drawer.
 */
export function TaskFormDrawer({
  work,
  target,
  onClose,
  onSaved,
}: TaskFormDrawerProps): ReactElement {
  const { notify } = useToast();
  const isNew = target === 'new';
  const existing = target !== null && target !== 'new' ? target : null;

  const [floors, setFloors] = useState<ObjectNodeDto[]>([]);
  const [employees, setEmployees] = useState<DispatchCandidateDto[]>([]);

  const [floorId, setFloorId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState<MaterialUnit>('PIECE');
  const [totalQuantity, setTotalQuantity] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState('');
  const [plannedEndDate, setPlannedEndDate] = useState('');
  const [assignedEmployeeId, setAssignedEmployeeId] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (target === null) return undefined;

    setFormError(null);
    setFieldErrors({});

    if (existing) {
      setFloorId(existing.floorId ?? '');
      setTitle(existing.title);
      setDescription(existing.description ?? '');
      setUnit(existing.unit);
      setTotalQuantity(String(existing.totalQuantity));
      setPlannedStartDate(toDateInput(existing.plannedStartDate));
      setPlannedEndDate(toDateInput(existing.plannedEndDate));
      setAssignedEmployeeId(existing.assignedEmployeeId ?? '');
    } else {
      setFloorId('');
      setTitle('');
      setDescription('');
      setUnit('PIECE');
      setTotalQuantity('');
      // Default to the parent window so the containment rule is satisfied by default.
      setPlannedStartDate(toDateInput(work.plannedStartDate));
      setPlannedEndDate(toDateInput(work.plannedEndDate));
      setAssignedEmployeeId('');
    }

    let cancelled = false;
    void Promise.all([
      objectService.children(work.building.id).catch(() => [] as ObjectNodeDto[]),
      dispatchService.employeeCandidates({}).catch(() => [] as DispatchCandidateDto[]),
    ]).then(([children, candidates]) => {
      if (cancelled) return;
      setFloors(children.filter((node) => node.kind === 'FLOOR'));
      setEmployees(candidates);
    });

    return () => {
      cancelled = true;
    };
  }, [target, existing, work.building.id, work.plannedStartDate, work.plannedEndDate]);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const payload = {
      floorId: floorId || null,
      title: title.trim(),
      description: description.trim() || null,
      unit,
      totalQuantity: Number(totalQuantity || '0'),
      plannedStartDate: plannedStartDate ? `${plannedStartDate}T00:00:00.000Z` : '',
      plannedEndDate: plannedEndDate ? `${plannedEndDate}T00:00:00.000Z` : '',
      assignedEmployeeId: assignedEmployeeId || null,
    };

    const parsed = isNew
      ? createPlannedWorkTaskSchema.safeParse(payload)
      : updatePlannedWorkTaskSchema.safeParse(payload);

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
      const updated = isNew
        ? await plannedWorkService.createTask(
            work.id,
            parsed.data as Parameters<typeof plannedWorkService.createTask>[1],
          )
        : await plannedWorkService.updateTask(
            work.id,
            existing!.id,
            parsed.data as Parameters<typeof plannedWorkService.updateTask>[2],
          );
      notify(isNew ? 'Дэд ажил нэмэгдлээ.' : 'Дэд ажил шинэчлэгдлээ.', 'success');
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
    <Drawer
      open={target !== null}
      title={isNew ? 'Шинэ дэд ажил' : (existing?.title ?? '')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            Хадгалах
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        <Alert variant="info">
          Дэд ажлын хугацаа эцэг ажлын хугацаанд байх ёстой. Төлөв нь биелэлт, баримтаас
          автоматаар тодорхойлогдох тул гараар сонгохгүй.
        </Alert>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Дэд ажлын нэр" required error={fieldErrors.title}>
            <TextInput value={title} onChange={setTitle} disabled={submitting} />
          </Field>

          <Field label="Давхар" error={fieldErrors.floorId}>
            <SelectInput
              value={floorId}
              onChange={setFloorId}
              placeholder="Давхар заахгүй"
              options={floors.map((floor) => ({ value: floor.id, label: floor.name }))}
              disabled={submitting}
            />
          </Field>

          <Field label="Хийх тоо хэмжээ" required error={fieldErrors.totalQuantity}>
            <TextInput
              type="number"
              value={totalQuantity}
              onChange={setTotalQuantity}
              disabled={submitting}
            />
          </Field>

          <Field label="Хэмжих нэгж" required error={fieldErrors.unit}>
            <SelectInput
              value={unit}
              onChange={(value) => setUnit(value as MaterialUnit)}
              options={MATERIAL_UNITS.map((entry) => ({
                value: entry,
                label: MATERIAL_UNIT_LABELS[entry],
              }))}
              disabled={submitting}
            />
          </Field>

          <Field label="Эхлэх огноо" required error={fieldErrors.plannedStartDate}>
            <TextInput
              type="date"
              value={plannedStartDate}
              onChange={setPlannedStartDate}
              disabled={submitting}
            />
          </Field>

          <Field label="Дуусах огноо" required error={fieldErrors.plannedEndDate}>
            <TextInput
              type="date"
              value={plannedEndDate}
              onChange={setPlannedEndDate}
              disabled={submitting}
            />
          </Field>

          <Field label="Хариуцах ажилтан" error={fieldErrors.assignedEmployeeId}>
            <SelectInput
              value={assignedEmployeeId}
              onChange={setAssignedEmployeeId}
              placeholder="Ажилтан сонгох"
              options={employees.map((employee) => ({
                value: employee.id,
                label: `${employee.lastName} ${employee.firstName}`,
              }))}
              disabled={submitting}
            />
          </Field>
        </div>

        <div>
          <label htmlFor="task-description" className={FILTER_LABEL}>
            Тайлбар
          </label>
          <textarea
            id="task-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={submitting}
            className={FIELD_TEXTAREA}
          />
        </div>
      </div>
    </Drawer>
  );
}
