import {
  PERMISSIONS,
  REPORT_SUBMITTABLE_STATUSES,
  progressPercentOf,
  type ActorStampDto,
  type PlannedWorkMaterialDto,
  type PlannedWorkReportDto,
  type PlannedWorkReportPreviewDto,
  type PlannedWorkReportTaskLineDto,
  type ReturnPlannedWorkReportInput,
  type UpdatePlannedWorkReportInput,
} from '@monhorus/shared';
import { Types, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { withTransaction } from '../../common/utils/transaction.util';
import { logger } from '../../config/logger';
import { hasPermission } from '../../middlewares/authorize.middleware';
import { recordAudit } from '../audit/audit.service';
import { ObjectNode } from '../objects/object.models';
import { Customer } from '../objects/object.models';
import { Report } from '../report-record/report-record.model';
import { applyReportSafely } from '../report-record/report-record.service';
import { plannedWorkMaterialsOf } from './planned-work.materials.service';
import {
  PlannedWork,
  PlannedWorkReport,
  PlannedWorkTask,
  type IPlannedWork,
  type IPlannedWorkReport,
  type IPlannedWorkTask,
} from './planned-work.models';
import {
  allTasksComplete,
  completionBlockersOf,
  floorProgressOf,
  progressOfTasks,
  taskEvidenceOf,
  isIncludedTask,
} from './planned-work.progress.service';
import { assertPlannedWorkAssignmentScope } from './planned-work.scope';
import {
  archiveAfterReportApproval,
  writeCanonicalPlannedWorkReport,
} from './planned-work.transition.service';

/**
 * A loaded Mongoose document. `HydratedDocument` carries both the plain fields and the
 * document methods (`save`, `populate`), which a bare intersection with `_id` does not.
 */
type Doc<T> = HydratedDocument<T>;

/**
 * Consolidated report workflow.
 *
 * The report is a separate workflow from the planned-work lifecycle. A returned report
 * leaves the work COMPLETED: operational work never reopens because a reviewer wanted a
 * better write-up.
 *
 * DRAFT -> SUBMITTED -> APPROVED, or SUBMITTED -> RETURNED -> SUBMITTED.
 *
 * Internal approval is entirely separate from customer confirmation. Customer
 * confirmation is not required for internal approval in this implementation, and a
 * customer may only ever see a report that has been internally approved.
 */

function stamp(
  id: Types.ObjectId | null,
  name: string | null,
  at: Date | null,
): ActorStampDto {
  return { id: id ? String(id) : null, name, at: at ? at.toISOString() : null };
}

// -- Approval authority ------------------------------------------------------

/**
 * Emergency override.
 *
 * The existing RBAC architecture makes `head_admin` an unconditional superuser, so that
 * is the only identity permitted to approve a report it authored or submitted. Every
 * override is flagged on the record and written to the audit trail.
 */
function isOverrideCapable(actor: AuthContext): boolean {
  return actor.role === 'head_admin';
}

/**
 * Reasons the caller may not approve. Empty means approval is allowed right now.
 *
 * Approval authority is a permission, never a reporting line: an assigned employee does
 * not always have a manager who is valid for the work in question.
 */
export function approvalBlockersOf(
  report: Doc<IPlannedWorkReport>,
  actor: AuthContext,
): string[] {
  const blockers: string[] = [];

  if (report.status !== 'SUBMITTED') {
    blockers.push('Тайлан хянуулахаар илгээгдээгүй байна.');
  }

  if (!hasPermission(actor, PERMISSIONS.PLANNED_WORK_APPROVE_REPORT)) {
    blockers.push('Тайлан батлах эрх байхгүй байна.');
    // No point reporting the self-approval rule to someone who cannot approve at all.
    return blockers;
  }

  if (isOverrideCapable(actor)) return blockers;

  if (report.createdBy && String(report.createdBy) === actor.userId) {
    blockers.push('Тайланг зохиогч өөрөө батлах боломжгүй.');
  }
  if (report.submittedBy && String(report.submittedBy) === actor.userId) {
    blockers.push('Тайланг илгээсэн хүн өөрөө батлах боломжгүй.');
  }

  return blockers;
}

// -- Submission requirements -------------------------------------------------

/**
 * Reasons the report may not be submitted. Empty means submission is allowed.
 *
 * Requirements: every included task is fully complete with its evidence, notes and
 * recommendations, the consolidated conclusion and recommendation are present, and the
 * preview assembles.
 */
export function submissionBlockersOf(
  report: Doc<IPlannedWorkReport>,
  tasks: readonly IPlannedWorkTask[],
  previewGenerated: boolean,
): string[] {
  const blockers: string[] = [];

  if (!REPORT_SUBMITTABLE_STATUSES.includes(report.status)) {
    blockers.push('Тайлан илгээх төлөвт байхгүй.');
  }

  if (!allTasksComplete(tasks)) {
    blockers.push(...completionBlockersOf(tasks));
  }

  if ((report.conclusion ?? '').trim().length === 0) {
    blockers.push('Нэгдсэн дүгнэлт бөглөгдөөгүй.');
  }
  if ((report.recommendation ?? '').trim().length === 0) {
    blockers.push('Нэгдсэн зөвлөмж бөглөгдөөгүй.');
  }

  if (!previewGenerated) {
    blockers.push('Тайлангийн урьдчилсан хувилбар үүсгэж болсонгүй.');
  }

  return blockers;
}

// -- Mapping -----------------------------------------------------------------

export function toReportDto(
  report: Doc<IPlannedWorkReport>,
  actor: AuthContext,
  submissionBlockers: readonly string[],
): PlannedWorkReportDto {
  const approvalBlockers = approvalBlockersOf(report, actor);

  return {
    id: String(report._id),
    plannedWorkId: String(report.plannedWork),
    status: report.status,
    conclusion: report.conclusion,
    recommendation: report.recommendation,
    createdBy: stamp(report.createdBy, report.createdByName, report.createdAt),
    submittedBy: stamp(report.submittedBy, report.submittedByName, report.submittedAt),
    approvedBy: stamp(report.approvedBy, report.approvedByName, report.approvedAt),
    returnedBy: stamp(report.returnedBy, report.returnedByName, report.returnedAt),
    returnReason: report.returnReason,
    submissionBlockers: [...submissionBlockers],
    canApprove: approvalBlockers.length === 0,
    approvalBlockers,
    // A customer sees an approved report and nothing else.
    visibleToCustomer: report.status === 'APPROVED',
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

// -- Preview -----------------------------------------------------------------

function nodeName(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'name' in value) {
    return String((value as { name: string }).name);
  }
  return '';
}

/**
 * Assembles the report content.
 *
 * Returns null when the content cannot be produced, which is treated as a submission
 * blocker rather than an exception: a half-built report must not reach a reviewer.
 */
/**
 * The photographs attached to each of a work's sub-tasks, as file ids.
 *
 * Separate from `buildReportPreview` on purpose. That builds what the SCREEN needs, and
 * the screen shows photo counts rather than photographs — putting ids on
 * `PlannedWorkReportTaskLineDto` would widen a shared type for one consumer that is not
 * the screen. The PDF asks for this instead, and pays one query for it.
 *
 * Before and after are concatenated in that order: a reader looking at a pair wants to
 * see the state that prompted the work before the state that resulted from it.
 */
export async function taskPhotoIdsOf(
  work: Doc<IPlannedWork>,
): Promise<Array<{ taskId: string; fileIds: string[] }>> {
  const tasks = await PlannedWorkTask.find({ plannedWork: work._id })
    .select('_id beforePhotos afterPhotos')
    .sort({ plannedStartDate: 1, title: 1 })
    .lean();

  return tasks.map((task) => ({
    taskId: String(task._id),
    fileIds: [...task.beforePhotos, ...task.afterPhotos].map(String),
  }));
}

export async function buildReportPreview(
  work: Doc<IPlannedWork>,
  report: Doc<IPlannedWorkReport> | null,
): Promise<PlannedWorkReportPreviewDto | null> {
  const [tasks, materials, project, building, customer] = await Promise.all([
    PlannedWorkTask.find({ plannedWork: work._id }).sort({ plannedStartDate: 1, title: 1 }),
    plannedWorkMaterialsOf(work),
    work.project ? ObjectNode.findById(work.project).select('name') : null,
    ObjectNode.findById(work.building).select('name'),
    Customer.findById(work.customer).select('name'),
  ]);

  // A report that references a deleted building or customer cannot be rendered. The
  // project is optional on the work, so only a DANGLING reference to one is fatal —
  // its plain absence must not block submission.
  if (!building || !customer) return null;
  if (work.project && !project) return null;

  const floorIds = [...new Set(tasks.filter((task) => task.floor).map((task) => String(task.floor)))];
  const floors = floorIds.length
    ? await ObjectNode.find({ _id: { $in: floorIds.map((id) => new Types.ObjectId(id)) } }).select(
        'name',
      )
    : [];
  const floorNames = new Map(floors.map((floor) => [String(floor._id), floor.name]));

  const summary = progressOfTasks(tasks);

  const lines: PlannedWorkReportTaskLineDto[] = tasks.map((task) => ({
    id: String(task._id),
    title: task.title,
    floorName: task.floor
      ? (floorNames.get(String(task.floor)) ?? 'Тодорхойгүй давхар')
      : 'Давхар заагаагүй',
    unit: task.unit,
    totalQuantity: task.totalQuantity,
    completedQuantity: task.completedQuantity,
    progressPercent: progressPercentOf(task.totalQuantity, task.completedQuantity),
    status: task.status,
    note: task.note,
    score: task.score,
    riskLevel: task.riskLevel,
    recommendation: task.recommendation,
    beforePhotoCount: task.beforePhotos.length,
    afterPhotoCount: task.afterPhotos.length,
  }));

  return {
    plannedWorkId: String(work._id),
    workNumber: work.workNumber,
    title: work.title,
    customerName: nodeName(customer),
    projectName: project ? nodeName(project) : null,
    buildingName: nodeName(building),
    status: report?.status ?? 'DRAFT',
    plannedStartDate: work.plannedStartDate.toISOString(),
    plannedEndDate: work.plannedEndDate.toISOString(),
    originalPlannedEndDate: work.originalPlannedEndDate.toISOString(),
    actualStartDate: work.actualStartDate?.toISOString() ?? null,
    actualEndDate: work.actualEndDate?.toISOString() ?? null,
    completedLate: work.completedLate,
    delayMinutes: work.delayMinutes,
    totalPausedMinutes: work.totalPausedMinutes,
    totalQuantity: summary.totalQuantity,
    completedQuantity: summary.completedQuantity,
    remainingQuantity: summary.remainingQuantity,
    progressPercent: summary.progressPercent,
    floorProgress: floorProgressOf(tasks, floorNames),
    tasks: lines,
    materials,
    conclusion: report?.conclusion ?? null,
    recommendation: report?.recommendation ?? null,
    generatedAt: new Date().toISOString(),
  };
}

/** Loads the report plus everything needed to describe its current gates. */
export async function loadReportState(
  work: Doc<IPlannedWork>,
): Promise<{
  report: Doc<IPlannedWorkReport> | null;
  blockers: string[];
  preview: PlannedWorkReportPreviewDto | null;
}> {
  const report = await PlannedWorkReport.findOne({ plannedWork: work._id });
  if (!report) return { report: null, blockers: [], preview: null };

  const [tasks, preview] = await Promise.all([
    PlannedWorkTask.find({ plannedWork: work._id }),
    buildReportPreview(work, report),
  ]);

  return {
    report,
    blockers: submissionBlockersOf(report, tasks, preview !== null),
    preview,
  };
}

// -- Workflow operations -----------------------------------------------------

async function loadReportForWork(work: Doc<IPlannedWork>): Promise<Doc<IPlannedWorkReport>> {
  const report = await PlannedWorkReport.findOne({ plannedWork: work._id });
  if (!report) {
    throw AppError.notFound(
      ERROR_CODES.NOT_FOUND,
      'Тайлан үүсээгүй байна. Ажлыг дуусгасны дараа тайлан үүснэ.',
    );
  }
  return report;
}

/**
 * Loads the report, opening it in DRAFT on the first write.
 *
 * The COMPLETE transition seeds the same row, but waiting for completion meant there was
 * no report to write into for the whole of DRAFT, PLANNED, STARTED, PAUSED and OVERDUE —
 * that is, for the entire time anybody is actually on site — and a PATCH answered 404. The
 * write-up is produced while the job is being done, so the row is opened by whichever of
 * the two paths arrives first and the other becomes a no-op.
 *
 * An UPSERT rather than a read-then-create because `plannedWork` is uniquely indexed: two
 * first PATCHes racing each other would otherwise fail one of them on a duplicate key.
 */
async function openReportForWork(
  work: Doc<IPlannedWork>,
  actor: AuthContext,
): Promise<{ report: Doc<IPlannedWorkReport>; opened: boolean }> {
  const existing = await PlannedWorkReport.findOne({ plannedWork: work._id });
  if (existing) return { report: existing, opened: false };

  // Terminal records are read-only everywhere else in this module's siblings
  // (`assertMutable` in planned-work.service.ts), and opening a fresh write-up on a
  // cancelled job has no reader. An archived work always already has its approved report,
  // so this branch is only reachable for CANCELLED in practice.
  if (work.status === 'ARCHIVED' || work.status === 'CANCELLED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      work.status === 'ARCHIVED'
        ? 'Архивласан ажлын тайлан үүсгэх боломжгүй.'
        : 'Цуцлагдсан ажилд тайлан үүсгэх боломжгүй.',
    );
  }

  const report = await PlannedWorkReport.findOneAndUpdate(
    { plannedWork: work._id },
    {
      // Exactly the fields the COMPLETE-transition path sets, so the two converge on one
      // shape and nothing downstream can tell which opened the row.
      $setOnInsert: {
        plannedWork: work._id,
        status: 'DRAFT',
        conclusion: null,
        recommendation: null,
        createdBy: new Types.ObjectId(actor.userId),
        createdByName: actor.fullName,
      },
    },
    { new: true, upsert: true },
  );

  if (!report) {
    // Unreachable with `upsert: true` and `new: true`; the typing is nullable because the
    // non-upsert form of this call can miss.
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Тайлан үүсгэж чадсангүй.');
  }

  return { report, opened: true };
}

/** Editing is only possible while the report is a draft or has been returned. */
export async function updateReport(
  work: Doc<IPlannedWork>,
  input: UpdatePlannedWorkReportInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<Doc<IPlannedWorkReport>> {
  // Authoring the write-up is part of doing the job, so it is confined to the job's crew.
  // Approval and return are deliberately NOT scoped here: they are keyed on
  // `planned_work.approve_report`, which is an oversight permission the crew never holds,
  // and that separation is the whole of the section 9.2 submit/approve split.
  await assertPlannedWorkAssignmentScope(work._id, actor);

  // Opened only AFTER the scope check, so a caller who may not act on this job cannot
  // create a row on it by probing the endpoint.
  const { report, opened } = await openReportForWork(work, actor);

  if (opened) {
    await recordAudit({
      entityType: 'PlannedWorkReport',
      entityId: report._id,
      action: 'REPORT_CREATED',
      actor: { id: actor.userId, role: actor.role, label: actor.fullName },
      meta,
      reason: 'report authored during the work',
      newValue: { status: 'DRAFT' },
    });
  }

  if (!REPORT_SUBMITTABLE_STATUSES.includes(report.status)) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Хянуулахаар илгээсэн эсвэл батлагдсан тайланг засах боломжгүй.',
    );
  }

  const before = { conclusion: report.conclusion, recommendation: report.recommendation };

  if (input.conclusion !== undefined) report.conclusion = input.conclusion ?? null;
  if (input.recommendation !== undefined) report.recommendation = input.recommendation ?? null;
  await report.save();

  await recordAudit({
    entityType: 'PlannedWorkReport',
    entityId: report._id,
    action: 'REPORT_UPDATED',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: before,
    newValue: { conclusion: report.conclusion, recommendation: report.recommendation },
  });

  return report;
}

export async function submitReport(
  work: Doc<IPlannedWork>,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<Doc<IPlannedWorkReport>> {
  await assertPlannedWorkAssignmentScope(work._id, actor);

  const report = await loadReportForWork(work);

  const [tasks, preview] = await Promise.all([
    PlannedWorkTask.find({ plannedWork: work._id }),
    buildReportPreview(work, report),
  ]);

  const blockers = submissionBlockersOf(report, tasks, preview !== null);
  if (blockers.length > 0) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Тайлан илгээх шаардлага хангаагүй байна.',
      blockers.map((message) => ({ field: 'report', message })),
    );
  }

  const now = new Date();
  report.status = 'SUBMITTED';
  report.submittedBy = new Types.ObjectId(actor.userId);
  report.submittedByName = actor.fullName;
  report.submittedAt = now;
  // A resubmission clears the previous return so the record reads as pending review.
  report.returnReason = null;
  await report.save();

  await recordAudit({
    entityType: 'PlannedWorkReport',
    entityId: report._id,
    action: 'REPORT_SUBMITTED',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: { status: 'DRAFT' },
    newValue: { status: 'SUBMITTED', submittedAt: now.toISOString() },
  });

  return report;
}

export async function returnReport(
  work: Doc<IPlannedWork>,
  input: ReturnPlannedWorkReportInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<Doc<IPlannedWorkReport>> {
  const report = await loadReportForWork(work);

  if (report.status !== 'SUBMITTED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Зөвхөн хянуулахаар илгээсэн тайланг буцаана.',
    );
  }

  const now = new Date();
  report.status = 'RETURNED';
  report.returnedBy = new Types.ObjectId(actor.userId);
  report.returnedByName = actor.fullName;
  report.returnedAt = now;
  report.returnReason = input.reason;
  await report.save();

  // The planned work stays COMPLETED: a returned report never reopens the work.
  await recordAudit({
    entityType: 'PlannedWorkReport',
    entityId: report._id,
    action: 'REPORT_RETURNED',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: input.reason,
    oldValue: { status: 'SUBMITTED' },
    newValue: { status: 'RETURNED', returnedAt: now.toISOString() },
  });

  return report;
}

/**
 * Approves the report and archives the work.
 *
 * Both writes plus the audit rows happen inside one transaction: the work must never be
 * archived without an approved report, and an approved report must never leave the work
 * unarchived.
 */
/**
 * Settles the work's canonical report and lets its findings reach the equipment.
 *
 * Approval is the trigger rather than sub-task completion: a score is a claim until a
 * reviewer signs it off, and letting an unreviewed figure move a building's standing would
 * make the hierarchy disagree with the report that produced it. The canonical row was
 * opened in DRAFT when the work completed; rewriting it here (rather than flipping the
 * status) also carries the final Дүгнэлт/Зөвлөмж into the store and covers a work
 * approved before its draft ever landed — the source-keyed upsert makes both the same
 * write.
 *
 * Guarded, and deliberately after the approval transaction commits: the approval is the
 * record, the central report, equipment standing and rollups are derived from it.
 * Throwing here would report a failed approval that in fact succeeded.
 */
async function publishApprovedReport(
  work: Doc<IPlannedWork>,
  actor: AuthContext,
  approvedAt: Date,
): Promise<void> {
  try {
    const canonicalId = await writeCanonicalPlannedWorkReport(work, 'APPROVED', actor);
    await Report.updateOne(
      { _id: canonicalId },
      {
        $set: {
          approvedBy: new Types.ObjectId(actor.userId),
          approvedByName: actor.fullName,
          approvedAt,
        },
      },
    );
    await applyReportSafely(canonicalId);
  } catch (error) {
    logger.error(
      { err: error, plannedWork: String(work._id) },
      'approved planned work could not be published to its equipment',
    );
  }
}

export async function approveReport(
  work: Doc<IPlannedWork>,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<Doc<IPlannedWorkReport>> {
  const report = await loadReportForWork(work);

  const blockers = approvalBlockersOf(report, actor);
  if (blockers.length > 0) {
    throw AppError.forbidden(
      ERROR_CODES.FORBIDDEN,
      blockers[0] ?? 'Тайлан батлах боломжгүй.',
    );
  }

  const wasOverride =
    isOverrideCapable(actor) &&
    ((report.createdBy !== null && String(report.createdBy) === actor.userId) ||
      (report.submittedBy !== null && String(report.submittedBy) === actor.userId));

  const now = new Date();

  await withTransaction(async (session) => {
    await PlannedWorkReport.updateOne(
      { _id: report._id, status: 'SUBMITTED' },
      {
        $set: {
          status: 'APPROVED',
          approvedBy: new Types.ObjectId(actor.userId),
          approvedByName: actor.fullName,
          approvedAt: now,
          approvalWasOverride: wasOverride,
        },
      },
      session ? { session } : {},
    );

    await archiveAfterReportApproval(work, actor, meta, session);
  });

  report.status = 'APPROVED';
  report.approvedBy = new Types.ObjectId(actor.userId);
  report.approvedByName = actor.fullName;
  report.approvedAt = now;
  report.approvalWasOverride = wasOverride;

  await publishApprovedReport(work, actor, now);

  await recordAudit({
    entityType: 'PlannedWorkReport',
    entityId: report._id,
    action: 'REPORT_APPROVED',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: wasOverride ? 'head_admin emergency override' : null,
    oldValue: { status: 'SUBMITTED' },
    newValue: {
      status: 'APPROVED',
      approvedAt: now.toISOString(),
      approvalWasOverride: wasOverride,
    },
  });

  return report;
}

/** Exposed for the customer-facing read: only an approved report is visible. */
export function assertReportVisibleToCustomer(report: Doc<IPlannedWorkReport>): void {
  if (report.status !== 'APPROVED') {
    throw AppError.forbidden(
      ERROR_CODES.FORBIDDEN,
      'Батлагдаагүй тайланг харилцагчид харуулахгүй.',
    );
  }
}

/** Re-exported so the main service does not need its own evidence import. */
export { taskEvidenceOf, isIncludedTask };

/** Ensures a work is archivable only through this module. */
export async function reportStatusOf(
  plannedWorkId: Types.ObjectId,
): Promise<IPlannedWorkReport['status'] | null> {
  const report = await PlannedWorkReport.findOne({ plannedWork: plannedWorkId }).select('status');
  return report?.status ?? null;
}

/** Convenience used by the list mapper to avoid an N+1 per row. */
export async function reportStatusesFor(
  plannedWorkIds: readonly Types.ObjectId[],
): Promise<Map<string, IPlannedWorkReport['status']>> {
  if (plannedWorkIds.length === 0) return new Map();
  const reports = await PlannedWorkReport.find({ plannedWork: { $in: plannedWorkIds } }).select(
    'plannedWork status',
  );
  return new Map(reports.map((report) => [String(report.plannedWork), report.status]));
}

/** Kept for symmetry with the work loader used by the routes. */
export async function findWorkOrThrow(plannedWorkId: string): Promise<Doc<IPlannedWork>> {
  const work = await PlannedWork.findById(plannedWorkId);
  if (!work) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Төлөвлөгөөт ажил олдсонгүй.');
  }
  return work;
}
