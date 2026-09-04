import {
  INSPECTION_REPORT_DEFAULT_ACT_NAME,
  INSPECTION_REPORT_STATUS_LABELS,
  PLANNED_WORK_TASK_STATUS_LABELS,
  SETTING_KEYS,
  canTransitionInspectionReport,
  isInspectionReportLocked,
  isRiskFinding,
  overallSafetyLabelOf,
  overallSafetyLevel,
  riskBandsOf,
  severityOrderOf,
  type InspectionReportAttachmentDto,
  type InspectionReportBlocker,
  type InspectionReportDto,
  type InspectionReportGroupDto,
  type InspectionReportIssueDto,
  type InspectionReportReadinessDto,
  type InspectionReportStatus,
  type InspectionReportTaskDto,
  type ReturnInspectionReportInput,
  type ReviewInspectionReportInput,
  type RiskBand,
  type RiskLevel,
  type UpdateInspectionReportInput,
} from '@monhorus/shared';
import { Types, type FilterQuery, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import { Employee } from '../employee/employee.model';
import { Customer, ObjectNode } from '../objects/object.models';
import { Team } from '../org/org.models';
import {
  PlannedWork,
  PlannedWorkTask,
  type IPlannedWork,
  type IPlannedWorkTask,
} from '../planned-work/planned-work.models';
import { resolveAssignedWorkFilter } from '../planned-work/planned-work.scope';
import { getSettings } from '../settings/settings.service';
import { StoredFile, type IStoredFile } from '../storage/stored-file.model';
import { InspectionReport, type IInspectionReport } from './inspection-report.model';

/**
 * Consolidated inspection report (requirements 7-11).
 *
 * The document stores only what a human authored plus where it sits in the review chain.
 * Everything a reader sees about the work itself - the heading, the sub-task sections,
 * the илэрсэн зөрчил list and the overall safety level - is derived here on every read, so
 * the report cannot go stale behind its own sub-tasks.
 */

type Doc<T> = HydratedDocument<T>;

const UNASSIGNED_FLOOR_LABEL = 'Давхар заагаагүй';
const UNKNOWN_FLOOR_LABEL = 'Тодорхойгүй давхар';

// -- Loading -----------------------------------------------------------------

/**
 * The one door into a planned work for this whole module, and it is scoped.
 *
 * IT USED TO BE A BARE `findById`, and that was the defect. `requirePlannedWorkAssignmentScope`
 * is mounted above this router in `planned-work.routes.ts` but returns `next()`
 * unconditionally for GET, HEAD and OPTIONS, on the stated premise that the loader beneath
 * a read has already applied the same predicate. Beneath the three reads here it had not:
 * `/inspection-report`, `/inspection-report/pdf` and `/inspection-report/readiness` are all
 * keyed on `planned_work.view`, which every technician holds, so any technician read any
 * job's consolidated report — the customer, the project, the building, the floors, the crew
 * by name, and the id of every attachment, which `GET /files/:fileId` then redeems.
 *
 * WHY THE PREDICATE LIVES HERE rather than in a controller helper. Every one of the ten
 * handlers loads its work through this function and nothing else in this module reaches
 * `PlannedWork` by id, so putting it here is what stops a route added to this router later
 * from being unscoped by omission. The actor is required rather than optional for the same
 * reason: there is no signature that silently skips the check. There are no non-HTTP
 * callers to accommodate — every caller is a request handler with an `AuthContext`.
 *
 * WHICH PREDICATE. `resolveAssignedWorkFilter`, the READ form, identical to what
 * `getPlannedWorkById`, both list services and `findReadableWorkOrThrow` (the sibling
 * `/report`, `/report/pdf` and `/report/photo-pdf` reads) apply. It returns null — meaning
 * "add nothing" — for a caller holding an oversight OR a read-oversight key, so dispatch,
 * management and finance keep full reach and only a caller bounded by assignment is bounded
 * here. Null is never `{}`; see that function for why the distinction is load bearing.
 *
 * THE WRITES ARE UNAFFECTED. They already pass `assertPlannedWorkAssignmentScope` in the
 * mounted guard, which runs first and is the stricter of the two: its unscoped set is a
 * subset of this one, and its assigned case is the same `$or` evaluated per record. A
 * caller who reaches a write handler at all therefore satisfies this filter too, and the
 * write refusal stays the 403 it was rather than becoming a 404.
 *
 * ANSWERED AS NOT-FOUND, matching `getPlannedWorkById` and the sibling report reads, with
 * the message this loader already raised for a genuinely absent work: replying "forbidden"
 * would confirm the id names a real job and turn the endpoint into an oracle for probing
 * identifiers.
 */
export async function findPlannedWorkOrThrow(
  plannedWorkId: string,
  actor: AuthContext,
): Promise<Doc<IPlannedWork>> {
  const assignmentFilter = await resolveAssignedWorkFilter<IPlannedWork>(actor);

  // `_id` is left as the raw string so mongoose casts it exactly as `findById` did: a
  // malformed id keeps producing the CastError the error handler already turns into a 400,
  // rather than throwing out of `new Types.ObjectId` before the filter is built.
  const filter: FilterQuery<IPlannedWork> = { _id: plannedWorkId };
  if (assignmentFilter) filter.$and = [assignmentFilter];

  const work = await PlannedWork.findOne(filter);
  if (!work) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Төлөвлөгөөт ажил олдсонгүй.');
  }
  return work;
}

async function loadReportOrThrow(work: Doc<IPlannedWork>): Promise<Doc<IInspectionReport>> {
  const report = await InspectionReport.findOne({ plannedWork: work._id });
  if (!report) {
    throw AppError.notFound(
      ERROR_CODES.NOT_FOUND,
      'Үзлэгийн нэгдсэн тайлан үүсээгүй байна.',
    );
  }
  return report;
}

async function tasksOf(work: Doc<IPlannedWork>): Promise<Doc<IPlannedWorkTask>[]> {
  return PlannedWorkTask.find({ plannedWork: work._id }).sort({ plannedStartDate: 1, title: 1 });
}

// -- Readiness (requirement 7) -----------------------------------------------

/**
 * Whether a report may be produced yet.
 *
 * The product owner's rule is exactly two conditions: at least one sub-task exists, and
 * every non-skipped sub-task is DONE. SCORES_MISSING is reported alongside them but does
 * NOT withhold generation: the only sub-tasks that can be DONE without a үнэлгээ are the
 * ones grandfathered when the score gate landed, and refusing them a report would strand
 * precisely the works that grandfathering exists to protect.
 */
export async function readinessOf(
  work: Doc<IPlannedWork>,
): Promise<InspectionReportReadinessDto> {
  const [tasks, report] = await Promise.all([
    tasksOf(work),
    InspectionReport.findOne({ plannedWork: work._id }).select('_id'),
  ]);

  const included = tasks.filter((task) => !task.skipped);
  const outstanding = included.filter((task) => task.status !== 'DONE');
  const unscored = included.filter((task) => task.status === 'DONE' && task.score === null);

  const blockers: InspectionReportBlocker[] = [];
  if (tasks.length === 0) blockers.push('NO_TASKS');
  else if (outstanding.length > 0) blockers.push('TASKS_INCOMPLETE');
  if (unscored.length > 0) blockers.push('SCORES_MISSING');

  return {
    canGenerate: tasks.length > 0 && outstanding.length === 0,
    blockers,
    outstandingTaskTitles: outstanding.map((task) => task.title),
    existingReportId: report ? String(report._id) : null,
  };
}

// -- Derived content ---------------------------------------------------------

interface ReportContext {
  tasks: Doc<IPlannedWorkTask>[];
  groups: InspectionReportGroupDto[];
  issues: InspectionReportIssueDto[];
  overallLevel: RiskLevel | null;
  /**
   * The ladder this report was read against.
   *
   * Carried rather than re-fetched because severity, what counts as a зөрчил and the
   * wording of the verdict all have to come from ONE ladder: resolving it again further
   * down would let a settings change land mid-report and print a document whose sections
   * disagree with each other.
   */
  bands: RiskBand[];
  customerName: string | null;
  projectName: string | null;
  buildingName: string | null;
  locationLabel: string | null;
  responsibleEmployeeNames: string[];
  responsibleTeamNames: string[];
  contractorName: string | null;
}

function employeeName(employee: { firstName: string; lastName: string }): string {
  return `${employee.lastName} ${employee.firstName}`.trim();
}

function attachmentsOf(
  task: Doc<IPlannedWorkTask>,
  files: ReadonlyMap<string, IStoredFile & { _id: Types.ObjectId }>,
): InspectionReportAttachmentDto[] {
  const rows: InspectionReportAttachmentDto[] = [];

  for (const [stage, ids] of [
    ['BEFORE', task.beforePhotos],
    ['AFTER', task.afterPhotos],
  ] as const) {
    for (const id of ids) {
      const file = files.get(String(id));
      if (!file) continue;
      rows.push({
        id: String(file._id),
        name: file.originalName,
        downloadUrl: `/api/v1/files/${String(file._id)}`,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        stage,
      });
    }
  }

  return rows;
}

/**
 * Loads everything the report is derived from.
 *
 * One pass over the sub-tasks produces the floor groups and the зөрчил list together, so
 * the two can never describe different data.
 */
async function loadContext(work: Doc<IPlannedWork>): Promise<ReportContext> {
  const tasks = await tasksOf(work);

  const floorIds = [...new Set(tasks.filter((task) => task.floor).map((task) => String(task.floor)))];
  const photoIds = tasks.flatMap((task) => [...task.beforePhotos, ...task.afterPhotos]);
  const employeeIds = [...work.assignedEmployees, ...tasks
    .filter((task) => task.assignedEmployee)
    .map((task) => task.assignedEmployee as Types.ObjectId)];

  const [floors, files, employees, team, customer, project, building, settings] = await Promise.all([
    floorIds.length
      ? ObjectNode.find({ _id: { $in: floorIds.map((id) => new Types.ObjectId(id)) } }).select('name')
      : [],
    photoIds.length
      ? StoredFile.find({ _id: { $in: photoIds } }).select(
          'originalName mimeType sizeBytes createdAt',
        )
      : [],
    employeeIds.length
      ? Employee.find({ _id: { $in: employeeIds } }).select('firstName lastName')
      : [],
    work.assignedTeam ? Team.findById(work.assignedTeam).select('name') : null,
    Customer.findById(work.customer).select('name'),
    ObjectNode.findById(work.project).select('name'),
    ObjectNode.findById(work.building).select('name attributes'),
    getSettings(),
  ]);

  // One ladder for the whole report. `getSettings()` is already awaited above, so the
  // administrator's bands cost nothing extra here.
  const bands = riskBandsOf(settings);

  const floorNames = new Map(floors.map((floor) => [String(floor._id), floor.name]));
  const fileMap = new Map(files.map((file) => [String(file._id), file]));
  const employeeNames = new Map(employees.map((employee) => [String(employee._id), employeeName(employee)]));

  // Group by floor. A sub-task with no floor lands in one shared bucket rather than
  // vanishing from the report.
  const buckets = new Map<string, InspectionReportTaskDto[]>();
  const issues: InspectionReportIssueDto[] = [];

  for (const task of tasks) {
    const floorKey = task.floor ? String(task.floor) : '';
    const resolvedFloorName = task.floor
      ? (floorNames.get(floorKey) ?? UNKNOWN_FLOOR_LABEL)
      : null;

    const row: InspectionReportTaskDto = {
      taskId: String(task._id),
      title: task.title,
      floorName: resolvedFloorName,
      status: task.status,
      statusLabel: PLANNED_WORK_TASK_STATUS_LABELS[task.status],
      skipped: task.skipped,
      score: task.score,
      riskLevel: task.riskLevel,
      note: task.note,
      recommendation: task.recommendation,
      totalQuantity: task.totalQuantity,
      completedQuantity: Math.min(task.completedQuantity, task.totalQuantity),
      unit: task.unit,
      attachments: attachmentsOf(task, fileMap),
      completedAt: task.completedAt?.toISOString() ?? null,
      assignedEmployeeName: task.assignedEmployee
        ? (employeeNames.get(String(task.assignedEmployee)) ?? null)
        : null,
    };

    const bucket = buckets.get(floorKey);
    if (bucket) bucket.push(row);
    else buckets.set(floorKey, [row]);

    // Requirement 8: a зөрчил is DERIVED from the band, never entered. The performer's
    // Тайлбар is the condition and their Зөвлөмж is the advice, so no third text field
    // is added to the sub-task.
    if (isRiskFinding(task.riskLevel, bands)) {
      issues.push({
        taskId: String(task._id),
        title: task.title,
        locationLabel: resolvedFloorName,
        riskLevel: task.riskLevel,
        score: task.score,
        condition: task.note,
        advice: task.recommendation,
      });
    }
  }

  const groups: InspectionReportGroupDto[] = [...buckets.entries()]
    .map(([floorId, rows]) => ({
      floorId: floorId === '' ? null : floorId,
      floorName:
        floorId === ''
          ? UNASSIGNED_FLOOR_LABEL
          : (floorNames.get(floorId) ?? UNKNOWN_FLOOR_LABEL),
      tasks: rows,
    }))
    .sort((left, right) => left.floorName.localeCompare(right.floorName, 'mn'));

  // Worst зөрчил first, ranked by the configured ladder rather than by the position of a
  // storage key — the reserved spares sort above `OUT_OF_SERVICE` in that list.
  const severityOrder = severityOrderOf(bands);
  issues.sort((left, right) => {
    const bySeverity =
      severityOrder.indexOf(left.riskLevel) - severityOrder.indexOf(right.riskLevel);
    return bySeverity !== 0 ? bySeverity : left.title.localeCompare(right.title, 'mn');
  });

  const contractor = String(settings[SETTING_KEYS.COMPANY_NAME] ?? '').trim();

  return {
    tasks,
    groups,
    issues,
    // Requirement 9: worst wins, never an average, null when nothing was scored.
    overallLevel: overallSafetyLevel(tasks.map((task) => task.riskLevel), bands),
    bands,
    customerName: customer?.name ?? null,
    projectName: project?.name ?? null,
    buildingName: building?.name ?? null,
    locationLabel: building?.attributes?.address ?? null,
    responsibleEmployeeNames: work.assignedEmployees
      .map((id) => employeeNames.get(String(id)))
      .filter((name): name is string => Boolean(name)),
    responsibleTeamNames: team ? [team.name] : [],
    // The operator's own company. Administrator data, read from Тохиргоо, never a literal.
    contractorName: contractor.length > 0 ? contractor : null,
  };
}

// -- Auto composition (requirement 9) ----------------------------------------

function findingLine(issue: InspectionReportIssueDto, bands: readonly RiskBand[]): string {
  const where = issue.locationLabel ? `${issue.locationLabel} - ` : '';
  const score = issue.score === null ? '' : ` (${issue.score} оноо)`;
  const condition = (issue.condition ?? '').trim();
  const tail = condition.length > 0 ? ` ${condition}` : '';
  return `- ${where}${issue.title}: ${overallSafetyLabelOf(issue.riskLevel, bands)}${score}.${tail}`;
}

function composeIssueSummary(
  issues: readonly InspectionReportIssueDto[],
  bands: readonly RiskBand[],
): string {
  if (issues.length === 0) return 'Үзлэгээр зөрчил илрээгүй.';
  return [
    `Нийт ${issues.length} зөрчил илэрлээ.`,
    ...issues.map((issue) => findingLine(issue, bands)),
  ].join('\n');
}

function composeConclusion(
  taskCount: number,
  overallLevel: RiskLevel | null,
  issues: readonly InspectionReportIssueDto[],
  bands: readonly RiskBand[],
): string {
  if (overallLevel === null) {
    return `Үзлэгт ${taskCount} дэд ажил хамрагдсан. Үнэлгээ бүртгэгдээгүй тул ерөнхий түвшин тодорхойлогдоогүй.`;
  }
  const found =
    issues.length === 0 ? 'Зөрчил илрээгүй.' : `Илэрсэн зөрчил: ${issues.length}.`;
  return `Үзлэгт ${taskCount} дэд ажил хамрагдсан. Ерөнхий түвшин: ${overallSafetyLabelOf(overallLevel, bands)}. ${found}`;
}

function composeRecommendation(issues: readonly InspectionReportIssueDto[]): string {
  const advices = [
    ...new Set(
      issues
        .map((issue) => (issue.advice ?? '').trim())
        .filter((advice) => advice.length > 0),
    ),
  ];

  if (advices.length > 0) {
    return ['Дараах арга хэмжээг авах шаардлагатай.', ...advices.map((advice) => `- ${advice}`)].join(
      '\n',
    );
  }
  return issues.length === 0
    ? 'Нэмэлт арга хэмжээ шаардлагагүй.'
    : 'Илэрсэн зөрчилд гүйцэтгэгчийн зөвлөмж бүртгэгдээгүй.';
}

/**
 * Lines seeded onto the panel replacement list.
 *
 * "The worst findings" is read as the findings that set the overall level, which is what
 * makes them the worst. The administrator edits the list down, and once they do,
 * generation never touches the text again.
 */
function seedReplacementLines(
  issues: readonly InspectionReportIssueDto[],
  overallLevel: RiskLevel | null,
  bands: readonly RiskBand[],
): string[] {
  if (!isRiskFinding(overallLevel, bands)) return [];
  return issues
    .filter((issue) => issue.riskLevel === overallLevel)
    .map((issue) => (issue.locationLabel ? `${issue.locationLabel} - ${issue.title}` : issue.title));
}

interface ComposedNarrative {
  issueSummary: string;
  conclusion: string;
  recommendation: string;
  replacementPanels: string[];
  replacementConnections: string[];
}

function composeNarrative(context: ReportContext): ComposedNarrative {
  return {
    issueSummary: composeIssueSummary(context.issues, context.bands),
    conclusion: composeConclusion(
      context.tasks.length,
      context.overallLevel,
      context.issues,
      context.bands,
    ),
    recommendation: composeRecommendation(context.issues),
    replacementPanels: seedReplacementLines(context.issues, context.overallLevel, context.bands),
    /**
     * Left empty deliberately. Nothing in the sub-task data distinguishes a самбар from a
     * холболт, so the panel findings relabelled as connection findings would put a claim
     * the system cannot support into a printed official act. The administrator fills this
     * in from what was actually inspected; an empty list renders as an empty field in both
     * the web editor and the mobile sheet.
     */
    replacementConnections: [],
  };
}

// -- Signature block (requirement 11) ----------------------------------------

/**
 * The position printed beside a signature.
 *
 * Read from the Employee record linked to the user, and null when the user has no
 * employee record or that record carries no position. Resolved at read time rather than
 * copied onto the report, so a corrected employee record corrects the report.
 */
async function positionsOf(
  userIds: readonly (Types.ObjectId | null)[],
): Promise<Map<string, string>> {
  const ids = userIds.filter((id): id is Types.ObjectId => id !== null);
  if (ids.length === 0) return new Map();

  const employees = await Employee.find({ systemUser: { $in: ids } })
    .select('systemUser position')
    .populate({ path: 'position', select: 'name' });

  const map = new Map<string, string>();
  for (const employee of employees) {
    const position = employee.position as unknown as { name?: string } | null;
    if (employee.systemUser && position && typeof position.name === 'string') {
      map.set(String(employee.systemUser), position.name);
    }
  }
  return map;
}

// -- Mapping -----------------------------------------------------------------

export async function toInspectionReportDto(
  report: Doc<IInspectionReport>,
  work: Doc<IPlannedWork>,
): Promise<InspectionReportDto> {
  const [context, positions] = await Promise.all([
    loadContext(work),
    positionsOf([report.createdBy, report.approvedBy]),
  ]);

  return {
    id: String(report._id),
    plannedWorkId: String(work._id),
    status: report.status,
    version: report.version,

    workNumber: work.workNumber,
    workTitle: work.title,
    customerName: context.customerName,
    projectName: context.projectName,
    buildingName: context.buildingName,
    locationLabel: context.locationLabel,
    inspectionStart: work.actualStartDate?.toISOString() ?? null,
    inspectionEnd: work.actualEndDate?.toISOString() ?? null,
    responsibleEmployeeNames: context.responsibleEmployeeNames,
    responsibleTeamNames: context.responsibleTeamNames,
    contractorName: context.contractorName,
    actName: INSPECTION_REPORT_DEFAULT_ACT_NAME,
    inspectedScope: report.inspectedScope,

    groups: context.groups,
    issues: context.issues,

    overallLevel: context.overallLevel,
    overallLabel: context.overallLevel
      ? overallSafetyLabelOf(context.overallLevel, context.bands)
      : null,
    issueSummary: report.issueSummary,
    conclusion: report.conclusion,
    recommendation: report.recommendation,
    replacementPanels: [...report.replacementPanels],
    replacementConnections: [...report.replacementConnections],
    isAutoDraft: report.isAutoDraft,

    createdByName: report.createdByName,
    createdByPosition: report.createdBy
      ? (positions.get(String(report.createdBy)) ?? null)
      : null,
    createdAt: report.createdAt.toISOString(),
    submittedByName: report.submittedByName,
    submittedAt: report.submittedAt?.toISOString() ?? null,
    approvedByName: report.approvedByName,
    approvedByPosition: report.approvedBy
      ? (positions.get(String(report.approvedBy)) ?? null)
      : null,
    approvedAt: report.approvedAt?.toISOString() ?? null,
    returnedByName: report.returnedByName,
    returnedAt: report.returnedAt?.toISOString() ?? null,
    returnReason: report.returnReason,
    finalisedByName: report.finalisedByName,
    finalisedAt: report.finalisedAt?.toISOString() ?? null,
    updatedAt: report.updatedAt.toISOString(),
  };
}

export async function getReport(work: Doc<IPlannedWork>): Promise<InspectionReportDto> {
  const report = await loadReportOrThrow(work);
  return toInspectionReportDto(report, work);
}

// -- Audit -------------------------------------------------------------------

/** The stored shape an audit row carries, so old and new values are comparable. */
function auditSnapshot(report: Doc<IInspectionReport>): Record<string, unknown> {
  return {
    status: report.status,
    version: report.version,
    isAutoDraft: report.isAutoDraft,
    inspectedScope: report.inspectedScope,
    issueSummary: report.issueSummary,
    conclusion: report.conclusion,
    recommendation: report.recommendation,
    replacementPanels: [...report.replacementPanels],
    replacementConnections: [...report.replacementConnections],
  };
}

type InspectionAuditAction =
  | 'INSPECTION_REPORT_GENERATED'
  | 'INSPECTION_REPORT_UPDATED'
  | 'INSPECTION_REPORT_SUBMITTED'
  | 'INSPECTION_REPORT_APPROVED'
  | 'INSPECTION_REPORT_RETURNED'
  | 'INSPECTION_REPORT_FINALISED'
  | 'INSPECTION_REPORT_REOPENED';

async function audit(
  action: InspectionAuditAction,
  report: Doc<IInspectionReport>,
  oldValue: Record<string, unknown> | null,
  actor: AuthContext,
  meta: RequestMeta,
  reason: string | null = null,
): Promise<void> {
  await recordAudit({
    entityType: 'InspectionReport',
    entityId: report._id,
    action,
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason,
    oldValue,
    newValue: auditSnapshot(report),
  });
}

// -- Generation (requirements 7 and 9) ---------------------------------------

function assertEditable(report: Doc<IInspectionReport>): void {
  if (isInspectionReportLocked(report.status)) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      `"${INSPECTION_REPORT_STATUS_LABELS[report.status]}" төлөвт байгаа тайланг засах боломжгүй.`,
    );
  }
}

/**
 * Produces the draft, or refreshes an existing one.
 *
 * Regeneration recomposes the narrative ONLY while `isAutoDraft` is true. Once an
 * administrator has written anything, their text is preserved verbatim: destroying a
 * reviewer's writing because someone pressed the generate button again is not an
 * acceptable outcome, so the derived sections refresh and the prose does not.
 */
export async function generateReport(
  work: Doc<IPlannedWork>,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<InspectionReportDto> {
  const readiness = await readinessOf(work);
  if (!readiness.canGenerate) {
    const issues =
      readiness.outstandingTaskTitles.length > 0
        ? readiness.outstandingTaskTitles.map((title) => ({
            field: 'tasks',
            message: `"${title}" дэд ажил дуусаагүй байна.`,
          }))
        : [{ field: 'tasks', message: 'Дэд ажил бүртгэгдээгүй байна.' }];

    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Дэд ажлууд дуусаагүй тул үзлэгийн тайлан үүсгэх боломжгүй.',
      issues,
    );
  }

  const context = await loadContext(work);
  const composed = composeNarrative(context);

  const existing = await InspectionReport.findOne({ plannedWork: work._id });

  if (existing) {
    assertEditable(existing);
    const before = auditSnapshot(existing);

    if (existing.isAutoDraft) {
      existing.issueSummary = composed.issueSummary;
      existing.conclusion = composed.conclusion;
      existing.recommendation = composed.recommendation;
      existing.replacementPanels = composed.replacementPanels;
      existing.replacementConnections = composed.replacementConnections;
    }
    await existing.save();

    await audit('INSPECTION_REPORT_GENERATED', existing, before, actor, meta, 'report regenerated');
    return toInspectionReportDto(existing, work);
  }

  const report = await InspectionReport.create({
    plannedWork: work._id,
    status: 'DRAFT',
    version: 1,
    inspectedScope: null,
    issueSummary: composed.issueSummary,
    conclusion: composed.conclusion,
    recommendation: composed.recommendation,
    replacementPanels: composed.replacementPanels,
    replacementConnections: composed.replacementConnections,
    isAutoDraft: true,
    createdBy: new Types.ObjectId(actor.userId),
    createdByName: actor.fullName,
  });

  await audit('INSPECTION_REPORT_GENERATED', report, null, actor, meta);
  return toInspectionReportDto(report, work);
}

// -- Administrator review (requirement 10) -----------------------------------

/**
 * Edits the narrative.
 *
 * Changing any field the generator composes takes the report out of auto-draft, which is
 * the switch that stops a later regeneration from overwriting the administrator's text.
 * `inspectedScope` is never composed by the system, so writing it alone leaves the flag
 * alone and still survives regeneration untouched.
 */
export async function updateReport(
  work: Doc<IPlannedWork>,
  input: UpdateInspectionReportInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<InspectionReportDto> {
  const report = await loadReportOrThrow(work);
  assertEditable(report);

  const before = auditSnapshot(report);
  let composedFieldChanged = false;

  if (input.inspectedScope !== undefined) report.inspectedScope = input.inspectedScope ?? null;

  if (input.issueSummary !== undefined) {
    const next = input.issueSummary ?? null;
    if (next !== report.issueSummary) composedFieldChanged = true;
    report.issueSummary = next;
  }
  if (input.conclusion !== undefined) {
    const next = input.conclusion ?? null;
    if (next !== report.conclusion) composedFieldChanged = true;
    report.conclusion = next;
  }
  if (input.recommendation !== undefined) {
    const next = input.recommendation ?? null;
    if (next !== report.recommendation) composedFieldChanged = true;
    report.recommendation = next;
  }
  if (input.replacementPanels !== undefined) {
    if (JSON.stringify(input.replacementPanels) !== JSON.stringify([...report.replacementPanels])) {
      composedFieldChanged = true;
    }
    report.replacementPanels = [...input.replacementPanels];
  }
  if (input.replacementConnections !== undefined) {
    if (
      JSON.stringify(input.replacementConnections) !==
      JSON.stringify([...report.replacementConnections])
    ) {
      composedFieldChanged = true;
    }
    report.replacementConnections = [...input.replacementConnections];
  }

  if (composedFieldChanged) report.isAutoDraft = false;
  await report.save();

  await audit('INSPECTION_REPORT_UPDATED', report, before, actor, meta);
  return toInspectionReportDto(report, work);
}

function assertTransition(report: Doc<IInspectionReport>, to: InspectionReportStatus): void {
  if (!canTransitionInspectionReport(report.status, to)) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      `"${INSPECTION_REPORT_STATUS_LABELS[report.status]}" төлөвөөс "${INSPECTION_REPORT_STATUS_LABELS[to]}" төлөвт шилжих боломжгүй.`,
      [{ field: 'status', message: 'Төлөвийн шилжилт зөвшөөрөгдөөгүй.' }],
    );
  }
}

export async function submitReport(
  work: Doc<IPlannedWork>,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<InspectionReportDto> {
  const report = await loadReportOrThrow(work);
  assertTransition(report, 'SUBMITTED');

  const before = auditSnapshot(report);
  report.status = 'SUBMITTED';
  report.submittedBy = new Types.ObjectId(actor.userId);
  report.submittedByName = actor.fullName;
  report.submittedAt = new Date();
  // A resubmission reads as pending review rather than still returned.
  report.returnReason = null;
  await report.save();

  await audit('INSPECTION_REPORT_SUBMITTED', report, before, actor, meta);
  return toInspectionReportDto(report, work);
}

export async function approveReport(
  work: Doc<IPlannedWork>,
  input: ReviewInspectionReportInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<InspectionReportDto> {
  const report = await loadReportOrThrow(work);
  assertTransition(report, 'APPROVED');

  const before = auditSnapshot(report);
  report.status = 'APPROVED';
  report.approvedBy = new Types.ObjectId(actor.userId);
  report.approvedByName = actor.fullName;
  report.approvedAt = new Date();
  await report.save();

  await audit('INSPECTION_REPORT_APPROVED', report, before, actor, meta, input.note ?? null);
  return toInspectionReportDto(report, work);
}

export async function returnReport(
  work: Doc<IPlannedWork>,
  input: ReturnInspectionReportInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<InspectionReportDto> {
  const report = await loadReportOrThrow(work);
  assertTransition(report, 'RETURNED');

  const before = auditSnapshot(report);
  report.status = 'RETURNED';
  report.returnedBy = new Types.ObjectId(actor.userId);
  report.returnedByName = actor.fullName;
  report.returnedAt = new Date();
  report.returnReason = input.reason;
  await report.save();

  await audit('INSPECTION_REPORT_RETURNED', report, before, actor, meta, input.reason);
  return toInspectionReportDto(report, work);
}

export async function finaliseReport(
  work: Doc<IPlannedWork>,
  input: ReviewInspectionReportInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<InspectionReportDto> {
  const report = await loadReportOrThrow(work);
  assertTransition(report, 'FINALISED');

  const before = auditSnapshot(report);
  report.status = 'FINALISED';
  report.finalisedBy = new Types.ObjectId(actor.userId);
  report.finalisedByName = actor.fullName;
  report.finalisedAt = new Date();
  await report.save();

  await audit('INSPECTION_REPORT_FINALISED', report, before, actor, meta, input.note ?? null);
  return toInspectionReportDto(report, work);
}

/**
 * Reopens a finalised report as a new version.
 *
 * FINALISED is terminal in the transition matrix on purpose, so this is not a transition:
 * the version counter advances and the report returns to DRAFT. No copy of the previous
 * version is stored - the audit row carries the old and the new values, which is where
 * the change history is read from.
 */
export async function reopenReport(
  work: Doc<IPlannedWork>,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<InspectionReportDto> {
  const report = await loadReportOrThrow(work);

  if (report.status !== 'FINALISED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Зөвхөн эцэслэгдсэн тайланг дахин нээнэ.',
      [{ field: 'status', message: 'Тайлан эцэслэгдээгүй байна.' }],
    );
  }

  const before = auditSnapshot(report);
  report.status = 'DRAFT';
  report.version += 1;
  // The review stamps belong to the version that just closed; the new version starts
  // unreviewed. What they held is preserved in the audit row above.
  report.submittedBy = null;
  report.submittedByName = null;
  report.submittedAt = null;
  report.approvedBy = null;
  report.approvedByName = null;
  report.approvedAt = null;
  report.returnedBy = null;
  report.returnedByName = null;
  report.returnedAt = null;
  report.returnReason = null;
  report.finalisedBy = null;
  report.finalisedByName = null;
  report.finalisedAt = null;
  await report.save();

  await audit('INSPECTION_REPORT_REOPENED', report, before, actor, meta, 'new version opened');
  return toInspectionReportDto(report, work);
}
