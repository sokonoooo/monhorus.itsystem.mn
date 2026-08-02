import {
  KVA_UNAVAILABLE_NOTE,
  OBJECT_CATEGORY_LABELS,
  PERMISSIONS,
  type FloorDto,
  type ObjectAssessmentDto,
  type ObjectDetailDto,
  type ObjectHistoryDto,
  type ObjectListItemDto,
  type ObjectPhotoDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { ColumnPicker } from '../../../components/ui/ColumnPicker';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { DataTable, type Column } from '../../../components/ui/DataTable';
import { Modal } from '../../../components/ui/Modal';
import { PageHeader } from '../../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../../components/ui/States';
import { useToast } from '../../../components/ui/ToastProvider';
import { useAuth } from '../../../contexts/auth-context';
import { useTableColumns } from '../../../hooks/use-table-columns';
import { ApiError } from '../../../lib/api-client';
import { authorisedFileUrl } from '../../../lib/file-url';
import { objectMasterService } from '../../../services/object-master.service';
import { projectService } from '../../../services/project.service';
import { AssessmentDetailDrawer } from './AssessmentDetailDrawer';
import { AssessmentDrawer } from './AssessmentDrawer';
import {
  LoadPercent,
  LoadValue,
  ObjectCategoryBadge,
  ObjectStatusBadge,
  ScoreBar,
  ScorePercent,
  VarianceValue,
} from './ObjectBadges';

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-sm text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * An object placed on a floor (requirements 4.1, 10, 11.5).
 *
 * The page lives under the floor path because an object instance only exists as a placement:
 * the catalogue at /object-types holds the product, this holds the measurements taken on the
 * floor. Every exit leads back into the project module.
 */
export function ObjectDetailPage(): ReactElement {
  const { floorId, objectId } = useParams<{ floorId: string; objectId: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify } = useToast();

  const canManage = can(PERMISSIONS.OBJECT_MASTER_MANAGE);
  const canAssess = can(PERMISSIONS.OBJECT_MASTER_ASSESS);

  const [object, setObject] = useState<ObjectDetailDto | null>(null);
  const [floor, setFloor] = useState<FloorDto | null>(null);
  const [history, setHistory] = useState<ObjectHistoryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assessTarget, setAssessTarget] = useState<ObjectDetailDto | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [photoPreview, setPhotoPreview] = useState<ObjectPhotoDto | null>(null);
  const [assessmentDetail, setAssessmentDetail] = useState<ObjectAssessmentDto | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!objectId || !floorId) return;
    setLoading(true);
    setError(null);
    try {
      // The floor supplies the building and project crumbs; the object DTO only knows its
      // floor, so the breadcrumb trail is resolved from the route floor rather than guessed.
      const [detail, timeline, floorDetail] = await Promise.all([
        objectMasterService.getById(objectId),
        objectMasterService.history(objectId),
        projectService.getFloor(floorId),
      ]);
      setObject(detail);
      setHistory(timeline);
      setFloor(floorDetail);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Объект ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [objectId, floorId]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Assessment evidence for the detail panel.
   *
   * The download route is authenticated, so a stored photo cannot be used as a bare `src`.
   * Each attachment is fetched once with the bearer token and turned into an object URL
   * that backs both its thumbnail and its enlarged preview, and every URL is revoked when
   * the history reloads or the page unmounts.
   *
   * Fetching happens here rather than when a row is opened: the page already knows every
   * assessment, and loading the whole set once keeps a panel from showing a spinner where
   * the evidence should be.
   */
  useEffect(() => {
    const photos = (history?.assessments ?? []).flatMap((entry) => entry.photos);
    if (photos.length === 0) {
      setPhotoUrls({});
      return undefined;
    }

    let cancelled = false;
    const created: string[] = [];

    void Promise.all(
      photos.map(async (photo) => {
        try {
          const url = await authorisedFileUrl(photo.downloadUrl);
          created.push(url);
          return [photo.id, url] as const;
        } catch {
          // One unreadable attachment must not blank out the rest of the history.
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setPhotoUrls(Object.fromEntries(entries.filter((entry) => entry !== null)));
    });

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [history]);

  const floorPath = `/floors/${floorId ?? ''}`;

  async function handleDelete(): Promise<void> {
    if (!object) return;
    try {
      await objectMasterService.remove(object.id);
      notify('Объект устгагдлаа.', 'success');
      navigate(floorPath);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Устгаж чадсангүй.', 'error');
      setDeleteOpen(false);
    }
  }

  const childColumns: ReadonlyArray<Column<ObjectListItemDto>> = [
    {
      key: 'object',
      header: 'Объект',
      render: (row) => <span className="truncate text-slate-900">{row.name}</span>,
    },
    {
      key: 'code',
      header: 'Код',
      render: (row) => <span className="whitespace-nowrap text-slate-600">{row.code}</span>,
    },
    {
      key: 'load',
      header: 'Ачаалал',
      align: 'right',
      render: (row) => <LoadValue value={row.calculatedLoad} />,
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
    { key: 'status', header: 'Төлөв', render: (row) => <ObjectStatusBadge status={row.status} /> },
  ];

  // The two child tables share a column set but not a preference: a caller may want the
  // load column on circuits and off equipment.
  const circuitColumnState = useTableColumns('object-child-circuits', childColumns);
  const equipmentColumnState = useTableColumns('object-child-equipment', childColumns);

  /**
   * Assessment history, one recorded value per cell.
   *
   * The history is append-only, so the table carries no action column at all: nothing here
   * can change or remove a stored assessment. A row opens the assessment for reading, and
   * nothing else.
   */
  const assessmentColumns: ReadonlyArray<Column<ObjectAssessmentDto>> = [
    {
      key: 'score',
      header: 'Үнэлгээ',
      render: (row) => <ScorePercent level={row.riskLevel} score={row.newScore} />,
    },
    {
      key: 'photos',
      header: 'Нотлох зураг',
      // The thumbnail moved into the detail panel, but the count stays: without it there is
      // nothing in the row to say a photo is waiting behind it, and evidence nobody knows
      // about might as well not have been attached. Assessments recorded before evidence
      // was required have none, and read as such.
      render: (row) =>
        row.photos.length === 0 ? (
          <span className="text-slate-400">-</span>
        ) : (
          <span className="whitespace-nowrap text-slate-600">{row.photos.length} зураг</span>
        ),
    },
    {
      key: 'previousScore',
      header: 'Өмнөх оноо',
      align: 'right',
      render: (row) => (
        <span className="tabular-nums text-slate-700">{row.previousScore ?? '-'}</span>
      ),
    },
    {
      key: 'conclusion',
      header: 'Тайлбар',
      render: (row) => <span className="text-slate-800">{row.conclusion ?? '-'}</span>,
    },
    {
      key: 'recommendation',
      header: 'Зөвлөмж',
      render: (row) => <span className="text-slate-700">{row.recommendation ?? '-'}</span>,
    },
    {
      key: 'actionTaken',
      header: 'Арга хэмжээ',
      render: (row) => <span className="text-slate-700">{row.actionTaken ?? '-'}</span>,
    },
    {
      key: 'measuredLoad',
      header: 'Хэмжсэн ачаалал',
      align: 'right',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {row.measuredLoadKw === null ? '-' : `${row.measuredLoadKw} kW`}
        </span>
      ),
    },
    {
      key: 'repairRequired',
      header: 'Засвар шаардлагатай',
      render: (row) => (
        <span className="text-slate-700">{row.repairRequired ? 'Тийм' : 'Үгүй'}</span>
      ),
    },
    {
      key: 'revisitRequired',
      header: 'Дахин үзлэг',
      render: (row) => (
        <span className="text-slate-700">{row.revisitRequired ? 'Тийм' : 'Үгүй'}</span>
      ),
    },
    {
      key: 'revisitDate',
      header: 'Дахин үзлэгийн огноо',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {row.revisitDate === null ? '-' : row.revisitDate.slice(0, 10)}
        </span>
      ),
    },
    {
      key: 'assessedBy',
      header: 'Үнэлсэн',
      render: (row) => <span className="text-slate-700">{row.assessedByName ?? '-'}</span>,
    },
    {
      key: 'assessedAt',
      header: 'Огноо',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-600">{formatDateTime(row.assessedAt)}</span>
      ),
    },
  ];

  const assessmentColumnState = useTableColumns('object-assessment-history', assessmentColumns);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !object) return <ErrorState description={error ?? 'Объект олдсонгүй.'} />;

  return (
    <>
      <PageHeader
        title={object.name}
        description={`${object.code} · ${OBJECT_CATEGORY_LABELS[object.category]}${
          object.objectType ? ` · ${object.objectType.name}` : ''
        }`}
        backTo={{ to: floorPath, label: 'Давхар руу буцах' }}
        breadcrumbs={[
          { label: 'Төсөл', to: '/projects' },
          ...(floor
            ? [
                { label: floor.projectName ?? '-', to: `/projects/${floor.projectId}` },
                { label: floor.buildingName ?? '-', to: `/buildings/${floor.buildingId}` },
                { label: floor.name, to: floorPath },
              ]
            : []),
          { label: object.code },
        ]}
        actions={
          <>
            {canAssess && object.canAssess && (
              <Button onClick={() => setAssessTarget(object)}>Үнэлгээ бүртгэх</Button>
            )}
            {canManage && (
              <Button
                variant="secondary"
                onClick={() => navigate(`${floorPath}/objects/${object.id}/edit`)}
              >
                Засах
              </Button>
            )}
            {canManage && object.deleteBlockers.length === 0 && (
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>
                Устгах
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {!object.canAssess && (
          <Alert variant="info">
            Энэ тоноглолын төрөл дүгнэлт үүсгэхээр тохируулагдаагүй тул үнэлгээ бүртгэхгүй.
          </Alert>
        )}

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <ObjectCategoryBadge category={object.category} />
            <ObjectStatusBadge status={object.status} />
            {/* The band is named here as well as coloured: this is the object's own header,
                where there is room and no legend beside it. */}
            <ScoreBar
              level={object.latestAssessment?.riskLevel ?? null}
              score={object.latestAssessment?.score ?? null}
              showPill
            />
          </div>

          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Row label="Харилцагч">{object.customerName ?? '-'}</Row>
            <Row label="Барилга">{object.buildingName ?? '-'}</Row>
            <Row label="Давхар">{object.floorName ?? 'Холбогдоогүй'}</Row>
            <Row label="Тоноглолын төрөл">{object.objectType?.name ?? '-'}</Row>
          </dl>

          {(object.description || object.notes) && (
            <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
              {object.description && (
                <p className="whitespace-pre-wrap text-sm text-slate-700">{object.description}</p>
              )}
              {object.notes && (
                <div>
                  <p className="text-xs text-slate-500">Тэмдэглэл</p>
                  <p className="whitespace-pre-wrap text-sm text-slate-700">{object.notes}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Техникийн үзүүлэлт</h2>

          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {object.panel && (
              <>
                <Row label="Хүчин чадал">
                  {object.panel.capacityKw === null ? '-' : `${object.panel.capacityKw} kW`}
                </Row>
                <Row label="Байрлал">{object.panel.location ?? '-'}</Row>
                <Row label="Хамгаалалт">{object.panel.protection ?? '-'}</Row>
              </>
            )}

            {object.circuit && (
              <>
                <Row label="Харьяалагдах самбар">{object.circuit.panel?.name ?? '-'}</Row>
                <Row label="Хамгаалах автомат">{object.circuit.breakerRating ?? '-'}</Row>
                <Row label="Кабель">
                  {object.circuit.cableType ?? '-'}
                  {object.circuit.cableSectionMm2 ? ` ${object.circuit.cableSectionMm2} мм²` : ''}
                  {object.circuit.cableLengthM ? ` · ${object.circuit.cableLengthM} м` : ''}
                </Row>
                <Row label="Зөвшөөрөгдөх чадал">
                  {object.circuit.permittedCapacityKw === null
                    ? '-'
                    : `${object.circuit.permittedCapacityKw} kW`}
                </Row>
              </>
            )}

            {object.equipment && (
              <>
                <Row label="Тэжээх хэлхээ">{object.equipment.circuit?.name ?? 'Холбогдоогүй'}</Row>
                <Row label="Нэрлэсэн чадал">
                  {object.equipment.ratedPowerKw === null
                    ? '-'
                    : `${object.equipment.ratedPowerKw} kW`}
                </Row>
                <Row label="Тоо ширхэг">{object.equipment.quantity ?? '-'}</Row>
                <Row label="Ашиглалтын коэффициент">
                  {object.equipment.usageCoefficient ?? '1.0 (үндсэн)'}
                </Row>
              </>
            )}
          </dl>

          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-200 pt-4 md:grid-cols-4">
            <Row label="Тооцоолсон ачаалал">
              <LoadValue value={object.calculatedLoad} />
            </Row>
            <Row label="Хэмжсэн ачаалал">
              {object.measuredLoadKw === null ? '-' : `${object.measuredLoadKw} kW`}
            </Row>
            <Row label="Зөрүү">
              <VarianceValue value={object.loadVariance} />
            </Row>
            {object.category !== 'EQUIPMENT' && (
              <Row label="Ачааллын хувь">
                <LoadPercent value={object.loadPercent} />
              </Row>
            )}
          </dl>

          {object.category === 'PANEL' && (
            <p className="mt-3 text-xs text-slate-500">
              Нөөц чадал: <LoadValue value={object.reserveKw} />. {KVA_UNAVAILABLE_NOTE}
            </p>
          )}
        </div>

        {object.childCircuits.length > 0 && (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Энэ самбарын хэлхээнүүд</h2>
              <ColumnPicker controller={circuitColumnState} />
            </div>
            <DataTable
              columns={circuitColumnState.visibleColumns}
              rows={object.childCircuits}
              rowKey={(row) => row.id}
              onRowClick={(row) => navigate(`${floorPath}/objects/${row.id}`)}
              emptyTitle="Хэлхээ алга"
            />
          </div>
        )}

        {object.childEquipment.length > 0 && (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Энэ хэлхээнд холбогдсон тоноглол
              </h2>
              <ColumnPicker controller={equipmentColumnState} />
            </div>
            <DataTable
              columns={equipmentColumnState.visibleColumns}
              rows={object.childEquipment}
              rowKey={(row) => row.id}
              onRowClick={(row) => navigate(`${floorPath}/objects/${row.id}`)}
              emptyTitle="Тоноглол алга"
            />
          </div>
        )}

        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Үнэлгээний түүх</h2>
            <ColumnPicker controller={assessmentColumnState} />
          </div>
          <DataTable
            ariaLabel="Үнэлгээний түүх"
            columns={assessmentColumnState.visibleColumns}
            rows={history?.assessments ?? []}
            rowKey={(row) => row.id}
            onRowClick={(row) => setAssessmentDetail(row)}
            emptyTitle="Үнэлгээ бүртгэгдээгүй байна."
          />
        </div>

        {/* The reasons deletion is blocked close the page: they explain an action that is
            already absent from the header, so they are read last rather than first. */}
        {object.deleteBlockers.length > 0 && canManage && (
          <Alert variant="warning" title="Устгах боломжгүй">
            <ul className="ml-4 list-disc space-y-0.5">
              {object.deleteBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Alert>
        )}
      </div>

      <AssessmentDrawer
        object={assessTarget}
        onClose={() => setAssessTarget(null)}
        onSaved={() => {
          setAssessTarget(null);
          void load();
        }}
      />

      <AssessmentDetailDrawer
        assessment={assessmentDetail}
        photoUrls={photoUrls}
        onPreview={(photo) => setPhotoPreview(photo)}
        onClose={() => setAssessmentDetail(null)}
      />

      <Modal
        open={photoPreview !== null}
        title={photoPreview?.name ?? ''}
        onClose={() => setPhotoPreview(null)}
      >
        {photoPreview && photoUrls[photoPreview.id] ? (
          <img
            src={photoUrls[photoPreview.id]}
            alt={photoPreview.name}
            className="mx-auto max-h-[60vh] w-auto max-w-full"
          />
        ) : (
          <div className="h-48 animate-pulse rounded bg-slate-200" />
        )}
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        title="Объект устгах"
        message={`"${object.name}" объектыг устгах уу?`}
        confirmLabel="Устгах"
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => handleDelete()}
      />
    </>
  );
}
