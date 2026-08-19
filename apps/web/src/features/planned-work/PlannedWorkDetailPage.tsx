import {
  MATERIAL_UNIT_LABELS,
  PERMISSIONS,
  type PlannedWorkDto,
  type PlannedWorkMaterialDto,
  type PlannedWorkTaskDto,
} from '@monhorus/shared';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { RowActions, type RowActionItem } from '../../components/ui/RowActions';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../contexts/auth-context';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { formatMinutes } from '../../lib/duration';
import { plannedWorkService } from '../../services/planned-work.service';
import { ScoreBar } from '../projects/objects/ObjectBadges';
import { PlannedMaterialsDrawer } from './PlannedMaterialsDrawer';
import {
  LateBadge,
  PlannedWorkStatusBadge,
  ProgressBar,
  ReportStatusBadge,
  TaskStatusBadge,
} from './PlannedWorkBadges';
import {
  FloorTaskSection,
  TaskEquipmentPanel,
  groupTasksByFloor,
} from './PlannedWorkFloorSections';
import { RescheduleDrawer } from './RescheduleDrawer';
import { TaskDetailDrawer } from './TaskDetailDrawer';
import { TaskFormDrawer } from './TaskFormDrawer';
import { TaskMaterialUsagePanel } from './TaskMaterialUsagePanel';
import { TaskProgressDrawer } from './TaskProgressDrawer';
import { TransitionActions } from './TransitionActions';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/**
 * Which floor sections the user has closed.
 *
 * Stores the CLOSED ones, so the default with nothing stored is every section open: this
 * page is the work itself, and opening it to a column of collapsed headers would hide the
 * content behind a click per floor. Same `monhorus.*` namespace and same reasoning as
 * `useTableColumns` — a private view preference with no consequence if it is lost, not
 * worth a round trip.
 */
const FLOOR_COLLAPSE_STORAGE_KEY = 'monhorus.section.planned-work-floors';

function readCollapsedFloors(): string[] {
  try {
    const raw = localStorage.getItem(FLOOR_COLLAPSE_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    // A corrupt preference opens everything rather than taking the page down.
    return [];
  }
}

function writeCollapsedFloors(next: readonly string[]): void {
  try {
    localStorage.setItem(FLOOR_COLLAPSE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked quota must not stop the section from collapsing.
  }
}

function SummaryRow({ label, value }: { label: string; value: ReactElement | string }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-sm text-slate-900">{value}</dd>
    </div>
  );
}

export function PlannedWorkDetailPage(): ReactElement {
  const { plannedWorkId } = useParams<{ plannedWorkId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { notify } = useToast();

  /** Set by the consolidated inspection report so an admin lands on the sub-task itself. */
  const focusTaskId = searchParams.get('task');

  const canUpdate = can(PERMISSIONS.PLANNED_WORK_UPDATE);
  const canRecord = can(PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS);
  const canReschedule = can(PERMISSIONS.PLANNED_WORK_RESCHEDULE);

  const [work, setWork] = useState<PlannedWorkDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [collapsedFloors, setCollapsedFloors] = useState<readonly string[]>(() =>
    readCollapsedFloors(),
  );

  const [taskTarget, setTaskTarget] = useState<PlannedWorkTaskDto | null | 'new'>(null);
  const [progressTarget, setProgressTarget] = useState<PlannedWorkTaskDto | null>(null);
  const [detailTarget, setDetailTarget] = useState<PlannedWorkTaskDto | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlannedWorkTaskDto | null>(null);

  /**
   * Sub-tasks whose detail panel — the equipment it covers and the material it drew — is
   * open. Held here rather than per floor section so a row stays open when its floor group
   * re-renders, and deliberately NOT persisted: unlike the collapsed-floor preference this
   * is a glance at one row, not a layout choice.
   */
  const [expandedTaskIds, setExpandedTaskIds] = useState<readonly string[]>([]);

  const toggleTask = useCallback((taskId: string): void => {
    setExpandedTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((entry) => entry !== taskId)
        : [...current, taskId],
    );
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (!plannedWorkId) return;
    setLoading(true);
    setError(null);
    try {
      setWork(await plannedWorkService.getById(plannedWorkId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Ажил ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [plannedWorkId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFloor = useCallback((floorKey: string): void => {
    setCollapsedFloors((current) => {
      const next = current.includes(floorKey)
        ? current.filter((entry) => entry !== floorKey)
        : [...current, floorKey];
      writeCollapsedFloors(next);
      return next;
    });
  }, []);

  // Opening the deep-linked sub-task is done once. `work` is replaced after every progress
  // or edit save, and reacting to that would reopen a drawer the user had closed.
  const openedTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (!work || !focusTaskId || openedTaskRef.current === focusTaskId) return;
    const match = work.tasks.find((task) => task.id === focusTaskId);
    if (!match) return;
    openedTaskRef.current = focusTaskId;
    setDetailTarget(match);
  }, [work, focusTaskId]);

  async function handleDeleteTask(): Promise<void> {
    if (!work || !deleteTarget) return;
    try {
      setWork(await plannedWorkService.deleteTask(work.id, deleteTarget.id));
      notify('Дэд ажил устгагдлаа.', 'success');
      setDeleteTarget(null);
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Устгаж чадсангүй.', 'error');
    }
  }

  const isClosed = work?.lifecycleStatus === 'ARCHIVED' || work?.lifecycleStatus === 'CANCELLED';

  const taskColumns: ReadonlyArray<Column<PlannedWorkTaskDto>> = [
    {
      key: 'task',
      header: 'Дэд ажил',
      render: (row) => <span className="truncate font-medium text-slate-900">{row.title}</span>,
    },
    {
      key: 'floor',
      header: 'Давхар',
      render: (row) => (
        <span className="truncate text-slate-700">{row.floorName ?? 'Давхар заагаагүй'}</span>
      ),
    },
    {
      key: 'plannedStart',
      header: 'Эхлэх',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{formatDate(row.plannedStartDate)}</span>
      ),
    },
    {
      key: 'plannedEnd',
      header: 'Дуусах',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{formatDate(row.plannedEndDate)}</span>
      ),
    },
    {
      key: 'progress',
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
    { key: 'status', header: 'Төлөв', render: (row) => <TaskStatusBadge status={row.status} /> },
    {
      key: 'score',
      header: 'Үнэлгээ',
      render: (row) => <ScoreBar level={row.riskLevel} score={row.score} />,
    },
    {
      key: 'evidence',
      header: 'Дутуу баримт',
      render: (row) =>
        row.missingEvidence.length === 0 ? (
          <span className="text-xs text-green-700">Бүрэн</span>
        ) : (
          <span className="text-xs text-amber-700">{row.missingEvidence.join(', ')}</span>
        ),
    },
    {
      key: 'assigned',
      header: 'Ажилтан',
      render: (row) => (
        <span className="text-slate-700">{row.assignedEmployeeName ?? '-'}</span>
      ),
    },
    {
      key: 'createdBy',
      header: 'Үүсгэсэн',
      render: (row) => <span className="text-slate-700">{row.createdByName ?? '-'}</span>,
    },
    {
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      render: (row) => {
        const items: RowActionItem[] = [
          { label: 'Дэлгэрэнгүй', onSelect: () => setDetailTarget(row) },
        ];
        if (canRecord && !isClosed) {
          items.push({ label: 'Биелэлт', onSelect: () => setProgressTarget(row) });
        }
        if (canUpdate && !isClosed) {
          items.push({ label: 'Засах', onSelect: () => setTaskTarget(row) });
        }
        // Progress already recorded against a sub-task must not be thrown away by a delete.
        if (canUpdate && !isClosed && row.completedQuantity === 0) {
          items.push({ label: 'Устгах', onSelect: () => setDeleteTarget(row), tone: 'danger' });
        }
        return <RowActions items={items} />;
      },
    },
  ];

  const materialColumns: ReadonlyArray<Column<PlannedWorkMaterialDto>> = [
    {
      key: 'material',
      header: 'Нэр',
      render: (row) => <span className="truncate text-slate-900">{row.name}</span>,
    },
    {
      key: 'usage',
      header: 'Зарцуулалт',
      render: (row) => (
        <ProgressBar
          // The one figure on this row with no server field behind it, because there is no
          // percentage in the contract — it is the fill of the bar and nothing else. The
          // NUMBERS beside and after it are the server's own, and Үлдэгдэл in particular is
          // read rather than subtracted: the guard the backend enforces acts on the stored
          // remainder, so a client that recomputed it could disagree with the thing that
          // decides whether the next draw is allowed.
          percent={row.quantity > 0 ? Math.round((row.consumedQuantity / row.quantity) * 100) : 0}
          completedQuantity={row.consumedQuantity}
          totalQuantity={row.quantity}
          unitLabel={MATERIAL_UNIT_LABELS[row.unit]}
        />
      ),
    },
    {
      key: 'quantity',
      header: 'Бүртгэсэн',
      align: 'right',
      render: (row) => (
        <span className="whitespace-nowrap font-medium text-slate-900">
          {row.quantity.toLocaleString('mn-MN')}
        </span>
      ),
    },
    {
      key: 'consumed',
      header: 'Зарцуулсан',
      align: 'right',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {row.consumedQuantity.toLocaleString('mn-MN')}
        </span>
      ),
    },
    {
      key: 'remaining',
      header: 'Үлдэгдэл',
      align: 'right',
      render: (row) => (
        <span
          className={`whitespace-nowrap font-medium ${
            row.remainingQuantity === 0 ? 'text-amber-700' : 'text-slate-900'
          }`}
        >
          {row.remainingQuantity.toLocaleString('mn-MN')}
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

  // `tableKey` is unchanged from when this was one flat table: the columns are the same
  // columns, and a new key would throw away every preference already saved.
  const taskColumnState = useTableColumns('planned-work-tasks', taskColumns);
  const materialColumnState = useTableColumns('planned-work-materials', materialColumns);

  const floorGroups = useMemo(
    () => groupTasksByFloor(work?.tasks ?? [], work?.floorProgress ?? []),
    [work],
  );

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error || !work) {
    return <ErrorState description={error ?? 'Төлөвлөгөөт ажил олдсонгүй.'} />;
  }

  return (
    <>
      <PageHeader
        title={work.title}
        description={`${work.workNumber} · ${work.customer.name} · ${work.building.name}`}
        backTo={{ to: '/planned-work', label: 'Төлөвлөгөөт ажлын жагсаалт руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Төлөвлөгөөт ажил', to: '/planned-work' },
          { label: work.workNumber },
        ]}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(`/planned-work/${work.id}/report`)}>
              Тайлан
            </Button>
            <Button
              variant="secondary"
              onClick={() => navigate(`/planned-work/${work.id}/inspection-report`)}
            >
              Үзлэгийн нэгдсэн тайлан
            </Button>
            {canReschedule && !isClosed && work.lifecycleStatus !== 'COMPLETED' && (
              <Button variant="secondary" onClick={() => setRescheduleOpen(true)}>
                Хугацаа сунгах
              </Button>
            )}
            {canUpdate && !isClosed && (
              <Button variant="secondary" onClick={() => navigate(`/planned-work/${work.id}/edit`)}>
                Засах
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {work.effectiveStatus === 'OVERDUE' && (
          <Alert variant="error" title="Хугацаа хэтэрсэн">
            Төлөвлөсөн дуусах огноо {formatDate(work.plannedEndDate)}, хэтэрсэн болсон
            хугацаа {formatDateTime(work.overdueAt)}. Хугацааг зөвхөн зөвшөөрөгдсөн
            сунгалтаар өөрчилнө.
          </Alert>
        )}

        {work.lifecycleStatus === 'PAUSED' && (
          <Alert variant="warning" title="Түр зогссон">
            Түр зогсолт төлөвлөсөн хугацааг сунгадаггүй. Шаардлагатай бол хугацаа сунгах
            үйлдлийг тусад нь хийнэ.
          </Alert>
        )}

        {work.completionBlockers.length > 0 && !isClosed && (
          <Alert variant="info" title="Дуусгахад дараах нь шаардлагатай">
            <ul className="ml-4 list-disc space-y-0.5">
              {work.completionBlockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Alert>
        )}

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <PlannedWorkStatusBadge status={work.effectiveStatus} />
            {work.completedLate && <LateBadge delayMinutes={work.delayMinutes} />}
            {work.report && <ReportStatusBadge status={work.report.status} />}
            <div className="ml-auto">
              <TransitionActions work={work} onChanged={setWork} />
            </div>
          </div>

          <ProgressBar
            percent={work.progressPercent}
            completedQuantity={work.completedQuantity}
            totalQuantity={work.totalQuantity}
          />

          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-slate-200 pt-4 md:grid-cols-4">
            <SummaryRow label="Төсөл" value={work.project?.name ?? '-'} />
            <SummaryRow label="Төлөвлөсөн эхлэх" value={formatDate(work.plannedStartDate)} />
            <SummaryRow label="Төлөвлөсөн дуусах" value={formatDate(work.plannedEndDate)} />
            <SummaryRow label="Эх дуусах огноо" value={formatDate(work.originalPlannedEndDate)} />
            <SummaryRow label="Бодит эхэлсэн" value={formatDate(work.actualStartDate)} />
            <SummaryRow label="Бодит дууссан" value={formatDate(work.actualEndDate)} />
            <SummaryRow
              label="Түр зогссон хугацаа"
              value={formatMinutes(work.totalPausedMinutes)}
            />
            <SummaryRow label="Дэд ажлын тоо" value={String(work.taskCount)} />
          </dl>

          {work.description && (
            <p className="mt-4 whitespace-pre-wrap border-t border-slate-200 pt-4 text-sm text-slate-700">
              {work.description}
            </p>
          )}

          {work.cancelReason && (
            <Alert variant="warning" title="Цуцлалтын шалтгаан">
              {work.cancelReason}
            </Alert>
          )}
        </div>

        {/* Floor, then sub-task, then what the sub-task consumed. The floor rollup that
            used to be a separate read-only list is the section header itself, so a floor's
            progress and its sub-tasks are never read in two different places. */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Дэд ажил</h2>
            <div className="flex items-center gap-2">
              {/* ONE controller for the page. A picker per floor would make "which columns
                  does this table show" a question with a different answer per section. */}
              <ColumnPicker controller={taskColumnState} />
              {canUpdate && !isClosed && (
                <Button variant="secondary" size="sm" onClick={() => setTaskTarget('new')}>
                  Дэд ажил нэмэх
                </Button>
              )}
            </div>
          </div>

          {floorGroups.length === 0 ? (
            <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <DataTable
                columns={taskColumnState.visibleColumns}
                rows={[]}
                rowKey={(row: PlannedWorkTaskDto) => row.id}
                emptyTitle="Дэд ажил бүртгэгдээгүй"
                emptyDescription="Биелэлтийг хэмжихийн тулд дэд ажил нэмнэ үү."
              />
            </div>
          ) : (
            floorGroups.map((group) => (
              <FloorTaskSection
                key={group.key}
                group={group}
                columns={taskColumnState.visibleColumns}
                expanded={!collapsedFloors.includes(group.key)}
                onToggle={() => toggleFloor(group.key)}
                expandedTaskIds={expandedTaskIds}
                onToggleTask={toggleTask}
                renderTaskPanel={(task) => (
                  <div className="space-y-3">
                    <TaskEquipmentPanel task={task} />
                    <TaskMaterialUsagePanel
                      work={work}
                      task={task}
                      canRecord={canRecord}
                      isClosed={isClosed}
                      onSaved={setWork}
                    />
                  </div>
                )}
              />
            ))
          )}
        </div>

        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            {/* The plan AND the actuals, in one place. It used to be the plan alone, and the
                heading said so; now every row carries what was registered, what the
                sub-tasks have drawn against it and what the server says is left, so the
                heading names both halves rather than denying one of them. */}
            <h2 className="text-sm font-semibold text-slate-900">Материал ба зарцуулалт</h2>
            <div className="flex items-center gap-2">
              <ColumnPicker controller={materialColumnState} />
              {canUpdate && !isClosed && (
                <Button variant="secondary" size="sm" onClick={() => setMaterialsOpen(true)}>
                  Материал засах
                </Button>
              )}
            </div>
          </div>
          <DataTable
            columns={materialColumnState.visibleColumns}
            rows={work.materials}
            // The catalogue reference, not the name: a material appears at most once per
            // work, and the name is a frozen copy that two catalogue rows could share.
            rowKey={(row) => row.materialItemId}
            // NUMBERED BUT NOT PAGED: the materials travel inside the work's own detail
            // payload, so there is no endpoint to ask for a second page of.
            numbering
            ariaLabel="Материал ба зарцуулалт"
            emptyTitle="Материал бүртгэгдээгүй"
            emptyDescription="Ажилд бүртгэсэн материал, түүний зарцуулалт ба үлдэгдэл энд харагдана."
          />
        </div>

        {(work.pauseHistory.length > 0 || work.scheduleHistory.length > 0) && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {work.pauseHistory.length > 0 && (
              <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h2 className="mb-3 text-sm font-semibold text-slate-900">Түр зогсолтын түүх</h2>
                <ul className="space-y-2 text-sm">
                  {work.pauseHistory.map((entry, index) => (
                    <li key={`${entry.pausedAt}-${index}`} className="border-l-2 border-amber-300 pl-3">
                      <p className="text-slate-900">{entry.reason}</p>
                      <p className="text-xs text-slate-500">
                        {formatDateTime(entry.pausedAt)} - {formatDateTime(entry.resumedAt)}
                        {entry.durationMinutes !== null
                          ? ` (${formatMinutes(entry.durationMinutes)})`
                          : ' (үргэлжилж байна)'}
                      </p>
                      <p className="text-xs text-slate-500">{entry.pausedByName ?? '-'}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {work.scheduleHistory.length > 0 && (
              <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h2 className="mb-3 text-sm font-semibold text-slate-900">Хугацааны өөрчлөлт</h2>
                <ul className="space-y-2 text-sm">
                  {work.scheduleHistory.map((entry, index) => (
                    <li key={`${entry.changedAt}-${index}`} className="border-l-2 border-blue-300 pl-3">
                      <p className="text-slate-900">
                        {formatDate(entry.previousPlannedEndDate)} to{' '}
                        {formatDate(entry.newPlannedEndDate)}
                      </p>
                      <p className="text-xs text-slate-600">{entry.reason}</p>
                      <p className="text-xs text-slate-500">
                        {entry.changedByName ?? '-'} · {formatDateTime(entry.changedAt)}
                        {entry.clearedOverdue ? ' · хугацаа хэтэрсэн төлөв цуцлагдсан' : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <TaskFormDrawer
        work={work}
        target={taskTarget}
        onClose={() => setTaskTarget(null)}
        onSaved={(updated) => {
          setWork(updated);
          setTaskTarget(null);
        }}
      />

      <TaskProgressDrawer
        work={work}
        task={progressTarget}
        onClose={() => setProgressTarget(null)}
        onSaved={(updated) => {
          setWork(updated);
          // Keep the drawer open on the refreshed task so evidence edits stay visible.
          setProgressTarget(
            updated.tasks.find((task) => task.id === progressTarget?.id) ?? null,
          );
        }}
      />

      <TaskDetailDrawer task={detailTarget} onClose={() => setDetailTarget(null)} />

      <RescheduleDrawer
        work={work}
        open={rescheduleOpen}
        onClose={() => setRescheduleOpen(false)}
        onSaved={(updated) => {
          setWork(updated);
          setRescheduleOpen(false);
        }}
      />

      <PlannedMaterialsDrawer
        work={work}
        open={materialsOpen}
        onClose={() => setMaterialsOpen(false)}
        onSaved={(updated) => {
          setWork(updated);
          setMaterialsOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Дэд ажил устгах"
        message={`"${deleteTarget?.title ?? ''}" дэд ажлыг устгах уу? Хавсаргасан зураг хамт устна.`}
        confirmLabel="Устгах"
        danger
        onConfirm={() => handleDeleteTask()}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
