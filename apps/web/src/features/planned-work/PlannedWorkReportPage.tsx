import {
  MATERIAL_UNIT_LABELS,
  PERMISSIONS,
  REPORT_SUBMITTABLE_STATUSES,
  type PlannedWorkMaterialDto,
  type PlannedWorkReportDto,
  type PlannedWorkReportPreviewDto,
  type PlannedWorkReportTaskLineDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { formatMinutes } from '../../lib/duration';
import { plannedWorkService } from '../../services/planned-work.service';
import { ScoreBar } from '../projects/objects/ObjectBadges';
import { ProgressBar, ReportStatusBadge, TaskStatusBadge } from './PlannedWorkBadges';

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/**
 * Consolidated report screen.
 *
 * The workflow is DRAFT to SUBMITTED to APPROVED, or SUBMITTED to RETURNED and back. All
 * gates are backend-computed: `submissionBlockers` explains a disabled submit button and
 * `canApprove` decides whether approval is offered at all, so the client never guesses
 * whether the current user is allowed to approve their own work.
 */
export function PlannedWorkReportPage(): ReactElement {
  const { plannedWorkId } = useParams<{ plannedWorkId: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify } = useToast();

  const canSubmit = can(PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT);
  const canReview = can(PERMISSIONS.PLANNED_WORK_APPROVE_REPORT);

  const [report, setReport] = useState<PlannedWorkReportDto | null>(null);
  const [preview, setPreview] = useState<PlannedWorkReportPreviewDto | null>(null);
  const [conclusion, setConclusion] = useState('');
  const [recommendation, setRecommendation] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!plannedWorkId) return;
    setLoading(true);
    setError(null);
    try {
      const bundle = await plannedWorkService.report(plannedWorkId);
      setReport(bundle.report);
      setPreview(bundle.preview);
      setConclusion(bundle.report?.conclusion ?? '');
      setRecommendation(bundle.report?.recommendation ?? '');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Тайлан ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [plannedWorkId]);

  useEffect(() => {
    void load();
  }, [load]);

  function describe(caught: unknown, fallback: string): string {
    if (caught instanceof ApiError) {
      return [caught.message, ...caught.issues.map((issue) => issue.message)].join(' ');
    }
    return fallback;
  }

  async function run(
    operation: () => Promise<unknown>,
    successMessage: string,
  ): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      await operation();
      notify(successMessage, 'success');
      await load();
      return true;
    } catch (caught) {
      setActionError(describe(caught, 'Гэнэтийн алдаа гарлаа.'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const taskColumns: ReadonlyArray<Column<PlannedWorkReportTaskLineDto>> = [
    {
      key: 'task',
      header: 'Дэд ажил',
      render: (row) => <span className="truncate text-slate-900">{row.title}</span>,
    },
    {
      key: 'floor',
      header: 'Давхар',
      render: (row) => <span className="truncate text-slate-700">{row.floorName}</span>,
    },
    {
      key: 'quantity',
      header: 'Биелэлт',
      render: (row) => (
        <ProgressBar
          percent={row.progressPercent}
          completedQuantity={row.completedQuantity}
          totalQuantity={row.totalQuantity}
          unitLabel={MATERIAL_UNIT_LABELS[row.unit]}
        />
      ),
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) => <TaskStatusBadge status={row.status} />,
    },
    {
      key: 'beforePhotos',
      header: 'Өмнөх зураг',
      align: 'right',
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-slate-600">{row.beforePhotoCount}</span>
      ),
    },
    {
      key: 'afterPhotos',
      header: 'Дараах зураг',
      align: 'right',
      render: (row) => (
        <span className="whitespace-nowrap text-xs text-slate-600">{row.afterPhotoCount}</span>
      ),
    },
    {
      key: 'score',
      header: 'Үнэлгээ',
      render: (row) => <ScoreBar level={row.riskLevel} score={row.score} />,
    },
    {
      key: 'note',
      header: 'Тайлбар',
      render: (row) => <span className="text-xs text-slate-700">{row.note ?? '-'}</span>,
    },
    {
      key: 'recommendation',
      header: 'Зөвлөмж',
      render: (row) => <span className="text-xs text-slate-700">{row.recommendation ?? '-'}</span>,
    },
  ];

  const materialColumns: ReadonlyArray<Column<PlannedWorkMaterialDto>> = [
    {
      key: 'material',
      header: 'Нэр',
      render: (row) => <span className="text-slate-900">{row.name}</span>,
    },
    {
      key: 'quantity',
      header: 'Тоо',
      align: 'right',
      render: (row) => (
        <span className="whitespace-nowrap font-medium text-slate-900">
          {row.quantity.toLocaleString('mn-MN')}
        </span>
      ),
    },
    {
      key: 'unit',
      header: 'Нэгж',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-600">{MATERIAL_UNIT_LABELS[row.unit]}</span>
      ),
    },
  ];

  const taskColumnState = useTableColumns('report-tasks', taskColumns);
  const materialColumnState = useTableColumns('report-materials', materialColumns);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error) return <ErrorState description={error} />;

  if (!report || !preview) {
    return (
      <>
        <PageHeader
          title="Нэгдсэн тайлан"
          backTo={{ to: `/planned-work/${plannedWorkId ?? ''}`, label: 'Ажил руу буцах' }}
          breadcrumbs={[
            { label: 'Нүүр', to: '/dashboard' },
            { label: 'Төлөвлөгөөт ажил', to: '/planned-work' },
            { label: 'Тайлан' },
          ]}
        />
        <EmptyState
          title="Тайлан үүсээгүй байна"
          description="Нэгдсэн тайлан нь ажлыг дуусгасны дараа ноорог төлөвт автоматаар үүснэ."
          action={
            <Button variant="secondary" onClick={() => navigate(`/planned-work/${plannedWorkId}`)}>
              Ажил руу буцах
            </Button>
          }
        />
      </>
    );
  }

  const editable = REPORT_SUBMITTABLE_STATUSES.includes(report.status) && canSubmit;

  return (
    <>
      <PageHeader
        title="Нэгдсэн тайлан"
        description={`${preview.workNumber} · ${preview.title}`}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Төлөвлөгөөт ажил', to: '/planned-work' },
          { label: preview.workNumber, to: `/planned-work/${plannedWorkId}` },
          { label: 'Тайлан' },
        ]}
        actions={
          <>
            {editable && (
              <Button
                variant="secondary"
                onClick={() =>
                  void run(
                    () =>
                      plannedWorkService.updateReport(plannedWorkId!, {
                        conclusion: conclusion.trim() || null,
                        recommendation: recommendation.trim() || null,
                      }),
                    'Тайлан хадгалагдлаа.',
                  )
                }
                disabled={busy}
              >
                Хадгалах
              </Button>
            )}
            {editable && (
              <Button
                onClick={() =>
                  void run(
                    () => plannedWorkService.submitReport(plannedWorkId!),
                    'Тайлан хянуулахаар илгээгдлээ.',
                  )
                }
                disabled={busy || report.submissionBlockers.length > 0}
              >
                Хянуулахаар илгээх
              </Button>
            )}
            {canReview && report.status === 'SUBMITTED' && (
              <>
                <Button variant="secondary" onClick={() => setReturnOpen(true)} disabled={busy}>
                  Буцаах
                </Button>
                <Button
                  onClick={() => setApproveOpen(true)}
                  disabled={busy || !report.canApprove}
                >
                  Батлах
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {actionError && <Alert variant="error">{actionError}</Alert>}

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <ReportStatusBadge status={report.status} />
            {report.visibleToCustomer ? (
              <span className="text-xs text-green-700">Харилцагчид харагдана</span>
            ) : (
              <span className="text-xs text-slate-500">Харилцагчид харагдахгүй</span>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500">Харилцагч</dt>
              <dd className="text-sm text-slate-900">{preview.customerName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Төсөл</dt>
              <dd className="text-sm text-slate-900">{preview.projectName ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Барилга</dt>
              <dd className="text-sm text-slate-900">{preview.buildingName}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Биелэлт</dt>
              <dd>
                <ProgressBar
                  percent={preview.progressPercent}
                  completedQuantity={preview.completedQuantity}
                  totalQuantity={preview.totalQuantity}
                />
              </dd>
            </div>
          </dl>

          {preview.completedLate && (
            <Alert variant="warning" title="Хугацаа хэтэрсэн">
              Эх төлөвлөсөн дуусах огноо {preview.originalPlannedEndDate.slice(0, 10)}, бодит
              дууссан {formatDateTime(preview.actualEndDate)}. Хоцролт{' '}
              {formatMinutes(preview.delayMinutes)}.
            </Alert>
          )}
        </div>

        {report.status === 'RETURNED' && report.returnReason && (
          <Alert variant="error" title="Тайлан буцаагдсан">
            {report.returnReason}
            <p className="mt-1 text-xs">
              {report.returnedBy.name ?? '-'} · {formatDateTime(report.returnedBy.at)}
            </p>
          </Alert>
        )}

        {report.submissionBlockers.length > 0 && canSubmit && (
          <Alert variant="warning" title="Илгээхэд дараах нь шаардлагатай">
            <ul className="ml-4 list-disc space-y-0.5">
              {report.submissionBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Alert>
        )}

        {canReview && report.status === 'SUBMITTED' && report.approvalBlockers.length > 0 && (
          <Alert variant="info" title="Батлах боломжгүй">
            <ul className="ml-4 list-disc space-y-0.5">
              {report.approvalBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Нэгдсэн дүгнэлт ба зөвлөмж</h2>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="report-conclusion"
                className={FILTER_LABEL}
              >
                Дүгнэлт
              </label>
              <textarea
                id="report-conclusion"
                rows={4}
                value={conclusion}
                onChange={(event) => setConclusion(event.target.value)}
                disabled={!editable || busy}
                className={FIELD_TEXTAREA}
              />
            </div>
            <div>
              <label
                htmlFor="report-recommendation"
                className={FILTER_LABEL}
              >
                Зөвлөмж
              </label>
              <textarea
                id="report-recommendation"
                rows={4}
                value={recommendation}
                onChange={(event) => setRecommendation(event.target.value)}
                disabled={!editable || busy}
                className={FIELD_TEXTAREA}
              />
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200 pt-4 text-xs md:grid-cols-4">
            <div>
              <dt className="text-slate-500">Зохиогч</dt>
              <dd className="text-slate-900">{report.createdBy.name ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Илгээсэн</dt>
              <dd className="text-slate-900">
                {report.submittedBy.name ?? '-'} · {formatDateTime(report.submittedBy.at)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Батласан</dt>
              <dd className="text-slate-900">
                {report.approvedBy.name ?? '-'} · {formatDateTime(report.approvedBy.at)}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Буцаасан</dt>
              <dd className="text-slate-900">
                {report.returnedBy.name ?? '-'} · {formatDateTime(report.returnedBy.at)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Дэд ажлын биелэлт</h2>
            <ColumnPicker controller={taskColumnState} />
          </div>
          <DataTable
            columns={taskColumnState.visibleColumns}
            rows={preview.tasks}
            rowKey={(row) => row.id}
            emptyTitle="Дэд ажил байхгүй"
          />
        </div>

        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Материал</h2>
            <ColumnPicker controller={materialColumnState} />
          </div>
          <DataTable
            columns={materialColumnState.visibleColumns}
            rows={preview.materials}
            rowKey={(row) => row.name}
            emptyTitle="Материал бүртгэгдээгүй"
          />
        </div>
      </div>

      <ConfirmDialog
        open={returnOpen}
        title="Тайлан буцаах"
        message="Тайланг засуулахаар буцаана. Шалтгаан заавал бөглөнө. Ажил дууссан төлөвтэй хэвээр байна."
        confirmLabel="Буцаах"
        requireReason
        reasonLabel="Буцаах шалтгаан"
        onCancel={() => setReturnOpen(false)}
        onConfirm={async (reason) => {
          const ok = await run(
            () => plannedWorkService.returnReport(plannedWorkId!, { reason }),
            'Тайлан буцаагдлаа.',
          );
          if (ok) setReturnOpen(false);
        }}
      />

      <ConfirmDialog
        open={approveOpen}
        title="Тайлан батлах"
        message="Тайланг батлахад ажил архивлагдана. Архивласны дараа зөвхөн харах боломжтой."
        confirmLabel="Батлах"
        onCancel={() => setApproveOpen(false)}
        onConfirm={async () => {
          const ok = await run(
            () => plannedWorkService.approveReport(plannedWorkId!),
            'Тайлан батлагдаж, ажил архивлагдлаа.',
          );
          if (ok) setApproveOpen(false);
        }}
      />
    </>
  );
}
