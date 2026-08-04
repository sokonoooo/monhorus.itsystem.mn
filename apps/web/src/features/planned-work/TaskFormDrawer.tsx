import {
  MATERIAL_UNITS,
  MATERIAL_UNIT_LABELS,
  createPlannedWorkTaskSchema,
  updatePlannedWorkTaskSchema,
  type DispatchCandidateDto,
  type MaterialUnit,
  type ObjectListItemDto,
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
import { objectMasterService } from '../../services/object-master.service';
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

/** A picked piece of equipment. `code` is absent when the row was hydrated from a saved task. */
interface EquipmentRow {
  id: string;
  name: string;
  code: string | null;
}

/**
 * Page size for the candidate list.
 *
 * `objectListQuerySchema` caps `limit` at 100 and the query is validated before the
 * handler runs, so asking for more is not a larger page — it is a 400 and an empty
 * picker. Anything above this silently turns the field into a dead control.
 */
const EQUIPMENT_PAGE_LIMIT = 100;

/**
 * The equipment a sub-task covers.
 *
 * Scoped exactly the way the backend scopes it: a sub-task that names a floor may only
 * cover equipment on THAT floor, and one that names none may cover anything in the work's
 * building. Offering a wider list would only produce a 400 on save.
 *
 * Deliberately not `FloorObjectPicker`: that component is a Drawer of its own that LINKS
 * unlinked objects to a floor and writes through `projectService.linkObjects`. This is a
 * field inside an existing drawer that selects already-placed equipment and writes nothing
 * — no part of it could be shared without turning the linker into something else.
 */
function TaskEquipmentPicker({
  buildingId,
  floorId,
  rows,
  disabled,
  onChange,
}: {
  buildingId: string;
  floorId: string;
  rows: readonly EquipmentRow[];
  disabled: boolean;
  onChange: (next: EquipmentRow[]) => void;
}): ReactElement {
  const [candidates, setCandidates] = useState<ObjectListItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  /** The list could not be fetched. Distinct from "fetched, and there is nothing". */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    objectMasterService
      .list(
        floorId
          ? { floorId, limit: EQUIPMENT_PAGE_LIMIT }
          : { buildingId, limit: EQUIPMENT_PAGE_LIMIT },
      )
      .then((page) => {
        if (cancelled) return;
        setCandidates(page.items);
        setTotal(page.total);
      })
      .catch(() => {
        if (cancelled) return;
        setCandidates([]);
        setTotal(0);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [buildingId, floorId]);

  const selected = new Set(rows.map((row) => row.id));
  const empty = !loading && !failed && candidates.length === 0;
  // The page is capped, so a bigger building can hold equipment this select never offers.
  const truncated = !loading && !failed && total > candidates.length;

  /**
   * The line under the select.
   *
   * Every branch says the field is optional, because the state that reads as a
   * requirement is exactly the one where nothing can be picked.
   */
  const hint = loading
    ? 'Ачааллаж байна…'
    : failed || empty
      ? undefined
      : floorId
        ? 'Зөвхөн сонгосон давхрын тоноглол. Сонгох албагүй.'
        : 'Давхар заагаагүй тул барилгын бүх тоноглол. Сонгох албагүй.';

  return (
    <div className="space-y-2">
      <Field label="Хамрах тоноглол (заавал бус)" hint={hint}>
        <SelectInput
          value=""
          onChange={(value) => {
            const object = candidates.find((entry) => entry.id === value);
            if (!object || selected.has(object.id)) return;
            onChange([...rows, { id: object.id, name: object.name, code: object.code }]);
          }}
          placeholder={
            loading
              ? 'Ачааллаж байна…'
              : failed
                ? 'Жагсаалт ачаалагдсангүй'
                : empty
                  ? 'Сонгох тоноглол алга'
                  : 'Тоноглол нэмэх'
          }
          options={candidates
            .filter((object) => !selected.has(object.id))
            .map((object) => ({
              value: object.id,
              label: object.code ? `${object.code} · ${object.name}` : object.name,
            }))}
          disabled={disabled || failed || empty}
        />
      </Field>

      {failed && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          Тоноглолын жагсаалтыг ачаалж чадсангүй. Дэд ажлыг тоноглолгүйгээр хадгалж болно.
        </p>
      )}

      {empty && (
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
          {floorId
            ? 'Энэ давхарт бүртгэлтэй тоноглол алга. Дэд ажлыг тоноглолгүйгээр хадгалж болно.'
            : 'Энэ барилгад бүртгэлтэй тоноглол алга. Дэд ажлыг тоноглолгүйгээр хадгалж болно.'}
        </p>
      )}

      {truncated && (
        <p className="text-xs text-slate-500">
          Нийт {total} тоноглолоос эхний {candidates.length} нь жагсав. Давхар сонгож
          нарийсгана уу.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg bg-blue-50 p-3 ring-1 ring-inset ring-blue-200">
          <p className="text-xs font-semibold text-blue-900">
            Тоноглол заавал биш — сонгоогүй ч хадгална.
          </p>
          <p className="mt-0.5 text-xs text-blue-800">
            Тоноглол сонгоогүй бол энэ дэд ажлын дүгнэлт Үзлэг ба дүгнэлт хэсэгт харагдахгүй:
            тэнд зөвхөн тоноглолд холбогдсон үр дүн жагсдаг.
          </p>
        </div>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-2.5 pr-1 text-xs text-slate-700"
            >
              <span className="truncate">{row.code ? `${row.code} · ${row.name}` : row.name}</span>
              <button
                type="button"
                disabled={disabled}
                aria-label={`${row.name} хасах`}
                onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))}
                className="rounded-full px-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
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
  const [equipment, setEquipment] = useState<readonly EquipmentRow[]>([]);
  /** Shown once, after a floor change has thrown a selection away. */
  const [equipmentCleared, setEquipmentCleared] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (target === null) return undefined;

    setFormError(null);
    setFieldErrors({});
    setEquipmentCleared(false);

    if (existing) {
      setFloorId(existing.floorId ?? '');
      setTitle(existing.title);
      setDescription(existing.description ?? '');
      setUnit(existing.unit);
      setTotalQuantity(String(existing.totalQuantity));
      setPlannedStartDate(toDateInput(existing.plannedStartDate));
      setPlannedEndDate(toDateInput(existing.plannedEndDate));
      setAssignedEmployeeId(existing.assignedEmployeeId ?? '');
      // The saved refs carry no code; the chip shows the name until the row is re-picked.
      setEquipment(
        existing.relatedObjects.map((ref) => ({ id: ref.id, name: ref.name, code: null })),
      );
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
      setEquipment([]);
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

  /**
   * Moves the sub-task to another floor, dropping equipment the move would invalidate.
   *
   * The backend admits a sub-task's equipment only from the floor it names, or from
   * anywhere in the building when it names none, so a floor change can turn an already
   * valid selection into a 400 on save. Rather than let that happen, the selection is
   * dropped exactly when the new scope is not a superset of the old one:
   *
   * - to a REAL floor, from anywhere else — narrowing. Equipment picked on another floor,
   *   or building-wide, need not be on this one, so it goes.
   * - to "Давхар заахгүй" — widening from one floor to the whole building. Everything
   *   already picked is still inside the building, so it is kept.
   *
   * Decided from the two ids alone rather than by re-checking the new floor's contents:
   * that list is paged, and a selection silently dropped because it fell past the page
   * limit would be worse than the 400 this avoids.
   */
  function handleFloorChange(nextFloorId: string): void {
    if (nextFloorId === floorId) return;
    const invalidated = nextFloorId !== '' && equipment.length > 0;
    setFloorId(nextFloorId);
    if (invalidated) setEquipment([]);
    setEquipmentCleared(invalidated);
  }

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
      relatedObjectIds: equipment.map((row) => row.id),
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
              onChange={handleFloorChange}
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

        {equipmentCleared && (
          <Alert variant="warning">
            Давхар өөрчлөгдсөн тул сонгосон тоноглол цуцлагдлаа. Шинэ давхраас дахин сонгоно уу.
          </Alert>
        )}

        <TaskEquipmentPicker
          buildingId={work.building.id}
          floorId={floorId}
          rows={equipment}
          disabled={submitting}
          onChange={(next) => {
            setEquipment(next);
            // The notice has been acted on the moment the list is touched again.
            setEquipmentCleared(false);
          }}
        />

        {fieldErrors.relatedObjectIds && (
          <Alert variant="error">{fieldErrors.relatedObjectIds}</Alert>
        )}

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
