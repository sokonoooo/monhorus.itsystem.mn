import {
  INSPECTION_REPORT_BLOCKER_LABELS,
  INSPECTION_REPORT_VERSION_NOTE,
  PERMISSIONS,
  canTransitionInspectionReport,
  isInspectionReportLocked,
  type InspectionReportAttachmentDto,
  type InspectionReportDto,
  type InspectionReportIssueDto,
  type InspectionReportReadinessDto,
  type InspectionReportStatus,
  type InspectionReportTaskDto,
  type PermissionKey,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { plannedWorkService } from '../../services/planned-work.service';
import { authorisedFileUrl } from '../../lib/file-url';
import { inspectionReportService } from '../../services/inspection-report.service';
import {
  InspectionReportStatusBadge,
  OverallSafetyBadge,
  SafetyLevelPill,
} from './InspectionReportBadges';

const STAGE_LABELS: Record<InspectionReportAttachmentDto['stage'], string> = {
  BEFORE: 'Ажлын өмнөх',
  AFTER: 'Ажлын дараах',
};

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function joinNames(names: readonly string[]): string {
  return names.length > 0 ? names.join(', ') : '-';
}

/** One editable line per row, which is how the printed report writes both lists. */
function toLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function HeadingRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-sm text-slate-900">{value}</dd>
    </div>
  );
}

/**
 * One workflow move, described once and matched against the shared transition table.
 *
 * Which buttons exist is never hardcoded per status: the list below is filtered through
 * `canTransitionInspectionReport`, so the shared contract stays the only place that decides
 * what is legal and the screen cannot drift from the backend.
 */
interface WorkflowAction {
  /** DRAFT is excluded: nothing transitions back into it, reopening makes a new version. */
  target: Exclude<InspectionReportStatus, 'DRAFT'>;
  label: string;
  permission: PermissionKey;
  requiresReason: boolean;
  danger: boolean;
  message: string;
}

const WORKFLOW_ACTIONS: readonly WorkflowAction[] = [
  {
    target: 'SUBMITTED',
    label: 'Хянуулахаар илгээх',
    permission: PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
    requiresReason: false,
    danger: false,
    message: 'Тайланг админд хянуулахаар илгээнэ. Илгээсний дараа засах боломжгүй болно.',
  },
  {
    target: 'APPROVED',
    label: 'Батлах',
    permission: PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
    requiresReason: false,
    danger: false,
    message: 'Тайланг батална. Дараа нь эцэслэх буюу буцаах боломжтой.',
  },
  {
    target: 'RETURNED',
    label: 'Буцаах',
    permission: PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
    requiresReason: true,
    danger: true,
    message: 'Тайланг засуулахаар буцаана. Шалтгаан заавал бөглөнө.',
  },
  {
    target: 'FINALISED',
    label: 'Эцэслэх',
    permission: PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
    requiresReason: false,
    danger: false,
    message: 'Тайланг эцэслэнэ. Эцэслэсний дараа зөвхөн шинэ хувилбараар өөрчилнө.',
  },
];

/**
 * The consolidated inspection report (Үзлэгийн нэгдсэн тайлан), requirements 7 to 11.
 *
 * The screen mirrors the printed report the customer supplied: heading, overall safety
 * verdict, the sub-tasks grouped by floor with their documents, the зөрчил list, the
 * editable narrative and the signature block, in that order.
 *
 * Attachments are fetched with the caller's bearer token and turned into object URLs,
 * exactly as the sub-task drawer does, because the download route is authenticated and a
 * private file cannot be used as a bare `src`. One fetch per attachment backs the
 * thumbnail, the enlarged preview and the download link, and every URL is revoked on
 * unmount.
 */
export function InspectionReportPage(): ReactElement {
  const { plannedWorkId } = useParams<{ plannedWorkId: string }>();
  const { can } = useAuth();
  const { notify } = useToast();

  const canGenerateOrEdit = can(PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT);
  const canReview = can(PERMISSIONS.PLANNED_WORK_APPROVE_REPORT);

  const [report, setReport] = useState<InspectionReportDto | null>(null);
  const [readiness, setReadiness] = useState<InspectionReportReadinessDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  /**
   * Renders the PDF and hands it to the browser.
   *
   * Its own busy flag rather than `busy`: that one gates the write and workflow buttons,
   * and a download in flight is no reason the report cannot also be saved. A failure is
   * surfaced in the page's existing banner — a download that silently does nothing is
   * the worst outcome, because the button looks like it worked.
   */
  async function exportPdf(): Promise<void> {
    if (report === null) return;
    setExporting(true);
    setActionError(null);
    try {
      await plannedWorkService.downloadInspectionReportPdf(plannedWorkId!, report.workNumber);
    } catch (caught) {
      setActionError(
        caught instanceof ApiError ? caught.message : 'PDF үүсгэхэд алдаа гарлаа.',
      );
    } finally {
      setExporting(false);
    }
  }


  const [inspectedScope, setInspectedScope] = useState('');
  const [issueSummary, setIssueSummary] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [replacementPanels, setReplacementPanels] = useState('');
  const [replacementConnections, setReplacementConnections] = useState('');

  const [pendingAction, setPendingAction] = useState<WorkflowAction | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<InspectionReportAttachmentDto | null>(null);

  function seedNarrative(next: InspectionReportDto): void {
    setInspectedScope(next.inspectedScope ?? '');
    setIssueSummary(next.issueSummary ?? '');
    setConclusion(next.conclusion ?? '');
    setRecommendation(next.recommendation ?? '');
    setReplacementPanels(next.replacementPanels.join('\n'));
    setReplacementConnections(next.replacementConnections.join('\n'));
  }

  const load = useCallback(async (): Promise<void> => {
    if (!plannedWorkId) return;
    setLoading(true);
    setError(null);
    try {
      // Readiness is asked first because it also says whether a report exists, which spares
      // the screen a deliberate 404 on every planned work that has not been reported yet.
      const state = await inspectionReportService.readiness(plannedWorkId);
      setReadiness(state);

      if (state.existingReportId === null) {
        setReport(null);
      } else {
        const loaded = await inspectionReportService.get(plannedWorkId);
        setReport(loaded);
        seedNarrative(loaded);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Тайлан ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [plannedWorkId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!report) {
      setAttachmentUrls({});
      return undefined;
    }

    let cancelled = false;
    const created: string[] = [];
    const attachments = report.groups.flatMap((group) =>
      group.tasks.flatMap((task) => [...task.attachments]),
    );

    void Promise.all(
      attachments.map(async (attachment) => {
        try {
          const url = await authorisedFileUrl(attachment.downloadUrl);
          created.push(url);
          return [attachment.id, url] as const;
        } catch {
          // One unreadable attachment must not blank out the rest of the report.
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setAttachmentUrls(Object.fromEntries(entries.filter((entry) => entry !== null)));
    });

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [report]);

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

  async function runTransition(action: WorkflowAction, reason: string): Promise<void> {
    if (!plannedWorkId) return;

    const operation = (): Promise<InspectionReportDto> => {
      switch (action.target) {
        case 'SUBMITTED':
          return inspectionReportService.submit(plannedWorkId);
        case 'APPROVED':
          return inspectionReportService.approve(plannedWorkId);
        case 'RETURNED':
          return inspectionReportService.returnReport(plannedWorkId, { reason });
        case 'FINALISED':
          return inspectionReportService.finalise(plannedWorkId);
      }
    };

    const ok = await run(operation, `${action.label} үйлдэл гүйцэтгэгдлээ.`);
    if (ok) setPendingAction(null);
  }

  const issueColumns: ReadonlyArray<Column<InspectionReportIssueDto>> = [
    {
      key: 'title',
      header: 'Дэд ажил',
      render: (row) => <span className="font-medium text-slate-900">{row.title}</span>,
    },
    {
      key: 'location',
      header: 'Байршил',
      render: (row) => <span className="text-slate-700">{row.locationLabel ?? '-'}</span>,
    },
    {
      key: 'level',
      header: 'Түвшин',
      render: (row) => <SafetyLevelPill level={row.riskLevel} />,
    },
    {
      key: 'condition',
      header: 'Нөхцөл байдал',
      render: (row) => (
        <span className="whitespace-pre-wrap text-xs text-slate-700">{row.condition ?? '-'}</span>
      ),
    },
    {
      key: 'advice',
      header: 'Зөвлөмж',
      render: (row) => (
        <span className="whitespace-pre-wrap text-xs text-slate-700">{row.advice ?? '-'}</span>
      ),
    },
  ];

  const issueColumnState = useTableColumns('inspection-report-issues', issueColumns);

  const backTo = `/planned-work/${plannedWorkId ?? ''}`;
  const breadcrumbs = [
    { label: 'Нүүр', to: '/dashboard' },
    { label: 'Төлөвлөгөөт ажил', to: '/planned-work' },
    { label: 'Ажлын дэлгэрэнгүй', to: backTo },
    { label: 'Үзлэгийн нэгдсэн тайлан' },
  ];

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error) return <ErrorState description={error} />;

  // -- No report yet: show the readiness state and what is blocking it ---------

  if (!report) {
    const blockers = readiness?.blockers ?? [];
    const outstanding = readiness?.outstandingTaskTitles ?? [];
    const ready = readiness?.canGenerate === true;

    return (
      <>
        <PageHeader
          title="Үзлэгийн нэгдсэн тайлан"
          backTo={{ to: backTo, label: 'Ажил руу буцах' }}
          breadcrumbs={breadcrumbs}
        />

        <div className="space-y-4">
          {actionError && <Alert variant="error">{actionError}</Alert>}

          {!ready && blockers.length > 0 && (
            <Alert variant="warning" title="Тайлан үүсгэх боломжгүй">
              <ul className="ml-4 list-disc space-y-0.5">
                {blockers.map((blocker) => (
                  <li key={blocker}>{INSPECTION_REPORT_BLOCKER_LABELS[blocker]}</li>
                ))}
              </ul>
              {outstanding.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium">Дуусаагүй дэд ажил</p>
                  <ul className="ml-4 list-disc space-y-0.5">
                    {outstanding.map((title) => (
                      <li key={title}>{title}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Alert>
          )}

          <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <EmptyState
              title="Тайлан үүсээгүй байна"
              description="Бүх дэд ажил дуусч, үнэлгээ орсны дараа нэгдсэн тайланг үүсгэнэ."
              action={
                canGenerateOrEdit ? (
                  <Button
                    disabled={!ready || busy}
                    onClick={() =>
                      void run(
                        () => inspectionReportService.generate(plannedWorkId!),
                        'Тайлангийн ноорог үүслээ.',
                      )
                    }
                  >
                    Тайлан үүсгэх
                  </Button>
                ) : undefined
              }
            />
          </div>
        </div>
      </>
    );
  }

  // -- A report exists --------------------------------------------------------

  const editable = canGenerateOrEdit && !isInspectionReportLocked(report.status);
  const availableActions = WORKFLOW_ACTIONS.filter(
    (action) =>
      canTransitionInspectionReport(report.status, action.target) && can(action.permission),
  );

  function attachmentTile(attachment: InspectionReportAttachmentDto): ReactElement {
    const url = attachmentUrls[attachment.id] ?? null;
    const isImage = attachment.mimeType.startsWith('image/');

    return (
      <li
        key={attachment.id}
        className="overflow-hidden rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200"
      >
        {isImage ? (
          <button
            type="button"
            onClick={() => setPreview(attachment)}
            disabled={url === null}
            aria-label={`${attachment.name} томруулж харах`}
            className="block w-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600"
          >
            {url ? (
              <img src={url} alt={attachment.name} className="h-28 w-full object-cover" />
            ) : (
              <div className="h-28 w-full animate-pulse bg-slate-200" />
            )}
          </button>
        ) : (
          <div className="flex h-28 items-center justify-center bg-slate-100 px-2 text-center text-xs text-slate-500">
            {attachment.mimeType}
          </div>
        )}

        <div className="space-y-0.5 p-2">
          <p className="truncate text-xs font-medium text-slate-800" title={attachment.name}>
            {attachment.name}
          </p>
          <p className="text-[11px] text-slate-500">
            {STAGE_LABELS[attachment.stage]} · {formatSize(attachment.sizeBytes)}
          </p>
          {url ? (
            <a
              href={url}
              download={attachment.name}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              Татах
            </a>
          ) : (
            <span className="text-xs text-slate-400">Ачаалж байна</span>
          )}
        </div>
      </li>
    );
  }

  function taskCard(task: InspectionReportTaskDto): ReactElement {
    return (
      <li
        key={task.taskId}
        // A skipped sub-task is set apart from the rest. In a safety document an unchecked
        // item that looks like a checked one is the dangerous failure, so it carries its own
        // background and an explicit badge rather than relying on the status label alone.
        className={`rounded-lg p-3 ring-1 ring-inset ${
          task.skipped
            ? 'bg-amber-50 ring-amber-300'
            : 'bg-slate-50 ring-slate-200'
        }`}
      >
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold text-slate-900">{task.title}</p>
            <p className="text-xs text-slate-500">
              Байршил: {task.floorName ?? 'Давхар заагаагүй'}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {task.skipped && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-300">
                Хийгдээгүй
              </span>
            )}
            <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
              {task.statusLabel}
            </span>
            {task.riskLevel ? (
              <SafetyLevelPill level={task.riskLevel} />
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
                Үнэлгээгүй
              </span>
            )}
            <Link
              to={`/planned-work/${plannedWorkId ?? ''}?task=${task.taskId}`}
              aria-label={`${task.title} дэд ажил руу очих`}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              Дэд ажил руу очих
            </Link>
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <HeadingRow label="Үнэлгээ" value={task.score === null ? '-' : String(task.score)} />
          <HeadingRow label="Ажилтан" value={task.assignedEmployeeName ?? '-'} />
          <HeadingRow label="Тайлбар" value={task.note ?? '-'} />
          <HeadingRow label="Зөвлөмж" value={task.recommendation ?? '-'} />
        </dl>

        <div className="mt-2">
          <p className="mb-1 text-xs font-medium text-slate-600">Хавсралт</p>
          {task.attachments.length === 0 ? (
            <p className="rounded-lg bg-white p-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
              Хавсралт байхгүй.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {task.attachments.map(attachmentTile)}
            </ul>
          )}
        </div>
      </li>
    );
  }

  const previewUrl = preview ? (attachmentUrls[preview.id] ?? null) : null;

  return (
    <>
      <PageHeader
        title="Үзлэгийн нэгдсэн тайлан"
        description={`${report.workNumber} · ${report.workTitle}`}
        backTo={{ to: backTo, label: 'Ажил руу буцах' }}
        breadcrumbs={breadcrumbs}
        actions={
          <>
            {/*
              Always offered, and deliberately not gated on the workflow state: the PDF is
              a copy of what is already on screen, so anyone who may read the report may
              take it away. Gating it on FINALISED would stop an inspector printing the
              draft they are about to review.
            */}
            <Button
              variant="secondary"
              onClick={() => void exportPdf()}
              disabled={exporting}
            >
              {exporting ? 'PDF бэлдэж байна…' : 'PDF татах'}
            </Button>
            {editable && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      inspectionReportService.update(plannedWorkId!, {
                        inspectedScope: inspectedScope.trim() || null,
                        issueSummary: issueSummary.trim() || null,
                        conclusion: conclusion.trim() || null,
                        recommendation: recommendation.trim() || null,
                        replacementPanels: toLines(replacementPanels),
                        replacementConnections: toLines(replacementConnections),
                      }),
                    'Тайлан хадгалагдлаа.',
                  )
                }
              >
                Хадгалах
              </Button>
            )}

            {availableActions.map((action) => (
              <Button
                key={action.target}
                variant={action.danger ? 'secondary' : 'primary'}
                disabled={busy}
                onClick={() => setPendingAction(action)}
              >
                {action.label}
              </Button>
            ))}

            {report.status === 'FINALISED' && canReview && (
              <Button variant="secondary" disabled={busy} onClick={() => setReopenOpen(true)}>
                Шинэ хувилбар үүсгэх
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-4">
        {actionError && <Alert variant="error">{actionError}</Alert>}

        {report.status === 'RETURNED' && report.returnReason && (
          <Alert variant="error" title="Тайлан буцаагдсан">
            {report.returnReason}
            <p className="mt-1 text-xs">
              {report.returnedByName ?? '-'} · {formatDateTime(report.returnedAt)}
            </p>
          </Alert>
        )}

        {report.status === 'FINALISED' && (
          <Alert variant="info" title={`Эцэслэгдсэн тайлан. Хувилбар ${report.version}`}>
            {INSPECTION_REPORT_VERSION_NOTE}
          </Alert>
        )}

        {report.isAutoDraft && (
          <Alert variant="warning" title="Системийн боловсруулсан бичвэр">
            Доорх дүгнэлт, зөвлөмж, тайлбарыг систем автоматаар боловсруулсан бөгөөд хараахан
            хянагдаагүй байна. Батлахаас өмнө уншиж засна уу.
          </Alert>
        )}

        {/* a) Heading block ------------------------------------------------- */}
        <section
          aria-label="Тайлангийн толгой"
          className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <InspectionReportStatusBadge status={report.status} />
            <span className="text-xs text-slate-500">Хувилбар {report.version}</span>
          </div>

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <HeadingRow label="Төслийн нэр" value={report.projectName ?? '-'} />
            <HeadingRow
              label="Ерөнхий гүйцэтгэгчийн нэр"
              value={report.contractorName ?? '-'}
            />
            <HeadingRow label="Ил ба далд ажлын актны нэр" value={report.actName ?? '-'} />
            <HeadingRow label="Харилцагч" value={report.customerName ?? '-'} />
            <HeadingRow label="Барилга" value={report.buildingName ?? '-'} />
            <HeadingRow label="Байршил" value={report.locationLabel ?? '-'} />
            <HeadingRow
              label="Үзлэгийн хугацаа"
              value={`${formatDate(report.inspectionStart)} - ${formatDate(report.inspectionEnd)}`}
            />
            <HeadingRow
              label="Хариуцсан ажилтан"
              value={joinNames(report.responsibleEmployeeNames)}
            />
            <HeadingRow label="Баг" value={joinNames(report.responsibleTeamNames)} />
          </dl>
        </section>

        {/* b) Overall safety level ------------------------------------------ */}
        <section
          aria-label="Ерөнхий аюулгүй байдлын түвшин"
          className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
        >
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            Ерөнхий аюулгүй байдлын түвшин
          </h2>
          <OverallSafetyBadge level={report.overallLevel} label={report.overallLabel} />
          {report.overallLevel === null && (
            <p className="mt-2 text-xs text-slate-600">
              Нэг ч дэд ажилд үнэлгээ ороогүй тул ерөнхий түвшин тодорхойлогдоогүй байна.
            </p>
          )}
        </section>

        {/* c) Sub-task sections grouped by floor ---------------------------- */}
        <section
          aria-label="Дэд ажлын үзлэг"
          className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
        >
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Дэд ажлын үзлэг</h2>
          {report.groups.length === 0 ? (
            <p className="text-sm text-slate-600">Дэд ажил бүртгэгдээгүй.</p>
          ) : (
            <div className="space-y-5">
              {report.groups.map((group) => (
                <div key={group.floorId ?? group.floorName}>
                  <h3 className="mb-2 text-sm font-medium text-slate-700">{group.floorName}</h3>
                  <ul className="space-y-3">{group.tasks.map(taskCard)}</ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* d) Findings ------------------------------------------------------ */}
        <section
          aria-label="Илэрсэн зөрчил"
          className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Илэрсэн зөрчил</h2>
            <ColumnPicker controller={issueColumnState} />
          </div>
          <DataTable
            columns={issueColumnState.visibleColumns}
            rows={report.issues}
            rowKey={(row) => row.taskId}
            // NUMBERED BUT NOT PAGED: this is the preview of a report exported whole, and
            // the issues arrive inside its payload.
            numbering
            emptyTitle="Зөрчил илрээгүй"
            emptyDescription="Хэвийн түвшнээс доош үнэлэгдсэн дэд ажил байхгүй байна."
          />
        </section>

        {/* e) The editable narrative ---------------------------------------- */}
        <section
          aria-label="Тайлангийн бичвэр"
          className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
        >
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Тайлангийн бичвэр</h2>

          <div className="space-y-3">
            <NarrativeField
              id="inspected-scope"
              label="Үзлэгээр шалгасан"
              value={inspectedScope}
              onChange={setInspectedScope}
              disabled={!editable || busy}
              rows={3}
            />
            <NarrativeField
              id="issue-summary"
              label="Илэрсэн асуудлын тайлбар"
              value={issueSummary}
              onChange={setIssueSummary}
              disabled={!editable || busy}
              rows={5}
            />
            <NarrativeField
              id="conclusion"
              label="Дүгнэлт"
              value={conclusion}
              onChange={setConclusion}
              disabled={!editable || busy}
              rows={5}
            />
            <NarrativeField
              id="recommendation"
              label="Зөвлөмж"
              value={recommendation}
              onChange={setRecommendation}
              disabled={!editable || busy}
              rows={5}
            />
            <NarrativeField
              id="replacement-panels"
              label="Шинэчлэх шаардлагатай самбарууд"
              hint="Мөр тутамд нэг самбар бичнэ."
              value={replacementPanels}
              onChange={setReplacementPanels}
              disabled={!editable || busy}
              rows={4}
            />
            <NarrativeField
              id="replacement-connections"
              label="Шинэчлэх шаардлагатай холболт"
              hint="Мөр тутамд нэг холболт бичнэ."
              value={replacementConnections}
              onChange={setReplacementConnections}
              disabled={!editable || busy}
              rows={4}
            />
          </div>
        </section>

        {/* f) Signature block ----------------------------------------------- */}
        <section
          aria-label="Гарын үсэг"
          className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
        >
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Гарын үсэг</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-slate-500">Тайлан гүйцэтгэсэн</p>
              <p className="text-sm font-medium text-slate-900">{report.createdByName ?? '-'}</p>
              <p className="text-xs text-slate-600">{report.createdByPosition ?? '-'}</p>
              <p className="text-xs text-slate-500">{formatDateTime(report.createdAt)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Хянасан</p>
              <p className="text-sm font-medium text-slate-900">{report.approvedByName ?? '-'}</p>
              <p className="text-xs text-slate-600">{report.approvedByPosition ?? '-'}</p>
              <p className="text-xs text-slate-500">{formatDateTime(report.approvedAt)}</p>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.label ?? ''}
        message={pendingAction?.message ?? ''}
        confirmLabel={pendingAction?.label ?? 'Тийм'}
        danger={pendingAction?.danger ?? false}
        requireReason={pendingAction?.requiresReason ?? false}
        reasonLabel="Буцаах шалтгаан"
        onCancel={() => setPendingAction(null)}
        onConfirm={async (reason) => {
          if (pendingAction) await runTransition(pendingAction, reason);
        }}
      />

      <ConfirmDialog
        open={reopenOpen}
        title="Шинэ хувилбар үүсгэх"
        message={INSPECTION_REPORT_VERSION_NOTE}
        confirmLabel="Шинэ хувилбар үүсгэх"
        onCancel={() => setReopenOpen(false)}
        onConfirm={async () => {
          const ok = await run(
            () => inspectionReportService.reopen(plannedWorkId!),
            'Шинэ хувилбар үүслээ.',
          );
          if (ok) setReopenOpen(false);
        }}
      />

      <Modal open={preview !== null} title={preview?.name ?? ''} onClose={() => setPreview(null)}>
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={preview?.name ?? ''}
            className="mx-auto max-h-[60vh] w-auto max-w-full"
          />
        ) : (
          <div className="h-48 animate-pulse rounded bg-slate-200" />
        )}
      </Modal>
    </>
  );
}

function NarrativeField({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
  rows,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  rows: number;
}): ReactElement {
  return (
    <div>
      <label htmlFor={id} className={FILTER_LABEL}>
        {label}
      </label>
      {hint && <p className="mb-1 text-[11px] text-slate-500">{hint}</p>}
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={FIELD_TEXTAREA}
      />
    </div>
  );
}
