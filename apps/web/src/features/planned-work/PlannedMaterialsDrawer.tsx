import {
  MATERIAL_UNITS,
  MATERIAL_UNIT_LABELS,
  plannedWorkMaterialsSchema,
  type MaterialUnit,
  type PlannedWorkDto,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_INPUT, FIELD_SELECT, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { plannedWorkService } from '../../services/planned-work.service';

interface PlannedMaterialsDrawerProps {
  work: PlannedWorkDto;
  open: boolean;
  onClose: () => void;
  onSaved: (work: PlannedWorkDto) => void;
}

interface Row {
  name: string;
  quantity: string;
  unit: MaterialUnit;
}

/**
 * The material list of a planned work.
 *
 * Requirements 19.2 keeps V1 at "нэр/тоо": the name is typed rather than picked, because
 * there is no catalogue to pick from. The whole list is sent on save, so a row needs no
 * identifier of its own.
 */
export function PlannedMaterialsDrawer({
  work,
  open,
  onClose,
  onSaved,
}: PlannedMaterialsDrawerProps): ReactElement {
  const { notify } = useToast();

  const [rows, setRows] = useState<Row[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setRows(
      work.materials.map((entry) => ({
        name: entry.name,
        quantity: String(entry.quantity),
        unit: entry.unit,
      })),
    );
    setFormError(null);
  }, [open, work.materials]);

  function updateRow(index: number, patch: Partial<Row>): void {
    setRows((current) =>
      current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    );
  }

  async function handleSubmit(): Promise<void> {
    setFormError(null);

    const parsed = plannedWorkMaterialsSchema.safeParse({
      materials: rows
        .filter((row) => row.name.trim().length > 0)
        .map((row) => ({
          name: row.name.trim(),
          quantity: Number(row.quantity || '0'),
          unit: row.unit,
        })),
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Оруулсан мэдээлэл буруу байна.');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await plannedWorkService.setMaterials(work.id, parsed.data);
      notify('Материал шинэчлэгдлээ.', 'success');
      onSaved(updated);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Гэнэтийн алдаа гарлаа.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={open}
      title="Материал"
      onClose={onClose}
      width="lg"
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

        {rows.length === 0 && (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
            Материал бүртгээгүй байна.
          </p>
        )}

        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li
              // Rows carry no identifier, so the position is the key. It is stable while
              // the list is being edited because a removal rebuilds every row below it.
              key={`material-row-${index}`}
              className="rounded-lg p-3 ring-1 ring-inset ring-slate-200"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <div>
                  <label
                    htmlFor={`material-name-${index}`}
                    className={FILTER_LABEL}
                  >
                    Нэр
                  </label>
                  <input
                    id={`material-name-${index}`}
                    type="text"
                    value={row.name}
                    onChange={(event) => updateRow(index, { name: event.target.value })}
                    disabled={submitting}
                    placeholder="Кабель 3x2.5"
                    className={FIELD_INPUT}
                  />
                </div>

                <div>
                  <label
                    htmlFor={`material-qty-${index}`}
                    className={FILTER_LABEL}
                  >
                    Тоо
                  </label>
                  <input
                    id={`material-qty-${index}`}
                    type="number"
                    min="0"
                    value={row.quantity}
                    onChange={(event) => updateRow(index, { quantity: event.target.value })}
                    disabled={submitting}
                    className={FIELD_INPUT}
                  />
                </div>

                <div>
                  <label
                    htmlFor={`material-unit-${index}`}
                    className={FILTER_LABEL}
                  >
                    Нэгж
                  </label>
                  <select
                    id={`material-unit-${index}`}
                    value={row.unit}
                    onChange={(event) => updateRow(index, { unit: event.target.value as MaterialUnit })}
                    disabled={submitting}
                    className={FIELD_SELECT}
                  >
                    {MATERIAL_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {MATERIAL_UNIT_LABELS[unit]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setRows((current) => current.filter((_entry, position) => position !== index))
                    }
                    disabled={submitting}
                  >
                    Хасах
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            setRows((current) => [...current, { name: '', quantity: '', unit: 'PIECE' }])
          }
          disabled={submitting}
        >
          Материал нэмэх
        </Button>
      </div>
    </Drawer>
  );
}
