import {
  MATERIAL_UNITS,
  MATERIAL_UNIT_LABELS,
  PERMISSIONS,
  type MaterialItemDto,
  type MaterialUnit,
  type TaskMaterialUsageDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { materialService } from '../../services/material.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';

/**
 * What this sub-task consumed.
 *
 * Kept strictly apart from the equipment the sub-task assesses, and the two are never
 * offered in the same control: the objects are what the visit was ABOUT and receive the
 * finding, these are the resources it SPENT. Mixing them would put a spool of cable in the
 * equipment history as though it had been inspected.
 *
 * Rows are written straight through rather than batched into the parent form. A usage row
 * is an event with its own date and user, and the server records each one on its own; a
 * "save everything at the end" model would either lose that or have to reconstruct it.
 *
 * There are no stock balances behind the catalogue, so nothing here checks availability and
 * nothing pretends to — see `constants/material.ts`.
 */
export function TaskMaterialsPanel({
  plannedWorkId,
  taskId,
  /** Add/edit/remove close when the sub-task is finished; the list stays readable. */
  editable,
}: {
  plannedWorkId: string;
  taskId: string;
  editable: boolean;
}): ReactElement {
  const { can } = useAuth();
  const canRead = can(PERMISSIONS.MATERIAL_VIEW);
  const canWrite = editable && can(PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS);

  const [rows, setRows] = useState<TaskMaterialUsageDto[]>([]);
  const [catalogue, setCatalogue] = useState<MaterialItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [materialItemId, setMaterialItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<MaterialUnit>('PIECE');
  const [note, setNote] = useState('');

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setRows(await materialService.usage(plannedWorkId, taskId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Материал ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [plannedWorkId, taskId]);

  useEffect(() => {
    if (!canRead) return;
    void load();
  }, [canRead, load]);

  useEffect(() => {
    if (!canWrite) return;
    materialService
      // Only what is still stocked: a retired item stays readable on historic rows but the
      // server refuses it on a new one, so offering it would be a control that fails.
      .list({ isActive: true, limit: 200 })
      .then((page) => setCatalogue(page.items))
      .catch(() => setCatalogue([]));
  }, [canWrite]);

  if (!canRead) return <></>;

  /** The catalogue's own unit follows the pick, until the user overrides it. */
  function pickMaterial(id: string): void {
    setMaterialItemId(id);
    const chosen = catalogue.find((entry) => entry.id === id);
    if (chosen) setUnit(chosen.defaultUnit);
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Үйлдэл гүйцэтгэж чадсангүй.');
    } finally {
      setBusy(false);
    }
  }

  async function add(): Promise<void> {
    if (!materialItemId || quantity.trim() === '') return;
    await run(async () => {
      await materialService.addUsage(plannedWorkId, taskId, {
        materialItemId,
        quantity: Number(quantity),
        unit,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setMaterialItemId('');
      setQuantity('');
      setNote('');
    });
  }

  return (
    <div className="rounded-lg p-3 ring-1 ring-inset ring-slate-200">
      <p className="mb-2 text-xs font-medium text-slate-600">
        Ашигласан материал ({rows.length})
      </p>

      {error && (
        <div className="mb-2">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-slate-400">Ачааллаж байна…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-400">
          Материал бүртгээгүй байна. Материал зарцуулаагүй ажлыг ч дуусгана.
        </p>
      ) : (
        <ul className="mb-3 space-y-1">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-2 border-b border-slate-100 py-1.5 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-900">
                  {row.materialCode} · {row.materialName}
                </p>
                <p className="text-[11px] text-slate-500">
                  {row.usedByName ?? '-'} · {row.usedAt.slice(0, 10)}
                  {row.note ? ` · ${row.note}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums text-sm text-slate-700">
                  {row.quantity} {MATERIAL_UNIT_LABELS[row.unit]}
                </span>
                {canWrite && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        materialService.removeUsage(plannedWorkId, taskId, row.id),
                      )
                    }
                  >
                    Устгах
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <Field label="Материал">
            <SelectInput
              value={materialItemId}
              onChange={pickMaterial}
              placeholder="Сонгоно уу"
              options={catalogue.map((entry) => ({
                value: entry.id,
                label: `${entry.code} · ${entry.name}`,
              }))}
              disabled={busy}
            />
          </Field>
          <Field label="Тоо хэмжээ">
            <TextInput type="number" value={quantity} onChange={setQuantity} disabled={busy} />
          </Field>
          <Field label="Нэгж">
            <SelectInput
              value={unit}
              onChange={(value) => setUnit(value as MaterialUnit)}
              options={MATERIAL_UNITS.map((entry) => ({
                value: entry,
                label: MATERIAL_UNIT_LABELS[entry],
              }))}
              disabled={busy}
            />
          </Field>
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            disabled={!materialItemId || quantity.trim() === ''}
            onClick={() => void add()}
          >
            Нэмэх
          </Button>
          <div className="sm:col-span-4">
            <Field label="Тэмдэглэл" hint="Сонголттой">
              <TextInput value={note} onChange={setNote} disabled={busy} />
            </Field>
          </div>
        </div>
      )}

      {!editable && (
        <p className="mt-2 text-[11px] text-slate-400">
          Дэд ажил дууссан тул материалын бүртгэлийг өөрчлөх боломжгүй.
        </p>
      )}
    </div>
  );
}
