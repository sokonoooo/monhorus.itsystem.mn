import {
  PERMISSIONS,
  createBuildingSchema,
  type BuildingDto,
  type BuildingListQuery,
  type PaginatedData,
  type ProjectDto,
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
import { ActiveBadge } from './ProjectListPage';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/** Position held as numbers, matching the gpsLatitude/gpsLongitude pair the API stores. */
export interface GpsPosition {
  latitude: number | null;
  longitude: number | null;
}

export const NO_POSITION: GpsPosition = { latitude: null, longitude: null };

/**
 * Validation for the coordinate pair, shown under the map.
 *
 * MapPicker owns both numbers at once, so the two schema paths are surfaced together
 * rather than against a field each; the "both or neither" rule fires on one of them
 * depending on which half was filled.
 */
export function GpsErrors({
  fieldErrors,
}: {
  fieldErrors: Record<string, string>;
}): ReactElement | null {
  const message = fieldErrors.gpsLatitude ?? fieldErrors.gpsLongitude;
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-600">{message}</p>;
}

/**
 * Inline building create, so a project can be populated without leaving the page.
 *
 * No code is asked for: `BLD-001` is issued by the server against a per-customer counter,
 * and a code the browser proposed could only ever be a guess at it.
 */
function BuildingDrawer({
  projectId,
  open,
  onClose,
  onSaved,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { notify } = useToast();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [position, setPosition] = useState<GpsPosition>(NO_POSITION);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setName('');
    setAddress('');
    setPosition(NO_POSITION);
    setDescription('');
    setFormError(null);
    setFieldErrors({});
  }, [open]);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const parsed = createBuildingSchema.safeParse({
      projectId,
      name: name.trim(),
      address: address.trim() || null,
      gpsLatitude: position.latitude,
      gpsLongitude: position.longitude,
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
      await projectService.createBuilding(parsed.data);
      notify('Барилга үүслээ.', 'success');
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
      title="Шинэ барилга"
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
          <Field label="Барилгын нэр" required error={fieldErrors.name}>
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
            htmlFor="building-create-description"
            className={FILTER_LABEL}
          >
            Тайлбар
          </label>
          <textarea
            id="building-create-description"
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

export function ProjectDetailPage(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify } = useToast();

  const canManage = can(PERMISSIONS.OBJECT_MANAGE);

  // The building table's page and search live in the URL, the same as the project list:
  // this route reads nothing else from the query string, so there is nothing to clash with,
  // and a link to page 3 of a long project's buildings stays a link.
  const [searchParams, setSearchParams] = useSearchParams();

  const [project, setProject] = useState<ProjectDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [buildings, setBuildings] = useState<PaginatedData<BuildingDto> | null>(null);
  const [buildingsLoading, setBuildingsLoading] = useState(true);
  const [buildingsError, setBuildingsError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');

  const buildingQuery = useMemo<BuildingListQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    return {
      ...(projectId ? { projectId } : {}),
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: 20,
      ...(searchParams.get('search') ? { search: searchParams.get('search')! } : {}),
    };
  }, [projectId, searchParams]);

  const loadProject = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      setProject(await projectService.getProject(projectId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Төсөл ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // The list is fetched apart from the detail so that turning a page or typing a search
  // reloads the table alone, rather than throwing the whole page back to its skeleton.
  const requestIdRef = useRef(0);
  const queryKey = JSON.stringify(buildingQuery);

  const loadBuildings = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    const requestId = ++requestIdRef.current;
    setBuildingsLoading(true);
    setBuildingsError(null);
    try {
      const result = await projectService.listBuildings(JSON.parse(queryKey) as BuildingListQuery);
      if (requestId !== requestIdRef.current) return;
      setBuildings(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setBuildingsError(caught instanceof ApiError ? caught.message : 'Барилга ачаалж чадсангүй.');
    } finally {
      if (requestId === requestIdRef.current) setBuildingsLoading(false);
    }
  }, [projectId, queryKey]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    void loadBuildings();
  }, [loadBuildings]);

  /** Creating a building changes both the list and the counts on the detail. */
  const load = useCallback(async (): Promise<void> => {
    await Promise.all([loadProject(), loadBuildings()]);
  }, [loadProject, loadBuildings]);

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
    if (!project) return;
    try {
      await projectService.deleteProject(project.id);
      notify('Төсөл устгагдлаа.', 'success');
      navigate('/projects');
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Устгаж чадсангүй.', 'error');
      setDeleteOpen(false);
    }
  }

  const columns: ReadonlyArray<Column<BuildingDto>> = [
    {
      key: 'building',
      header: 'Барилгын нэр',
      render: (row) => <span className="truncate font-medium text-slate-900">{row.name}</span>,
    },
    {
      key: 'code',
      header: 'Код',
      render: (row) => <span className="whitespace-nowrap text-slate-600">{row.code}</span>,
    },
    {
      key: 'address',
      header: 'Хаяг',
      render: (row) => <span className="text-slate-700">{row.address ?? '-'}</span>,
    },
    {
      key: 'gps',
      header: 'GPS байршил',
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-slate-600">
          {row.gpsLatitude !== null && row.gpsLongitude !== null
            ? `${row.gpsLatitude}, ${row.gpsLongitude}`
            : '-'}
        </span>
      ),
    },
    {
      key: 'floors',
      header: 'Давхар',
      align: 'right',
      render: (row) => <span className="text-slate-700">{row.floorCount}</span>,
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
    { key: 'status', header: 'Төлөв', render: (row) => <ActiveBadge isActive={row.isActive} /> },
  ];

  const columnState = useTableColumns('project-buildings', columns);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error || !project) return <ErrorState description={error ?? 'Төсөл олдсонгүй.'} />;

  return (
    <>
      <PageHeader
        title={project.name}
        description={`${project.code}${project.customerName ? ` · ${project.customerName}` : ''}`}
        backTo={{ to: '/projects', label: 'Төслийн жагсаалт руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Төсөл', to: '/projects' },
          { label: project.code },
        ]}
        actions={
          <>
            {canManage && (
              <Button variant="secondary" onClick={() => navigate(`/projects/${project.id}/edit`)}>
                Засах
              </Button>
            )}
            {canManage && project.deleteBlockers.length === 0 && (
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Устгах
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {!project.isActive && (
          <Alert variant="warning">
            Энэ төсөл архивлагдсан. Шинэ барилга нэмэх, объект холбох боломжгүй.
          </Alert>
        )}

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4">
            <ActiveBadge isActive={project.isActive} />
          </div>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500">Гэрээний дугаар</dt>
              <dd className="text-sm text-slate-900">{project.contractNumber ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Хариуцагч</dt>
              <dd className="text-sm text-slate-900">{project.responsibleEmployeeName ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Эхлэх огноо</dt>
              <dd className="text-sm text-slate-900">{formatDate(project.startDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Дуусах огноо</dt>
              <dd className="text-sm text-slate-900">{formatDate(project.endDate)}</dd>
            </div>
          </dl>

          {project.description && (
            <p className="mt-4 whitespace-pre-wrap border-t border-slate-200 pt-4 text-sm text-slate-700">
              {project.description}
            </p>
          )}
        </div>

        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Барилга</h2>
            <div className="flex items-center gap-2">
              <div className="w-52">
                {/* Labelled for a screen reader only: the heading beside it already says
                    which table this searches. */}
                <label htmlFor="prj-building-search" className="sr-only">
                  Хайлт
                </label>
                <SearchField
                  id="prj-building-search"
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
              {canManage && project.isActive && (
                <Button variant="secondary" size="sm" onClick={() => setDrawerOpen(true)}>
                  Шинэ барилга
                </Button>
              )}
            </div>
          </div>
          <DataTable
            columns={columnState.visibleColumns}
            rows={buildings?.items ?? []}
            rowKey={(row) => row.id}
            // Numbered off the response rather than the query, so a request in flight can
            // never number the rows on screen against the page they did not come from.
            numbering={{ page: buildings?.page ?? 1, limit: buildings?.limit ?? 20 }}
            loading={buildingsLoading}
            error={buildingsError}
            onRetry={() => void loadBuildings()}
            onRowClick={(row) => navigate(`/buildings/${row.id}`)}
            emptyTitle="Барилга бүртгэгдээгүй"
            emptyDescription={
              searchParams.get('search')
                ? 'Хайлтад тохирох барилга алга.'
                : 'Давхар болон объект нэмэхийн тулд эхлээд барилга бүртгэнэ үү.'
            }
          />
          {buildings && (
            <Pagination
              page={buildings.page}
              totalPages={buildings.totalPages}
              total={buildings.total}
              onPageChange={(page) => updateParam('page', String(page))}
            />
          )}
        </div>

        {/* The reasons deletion is blocked close the page: they explain an action that is
            already absent from the header, so they are read last rather than first. */}
        {project.deleteBlockers.length > 0 && canManage && (
          <Alert variant="info" title="Устгах боломжгүй">
            <ul className="ml-4 list-disc space-y-0.5">
              {project.deleteBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Alert>
        )}
      </div>

      <BuildingDrawer
        projectId={project.id}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => {
          setDrawerOpen(false);
          void load();
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Төсөл устгах"
        message={`"${project.name}" төслийг устгах уу?`}
        confirmLabel="Устгах"
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => handleDelete()}
      />
    </>
  );
}
