import {
  PERMISSIONS,
  createFloorSchema,
  updateBuildingSchema,
  type BuildingDto,
  type FloorDto,
  type FloorListQuery,
  type PaginatedData,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { Drawer } from '../../components/ui/Drawer';
import { MapPicker } from '../../components/ui/MapPicker';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { projectService } from '../../services/project.service';
import { RiskSummaryCell } from './objects/ObjectBadges';
import { Field, TextInput } from '../employees/FormControls';
import { GpsErrors, type GpsPosition } from './ProjectDetailPage';
import { ActiveBadge } from './ProjectListPage';

/**
 * Inline edit for the building itself, and inline create for its floors.
 *
 * Neither drawer carries a code field. `BLD-001` and `FLR-001` are issued by the server,
 * and `updateBuildingSchema` is `.strict()`, so a code sent from here would be refused
 * rather than ignored — a code that can be edited is not an identifier, and renaming a
 * building must leave the label on somebody's drawing alone.
 */
function BuildingEditDrawer({
  building,
  open,
  onClose,
  onSaved,
}: {
  building: BuildingDto;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { notify } = useToast();
  const [name, setName] = useState(building.name);
  const [address, setAddress] = useState(building.address ?? '');
  const [position, setPosition] = useState<GpsPosition>({
    latitude: building.gpsLatitude,
    longitude: building.gpsLongitude,
  });
  const [description, setDescription] = useState(building.description ?? '');
  const [isActive, setIsActive] = useState(building.isActive);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName(building.name);
    setAddress(building.address ?? '');
    setPosition({ latitude: building.gpsLatitude, longitude: building.gpsLongitude });
    setDescription(building.description ?? '');
    setIsActive(building.isActive);
    setFormError(null);
    setFieldErrors({});
  }, [open, building]);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const parsed = updateBuildingSchema.safeParse({
      name: name.trim(),
      address: address.trim() || null,
      gpsLatitude: position.latitude,
      gpsLongitude: position.longitude,
      description: description.trim() || null,
      isActive,
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
      await projectService.updateBuilding(building.id, parsed.data);
      notify('Барилга шинэчлэгдлээ.', 'success');
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
      title="Барилга засах"
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Нэр" required error={fieldErrors.name}>
            <TextInput value={name} onChange={setName} disabled={submitting} />
          </Field>
        </div>
        <Field label="Хаяг" error={fieldErrors.address}>
          <TextInput value={address} onChange={setAddress} disabled={submitting} />
        </Field>
        <div>
          <MapPicker
            latitude={position.latitude}
            longitude={position.longitude}
            onChange={setPosition}
            disabled={submitting}
          />
          <GpsErrors fieldErrors={fieldErrors} />
        </div>
        <div>
          <label
            htmlFor="building-edit-description"
            className={FILTER_LABEL}
          >
            Тайлбар
          </label>
          <textarea
            id="building-edit-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={submitting}
            className={FIELD_TEXTAREA}
          />
          {fieldErrors.description && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.description}</p>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            disabled={submitting}
            className="h-4 w-4 rounded border-slate-300"
          />
          Идэвхтэй
        </label>
      </div>
    </Drawer>
  );
}

function FloorDrawer({
  buildingId,
  open,
  onClose,
  onSaved,
}: {
  buildingId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { notify } = useToast();
  const [name, setName] = useState('');
  const [areaSqm, setAreaSqm] = useState('');
  const [purpose, setPurpose] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName('');
    setAreaSqm('');
    setPurpose('');
    setDescription('');
    setFormError(null);
    setFieldErrors({});
  }, [open]);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    // The floor number is not asked for on create: the backend schema and the Mongoose
    // model both leave it optional with a null default, so it is simply not sent and
    // stays editable from the floor's own edit drawer.
    const parsed = createFloorSchema.safeParse({
      buildingId,
      name: name.trim(),
      areaSqm: areaSqm.trim() === '' ? null : Number(areaSqm),
      purpose: purpose.trim() || null,
      description: description.trim() || null,
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
      await projectService.createFloor(parsed.data);
      notify('Давхар үүслээ.', 'success');
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
      title="Шинэ давхар"
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
          План зургийг давхар үүсгэсний дараа дэлгэрэнгүй хуудсаас нь хавсаргана.
        </Alert>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Давхрын нэр" required error={fieldErrors.name}>
            <TextInput value={name} onChange={setName} disabled={submitting} />
          </Field>
          <Field label="Ашиглалтын талбай (м²)" error={fieldErrors.areaSqm}>
            <TextInput type="number" value={areaSqm} onChange={setAreaSqm} disabled={submitting} />
          </Field>
        </div>
        <Field label="Зориулалт" error={fieldErrors.purpose}>
          <TextInput value={purpose} onChange={setPurpose} disabled={submitting} />
        </Field>
        <div>
          <label
            htmlFor="floor-create-description"
            className={FILTER_LABEL}
          >
            Тайлбар
          </label>
          <textarea
            id="floor-create-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={submitting}
            className={FIELD_TEXTAREA}
          />
          {fieldErrors.description && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.description}</p>
          )}
        </div>
      </div>
    </Drawer>
  );
}

export function BuildingDetailPage(): ReactElement {
  const { buildingId } = useParams<{ buildingId: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify } = useToast();

  const canManage = can(PERMISSIONS.OBJECT_MANAGE);

  // The floor table's page and search live in the URL, the same as the project list: this
  // route reads nothing else from the query string, so there is nothing to clash with, and
  // a link to page 2 of a tower's floors stays a link.
  const [searchParams, setSearchParams] = useSearchParams();

  const [building, setBuilding] = useState<BuildingDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [floorOpen, setFloorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [floors, setFloors] = useState<PaginatedData<FloorDto> | null>(null);
  const [floorsLoading, setFloorsLoading] = useState(true);
  const [floorsError, setFloorsError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');

  const floorQuery = useMemo<FloorListQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    return {
      ...(buildingId ? { buildingId } : {}),
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: 20,
      ...(searchParams.get('search') ? { search: searchParams.get('search')! } : {}),
    };
  }, [buildingId, searchParams]);

  const loadBuilding = useCallback(async (): Promise<void> => {
    if (!buildingId) return;
    setLoading(true);
    setError(null);
    try {
      setBuilding(await projectService.getBuilding(buildingId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Барилга ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [buildingId]);

  // The list is fetched apart from the detail so that turning a page or typing a search
  // reloads the table alone, rather than throwing the whole page back to its skeleton.
  const requestIdRef = useRef(0);
  const queryKey = JSON.stringify(floorQuery);

  const loadFloors = useCallback(async (): Promise<void> => {
    if (!buildingId) return;
    const requestId = ++requestIdRef.current;
    setFloorsLoading(true);
    setFloorsError(null);
    try {
      const result = await projectService.listFloors(JSON.parse(queryKey) as FloorListQuery);
      if (requestId !== requestIdRef.current) return;
      setFloors(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setFloorsError(caught instanceof ApiError ? caught.message : 'Давхар ачаалж чадсангүй.');
    } finally {
      if (requestId === requestIdRef.current) setFloorsLoading(false);
    }
  }, [buildingId, queryKey]);

  useEffect(() => {
    void loadBuilding();
  }, [loadBuilding]);

  useEffect(() => {
    void loadFloors();
  }, [loadFloors]);

  /** Editing the building or adding a floor changes both the detail and the list. */
  const load = useCallback(async (): Promise<void> => {
    await Promise.all([loadBuilding(), loadFloors()]);
  }, [loadBuilding, loadFloors]);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    // Any filter change starts again at the first page; row 21 of the old result is
    // not row 21 of the new one.
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  async function handleDelete(): Promise<void> {
    if (!building) return;
    try {
      await projectService.deleteBuilding(building.id);
      notify('Барилга устгагдлаа.', 'success');
      navigate(`/projects/${building.projectId}`);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Устгаж чадсангүй.', 'error');
      setDeleteOpen(false);
    }
  }

  const columns: ReadonlyArray<Column<FloorDto>> = [
    {
      key: 'floor',
      header: 'Давхар',
      render: (row) => <span className="truncate font-medium text-slate-900">{row.name}</span>,
    },
    {
      key: 'code',
      header: 'Код',
      render: (row) => <span className="whitespace-nowrap text-slate-600">{row.code}</span>,
    },
    {
      key: 'plan',
      header: 'План зураг',
      render: (row) =>
        row.hasPlanImage ? (
          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200">
            Хавсаргасан
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
            Хавсаргаагүй
          </span>
        ),
    },
    {
      key: 'area',
      header: 'Талбай',
      align: 'right',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {row.areaSqm === null ? '-' : `${row.areaSqm.toLocaleString('mn-MN')} м²`}
        </span>
      ),
    },
    {
      key: 'objects',
      header: 'Объект',
      align: 'right',
      render: (row) => <span className="text-slate-700">{row.objectCount}</span>,
    },
    {
      key: 'risk',
      header: 'Үнэлгээ',
      render: (row) => <RiskSummaryCell summary={row.riskSummary} />,
    },
    {
      key: 'lastAssessed',
      header: 'Сүүлийн үзлэг',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {row.riskSummary.lastAssessedAt === null
            ? '-'
            : row.riskSummary.lastAssessedAt.slice(0, 10)}
        </span>
      ),
    },
    { key: 'status', header: 'Төлөв', render: (row) => <ActiveBadge isActive={row.isActive} /> },
    {
      key: 'createdBy',
      header: 'Үүсгэсэн',
      render: (row) => <span className="text-slate-700">{row.createdByName ?? '-'}</span>,
    },
  ];

  const columnState = useTableColumns('building-floors', columns);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error || !building) return <ErrorState description={error ?? 'Барилга олдсонгүй.'} />;

  return (
    <>
      <PageHeader
        title={building.name}
        description={`${building.code}${building.address ? ` · ${building.address}` : ''}`}
        backTo={{ to: `/projects/${building.projectId}`, label: 'Төсөл рүү буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Төсөл', to: '/projects' },
          { label: building.projectName ?? 'Төсөл', to: `/projects/${building.projectId}` },
          { label: building.code },
        ]}
        actions={
          <>
            {canManage && (
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                Засах
              </Button>
            )}
            {canManage && building.deleteBlockers.length === 0 && (
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Устгах
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {!building.isActive && (
          <Alert variant="warning">Архивласан барилга. Шинэ давхар нэмэх боломжгүй.</Alert>
        )}

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4">
            <ActiveBadge isActive={building.isActive} />
          </div>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500">Хаяг</dt>
              <dd className="text-sm text-slate-900">{building.address ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">GPS байршил</dt>
              <dd className="text-sm text-slate-900">
                {building.gpsLatitude !== null && building.gpsLongitude !== null
                  ? `${building.gpsLatitude}, ${building.gpsLongitude}`
                  : '-'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Давхрын тоо</dt>
              <dd className="text-sm text-slate-900">{building.floorCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Объектын тоо</dt>
              <dd className="text-sm text-slate-900">{building.objectCount}</dd>
            </div>
          </dl>

          {building.description && (
            <p className="mt-4 whitespace-pre-wrap border-t border-slate-200 pt-4 text-sm text-slate-700">
              {building.description}
            </p>
          )}
        </div>

        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Давхар</h2>
            <div className="flex items-center gap-2">
              <div className="w-52">
                {/* Labelled for a screen reader only: the heading beside it already says
                    which table this searches. */}
                <label htmlFor="bld-floor-search" className="sr-only">
                  Хайлт
                </label>
                <SearchField
                  id="bld-floor-search"
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') updateParam('search', searchDraft.trim());
                  }}
                  onBlur={() => updateParam('search', searchDraft.trim())}
                  placeholder="Нэр эсвэл код"
                />
              </div>
              <ColumnPicker controller={columnState} />
              {canManage && building.isActive && (
                <Button variant="secondary" size="sm" onClick={() => setFloorOpen(true)}>
                  Давхар нэмэх
                </Button>
              )}
            </div>
          </div>
          <DataTable
            columns={columnState.visibleColumns}
            rows={floors?.items ?? []}
            rowKey={(row) => row.id}
            // Numbered off the response rather than the query, so a request in flight can
            // never number the rows on screen against the page they did not come from.
            numbering={{ page: floors?.page ?? 1, limit: floors?.limit ?? 20 }}
            loading={floorsLoading}
            error={floorsError}
            onRetry={() => void loadFloors()}
            onRowClick={(row) => navigate(`/floors/${row.id}`)}
            emptyTitle="Давхар бүртгэгдээгүй"
            emptyDescription={
              searchParams.get('search')
                ? 'Хайлтад тохирох давхар алга.'
                : 'План зураг болон объект нэмэхийн тулд давхар бүртгэнэ үү.'
            }
          />
          {floors && (
            <Pagination
              page={floors.page}
              totalPages={floors.totalPages}
              total={floors.total}
              onPageChange={(page) => updateParam('page', String(page))}
            />
          )}
        </div>

        {/* The reasons deletion is blocked close the page: they explain an action that is
            already absent from the header, so they are read last rather than first. */}
        {building.deleteBlockers.length > 0 && canManage && (
          <Alert variant="info" title="Устгах боломжгүй">
            <ul className="ml-4 list-disc space-y-0.5">
              {building.deleteBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Alert>
        )}
      </div>

      <BuildingEditDrawer
        building={building}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          void load();
        }}
      />

      <FloorDrawer
        buildingId={building.id}
        open={floorOpen}
        onClose={() => setFloorOpen(false)}
        onSaved={() => {
          setFloorOpen(false);
          void load();
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Барилга устгах"
        message={`"${building.name}" барилгыг устгах уу?`}
        confirmLabel="Устгах"
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => handleDelete()}
      />
    </>
  );
}
