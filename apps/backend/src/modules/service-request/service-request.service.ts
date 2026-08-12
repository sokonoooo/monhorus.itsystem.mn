import {
  SERVICE_REQUEST_STATUS_LABELS,
  canTransition,
  isReasonRequired,
  type AssignServiceRequestInput,
  type ChangeServiceRequestStatusInput,
  type CreateServiceRequestInput,
  type DispatchBoardDto,
  type ExtendSlaInput,
  type PaginatedData,
  type ServiceRequestDetailDto,
  type ServiceRequestListItemDto,
  type SlaConfig,
  type ObjectBreadcrumbDto,
  type ServiceRequestAttachmentDto,
  type ServiceRequestListQueryInput,
  type ServiceRequestStatus,
  DISPATCH_BOARD_COLUMNS,
} from '@monhorus/shared';
import { Types, type FilterQuery, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  customerScopeFilter,
  resolveOwnerCustomerId,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import type { AuthContext } from '../../common/types/express';
import { creatorName } from '../../common/utils/creator.util';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import { notify } from '../notification/notification.service';
import { resolveAssignedWorkFilter } from '../planned-work/planned-work.scope';
import { assertReportAllows, hasApprovedWorkReport } from './work-report.service';
import { assertSelfProgressAllowed } from './self-progress.policy';
import { userIdsForEmployees } from '../notification/recipient.util';
import { Employee, type IEmployee } from '../employee/employee.model';
import { toEmployeeRefDto } from '../employee/employee.mapper';
import { Customer, ObjectNode } from '../objects/object.models';
import { StoredFile } from '../storage/stored-file.model';
import { computeSlaDueAt, evaluateSla } from './sla.service';
import { getSlaConfig } from '../settings/settings.service';
import {
  ServiceRequest,
  nextRequestNumber,
  type IServiceRequest,
  CLAIMABLE_STATUSES,
} from './service-request.model';
import { clearOpenForClaim, markOpenForClaim } from './unclaimed.service';

type WithId<T> = T & { _id: Types.ObjectId };
type NamedRef = { _id: Types.ObjectId; name: string } | null | undefined;
/** Shape the employee mapper needs from a populated assignedEmployees entry. */
type IEmployeeLike = IEmployee;

function ref(value: unknown): { id: string; name: string } | null {
  if (typeof value !== 'object' || value === null || !('name' in value)) return null;
  const node = value as { _id: Types.ObjectId; name: string };
  return { id: String(node._id), name: node.name };
}

const LOCATION_POPULATE = [
  { path: 'customer', select: 'name' },
  { path: 'project', select: 'name' },
  { path: 'building', select: 'name' },
  { path: 'floor', select: 'name' },
  { path: 'room', select: 'name' },
  { path: 'panel', select: 'name' },
  { path: 'circuit', select: 'name' },
  { path: 'device', select: 'name' },
  { path: 'assignedTeam', select: 'name' },
  { path: 'assignedEmployees', select: 'employeeCode firstName lastName photoDocument' },
] as const;

export function toListItemDto(
  request: WithId<IServiceRequest>,
  config: SlaConfig,
): ServiceRequestListItemDto {
  const sla = evaluateSla({
    status: request.status,
    isUrgent: request.isUrgent,
    slaStartedAt: request.slaStartedAt,
    slaDueAt: request.slaDueAt,
    completedAt: request.completedAt,
    config,
  });

  // assignedEmployees is either raw ObjectIds or populated Employee documents,
  // depending on whether the caller populated it. Only populated entries can be mapped.
  const employees = (request.assignedEmployees as unknown[])
    .filter(
      (entry): entry is WithId<IEmployeeLike> =>
        typeof entry === 'object' && entry !== null && 'employeeCode' in entry,
    )
    .map((entry) => toEmployeeRefDto(entry));

  return {
    id: String(request._id),
    requestNumber: request.requestNumber,
    customer: ref(request.customer as unknown as NamedRef),
    project: ref(request.project as unknown as NamedRef),
    building: ref(request.building as unknown as NamedRef),
    floor: ref(request.floor as unknown as NamedRef),
    room: ref(request.room as unknown as NamedRef),
    device: ref(request.device as unknown as NamedRef),
    // Sent on every request, null when nobody dropped a pin. Travels on the list DTO and not
    // only the detail one so a floor-plan view can mark several requests in one read.
    planPosition: request.planPosition
      ? { x: request.planPosition.x, y: request.planPosition.y }
      : null,
    requestType: request.requestType,
    isUrgent: request.isUrgent,
    status: request.status,
    assignedEmployees: employees,
    assignedTeam: ref(request.assignedTeam as unknown as NamedRef),
    createdByName: creatorName(request.createdBy, request.createdByName),
    createdAt: request.createdAt.toISOString(),
    slaDueAt: request.slaDueAt.toISOString(),
    slaState: sla.state,
    slaRemainingMinutes: sla.remainingMinutes,
  };
}

/**
 * Resolves the full location trail for a request.
 *
 * Uses the deepest supplied node and its materialised ancestor chain, so the whole
 * path is fetched in a single query rather than one per level.
 */
async function resolveLocationPath(
  request: WithId<IServiceRequest>,
): Promise<ObjectBreadcrumbDto[]> {
  const deepest =
    request.device ?? request.circuit ?? request.panel ?? request.room ??
    request.floor ?? request.building ?? request.project;
  if (!deepest) return [];

  const deepestId = typeof deepest === 'object' && '_id' in deepest
    ? (deepest as { _id: Types.ObjectId })._id
    : (deepest as Types.ObjectId);

  const node = await ObjectNode.findById(deepestId).select('kind name ancestors');
  if (!node) return [];

  const ancestors = await ObjectNode.find({ _id: { $in: node.ancestors } }).select('kind name');
  const byId = new Map(ancestors.map((entry) => [String(entry._id), entry]));

  const trail: ObjectBreadcrumbDto[] = [];
  for (const ancestorId of node.ancestors) {
    const entry = byId.get(String(ancestorId));
    if (entry) {
      trail.push({ id: String(entry._id), kind: entry.kind, name: entry.name });
    }
  }
  trail.push({ id: String(node._id), kind: node.kind, name: node.name });

  return trail;
}

async function resolveAttachments(
  request: WithId<IServiceRequest>,
): Promise<ServiceRequestAttachmentDto[]> {
  if (request.attachments.length === 0) return [];

  const files = await StoredFile.find({ _id: { $in: request.attachments } });
  return files.map((file) => ({
    id: String(file._id),
    name: file.originalName,
    downloadUrl: `/api/v1/files/${String(file._id)}`,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    uploadedByName: file.uploadedByName,
    uploadedAt: file.createdAt.toISOString(),
  }));
}

export async function toDetailDto(
  request: WithId<IServiceRequest>,
): Promise<ServiceRequestDetailDto> {
  const base = toListItemDto(request, await getSlaConfig());

  return {
    ...base,
    panel: ref(request.panel as unknown as NamedRef),
    circuit: ref(request.circuit as unknown as NamedRef),
    branch: request.branch,
    description: request.description,
    contactName: request.contactName,
    contactPhone: request.contactPhone,
    attachments: await resolveAttachments(request),
    statusHistory: request.statusHistory
      .slice()
      .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())
      .map((entry) => ({
        id: String(entry._id),
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        reason: entry.reason,
        changedByName: entry.changedByName,
        changedAt: entry.changedAt.toISOString(),
      })),
    locationPath: await resolveLocationPath(request),
    teamLeaderEmployeeId: request.teamLeaderEmployee ? String(request.teamLeaderEmployee) : null,
    slaStartedAt: request.slaStartedAt.toISOString(),
    slaExtendedMinutes: request.slaExtendedMinutes,
    slaExtensionReason: request.slaExtensionReason,
    revisitReason: request.revisitReason,
    revisitDueAt: request.revisitDueAt ? request.revisitDueAt.toISOString() : null,
    parentRequestId: request.parentRequest ? String(request.parentRequest) : null,
    createdByName: request.createdByName,
    // Whether `GET /:id/report/customer` will answer. Read from the conclusion rather than
    // inferred from `status`: a request is moved to COMPLETED by a person, and the flag has
    // to be a fact about the conclusion itself.
    hasApprovedReport: await hasApprovedWorkReport(request._id),
    updatedAt: request.updatedAt.toISOString(),
  };
}

/**
 * Loads a request that the caller is allowed to see, or reports it as missing.
 *
 * The tenant predicate is part of the query rather than a check on the loaded document, so
 * a request belonging to another organisation is indistinguishable from one that does not
 * exist. Answering "forbidden" would confirm the id is real and turn every by-id endpoint
 * into a probe for other organisations' identifiers.
 */
async function loadRequestInScope(
  requestId: string,
  scope: ResolvedCustomerScope,
): Promise<HydratedDocument<IServiceRequest>> {
  const request = await ServiceRequest.findOne({
    _id: new Types.ObjectId(requestId),
    ...customerScopeFilter(scope),
  });
  if (!request) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хүсэлт олдсонгүй.');
  }
  return request;
}

/**
 * Validates that every supplied location id exists, belongs to the owning customer,
 * and sits beneath its declared parent. Prevents a stale id left over from a changed
 * parent selection reaching the database.
 *
 * `customerId` is the owner resolved from the authenticated caller, never the raw body
 * field, so a customer cannot attach their request to another tenant's building by
 * sending that tenant's id alongside it.
 */
async function validateLocationChain(
  input: CreateServiceRequestInput,
  customerId: string,
): Promise<void> {
  const customer = await Customer.findById(customerId).select('_id');
  if (!customer) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Харилцагч олдсонгүй.', [
      { field: 'customerId', message: 'Харилцагч олдсонгүй.' },
    ]);
  }

  const chain: Array<[keyof CreateServiceRequestInput, string, string]> = [
    ['projectId', 'PROJECT', 'Төсөл'],
    ['buildingId', 'BUILDING', 'Барилга'],
    ['floorId', 'FLOOR', 'Давхар'],
    ['roomId', 'ROOM', 'Өрөө/бүс'],
    ['panelId', 'PANEL', 'Самбар'],
    ['circuitId', 'CIRCUIT', 'Хэлхээ'],
    ['deviceId', 'DEVICE', 'Төхөөрөмж'],
  ];

  let previousId: string | null = null;

  for (const [field, kind, label] of chain) {
    const value = input[field];
    if (typeof value !== 'string' || value.length === 0) continue;

    const node = await ObjectNode.findById(value).select('kind customer parent');
    if (!node) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, `${label} олдсонгүй.`, [
        { field, message: `${label} олдсонгүй.` },
      ]);
    }
    if (node.kind !== kind) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, `${label} буруу төрөлтэй байна.`, [
        { field, message: `${label} буруу төрөлтэй байна.` },
      ]);
    }
    if (String(node.customer) !== customerId) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        `${label} сонгосон харилцагчид харьяалагдахгүй байна.`,
        [{ field, message: `${label} өөр харилцагчийнх байна.` }],
      );
    }
    if (previousId && node.parent && String(node.parent) !== previousId) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        `${label} сонгосон эцэг объектод харьяалагдахгүй байна.`,
        [{ field, message: `${label} шатлал зөрчиж байна.` }],
      );
    }
    previousId = value;
  }
}

/**
 * Refuses an `attachmentIds` entry the caller did not upload and park themselves.
 *
 * `attachmentIds` is a list of ids chosen by the client, which makes it the same kind
 * of field as `buildingId`: something the request asserts and the server must verify.
 * The claim below only moves files matching `uploadedBy`, so a foreign id was never
 * stolen — but it WAS written into `attachments`, and `resolveAttachments` then reads
 * the StoredFile row to build the detail DTO. Another tenant's filename, size and
 * uploader name would have come back on a request the caller owns, which is the
 * metadata half of exactly the leak `assertFileInCustomerScope` closes for the bytes.
 *
 * The predicate is the same one the claim uses, so a file that passes here is a file
 * the claim will move: uploaded by this account, still an unclaimed SERVICE_REQUEST
 * attachment, i.e. parked on the uploader rather than already owned by some request.
 * Re-pointing an attachment from one request to another is therefore refused too,
 * which is the behaviour a client already has no way to ask for.
 *
 * Now that a customer can reach the upload route this is load-bearing rather than
 * theoretical: before it, a portal account could name any 24 hex characters.
 */
async function assertAttachmentsBelongToActor(
  attachmentIds: string[],
  actor: AuthContext,
): Promise<void> {
  if (attachmentIds.length === 0) return;

  const uploaderId = new Types.ObjectId(actor.userId);
  const owned = await StoredFile.countDocuments({
    _id: { $in: attachmentIds.map((id) => new Types.ObjectId(id)) },
    ownerType: 'SERVICE_REQUEST',
    ownerId: uploaderId,
    uploadedBy: uploaderId,
  });

  // Counted rather than compared id by id: the schema already rejects a duplicate-free
  // list of well-formed ids, and naming which id was refused would confirm that the
  // others exist, which is precisely what a caller probing for file ids wants to learn.
  if (owned !== attachmentIds.length) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Хавсралт файл олдсонгүй.', [
      { field: 'attachmentIds', message: 'Хавсаргасан файл олдсонгүй. Дахин хуулна уу.' },
    ]);
  }
}

export async function createServiceRequest(
  input: CreateServiceRequestInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ServiceRequestDetailDto> {
  // The owner comes from the authenticated caller. For a customer the body field must
  // match their own organisation or the request is refused outright, and every location
  // below is then verified against that same owner.
  const ownerCustomerId = resolveOwnerCustomerId(scope, input.customerId);
  await validateLocationChain(input, ownerCustomerId);
  await assertAttachmentsBelongToActor(input.attachmentIds, actor);

  const now = new Date();
  const slaDueAt = computeSlaDueAt(now, input.isUrgent, 0, await getSlaConfig());

  const request = await ServiceRequest.create({
    requestNumber: await nextRequestNumber(now),
    customer: new Types.ObjectId(ownerCustomerId),
    branch: input.branch ?? null,
    project: input.projectId ? new Types.ObjectId(input.projectId) : null,
    building: new Types.ObjectId(input.buildingId),
    floor: input.floorId ? new Types.ObjectId(input.floorId) : null,
    room: input.roomId ? new Types.ObjectId(input.roomId) : null,
    panel: input.panelId ? new Types.ObjectId(input.panelId) : null,
    circuit: input.circuitId ? new Types.ObjectId(input.circuitId) : null,
    device: input.deviceId ? new Types.ObjectId(input.deviceId) : null,
    // The schema has already refused a pin without a floor, so what arrives here either
    // names a drawing or is absent.
    planPosition: input.planPosition
      ? { x: input.planPosition.x, y: input.planPosition.y }
      : null,
    requestType: input.requestType,
    isUrgent: input.isUrgent,
    description: input.description,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    attachments: input.attachmentIds.map((id) => new Types.ObjectId(id)),
    status: 'NEW',
    slaStartedAt: now,
    slaDueAt,
    statusHistory: [
      {
        _id: new Types.ObjectId(),
        fromStatus: null,
        toStatus: 'NEW',
        reason: null,
        changedBy: new Types.ObjectId(actor.userId),
        changedByName: actor.fullName,
        changedAt: now,
      },
    ],
    createdBy: new Types.ObjectId(actor.userId),
    createdByName: actor.fullName,
  });

  // Attachments were parked on the uploader; transfer ownership to the request so
  // the download permission check resolves against the real owning entity.
  if (input.attachmentIds.length > 0) {
    await StoredFile.updateMany(
      {
        _id: { $in: input.attachmentIds.map((id) => new Types.ObjectId(id)) },
        ownerType: 'SERVICE_REQUEST',
        uploadedBy: new Types.ObjectId(actor.userId),
      },
      { $set: { ownerId: request._id } },
    );
  }

  // A new request is open from the moment it exists, so the two-hour scheduling clock
  // starts here rather than when somebody first looks at the board.
  await markOpenForClaim(request._id, request.createdAt ?? new Date());

  await recordAudit({
    entityType: 'Work',
    entityId: request._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: {
      requestNumber: request.requestNumber,
      isUrgent: request.isUrgent,
      slaDueAt: slaDueAt.toISOString(),
    },
  });

  // Section 14.3: a new call notifies the dispatch and admin side. The creator is
  // excluded, because telling somebody about the thing they just did is noise.
  await notify({
    event: 'SERVICE_REQUEST_CREATED',
    title: `${request.requestNumber} шинэ хүсэлт`,
    body: request.description.slice(0, 300),
    entityType: 'Work',
    entityId: request._id,
    linkPath: `/service-requests/${String(request._id)}`,
    permission: 'dispatch.view',
    excludeUserId: actor.userId,
  });

  return getServiceRequestById(String(request._id), scope, actor);
}

/**
 * The request list.
 *
 * TWO INDEPENDENT BOUNDARIES, because a caller can be on the wrong side of either.
 *
 * The tenant predicate comes from the scope and not from `query.customerId`: for a customer
 * the resolver has already discarded whatever they sent, which is what stops a caller
 * listing another organisation's requests by naming it in the query string.
 *
 * The assignment predicate bounds a STAFF caller to their own work, PLUS the open queue.
 * It closed the same hole `GET /planned-work` had: the filter was built entirely from query
 * parameters, so a technician who simply omitted `employeeId` received every request in the
 * company — every customer, address, contact name and fault description.
 * `resolveAssignedWorkFilter` returns null for a caller holding an oversight key, so a
 * dispatcher, a manager and an administrator are unaffected.
 *
 * `includeUnclaimed` is what keeps the "Нээлттэй" segment and `POST /:id/claim` working:
 * a request with no employee and no team is nobody's private business, it is the queue a
 * technician is meant to take from. See the option's own note for why planned work has no
 * equivalent.
 *
 * SKIPPED OUTRIGHT FOR A CUSTOMER SCOPE. A portal account has no employee card, so applying
 * this would answer the empty list for every customer in the system rather than the requests
 * they raised — worse, `includeUnclaimed` would show them other tenants' unassigned work if
 * tenancy were not already ANDed in. Tenancy is a customer's boundary and it is the correct
 * one.
 *
 * ANDed, not merged, so `employeeId`/`teamId` stay ADDITIONAL narrowing and cannot widen
 * the result, and so the predicate does not collide with the `$or` the search term uses.
 */
export async function listServiceRequests(
  query: ServiceRequestListQueryInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
): Promise<PaginatedData<ServiceRequestListItemDto>> {
  const filter: FilterQuery<IServiceRequest> = { ...customerScopeFilter(scope) };

  if (scope.mode === 'STAFF') {
    const assignmentFilter = await resolveAssignedWorkFilter<IServiceRequest>(actor, {
      includeUnclaimed: true,
    });
    if (assignmentFilter) filter.$and = [assignmentFilter];
  }

  if (query.status) filter.status = query.status;
  if (query.requestType) filter.requestType = query.requestType;
  if (query.isUrgent !== undefined) filter.isUrgent = query.isUrgent;
  if (query.projectId) filter.project = new Types.ObjectId(query.projectId);
  if (query.buildingId) filter.building = new Types.ObjectId(query.buildingId);
  if (query.employeeId) filter.assignedEmployees = new Types.ObjectId(query.employeeId);
  if (query.teamId) filter.assignedTeam = new Types.ObjectId(query.teamId);

  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [{ requestNumber: pattern }, { description: pattern }, { contactName: pattern }];
  }

  if (query.createdFrom || query.createdTo) {
    const range: Record<string, Date> = {};
    if (query.createdFrom) range.$gte = new Date(query.createdFrom);
    if (query.createdTo) range.$lte = new Date(query.createdTo);
    filter.createdAt = range;
  }

  const skip = (query.page - 1) * query.limit;
  const sort: Record<string, 1 | -1> = { [query.sortBy]: query.sortDir === 'asc' ? 1 : -1 };

  const [rows, total] = await Promise.all([
    ServiceRequest.find(filter).populate([...LOCATION_POPULATE]).sort(sort).skip(skip).limit(query.limit),
    ServiceRequest.countDocuments(filter),
  ]);

  const slaConfig = await getSlaConfig();
  let items = rows.map((row) => toListItemDto(row, slaConfig));

  // SLA state is derived, not stored, so it is filtered after mapping. The page
  // count still reflects the unfiltered total; this is documented as a known gap.
  if (query.slaState) {
    items = items.filter((item) => item.slaState === query.slaState);
  }

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

/**
 * The single-record read, bounded by the same two predicates the list is.
 *
 * `includeUnclaimed` IS WHAT KEEPS THE CLAIM FLOW ALIVE, and it is the one line here that
 * is easy to leave out and impossible to notice in a unit test. The "Нээлттэй" segment
 * lists requests nobody holds; a technician taps one to read the fault description before
 * deciding to take it. Without the allowance every one of those rows would 404 on tap — a
 * list of jobs that vanish when touched — and `POST /:id/claim` would still work while
 * being unreachable through the only screen that offers it.
 *
 * NOT-FOUND RATHER THAN FORBIDDEN, which is the convention `assertInCustomerScope` already
 * set on this endpoint and which the customer half of this same query has always used: a
 * 403 on an id confirms the record is real, turning the endpoint into an oracle for probing
 * identifiers. A colleague's request is now indistinguishable from an id that never existed.
 *
 * THE WRITE-THEN-RETURN CALLERS are safe by construction rather than by exemption. Assigning
 * needs `dispatch.assign`, changing status needs `service_request.change_status`, extending
 * an SLA needs `dispatch.extend_sla` — every one of those is oversight, so the actor is
 * unscoped here. Creating returns a request that is not assigned to anybody yet, which the
 * unclaimed branch admits. Claiming returns one the caller has just put their own name on.
 */
export async function getServiceRequestById(
  requestId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
): Promise<ServiceRequestDetailDto> {
  const filter: FilterQuery<IServiceRequest> = {
    _id: new Types.ObjectId(requestId),
    ...customerScopeFilter(scope),
  };

  // Skipped for a CUSTOMER scope for the same reason the list skips it: a portal account
  // has no employee card, and tenancy is already its boundary.
  if (scope.mode === 'STAFF') {
    const assignmentFilter = await resolveAssignedWorkFilter<IServiceRequest>(actor, {
      includeUnclaimed: true,
    });
    if (assignmentFilter) filter.$and = [assignmentFilter];
  }

  const request = await ServiceRequest.findOne(filter).populate([...LOCATION_POPULATE]);
  if (!request) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хүсэлт олдсонгүй.');
  }
  return await toDetailDto(request);
}

/**
 * Assigns employees or a team.
 *
 * Requirements rule 17 and the Phase 1 brief both forbid assigning work to an
 * employee who is not ACTIVE; that is enforced here rather than in the UI.
 */
export async function assignServiceRequest(
  requestId: string,
  input: AssignServiceRequestInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ServiceRequestDetailDto> {
  const request = await loadRequestInScope(requestId, scope);

  if (request.status === 'COMPLETED' || request.status === 'CANCELLED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Дууссан эсвэл цуцалсан хүсэлтэд ажилтан хуваарилах боломжгүй.',
    );
  }

  if (input.employeeIds.length > 0) {
    const employees = await Employee.find({
      _id: { $in: input.employeeIds.map((id) => new Types.ObjectId(id)) },
    }).select('status firstName lastName');

    if (employees.length !== input.employeeIds.length) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Сонгосон ажилтан олдсонгүй.', [
        { field: 'employeeIds', message: 'Ажилтан олдсонгүй.' },
      ]);
    }

    const notAssignable = employees.filter((employee) => employee.status !== 'ACTIVE');
    if (notAssignable.length > 0) {
      const names = notAssignable.map((e) => `${e.lastName} ${e.firstName}`).join(', ');
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        `Идэвхгүй ажилтанд ажил хуваарилах боломжгүй: ${names}`,
        [{ field: 'employeeIds', message: 'Зөвхөн идэвхтэй ажилтанд хуваарилна.' }],
      );
    }
  }

  const previousEmployees = request.assignedEmployees.map((id) => String(id));
  const previousStatus = request.status;

  request.assignedEmployees = input.employeeIds.map((id) => new Types.ObjectId(id));
  request.assignedTeam = input.teamId ? new Types.ObjectId(input.teamId) : null;
  request.teamLeaderEmployee = input.teamLeaderEmployeeId
    ? new Types.ObjectId(input.teamLeaderEmployeeId)
    : null;

  // Assignment moves NEW or UNASSIGNED forward to ASSIGNED automatically.
  if (previousStatus === 'NEW' || previousStatus === 'UNASSIGNED') {
    request.status = 'ASSIGNED';
    request.statusHistory.push({
      _id: new Types.ObjectId(),
      fromStatus: previousStatus,
      toStatus: 'ASSIGNED',
      reason: input.note ?? null,
      changedBy: new Types.ObjectId(actor.userId),
      changedByName: actor.fullName,
      changedAt: new Date(),
    });
  }

  await request.save();

  // Somebody now holds it, so the open interval is over and the sweep must stop seeing it.
  await clearOpenForClaim(request._id);

  await recordAudit({
    entityType: 'Work',
    entityId: request._id,
    action: 'Assigned',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: input.note ?? null,
    oldValue: { assignedEmployees: previousEmployees, status: previousStatus },
    newValue: {
      assignedEmployees: input.employeeIds,
      teamId: input.teamId ?? null,
      status: request.status,
    },
  });

  await notify({
    event: previousEmployees.length > 0 ? 'SERVICE_REQUEST_REASSIGNED' : 'SERVICE_REQUEST_ASSIGNED',
    title: `${request.requestNumber} танд хуваарилагдлаа`,
    body: request.description.slice(0, 300),
    entityType: 'Work',
    entityId: request._id,
    linkPath: `/service-requests/${String(request._id)}`,
    userIds: await userIdsForEmployees(input.employeeIds),
    excludeUserId: actor.userId,
  });

  return getServiceRequestById(requestId, scope, actor);
}

export async function changeServiceRequestStatus(
  requestId: string,
  input: ChangeServiceRequestStatusInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ServiceRequestDetailDto> {
  const request = await loadRequestInScope(requestId, scope);

  const from: ServiceRequestStatus = request.status;
  const to = input.status;

  /*
   * WHO the caller is allowed to be, before WHAT they are allowed to do.
   *
   * The route admits two populations: `service_request.change_status`, which is the office
   * and is unchanged, and `service_request.self_progress`, which is the field and is bounded
   * to the six states in `SELF_PROGRESS_STATUSES` on a request that names the caller or
   * their team. `assertSelfProgressAllowed` returns immediately for the first population, so
   * nothing here narrows an existing holder.
   *
   * Run BEFORE the transition matrix so that "you may not make this kind of move" is 403 and
   * "this move is not possible from here" is 400, rather than the second answer masking the
   * first for a caller who never had the authority in the first place.
   */
  await assertSelfProgressAllowed(request._id, to, actor);

  if (!canTransition(from, to)) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      `"${from}" төлвөөс "${to}" төлөв рүү шилжих боломжгүй.`,
      [{ field: 'status', message: 'Зөвшөөрөгдөөгүй шилжилт.' }],
    );
  }

  if (isReasonRequired(to) && !input.reason) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Шалтгаан заавал бөглөнө.', [
      { field: 'reason', message: 'Шалтгаан заавал.' },
    ]);
  }

  // Rules 17.6 and 17.7: no conclusion, no completion. Checked here rather than in the
  // transition matrix because the matrix knows the shape of the flow, not its contents.
  await assertReportAllows(request._id, to);

  request.status = to;
  if (to === 'COMPLETED') {
    request.completedAt = new Date();
  }

  /*
   * Returning a request to the open queue starts a NEW two-hour interval.
   *
   * The stamp is re-written rather than left alone, which is what makes the second spell
   * alertable: `unclaimedNotifiedFor` still holds the FIRST spell's stamp, so the two no
   * longer match and the sweep treats this as un-notified. Leaving the original stamp
   * would both suppress the alert forever and date the interval from the wrong moment.
   *
   * The assignment is dropped at the same time, because a request that is UNASSIGNED while
   * still naming an employee is not actually claimable and would be skipped by the sweep's
   * own predicate.
   */
  const reopened = to === 'UNASSIGNED' && from !== 'UNASSIGNED';
  if (reopened) {
    request.assignedEmployees = [];
    request.assignedTeam = null;
    request.teamLeaderEmployee = null;
  }
  request.statusHistory.push({
    _id: new Types.ObjectId(),
    fromStatus: from,
    toStatus: to,
    reason: input.reason ?? null,
    changedBy: new Types.ObjectId(actor.userId),
    changedByName: actor.fullName,
    changedAt: new Date(),
  });

  await request.save();

  if (reopened) {
    await markOpenForClaim(request._id);
  } else if (!CLAIMABLE_STATUSES.includes(to as (typeof CLAIMABLE_STATUSES)[number])) {
    await clearOpenForClaim(request._id);
  }

  await recordAudit({
    entityType: 'Work',
    entityId: request._id,
    action: 'StatusChanged',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: input.reason ?? null,
    oldValue: { status: from },
    newValue: { status: to },
  });

  await notify({
    event: 'SERVICE_REQUEST_STATUS_CHANGED',
    title: `${request.requestNumber} төлөв "${SERVICE_REQUEST_STATUS_LABELS[to]}" боллоо`,
    body: input.reason ?? null,
    entityType: 'Work',
    entityId: request._id,
    linkPath: `/service-requests/${String(request._id)}`,
    permission: 'service_request.view',
    excludeUserId: actor.userId,
  });

  return getServiceRequestById(requestId, scope, actor);
}

export async function extendSla(
  requestId: string,
  input: ExtendSlaInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ServiceRequestDetailDto> {
  const request = await loadRequestInScope(requestId, scope);

  const previousDueAt = request.slaDueAt;
  request.slaExtendedMinutes += input.additionalMinutes;
  request.slaDueAt = computeSlaDueAt(
    request.slaStartedAt,
    request.isUrgent,
    request.slaExtendedMinutes,
    await getSlaConfig(),
  );
  request.slaExtensionReason = input.reason;
  await request.save();

  await recordAudit({
    entityType: 'Work',
    entityId: request._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: `SLA extended: ${input.reason}`,
    oldValue: { slaDueAt: previousDueAt.toISOString() },
    newValue: { slaDueAt: request.slaDueAt.toISOString() },
  });

  return getServiceRequestById(requestId, scope, actor);
}

/**
 * Dispatch board grouped by workflow status.
 *
 * Dispatch is staff work and its route is gated on a staff permission, but the scope is
 * still taken and applied so the board can never be the one cross-tenant read left over.
 */
export async function getDispatchBoard(
  scope: ResolvedCustomerScope,
  limitPerColumn = 25,
): Promise<DispatchBoardDto> {
  // Resolved once so every column reports SLA state against the same configuration.
  const slaConfig = await getSlaConfig();
  const scopeFilter = customerScopeFilter(scope);

  const columns = await Promise.all(
    // A column may cover more than one status — the open column covers NEW and
    // UNASSIGNED — so both the page and the count match on the whole set.
    DISPATCH_BOARD_COLUMNS.map(async (column) => {
      const statuses = [...column.statuses];
      const filter = { status: { $in: statuses }, ...scopeFilter };

      const [rows, total] = await Promise.all([
        ServiceRequest.find(filter)
          .populate([...LOCATION_POPULATE])
          .sort({ isUrgent: -1, slaDueAt: 1 })
          .limit(limitPerColumn),
        ServiceRequest.countDocuments(filter),
      ]);

      return {
        id: column.id,
        statuses,
        label: column.label,
        total,
        items: rows.map((row) => toListItemDto(row, slaConfig)),
      };
    }),
  );

  return { columns, generatedAt: new Date().toISOString() };
}
