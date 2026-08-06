import {
  PERMISSIONS,
  updateFloorSchema,
  type FloorDto,
  type FloorLoadSummaryDto,
  type FloorPlanDto,
  type ObjectListItemDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Drawer } from '../../components/ui/Drawer';
import { RiskBadge } from '../../components/ui/DomainBadges';
import { PageHeader } from '../../components/ui/PageHeader';
import { RowActions } from '../../components/ui/RowActions';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { objectMasterService } from '../../services/object-master.service';
import { projectService } from '../../services/project.service';
import {
  LoadValue,
  ObjectCategoryBadge,
  ObjectStatusBadge,
  ScorePercent,
  VarianceValue,
} from './objects/ObjectBadges';
import { Field, TextInput } from '../employees/FormControls';
import { FloorObjectPicker } from './FloorObjectPicker';
import { FloorPlanPanel } from './FloorPlanPanel';
import { ActiveBadge } from './ProjectListPage';

function FloorEditDrawer({
  floor,
  open,
  onClose,
  onSaved,
}: {
  floor: FloorDto;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { notify } = useToast();
  const [code, setCode] = useState(floor.code);
  const [name, setName] = useState(floor.name);
  const [floorNumber, setFloorNumber] = useState(floor.floorNumber?.toString() ?? '');
  const [areaSqm, setAreaSqm] = useState(floor.areaSqm?.toString() ?? '');
  const [purpose, setPurpose] = useState(floor.purpose ?? '');
  const [description, setDescription] = useState(floor.description ?? '');
  const [isActive, setIsActive] = useState(floor.isActive);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setCode(floor.code);
    setName(floor.name);
    setFloorNumber(floor.floorNumber?.toString() ?? '');
    setAreaSqm(floor.areaSqm?.toString() ?? '');
    setPurpose(floor.purpose ?? '');
    setDescription(floor.description ?? '');
    setIsActive(floor.isActive);
    setFormError(null);
    setFieldErrors({});
  }, [open, floor]);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const parsed = updateFloorSchema.safeParse({
      code: code.trim().toUpperCase(),
      name: name.trim(),
      floorNumber: floorNumber.trim() === '' ? null : Number(floorNumber),
      areaSqm: areaSqm.trim() === '' ? null : Number(areaSqm),
      purpose: purpose.trim() || null,
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
      await projectService.updateFloor(floor.id, parsed.data);
      notify('Давхар шинэчлэгдлээ.', 'success');
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
      title="Давхар засах"
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
          <Field label="Код" required error={fieldErrors.code}>
            <TextInput value={code} onChange={(value) => setCode(value.toUpperCase())} disabled={submitting} />
          </Field>
          <Field label="Давхрын нэр" required error={fieldErrors.name}>
            <TextInput value={name} onChange={setName} disabled={submitting} />
          </Field>
          <Field label="Давхрын дугаар" error={fieldErrors.floorNumber}>
            <TextInput type="number" value={floorNumber} onChange={setFloorNumber} disabled={submitting} />
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
            htmlFor="floor-edit-description"
            className={FILTER_LABEL}
          >
            Тайлбар
          </label>
          <textarea
            id="floor-edit-description"
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

/** The largest page `objectListQuerySchema` will accept. Asking for more is a 400. */
const OBJECT_PAGE_LIMIT = 100;

/**
 * A ceiling on the paging loop, not on the floor.
 *
 * A floor with more than this many objects is not a floor anyone is reading a plan of, and
 * an unbounded loop against a miscounting server would spin forever. What is fetched is
 * still stated honestly: the table and the plan show what came back.
 */
const MAX_OBJECT_PAGES = 20;

/**
 * Every object on the floor, not the first hundred.
 *
 * The list endpoint pages and its limit is capped at 100, so a single request silently lost
 * every marker past the first page — a floor with 120 devices drew 100 pins and gave no
 * hint that twenty were missing. Pages are walked in order because the first response is
 * what says how many there are.
 */
async function fetchAllFloorObjects(floorId: string): Promise<ObjectListItemDto[]> {
  const items: ObjectListItemDto[] = [];
  let page = 1;

  for (;;) {
    const result = await objectMasterService.list({ floorId, limit: OBJECT_PAGE_LIMIT, page });
    items.push(...result.items);
    if (result.items.length === 0 || page >= result.totalPages || page >= MAX_OBJECT_PAGES) {
      return items;
    }
    page += 1;
  }
}

/**
 * Floor detail.
 *
 * Rendered in the required order: general information together with the plan image first,
 * then the objects on the floor. Counts, the section 11.5 load calculation and the risk
 * breakdown live inside the general information card, because they all describe this floor
 * and splitting them across the page made the load figures easy to miss.
 *
 * Objects are created here: an object instance is a placement on a floor, and the catalogue
 * of equipment types is separate master data.
 */
export function FloorDetailPage(): ReactElement {
  const { floorId } = useParams<{ floorId: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify } = useToast();

  const canManage = can(PERMISSIONS.OBJECT_MANAGE);
  const canViewObjects = can(PERMISSIONS.OBJECT_MASTER_VIEW);
  const canManageObjects = can(PERMISSIONS.OBJECT_MASTER_MANAGE);

  const [floor, setFloor] = useState<FloorDto | null>(null);
  const [plan, setPlan] = useState<FloorPlanDto | null>(null);
  const [objects, setObjects] = useState<ObjectListItemDto[]>([]);
  const [load, setLoad] = useState<FloorLoadSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * The permission set arrives after the first render, which flips `canViewObjects` and
   * refetches. Without this the whole page would drop back to a skeleton mid-flight and
   * visibly flicker; a refetch now keeps the content on screen.
   */
  const hasLoadedRef = useRef(false);
  const [editOpen, setEditOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unlinkTarget, setUnlinkTarget] = useState<ObjectListItemDto | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadAll = useCallback(async (): Promise<void> => {
    if (!floorId) return;
    if (!hasLoadedRef.current) setLoading(true);
    setError(null);
    try {
      const [detail, planImage] = await Promise.all([
        projectService.getFloor(floorId),
        projectService.getFloorPlan(floorId),
      ]);
      setFloor(detail);
      setPlan(planImage);

      // Objects and the load roll-up need their own permission; a caller without it still
      // sees the general information and the plan.
      if (canViewObjects) {
        const [allObjects, summary] = await Promise.all([
          fetchAllFloorObjects(floorId),
          projectService.floorLoad(floorId),
        ]);
        setObjects(allObjects);
        setLoad(summary);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Давхар ачаалж чадсангүй.');
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, [floorId, canViewObjects]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleUnlink(): Promise<void> {
    if (!floor || !unlinkTarget) return;
    try {
      await projectService.unlinkObject(floor.id, unlinkTarget.id);
      notify('Объектын холбоос салгагдлаа.', 'success');
      setUnlinkTarget(null);
      await loadAll();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Салгаж чадсангүй.', 'error');
      setUnlinkTarget(null);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!floor) return;
    try {
      await projectService.deleteFloor(floor.id);
      notify('Давхар устгагдлаа.', 'success');
      navigate(`/buildings/${floor.buildingId}`);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Устгаж чадсангүй.', 'error');
      setDeleteOpen(false);
    }
  }

  const objectColumns: ReadonlyArray<Column<ObjectListItemDto>> = [
    {
      key: 'object',
      header: 'Объект',
      render: (row) => <span className="truncate font-medium text-slate-900">{row.name}</span>,
    },
    {
      key: 'code',
      header: 'Код',
      render: (row) => <span className="whitespace-nowrap text-slate-600">{row.code}</span>,
    },
    {
      key: 'objectType',
      header: 'Тоноглолын төрөл',
      render: (row) => <span className="text-slate-700">{row.objectType?.name ?? '-'}</span>,
    },
    {
      key: 'category',
      header: 'Ангилал',
      render: (row) => <ObjectCategoryBadge category={row.category} />,
    },
    {
      key: 'load',
      header: 'Тооцоолсон',
      align: 'right',
      render: (row) => <LoadValue value={row.calculatedLoad} />,
    },
    {
      key: 'measured',
      header: 'Хэмжсэн',
      align: 'right',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {row.measuredLoadKw === null ? '-' : `${row.measuredLoadKw} kW`}
        </span>
      ),
    },
    {
      key: 'variance',
      header: 'Зөрүү',
      align: 'right',
      render: (row) => <VarianceValue value={row.loadVariance} />,
    },
    {
      key: 'risk',
      header: 'Үнэлгээ',
      render: (row) => (
        <ScorePercent
          level={row.latestAssessment?.riskLevel ?? null}
          score={row.latestAssessment?.score ?? null}
        />
      ),
    },
    {
      key: 'conclusion',
      header: 'Дүгнэлт',
      render: (row) => (
        <span className="truncate text-xs text-slate-600">
          {row.latestAssessment?.conclusion ?? '-'}
        </span>
      ),
    },
    {
      key: 'recommendation',
      header: 'Зөвлөмж',
      render: (row) => (
        <span className="truncate text-xs text-slate-600">
          {row.latestAssessment?.recommendation ?? '-'}
        </span>
      ),
    },
    { key: 'status', header: 'Төлөв', render: (row) => <ObjectStatusBadge status={row.status} /> },
    {
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      render: (row) => (
        // Permission-gated items are omitted rather than disabled: a caller without
        // object.manage never learns that unlinking exists.
        <RowActions
          items={[
            {
              label: 'Түүх',
              onSelect: () => navigate(`/floors/${floorId ?? ''}/objects/${row.id}`),
            },
            ...(canManage
              ? [{ label: 'Салгах', onSelect: (): void => setUnlinkTarget(row) }]
              : []),
          ]}
        />
      ),
    },
  ];

  const columnState = useTableColumns('floor-objects', objectColumns);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !floor) return <ErrorState description={error ?? 'Давхар олдсонгүй.'} />;

  return (
    <>
      <PageHeader
        title={floor.name}
        description={`${floor.code}${floor.buildingName ? ` · ${floor.buildingName}` : ''}${
          floor.projectName ? ` · ${floor.projectName}` : ''
        }`}
        backTo={{ to: `/buildings/${floor.buildingId}`, label: 'Барилга руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Төсөл', to: '/projects' },
          { label: floor.projectName ?? 'Төсөл', to: `/projects/${floor.projectId}` },
          { label: floor.buildingName ?? 'Барилга', to: `/buildings/${floor.buildingId}` },
          { label: floor.code },
        ]}
        actions={
          <>
            {canManage && (
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                Засах
              </Button>
            )}
            {canManage && floor.deleteBlockers.length === 0 && (
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Устгах
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {!floor.isActive && (
          <Alert variant="warning">
            Архивласан давхар. План зураг удирдах, объект холбох боломжгүй.
          </Alert>
        )}

        {/*
          1. General information and the plan image.

          Counts, load and risk sit inside this one card rather than in a separate block at
          the bottom of the page: they describe the same floor and are read together.
        */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Ерөнхий мэдээлэл</h2>
            <div className="mb-3">
              <ActiveBadge isActive={floor.isActive} />
            </div>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-xs text-slate-500">Давхрын дугаар</dt>
                <dd className="text-sm text-slate-900">{floor.floorNumber ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Ашиглалтын талбай</dt>
                <dd className="text-sm text-slate-900">
                  {floor.areaSqm === null ? '-' : `${floor.areaSqm.toLocaleString('mn-MN')} м²`}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Зориулалт</dt>
                <dd className="text-sm text-slate-900">{floor.purpose ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Объектын тоо</dt>
                <dd className="text-sm text-slate-900">{floor.objectCount}</dd>
              </div>
            </dl>
            {floor.description && (
              <p className="mt-3 whitespace-pre-wrap border-t border-slate-200 pt-3 text-sm text-slate-700">
                {floor.description}
              </p>
            )}

            {canViewObjects && load && (
              <>
                <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-200 pt-4">
                  <div>
                    <dt className="text-xs text-slate-500">Самбар</dt>
                    <dd className="text-sm text-slate-900">{load.panelCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Хэлхээ</dt>
                    <dd className="text-sm text-slate-900">{load.circuitCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Тоноглол</dt>
                    <dd className="text-sm text-slate-900">{load.equipmentCount}</dd>
                  </div>
                </dl>

                <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-slate-200 pt-4">
                  <div>
                    <dt className="text-xs text-slate-500">Давхрын нийт ачаалал</dt>
                    <dd className="text-sm">
                      <LoadValue value={load.totalKw} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Хэмжсэн нийт</dt>
                    <dd className="text-sm text-slate-900">
                      {load.measuredTotalKw === null ? '-' : `${load.measuredTotalKw} kW`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Зөрүү</dt>
                    <dd className="text-sm">
                      <VarianceValue value={load.variance} />
                    </dd>
                  </div>
                </dl>

                <div
                  role="group"
                  aria-label="Эрсдэлийн түвшний тоо"
                  className="mt-4 border-t border-slate-200 pt-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs font-medium text-slate-600">Эрсдэлийн түвшний тоо</p>
                    <p className="text-xs text-slate-500">
                      Үнэлгээгүй объект{' '}
                      <span className="font-medium text-slate-900">{load.unassessedCount}</span>
                    </p>
                  </div>
                  {load.riskCounts.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">Үнэлгээ бүртгэгдээгүй байна.</p>
                  ) : (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {load.riskCounts.map((entry) => (
                        <li key={entry.level}>
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-xs ring-1 ring-inset ring-slate-200">
                            <RiskBadge level={entry.level} />
                            <span className="font-medium text-slate-900">{entry.count}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* The explanation of why no aggregate score is shown has gone; the kVA
                      note stays because it names a value the page cannot compute. */}
                  <p className="mt-2 text-xs text-slate-500">{load.kvaNote}</p>
                </div>

                {load.unattachedEquipmentCount > 0 && (
                  <div className="mt-4">
                    <Alert variant="info" title="Хэлхээнд холбогдоогүй тоноглол">
                      {load.unattachedEquipmentCount} тоноглол ямар ч самбарын хэлхээнд
                      холбогдоогүй тул давхрын нийт ачаалалд ороогүй. Тэдгээрийн тооцоолсон
                      ачаалал: <LoadValue value={load.unattachedEquipmentKw} />.
                    </Alert>
                  </div>
                )}
              </>
            )}
          </div>

          <FloorPlanPanel
            floorId={floor.id}
            plan={plan}
            canManage={canManage && floor.isActive}
            objects={objects}
            customerId={floor.customerId}
            /*
              Placing an object writes to the object, so it is gated on object_master.manage
              rather than on the plan-managing permission. An archived floor is read-only,
              as it is everywhere else on this page.
            */
            canPlace={canManageObjects && floor.isActive}
            onChanged={() => void loadAll()}
          />
        </div>

        {/* 2. Objects linked to the floor. */}
        {canViewObjects && (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Холбогдсон объект</h2>
              <div className="flex flex-wrap items-center gap-2">
                <ColumnPicker controller={columnState} />
                {canManage && floor.isActive && (
                  <>
                    {/*
                      Not gated on the plan image. The API never required one — a floor
                      only has to exist, belong to the tenant and be active — and blocking
                      registration until somebody uploads a drawing meant equipment on a
                      floor with no scan yet could not be recorded at all.
                    */}
                    <Button size="sm" onClick={() => navigate(`/floors/${floor.id}/objects/new`)}>
                      Тоноглол нэмэх
                    </Button>
                    {/*
                      Relocating an existing panel to another floor is a real need and the
                      backend already supports and audits it, so linking stays available as
                      the secondary action.
                    */}
                    <Button variant="secondary" size="sm" onClick={() => setPickerOpen(true)}>
                      Байгаа объект холбох
                    </Button>
                  </>
                )}
              </div>
            </div>

            <DataTable
              columns={columnState.visibleColumns}
              rows={objects}
              rowKey={(row) => row.id}
              onRowClick={(row) => navigate(`/floors/${floor.id}/objects/${row.id}`)}
              emptyTitle="Объект бүртгэгдээгүй"
              emptyDescription="Самбар, хэлхээ, тоноглолыг энэ давхарт нэмнэ үү."
            />
          </div>
        )}

      </div>

      <FloorEditDrawer
        floor={floor}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          void loadAll();
        }}
      />

      <FloorObjectPicker
        floorId={floor.id}
        customerId={floor.customerId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onLinked={() => {
          setPickerOpen(false);
          void loadAll();
        }}
      />

      <ConfirmDialog
        open={unlinkTarget !== null}
        title="Объектын холбоос салгах"
        message={`"${unlinkTarget?.name ?? ''}" объектыг энэ давхраас салгах уу? Объект өөрөө устахгүй, мастер бүртгэлд үлдэнэ.`}
        confirmLabel="Салгах"
        onCancel={() => setUnlinkTarget(null)}
        onConfirm={() => handleUnlink()}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Давхар устгах"
        message={`"${floor.name}" давхрыг устгах уу?`}
        confirmLabel="Устгах"
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => handleDelete()}
      />
    </>
  );
}
