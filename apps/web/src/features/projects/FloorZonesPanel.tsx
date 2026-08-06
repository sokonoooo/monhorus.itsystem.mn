import {
  createObjectNodeSchema,
  updateObjectNodeSchema,
  type ObjectNodeDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Drawer } from '../../components/ui/Drawer';
import { RowActions } from '../../components/ui/RowActions';
import { useToast } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { Field, TextInput } from '../employees/FormControls';

interface FloorZonesPanelProps {
  floorId: string;
  /** The floor's own code, which the suggested zone code is built from. */
  floorCode: string;
  /** The floor's tenant. A node belongs to a customer, not to a floor. */
  customerId: string;
  /** object.manage on an active floor: may add, rename, archive and delete. */
  canManage: boolean;
}

/** The node code column is 64 characters; the suffix below never needs more than four. */
const MAX_CODE_LENGTH = 64;

/**
 * A free zone code derived from the floor's own.
 *
 * There is no server-side suggestion for nodes — `GET /objects-master/code-suggestion` only
 * knows about objects under a panel — so the sequence is worked out here from the zones
 * already on this floor, in the same shape that endpoint produces: the parent's code, a
 * separator and a two-digit sequence. It is a suggestion and stays editable, which is what
 * makes the narrower knowledge acceptable: uniqueness is per customer and only the server
 * can see the whole tenant, so a collision with a zone on another floor comes back as the
 * backend's duplicate-code error against the field the user can still change.
 */
export function suggestZoneCode(floorCode: string, existing: readonly ObjectNodeDto[]): string {
  const base = floorCode.slice(0, MAX_CODE_LENGTH - 4).replace(/-+$/, '');
  const taken = new Set(existing.map((zone) => zone.code));

  // One more candidate than there are taken codes guarantees a free one.
  for (let sequence = 1; sequence <= taken.size + 1; sequence += 1) {
    const candidate = `${base}-R${String(sequence).padStart(2, '0')}`;
    if (!taken.has(candidate)) return candidate;
  }

  return `${base}-R01`;
}

/**
 * Zones on a floor (the `ROOM` level of the hierarchy).
 *
 * The level a service request names as Өрөө/Бүс, which until now had no screen that could
 * create one: the dropdown on the request form was always empty because nothing in the app
 * wrote this level. Everything here goes through the generic node endpoints.
 *
 * Delete and archive are both offered because they are not interchangeable: the server
 * refuses to delete a zone a request already points at, and says which, so that refusal is
 * shown as it stands with archiving offered next to it rather than being flattened into
 * "устгаж чадсангүй".
 */
export function FloorZonesPanel({
  floorId,
  floorCode,
  customerId,
  canManage,
}: FloorZonesPanelProps): ReactElement {
  const { notify } = useToast();

  const [zones, setZones] = useState<ObjectNodeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [renameTarget, setRenameTarget] = useState<ObjectNodeDto | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [archiveTarget, setArchiveTarget] = useState<ObjectNodeDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ObjectNodeDto | null>(null);
  /** A refused delete, held with the server's own reason so it can be shown verbatim. */
  const [blocked, setBlocked] = useState<{ zone: ObjectNodeDto; message: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setZones(await objectService.children(floorId, 'ROOM'));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Бүсийн жагсаалт ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [floorId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate(): void {
    setCode(suggestZoneCode(floorCode, zones));
    setName('');
    setFormError(null);
    setFieldErrors({});
    setCreateOpen(true);
  }

  async function handleCreate(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    // The same schema the API validates against, so the rules cannot drift.
    const parsed = createObjectNodeSchema.safeParse({
      kind: 'ROOM',
      parentId: floorId,
      customerId,
      code: code.trim().toUpperCase(),
      name: name.trim(),
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

    setSaving(true);
    try {
      await objectService.createNode(parsed.data);
      notify('Бүс нэмэгдлээ.', 'success');
      setCreateOpen(false);
      await load();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setFormError('Бүс нэмж чадсангүй.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(): Promise<void> {
    if (!renameTarget) return;
    const parsed = updateObjectNodeSchema.safeParse({ name: renameValue.trim() });
    if (!parsed.success) {
      setFieldErrors({ name: parsed.error.issues[0]?.message ?? 'Нэр заавал.' });
      return;
    }

    setSaving(true);
    try {
      await objectService.updateNode(renameTarget.id, parsed.data);
      notify('Бүсийн нэр шинэчлэгдлээ.', 'success');
      setRenameTarget(null);
      await load();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Хадгалж чадсангүй.');
    } finally {
      setSaving(false);
    }
  }

  async function archive(zone: ObjectNodeDto): Promise<void> {
    try {
      await objectService.updateNode(zone.id, { isActive: false });
      notify('Бүс архивлагдлаа.', 'success');
      setArchiveTarget(null);
      setBlocked(null);
      await load();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Архивлаж чадсангүй.', 'error');
      setArchiveTarget(null);
    }
  }

  async function handleDelete(): Promise<void> {
    const zone = deleteTarget;
    if (!zone) return;
    setDeleteTarget(null);

    try {
      await objectService.deleteNode(zone.id);
      notify('Бүс устгагдлаа.', 'success');
      setBlocked(null);
      await load();
    } catch (caught) {
      // A refusal names what is holding the zone, so it is shown as the server wrote it
      // with archiving offered next to it. Anything else is a plain failure.
      if (caught instanceof ApiError && caught.status === 409) {
        setBlocked({ zone, message: caught.message });
        return;
      }
      notify(caught instanceof ApiError ? caught.message : 'Устгаж чадсангүй.', 'error');
    }
  }

  const columns: ReadonlyArray<Column<ObjectNodeDto>> = [
    {
      key: 'name',
      header: 'Бүсийн нэр',
      render: (row) => <span className="font-medium text-slate-900">{row.name}</span>,
    },
    {
      key: 'code',
      header: 'Код',
      render: (row) => <span className="whitespace-nowrap text-slate-600">{row.code}</span>,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Үйлдэл',
            align: 'right' as const,
            render: (row: ObjectNodeDto): ReactElement => (
              <RowActions
                label="Бүсийн үйлдэл"
                items={[
                  {
                    label: 'Нэр засах',
                    onSelect: (): void => {
                      setRenameValue(row.name);
                      setFormError(null);
                      setFieldErrors({});
                      setRenameTarget(row);
                    },
                  },
                  { label: 'Архивлах', onSelect: (): void => setArchiveTarget(row) },
                  {
                    label: 'Устгах',
                    tone: 'danger' as const,
                    onSelect: (): void => setDeleteTarget(row),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Өрөө/Бүс</h2>
        {canManage && (
          <Button size="sm" onClick={openCreate}>
            Бүс нэмэх
          </Button>
        )}
      </div>

      {blocked && (
        <div className="border-b border-slate-200 px-5 py-3">
          <Alert variant="warning" title="Устгах боломжгүй">
            <p>{blocked.message}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void archive(blocked.zone)}
              >
                Архивлах
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setBlocked(null)}>
                Хаах
              </Button>
            </div>
          </Alert>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={zones}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={() => void load()}
        ariaLabel="Өрөө/Бүс"
        emptyTitle="Бүс бүртгэгдээгүй"
        emptyDescription="Үйлчилгээний хүсэлт дээр өрөө/бүс сонгохын тулд энд бүртгэнэ үү."
      />

      <Drawer
        open={createOpen}
        title="Бүс нэмэх"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Цуцлах
            </Button>
            <Button onClick={() => void handleCreate()} loading={saving}>
              Нэмэх
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <Alert variant="error">{formError}</Alert>}
          <Field
            label="Код"
            required
            error={fieldErrors.code}
            hint="Давхрын кодоос санал болгосон. Харилцагч дотор давхардахгүй байх ёстой."
          >
            <TextInput
              value={code}
              onChange={(value) => setCode(value.toUpperCase())}
              disabled={saving}
            />
          </Field>
          <Field label="Бүсийн нэр" required error={fieldErrors.name}>
            <TextInput value={name} onChange={setName} disabled={saving} />
          </Field>
        </div>
      </Drawer>

      <Drawer
        open={renameTarget !== null}
        title="Бүсийн нэр засах"
        onClose={() => setRenameTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameTarget(null)} disabled={saving}>
              Цуцлах
            </Button>
            <Button onClick={() => void handleRename()} loading={saving}>
              Хадгалах
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && <Alert variant="error">{formError}</Alert>}
          <Field label="Бүсийн нэр" required error={fieldErrors.name}>
            <TextInput value={renameValue} onChange={setRenameValue} disabled={saving} />
          </Field>
        </div>
      </Drawer>

      <ConfirmDialog
        open={archiveTarget !== null}
        title="Бүс архивлах"
        message={`"${archiveTarget?.name ?? ''}" бүсийг архивлах уу? Хүсэлтийн сонголтод харагдахаа болих ба одоо байгаа хүсэлтүүд хэвээр үлдэнэ.`}
        confirmLabel="Архивлах"
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => (archiveTarget ? archive(archiveTarget) : undefined)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Бүс устгах"
        message={`"${deleteTarget?.name ?? ''}" бүсийг бүрмөсөн устгах уу?`}
        confirmLabel="Устгах"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete()}
      />
    </div>
  );
}
