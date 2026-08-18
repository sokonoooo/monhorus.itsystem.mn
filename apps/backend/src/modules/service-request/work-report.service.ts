import {
  ARRIVED_STATUSES,
  riskLevelFor,
  workReportCompleteness,
  type CustomerWorkReportDto,
  type ReturnWorkReportInput,
  type SaveWorkReportInput,
  type WorkReportDto,
  type WorkReportMaterialDto,
  type WorkReportObjectDto,
  type WorkReportPhotoDto,
  type ObjectAttributeValue,
  type ObjectTypeAttributeDto,
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
import {
  ObjectRecord,
  type IObjectTypeAttribute,
} from '../object-master/object-master.models';
import { applyObjectAttributeValues } from '../object-master/object-master.service';
import { toObjectTypeAttributeDtos } from '../object-master/object-type.service';
import { resolveAssignedWorkFilter } from '../planned-work/planned-work.scope';
import { Report } from '../report-record/report-record.model';
import { applyReportSafely, writeReport } from '../report-record/report-record.service';
import { getRiskBands } from '../settings/settings.service';
import { assertReportApprovalAllowed } from './self-progress.policy';
import { advanceOnConclusion } from './service-request.auto-status';
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
/**
 * The equipment's own attribute answers and the definitions that describe them.
 *
 * Both come off the OBJECT rather than off the finding: they are facts about the kit, true
 * between visits, so every report against the same equipment reads the same answers.
 *
 * Empty on both counts when the path was not populated or the type declares nothing, so a
 * report saved before the feature existed renders exactly as it did.
 */
function attributesOf(value: unknown): {
  attributeValues: Record<string, ObjectAttributeValue>;
  objectTypeAttributes: ObjectTypeAttributeDto[];
} {
  if (typeof value !== 'object' || value === null) {
    return { attributeValues: {}, objectTypeAttributes: [] };
  }
  const object = value as {
    attributeValues?: Record<string, ObjectAttributeValue>;
    objectType?: { attributes?: IObjectTypeAttribute[] } | Types.ObjectId;
  };
  const type = object.objectType;
  const attributes =
    type !== null && typeof type === 'object' && 'attributes' in type ? type.attributes : undefined;

  return {
    // Spread rather than handed out: `attributeValues` is a `Mixed` path, so this is the
    // loaded document's own object.
    attributeValues: { ...(object.attributeValues ?? {}) },
    objectTypeAttributes: toObjectTypeAttributeDtos(attributes),
  };
}

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
        ...attributesOf(entry.object),
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
  /**
   * The assessed equipment, and the type behind it.
   *
   * `attributeValues` and the type's definitions come back so each row on the report can ask
   * the type's own questions (4.1) pre-filled with what the equipment already answered — a
   * report may name a panel and a breaker, and they declare different things.
   *
   * Populating this path also gives the per-row `code` and `name` something to read: they
   * were declared nullable and always came back null, because only the flat `objects` list
   * above was ever populated.
   */
  {
    path: 'objectAssessments.object',
    select: 'code name attributeValues objectType',
    populate: { path: 'objectType', select: 'attributes' },
  },
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
 * The request a conclusion may be WRITTEN against, bounded by who is asking and by whether
 * they have arrived.
 *
 * TWO RULES, AND THEY FAIL DIFFERENTLY ON PURPOSE.
 *
 * Assignment first, reported as not-found. `requestIdInScope` keeps the unclaimed branch
 * because looking at the open queue is legitimate; writing on it is not. Dropping that
 * branch here means a technician must CLAIM a request before concluding it — the claim flow
 * exists precisely so that authorship is never ambiguous, and the previous behaviour let any
 * technician who scrolled past an unclaimed request become the author of a draft on it.
 * Not-found rather than forbidden for the usual reason: a colleague's request is none of
 * their business, including whether it exists.
 *
 * Arrival second, reported as a plain refusal with a reason, because by then the caller has
 * been established as the right person and is owed an explanation. A conclusion is a record
 * of what was found ON SITE; one written from the road is a guess. Arrival is read from the
 * history as well as the current status, so a request that arrived and was later returned to
 * ASSIGNED still counts as visited — `ARRIVED_STATUSES` alone cannot tell that.
 *
 * Oversight is unaffected: `resolveAssignedWorkFilter` answers null for a caller holding an
 * oversight key, so an administrator is bounded by neither rule.
 */
async function writableRequestId(
  requestId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
): Promise<Types.ObjectId> {
  const filter: FilterQuery<IServiceRequest> = {
    _id: new Types.ObjectId(requestId),
    ...customerScopeFilter(scope),
  };

  let assignmentBounded = false;
  if (scope.mode === 'STAFF') {
    const assignmentFilter = await resolveAssignedWorkFilter<IServiceRequest>(actor, {
      includeUnclaimed: false,
    });
    if (assignmentFilter) {
      filter.$and = [assignmentFilter];
      assignmentBounded = true;
    }
  }

  const request = await ServiceRequest.findOne(filter)
    .select('_id status statusHistory')
    .lean();
  if (!request) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хүсэлт олдсонгүй.');

  // The arrival rule is about the person doing the visit. An unscoped caller is not doing
  // one, so holding them to it would stop an administrator correcting a record.
  if (assignmentBounded && !hasArrivedOnSite(request)) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Ажлын байрлалд очсоны дараа дүгнэлт бичих боломжтой.',
      [{ field: 'status', message: 'Эхлээд "Очсон" төлөвт шилжүүлнэ үү.' }],
    );
  }

  return request._id;
}

/** Whether the technician has ever reached the site, by current status or by history. */
function hasArrivedOnSite(
  request: Pick<IServiceRequest, 'status' | 'statusHistory'>,
): boolean {
  if (ARRIVED_STATUSES.includes(request.status)) return true;
  return (request.statusHistory ?? []).some((entry) => entry.toStatus === 'ON_SITE');
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
  // Minting a draft attributes it to the caller, so this is a write, not a read.
  const request = { _id: await writableRequestId(requestId, scope, actor) };

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

/**
 * Whether a request's conclusion has been approved.
 *
 * Deliberately `exists` on the unique `serviceRequest` index rather than a populate: the
 * request detail read runs this on every call, for staff and customer alike, and it needs
 * to answer one boolean rather than assemble a conclusion nobody asked for.
 */
export async function hasApprovedWorkReport(requestId: Types.ObjectId): Promise<boolean> {
  const approved = await WorkReport.exists({ serviceRequest: requestId, status: 'APPROVED' });
  return approved !== null;
}

/**
 * The conclusion as a customer reads it.
 *
 * READS, NEVER CREATES. `GET /:id/report` is `getOrCreateWorkReport`, which mints a DRAFT
 * attributed to whoever asked first; pointing a portal key at that route would have made
 * every customer who opened the tab the recorded author of an empty conclusion on their own
 * request. `findWorkReport` is the read that has no such side effect, and this is what it
 * exists for.
 *
 * APPROVED OR NOTHING, and the nothing is a 404. Rules 17.6/17.7 make approval the moment a
 * conclusion stops being a working document, and the planned-work portal already draws the
 * line in the same place (`visibleToCustomer: report.status === 'APPROVED'`). The request's
 * own `COMPLETED` is not a substitute — it is set by hand, and live data has a COMPLETED
 * request whose conclusion never left DRAFT.
 *
 * "No conclusion", "a draft", "submitted" and "returned" are ALL answered identically, with
 * the same message a foreign request gets. A distinct reply for each would let a customer
 * watch their own request's internal review progress — and, worse, an "exists but not
 * approved" answer confirms a technician has written something they have not yet stood
 * behind. Whether the office is still arguing about the wording is not a fact the portal
 * should be able to observe.
 *
 * Tenancy is `requestIdInScope`'s, which puts the customer predicate in the query, so a
 * foreign request is missing rather than forbidden. Its assignment half is skipped for a
 * CUSTOMER scope, which is correct here for the reason stated there: a portal account has
 * no employee card to be assigned to anything.
 */
export async function getCustomerWorkReport(
  requestId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
): Promise<CustomerWorkReportDto> {
  const report = await findWorkReport(requestId, scope, actor);

  if (!report || report.status !== 'APPROVED') {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Дүгнэлт олдсонгүй.');
  }

  // Written out field by field rather than by deleting from the staff DTO: a field added to
  // `WorkReportDto` later must be opted IN to here, so the next internal note added to a
  // conclusion cannot reach a customer by default.
  return {
    conclusion: report.conclusion,
    recommendation: report.recommendation,
    score: report.score,
    riskLevel: report.riskLevel,
    repairRequired: report.repairRequired,
    revisitRequired: report.revisitRequired,
    revisitDate: report.revisitDate,
    beforePhotos: report.beforePhotos,
    afterPhotos: report.afterPhotos,
    approvedAt: report.approvedAt,
    approvedByName: report.approvedByName,
  };
}

export async function saveWorkReport(
  requestId: string,
  input: SaveWorkReportInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<WorkReportDto> {
  const report = await WorkReport.findOne({
    serviceRequest: await writableRequestId(requestId, scope, actor),
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
  /**
   * Absent means untouched for the five office-entered fields; see the note on
   * `saveWorkReportSchema`. `undefined` is "the caller does not manage this", `null`/`[]`
   * is "the caller is clearing it" — collapsing the two with `??` is what let a phone save
   * erase a dispatcher's material list and follow-up flags.
   */
  if (input.actionTaken !== undefined) report.actionTaken = input.actionTaken ?? null;
  if (input.repairRequired !== undefined) report.repairRequired = input.repairRequired;
  if (input.revisitRequired !== undefined) report.revisitRequired = input.revisitRequired;
  if (input.revisitDate !== undefined) {
    report.revisitDate = input.revisitDate ? new Date(input.revisitDate) : null;
  }
  report.set('beforePhotos', input.beforePhotoIds.map((id) => new Types.ObjectId(id)));
  report.set('afterPhotos', input.afterPhotoIds.map((id) => new Types.ObjectId(id)));
  // Requirements 19.2: what was used on the job, typed by hand. An explicitly sent list
  // still replaces the whole thing, exactly as the photo lists do.
  if (input.materials !== undefined) {
    report.set(
      'materials',
      input.materials.map((entry) => ({
        name: entry.name,
        quantity: entry.quantity,
        unit: entry.unit,
      })),
    );
  }

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

  /**
   * The type's own attributes answered on this report land on the EQUIPMENT (4.1).
   *
   * Not on the ReportItem: the score and the narrative are what this visit observed, while
   * "this breaker is fused" is a standing fact about the kit. A copy per report would create
   * as many answers as there are visits with no way to say which is current.
   *
   * Applied AFTER the ownership check above, so a row naming another tenant's equipment is
   * refused before anything is written to it. Sequential rather than parallel because each
   * call saves its own document and a refusal should name the first row that is wrong rather
   * than racing several.
   *
   * A row that omits the key is not asked and not touched — which is what lets a draft saved
   * from an older client, or before the fields were filled in, save unchanged.
   */
  for (const [index, entry] of assessments.entries()) {
    if (entry.attributeValues === undefined) continue;
    await applyObjectAttributeValues(
      new Types.ObjectId(entry.objectId),
      entry.attributeValues,
      `objectAssessments.${index}.`,
    );
  }

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
    serviceRequest: await writableRequestId(requestId, scope, actor),
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

  // The request follows the conclusion. Submitting one used to leave the request wherever
  // it was, so a technician who had finished still showed as working and somebody had to
  // move it by hand — two records of the same fact, kept in step by memory.
  await advanceOnConclusion(report.serviceRequest, 'REPORT_SUBMITTED', actor);

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

  // Approving the conclusion is the verification, so it finishes the request — and this is
  // where the customer is finally told, which nothing did before.
  await advanceOnConclusion(report.serviceRequest, 'COMPLETED', actor);

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
