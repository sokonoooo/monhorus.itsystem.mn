import {
  riskLevelFor,
  workReportCompleteness,
  type ReturnWorkReportInput,
  type SaveWorkReportInput,
  type WorkReportDto,
  type WorkReportMaterialDto,
  type WorkReportObjectDto,
  type WorkReportPhotoDto,
} from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  customerScopeFilter,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { logger } from '../../config/logger';
import { recordAudit } from '../audit/audit.service';
import { notify } from '../notification/notification.service';
import { ObjectRecord } from '../object-master/object-master.models';
import { resolveAssignedWorkFilter } from '../planned-work/planned-work.scope';
import { Report } from '../report-record/report-record.model';
import { applyReportSafely, writeReport } from '../report-record/report-record.service';
import { getRiskBands } from '../settings/settings.service';
import { assertReportApprovalAllowed } from './self-progress.policy';
import { ServiceRequest, type IServiceRequest } from './service-request.model';
import { WorkReport, type IWorkReport } from './work-report.model';

type WithId<T> = T & { _id: Types.ObjectId };

const ENTITY = 'Conclusion';
const PHOTO_SELECT = 'originalName mimeType sizeBytes uploadedByName createdAt';

function toPhotoDto(value: unknown): WorkReportPhotoDto | null {
  if (typeof value !== 'object' || value === null || !('originalName' in value)) return null;
  const photo = value as {
    _id: Types.ObjectId;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedByName: string | null;
    createdAt: Date;
  };
  return {
    id: String(photo._id),
    name: photo.originalName,
    downloadUrl: `/files/${String(photo._id)}`,
    mimeType: photo.mimeType,
    sizeBytes: photo.sizeBytes,
    uploadedByName: photo.uploadedByName,
    uploadedAt: photo.createdAt.toISOString(),
  };
}

/**
 * Tolerates an unpopulated reference the same way the report store does: an id-only ref
 * maps to its id with null labels, so a caller that did not populate still gets a usable
 * row rather than a crash.
 */
function toLinkedObject(value: unknown): WorkReportObjectDto {
  if (typeof value === 'object' && value !== null && 'code' in value) {
    const object = value as { _id: Types.ObjectId; code: string; name: string };
    return { id: String(object._id), code: object.code, name: object.name };
  }
  return { id: String(value), code: null, name: null };
}

/**
 * An array field of a conclusion, as it may actually come back from the database.
 *
 * `.lean()` returns the raw stored document: it skips hydration, and hydration is what
 * applies a schema `default`. A conclusion written before a list field existed on the
 * schema therefore arrives with that key ABSENT rather than as `[]`, and `undefined.map`
 * threw a TypeError the error handler could only report as a generic 500 — the whole
 * "Дүгнэлт бичих" screen failed on every conclusion older than the field. `objectAssessments`
 * is the field that actually broke, but `materials` and `objects` were added the same way
 * and are absent on the same documents, so every list is read through here.
 *
 * Backfilling instead would fix today's rows and leave the next added field to break the
 * same screen again; the read is the thing that has to tolerate its own history.
 */
function listOf<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function toDto(report: WithId<IWorkReport>): WorkReportDto {
  const beforePhotos = listOf(report.beforePhotos)
    .map(toPhotoDto)
    .filter((p): p is WorkReportPhotoDto => p !== null);
  const afterPhotos = listOf(report.afterPhotos)
    .map(toPhotoDto)
    .filter((p): p is WorkReportPhotoDto => p !== null);

  const completeness = workReportCompleteness({
    score: report.score,
    conclusion: report.conclusion,
    recommendation: report.recommendation,
    beforePhotoCount: beforePhotos.length,
    afterPhotoCount: afterPhotos.length,
  });

  return {
    id: String(report._id),
    serviceRequestId: String(report.serviceRequest),
    status: report.status,
    score: report.score,
    riskLevel: report.riskLevel,
    conclusion: report.conclusion,
    recommendation: report.recommendation,
    actionTaken: report.actionTaken,
    repairRequired: report.repairRequired,
    revisitRequired: report.revisitRequired,
    revisitDate: report.revisitDate?.toISOString() ?? null,
    beforePhotos,
    afterPhotos,
    materials: listOf(report.materials).map(
      (entry): WorkReportMaterialDto => ({
        name: entry.name,
        quantity: entry.quantity,
        unit: entry.unit,
      }),
    ),
    objects: listOf(report.objects).map(toLinkedObject),
    objectAssessments: listOf(report.objectAssessments).map((entry) => {
      const named = toLinkedObject(entry.object);
      return {
        objectId: named.id,
        code: named.code,
        name: named.name,
        score: entry.score,
        observation: entry.observation,
        conclusion: entry.conclusion,
        recommendation: entry.recommendation,
        photoIds: listOf(entry.photos).map(String),
      };
    }),
    missing: completeness.missing,
    isComplete: completeness.isComplete,
    createdByName: report.createdByName,
    submittedByName: report.submittedByName,
    submittedAt: report.submittedAt?.toISOString() ?? null,
    approvedByName: report.approvedByName,
    approvedAt: report.approvedAt?.toISOString() ?? null,
    returnedByName: report.returnedByName,
    returnedAt: report.returnedAt?.toISOString() ?? null,
    returnReason: report.returnReason,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

const POPULATE = [
  { path: 'beforePhotos', select: PHOTO_SELECT },
  { path: 'afterPhotos', select: PHOTO_SELECT },
  { path: 'objects', select: 'code name' },
];

function actorOf(actor: AuthContext): {
  id: string;
  role: AuthContext['role'];
  label: string | null;
} {
  return { id: actor.userId, role: actor.role, label: actor.fullName ?? null };
}

async function loadPopulated(reportId: Types.ObjectId): Promise<WorkReportDto> {
  const report = await WorkReport.findById(reportId)
    .populate(POPULATE)
    .lean<WithId<IWorkReport> | null>();
  if (!report) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Дүгнэлт олдсонгүй.');
  return toDto(report);
}

/**
 * Resolves the request a conclusion hangs off, within the caller's tenant AND their
 * assignment scope.
 *
 * The conclusion has no customer of its own, so its boundary is the request's. The
 * predicate lives in the query and a foreign request is reported as missing, for the same
 * reason as everywhere else: a "forbidden" answer would confirm the id exists.
 *
 * THE ASSIGNMENT HALF IS THE SAME PREDICATE `getServiceRequestById` APPLIES, and it is here
 * because the two had drifted apart. Once the request detail read became assignment-scoped,
 * a technician was answered 404 for a colleague's request and 200 for that same request's
 * conclusion — the sub-route was still bounded by tenancy alone. `GET /:id/report` is
 * `getOrCreate`, so the gap was not merely a read: naming any id in the company minted a
 * DRAFT conclusion attributed to the caller on a job that was never theirs. The rule the
 * assignment policy states — the set a caller may act on cannot drift from the set they are
 * shown — is what this restores.
 *
 * `includeUnclaimed` MATCHES THE DETAIL READ DELIBERATELY, and is not a separate decision
 * about the open queue: the "Дүгнэлт бичих" button is reached from the request detail
 * screen, so a request a technician may open is exactly the set they may write up. Refusing
 * an unclaimed request here while still showing it would be a narrower policy than the
 * screen offers, which is a product change rather than a consistency fix.
 *
 * SKIPPED FOR A CUSTOMER SCOPE for the reason the list and the detail read skip it: a portal
 * account has no employee card, so the predicate would answer nothing, and tenancy is
 * already its boundary.
 *
 * THE OFFICE REVIEWER IS UNAFFECTED. Returning needs `service_request.change_status`, and
 * every role holding it — SYSTEM_ADMIN, ADMIN, MANAGEMENT, DISPATCH — also holds an
 * oversight key, so `resolveAssignedWorkFilter` returns null for them and adds nothing to
 * the query.
 *
 * A FIELD APPROVER IS NOT. `service_request.approve_report` carries no oversight key with
 * it, so a technician reaching `report/approve` is bounded by this predicate like any other
 * read — and then a second time, more tightly, by `assertReportApprovalAllowed`, which drops
 * the unclaimed branch this one keeps. The two are not redundant: this one decides what may
 * be LOOKED at, that one decides what may be APPROVED, and approving a conclusion on a
 * request nobody holds is not a thing the claim flow leaves room for.
 */
async function requestIdInScope(
  requestId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
): Promise<Types.ObjectId> {
  const filter: FilterQuery<IServiceRequest> = {
    _id: new Types.ObjectId(requestId),
    ...customerScopeFilter(scope),
  };

  if (scope.mode === 'STAFF') {
    const assignmentFilter = await resolveAssignedWorkFilter<IServiceRequest>(actor, {
      includeUnclaimed: true,
    });
    if (assignmentFilter) filter.$and = [assignmentFilter];
  }

  const request = await ServiceRequest.findOne(filter).select('_id').lean();
  if (!request) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хүсэлт олдсонгүй.');
  return request._id;
}

/**
 * The conclusion for a request, created empty on first read.
 *
 * A technician opens the form before there is anything to save, so the record is brought
 * into being on demand rather than requiring an explicit create step.
 */
export async function getOrCreateWorkReport(
  requestId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
): Promise<WorkReportDto> {
  const request = { _id: await requestIdInScope(requestId, scope, actor) };

  const existing = await WorkReport.findOne({ serviceRequest: request._id })
    .populate(POPULATE)
    .lean<WithId<IWorkReport> | null>();
  if (existing) return toDto(existing);

  const created = await WorkReport.create({
    serviceRequest: request._id,
    status: 'DRAFT',
    createdBy: new Types.ObjectId(actor.userId),
    createdByName: actor.fullName ?? null,
  });

  return loadPopulated(created._id);
}

/** Reads the report without creating one, for callers that only display it. */
export async function findWorkReport(
  requestId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
): Promise<WorkReportDto | null> {
  const report = await WorkReport.findOne({
    serviceRequest: await requestIdInScope(requestId, scope, actor),
  })
    .populate(POPULATE)
    .lean<WithId<IWorkReport> | null>();
  return report ? toDto(report) : null;
}

export async function saveWorkReport(
  requestId: string,
  input: SaveWorkReportInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<WorkReportDto> {
  const report = await WorkReport.findOne({
    serviceRequest: await requestIdInScope(requestId, scope, actor),
  });
  if (!report) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Дүгнэлт олдсонгүй.');

  if (report.status === 'APPROVED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Батлагдсан дүгнэлтийг засахгүй.',
    );
  }

  const before = { score: report.score, status: report.status };

  report.score = input.score ?? null;
  // Section 10.1: the band is a function of the score against the thresholds in force,
  // never a value the caller supplies.
  report.riskLevel =
    input.score === null || input.score === undefined
      ? null
      : riskLevelFor(input.score, await getRiskBands());
  report.conclusion = input.conclusion ?? null;
  report.recommendation = input.recommendation ?? null;
  report.actionTaken = input.actionTaken ?? null;
  report.repairRequired = input.repairRequired;
  report.revisitRequired = input.revisitRequired;
  report.revisitDate = input.revisitDate ? new Date(input.revisitDate) : null;
  report.set('beforePhotos', input.beforePhotoIds.map((id) => new Types.ObjectId(id)));
  report.set('afterPhotos', input.afterPhotoIds.map((id) => new Types.ObjectId(id)));
  // Requirements 19.2: what was used on the job, typed by hand. The whole list is
  // replaced, exactly as the photo lists are.
  report.set(
    'materials',
    input.materials.map((entry) => ({
      name: entry.name,
      quantity: entry.quantity,
      unit: entry.unit,
    })),
  );

  /**
   * The equipment link is the only bridge from a service result to the object master, so
   * it must not cross a tenant: every id has to be a registered object of the request's
   * own customer, or a technician could name another organisation's equipment here and
   * move its figures on approval. Deduplicated first, because a repeated id would
   * otherwise raise one report twice against the store's unique (source, object) pair.
   */
  /*
   * The membership list is the union of both inputs.
   *
   * `objectAssessments` is what actually produces per-equipment findings; `objectIds` is
   * the flat list a draft uses while equipment has been chosen but not yet written up.
   * Merging them means an object named in either reaches the report, and an object dropped
   * from both stops being reported on — `syncItems` removes the item, so a withdrawn
   * finding does not linger on the equipment.
   */
  const assessments = input.objectAssessments ?? [];
  const objectIds = [
    ...new Set([...input.objectIds, ...assessments.map((entry) => entry.objectId)]),
  ].map((id) => new Types.ObjectId(id));

  if (objectIds.length > 0) {
    const request = await ServiceRequest.findById(report.serviceRequest).select('customer');
    const owned = await ObjectRecord.countDocuments({
      _id: { $in: objectIds },
      customer: request?.customer,
    });
    if (owned !== objectIds.length) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Сонгосон тоноглол энэ харилцагчийн бүртгэлд олдсонгүй.',
        [{ field: 'objectIds', message: 'Тоноглолыг дахин сонгоно уу.' }],
      );
    }
  }
  report.set('objects', objectIds);
  report.set(
    'objectAssessments',
    assessments.map((entry) => ({
      object: new Types.ObjectId(entry.objectId),
      score: entry.score ?? null,
      observation: entry.observation ?? null,
      conclusion: entry.conclusion ?? null,
      recommendation: entry.recommendation ?? null,
      photos: (entry.photoIds ?? []).map((id) => new Types.ObjectId(id)),
    })),
  );

  // Editing a returned conclusion puts it back into draft, so the technician resubmits
  // rather than leaving it sitting in a rejected state that reads as unaddressed.
  if (report.status === 'RETURNED') report.status = 'DRAFT';

  await report.save();

  await recordAudit({
    entityType: ENTITY,
    entityId: report._id,
    action: 'Updated',
    actor: actorOf(actor),
    meta,
    oldValue: before,
    newValue: { score: report.score, riskLevel: report.riskLevel, status: report.status },
  });

  return loadPopulated(report._id);
}

/**
 * Hands the conclusion to an administrator.
 *
 * Refused while a mandatory field is empty, and the response names every one of them so
 * the screen can point at the fields rather than showing one unhelpful message.
 */
export async function submitWorkReport(
  requestId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<WorkReportDto> {
  const report = await WorkReport.findOne({
    serviceRequest: await requestIdInScope(requestId, scope, actor),
  })
    .populate(POPULATE)
    .lean<WithId<IWorkReport> | null>();
  if (!report) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Дүгнэлт олдсонгүй.');

  const dto = toDto(report);
  if (!dto.isComplete) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Дүгнэлт дутуу тул илгээх боломжгүй.',
      dto.missing.map((field) => ({ field, message: 'Заавал бөглөнө.' })),
    );
  }

  await WorkReport.updateOne(
    { _id: report._id },
    {
      $set: {
        status: 'SUBMITTED',
        submittedBy: new Types.ObjectId(actor.userId),
        submittedByName: actor.fullName ?? null,
        submittedAt: new Date(),
        returnReason: null,
      },
    },
  );

  await recordAudit({
    entityType: ENTITY,
    entityId: report._id,
    action: 'Submitted',
    actor: actorOf(actor),
    meta,
    newValue: { score: report.score, riskLevel: report.riskLevel },
  });

  await notify({
    event: 'REPORT_SUBMITTED',
    title: 'Үйлчилгээний хүсэлтийн дүгнэлт хянуулахаар ирлээ',
    entityType: 'Work',
    entityId: report.serviceRequest,
    linkPath: `/service-requests/${String(report.serviceRequest)}`,
    permission: 'service_request.change_status',
    excludeUserId: actor.userId,
  });

  return loadPopulated(report._id);
}

/**
 * Sends an approved conclusion to the central report store and on to its equipment.
 *
 * ONE report per request, keyed on (customer, SERVICE_REQUEST, request id): a conclusion
 * re-approved after a return corrects its row rather than writing a second, and the
 * unique index — not a lookup — is what holds that. Each linked object becomes one item
 * carrying the conclusion's finding; the ids were already refused at save time unless
 * they belong to the request's own customer.
 *
 * Runs after the approval is saved and is guarded rather than awaited into the caller's
 * failure path: once the row says APPROVED the reviewer's action has happened, and
 * throwing here would tell them it did not and invite a retry of a request that already
 * succeeded. The equipment write and the rollup are derived stores; the report is the
 * record.
 *
 * A conclusion that names no equipment still becomes a report, so the work is searchable
 * in the central module — the hierarchy is then what the request itself knew, and no
 * equipment, floor, building or project figure moves.
 */
async function publishApprovedResult(
  report: WithId<IWorkReport>,
  actor: AuthContext,
): Promise<void> {
  try {
    const request = await ServiceRequest.findById(report.serviceRequest).select(
      'requestNumber customer project building',
    );

    const evidence = [...listOf(report.beforePhotos), ...listOf(report.afterPhotos)];
    const assessments = listOf(report.objectAssessments);
    const occurredAt = report.approvedAt ?? new Date();

    const written = await writeReport({
      type: 'SERVICE_REQUEST',
      status: 'APPROVED',
      title: `${request?.requestNumber ?? 'Хүсэлт'} — ажлын дүгнэлт`,
      sourceType: 'SERVICE_REQUEST',
      sourceId: report.serviceRequest,
      sourceReference: request?.requestNumber ?? null,
      conclusion: report.conclusion,
      recommendation: report.recommendation,
      /*
       * One item per object, carrying THAT object's finding.
       *
       * A per-equipment assessment wins where one was written; an object named without one
       * falls back to the visit-level figures, which is the only honest thing to say about
       * equipment the technician listed but did not score separately. The fallback is also
       * what keeps every conclusion written before per-equipment assessment existed
       * producing exactly the report it produced before.
       *
       * NO `judgedBy` IS SENT. A planned-work sub-task stamps `conclusionBy` when its
       * Дүгнэлт text changes, so its items can name the technician who judged that
       * equipment. `IWorkReportObjectAssessment` records no author at all — only the
       * conclusion as a whole has a `createdBy`, which is the draft's owner rather than a
       * per-equipment verdict — so there is nothing here that is true per item. The
       * history rows these produce keep naming the approver through `assessedBy`, and
       * their `judgedBy` stays null, which reads as "no per-equipment author recorded"
       * rather than as a claim about the wrong person.
       */
      items: listOf(report.objects).map((objectId) => {
        const perObject = assessments.find(
          (entry) => String(entry.object) === String(objectId),
        );
        return {
          object: objectId,
          score: perObject?.score ?? report.score,
          observation: perObject?.observation ?? report.actionTaken,
          conclusion: perObject?.conclusion ?? report.conclusion,
          recommendation: perObject?.recommendation ?? report.recommendation,
          // The object's own evidence when it has some, the visit's otherwise: a photo of
          // one panel is not evidence about another.
          evidenceAttachments:
            perObject && listOf(perObject.photos).length > 0
              ? [...listOf(perObject.photos)]
              : evidence,
        };
      }),
      hierarchy:
        listOf(report.objects).length === 0
          ? {
              customer: request?.customer ?? null,
              project: request?.project ?? null,
              building: request?.building ?? null,
            }
          : undefined,
      actor: { id: new Types.ObjectId(actor.userId), name: actor.fullName ?? null },
      occurredAt,
    });

    /**
     * The approval is carried onto the canonical row, as the planned-work path already
     * does with its own.
     *
     * `writeReport` records who RAISED a report, never who signed it off, so a row landing
     * here as APPROVED with no `approvedBy` was claiming a review with nobody attached to
     * it. Everything downstream reads `approvedByName ?? createdByName` — the history row's
     * author, the object timeline's actor, the report list — and on this path the two
     * happened to be the same person, so the gap was invisible rather than absent.
     */
    if (report.approvedBy || report.approvedAt) {
      await Report.updateOne(
        { _id: written._id },
        {
          $set: {
            approvedBy: report.approvedBy,
            approvedByName: report.approvedByName,
            approvedAt: report.approvedAt,
          },
        },
      );
    }

    await applyReportSafely(written._id);
  } catch (error) {
    logger.error(
      { err: error, workReport: String(report._id) },
      'approved work report could not be published to its equipment',
    );
  }
}

/**
 * Settles a submitted conclusion.
 *
 * TWO KEYS REACH THIS, and they are not the same authority. `service_request.change_status`
 * is the office reviewer and is unscoped in practice, because every role holding it also
 * holds an oversight key. `service_request.approve_report` is the field grant, and for its
 * holders `assertReportApprovalAllowed` bounds this to a request that names them or their
 * team — the same predicate `POST /:id/status` applies, minus the unclaimed queue.
 *
 * `returnWorkReport` below has no equivalent and must not acquire one: returning stays on
 * `service_request.change_status` alone.
 */
export async function approveWorkReport(
  requestId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<WorkReportDto> {
  const serviceRequestId = await requestIdInScope(requestId, scope, actor);
  await assertReportApprovalAllowed(serviceRequestId, actor);

  const report = await WorkReport.findOne({ serviceRequest: serviceRequestId });
  if (!report) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Дүгнэлт олдсонгүй.');

  if (report.status !== 'SUBMITTED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Зөвхөн хянуулахаар илгээсэн дүгнэлтийг батална.',
    );
  }

  report.status = 'APPROVED';
  report.approvedBy = new Types.ObjectId(actor.userId);
  report.approvedByName = actor.fullName ?? null;
  report.approvedAt = new Date();
  await report.save();

  await recordAudit({
    entityType: ENTITY,
    entityId: report._id,
    action: 'Approved',
    actor: actorOf(actor),
    meta,
    newValue: { status: 'APPROVED' },
  });

  await publishApprovedResult(report, actor);

  await notify({
    event: 'REPORT_APPROVED',
    title: 'Дүгнэлт батлагдлаа',
    entityType: 'Work',
    entityId: report.serviceRequest,
    linkPath: `/service-requests/${String(report.serviceRequest)}`,
    permission: 'service_request.view',
    excludeUserId: actor.userId,
  });

  return loadPopulated(report._id);
}

export async function returnWorkReport(
  requestId: string,
  input: ReturnWorkReportInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<WorkReportDto> {
  const report = await WorkReport.findOne({
    serviceRequest: await requestIdInScope(requestId, scope, actor),
  });
  if (!report) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Дүгнэлт олдсонгүй.');

  if (report.status !== 'SUBMITTED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Зөвхөн хянуулахаар илгээсэн дүгнэлтийг буцаана.',
    );
  }

  report.status = 'RETURNED';
  report.returnedBy = new Types.ObjectId(actor.userId);
  report.returnedByName = actor.fullName ?? null;
  report.returnedAt = new Date();
  report.returnReason = input.reason;
  await report.save();

  await recordAudit({
    entityType: ENTITY,
    entityId: report._id,
    action: 'Returned',
    actor: actorOf(actor),
    meta,
    reason: input.reason,
    newValue: { status: 'RETURNED' },
  });

  await notify({
    event: 'REPORT_RETURNED',
    title: 'Дүгнэлт засварлуулахаар буцаагдлаа',
    body: input.reason,
    entityType: 'Work',
    entityId: report.serviceRequest,
    linkPath: `/service-requests/${String(report.serviceRequest)}`,
    permission: 'service_request.view',
    excludeUserId: actor.userId,
  });

  return loadPopulated(report._id);
}

/**
 * Guard for the request's own status transitions.
 *
 * Rules 17.6 and 17.7 tie completion to a conclusion, so a request may not be handed to a
 * reviewer without a complete one, nor finished before that conclusion is approved.
 */
export async function assertReportAllows(
  requestId: Types.ObjectId,
  to: string,
): Promise<void> {
  if (to !== 'REPORT_SUBMITTED' && to !== 'COMPLETED') return;

  const report = await WorkReport.findOne({ serviceRequest: requestId })
    .populate(POPULATE)
    .lean<WithId<IWorkReport> | null>();

  if (!report) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Ажлын дүгнэлт бөглөөгүй тул энэ төлөвт шилжүүлэх боломжгүй.',
      [{ field: 'report', message: 'Дүгнэлт бөглөнө үү.' }],
    );
  }

  const dto = toDto(report);

  if (to === 'REPORT_SUBMITTED' && !dto.isComplete) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Дүгнэлт дутуу тул хянуулахаар илгээх боломжгүй.',
      dto.missing.map((field) => ({ field, message: 'Заавал бөглөнө.' })),
    );
  }

  if (to === 'COMPLETED' && report.status !== 'APPROVED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Админ дүгнэлтийг батлаагүй тул ажлыг дуусгах боломжгүй.',
      [{ field: 'report', message: 'Дүгнэлт батлагдаагүй.' }],
    );
  }
}
