import {
  MATERIAL_UNIT_LABELS,
  plannedWorkMaterialsSchema,
  type MaterialItemDto,
  type PlannedWorkDto,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { useToast } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import { materialService } from '../../services/material.service';
import { plannedWorkService } from '../../services/planned-work.service';
import { Field, SelectInput, TextInput, type Option } from '../employees/FormControls';

interface PlannedMaterialsDrawerProps {
  work: PlannedWorkDto;
  open: boolean;
  onClose: () => void;
  onSaved: (work: PlannedWorkDto) => void;
}

interface Row {
  materialItemId: string;
  quantity: string;
}

/**
 * The registered material list of a planned work.
 *
 * CATALOGUE-BACKED, not free text. A row names an item from `/materials`, and its name and
 * unit are frozen from that item by the server: sub-tasks now draw against these rows, and
 * a pool that is identified by a typed-in string splits the moment two people spell the
 * same cable differently. That is also why there is no unit control here — the unit belongs
 * to the catalogue entry and is shown, not chosen.
 *
 * The whole list is sent on save, so a row needs no identifier of its own; the catalogue
 * reference is the identity, and the shared schema refuses the same item twice.
 *
 * Errors are keyed by the schema's own dotted paths (`materials.0.quantity`), the same
 * paths the server returns, so a refusal lands on the row that caused it instead of being
 * flattened into one banner. That matters more than it used to: refusing to lower a
 * quantity below what has already been consumed is a per-row answer.
 */
export function PlannedMaterialsDrawer({
  work,
  open,
  onClose,
  onSaved,
}: PlannedMaterialsDrawerProps): ReactElement {
  const { notify } = useToast();

  const [rows, setRows] = useState<Row[]>([]);
  const [catalogue, setCatalogue] = useState<readonly MaterialItemDto[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;

    setRows(
      work.materials.map((entry) => ({
        materialItemId: entry.materialItemId,
        quantity: String(entry.quantity),
      })),
    );
    setFormError(null);
    setFieldErrors({});
  }, [open, work.materials]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    async function loadCatalogue(): Promise<void> {
      setCatalogueError(null);
      try {
        // Retired items are not offered, and the page limit is the schema's maximum: this
        // is a dropdown over reference data, not a browsable list, so a second page would
        // be a control nobody can reach from inside a <select>.
        const page = await materialService.list({ isActive: true, limit: 200 });
        if (!cancelled) setCatalogue(page.items);
      } catch (caught) {
        if (!cancelled) {
          setCatalogueError(
            caught instanceof ApiError ? caught.message : 'Материалын жагсаалт ачаалж чадсангүй.',
          );
        }
      }
    }

    void loadCatalogue();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /**
   * What the work already knows about a registered row, by catalogue id.
   *
   * Keeps a row readable when its catalogue entry has since been retired and therefore is
   * not in the picker: the frozen name and unit still came back with the work.
   */
  const registered = new Map(work.materials.map((entry) => [entry.materialItemId, entry]));

  const options: readonly Option[] = catalogue.map((item) => ({
    value: item.id,
    label: `${item.code} · ${item.name}`,
  }));

  function unitLabel(materialItemId: string): string {
    const item = catalogue.find((entry) => entry.id === materialItemId);
    const unit = item?.defaultUnit ?? registered.get(materialItemId)?.unit;
    return unit ? MATERIAL_UNIT_LABELS[unit] : '-';
  }

  function rowLabel(materialItemId: string): string {
    const item = catalogue.find((entry) => entry.id === materialItemId);
    return item?.name ?? registered.get(materialItemId)?.name ?? '';
  }

  function updateRow(index: number, patch: Partial<Row>): void {
    setRows((current) =>
      current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    );
  }

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    // Every row is sent, including one with nothing picked yet. Dropping the blank rows
    // would shift the indexes the errors are keyed by, so a rejection of the third row
    // would be painted on the second.
    const parsed = plannedWorkMaterialsSchema.safeParse({
      materials: rows.map((row) => ({
        materialItemId: row.materialItemId,
        quantity: Number(row.quantity || '0'),
      })),
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!errors[key]) errors[key] = issue.message;
      }
      // An id-shaped complaint about an empty box is really "you have not picked one yet",
      // and saying so is the difference between a fixable message and a puzzling one.
      rows.forEach((row, index) => {
        if (row.materialItemId === '') {
          errors[`materials.${index}.materialItemId`] = 'Материал сонгоно уу.';
        }
      });
      setFieldErrors(errors);
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await plannedWorkService.setMaterials(work.id, parsed.data);
      notify('Материал шинэчлэгдлээ.', 'success');
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
        {catalogueError && <Alert variant="error">{catalogueError}</Alert>}

        <p className="text-xs text-slate-500">
          Материалыг жагсаалтаас сонгоно. Нэгж нь материалын бүртгэлээс автоматаар тодорхойлогдоно.
          Дэд ажил дээр зарцуулалт бүртгэгдсэн материалын тоо хэмжээг зарцуулснаас доогуур
          болгох, эсвэл мөрийг нь хасах боломжгүй.
        </p>

        {rows.length === 0 && (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
            Материал бүртгээгүй байна.
          </p>
        )}

        <ul className="space-y-2">
          {rows.map((row, index) => {
            const entry = registered.get(row.materialItemId);
            const name = rowLabel(row.materialItemId) || `${index + 1}-р мөр`;

            return (
              <li
                // Rows carry no identifier, so the position is the key. It is stable while
                // the list is being edited because a removal rebuilds every row below it.
                key={`material-row-${index}`}
                className="rounded-lg p-3 ring-1 ring-inset ring-slate-200"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_auto_auto]">
                  <Field
                    label="Материал"
                    required
                    error={fieldErrors[`materials.${index}.materialItemId`]}
                  >
                    <SelectInput
                      value={row.materialItemId}
                      onChange={(value) => updateRow(index, { materialItemId: value })}
                      options={
                        // A retired item stays selectable on the row that already carries
                        // it, so opening this drawer cannot silently drop a registration.
                        entry && !catalogue.some((item) => item.id === entry.materialItemId)
                          ? [...options, { value: entry.materialItemId, label: entry.name }]
                          : options
                      }
                      placeholder="Сонгох"
                      disabled={submitting}
                    />
                  </Field>

                  <Field label="Тоо хэмжээ" required error={fieldErrors[`materials.${index}.quantity`]}>
                    <TextInput
                      value={row.quantity}
                      onChange={(value) => updateRow(index, { quantity: value })}
                      type="number"
                      disabled={submitting}
                    />
                  </Field>

                  <div className="min-w-0">
                    <p className="mb-1 block text-xs font-medium text-slate-600">Нэгж</p>
                    <p className="py-1.5 text-sm text-slate-700">{unitLabel(row.materialItemId)}</p>
                  </div>

                  <div className="flex items-end pb-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setRows((current) =>
                          current.filter((_entry, position) => position !== index),
                        )
                      }
                      disabled={submitting}
                      aria-label={`${name} хасах`}
                    >
                      Хасах
                    </Button>
                  </div>
                </div>

                {entry && entry.consumedQuantity > 0 && (
                  <p className="mt-1 text-xs text-slate-500">
                    Зарцуулсан {entry.consumedQuantity.toLocaleString('mn-MN')}{' '}
                    {MATERIAL_UNIT_LABELS[entry.unit]}. Үүнээс доогуур тоо хэмжээ хадгалагдахгүй.
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {fieldErrors.materials && <p className="text-xs text-red-600">{fieldErrors.materials}</p>}

        <Button
          variant="secondary"
          size="sm"
          onClick={() => setRows((current) => [...current, { materialItemId: '', quantity: '' }])}
          disabled={submitting}
        >
          Материал нэмэх
        </Button>
      </div>
    </Drawer>
  );
}
