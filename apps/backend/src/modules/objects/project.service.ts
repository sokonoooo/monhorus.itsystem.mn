import type {
  BuildingDto,
  RiskLevel,
  RiskSummaryDto,
  BuildingListQueryInput,
  CreateBuildingInput,
  CreateFloorInput,
  CreateProjectInput,
  FloorDto,
  FloorListQueryInput,
  PaginatedData,
  ProjectDto,
  ProjectListQueryInput,
  UpdateBuildingInput,
  UpdateFloorInput,
  UpdateProjectInput,
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
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import { Employee } from '../employee/employee.model';
import { ObjectRecord } from '../object-master/object-master.models';
import { rollupOf } from '../report-record/rollup.service';
import { PlannedWork } from '../planned-work/planned-work.models';
import { ServiceRequest } from '../service-request/service-request.model';
import { Customer, FloorPlan, ObjectNode, type IObjectNode } from './object.models';

/**
 * Project module CRUD: Project -> Building/Object -> Floor.
 *
 * Containment is validated on every write. Objects are master data owned by another
 * module and are only referenced from a floor, so nothing here creates or copies one.
 *
 * Deletion is refused whenever a dependent record exists; archiving via `isActive` is the
 * always-available alternative, and an archived node is hidden from the selectors that
 * drive new operational work.
 *
 * Every function that reads or writes a node takes a `ResolvedCustomerScope`. It is a
 * required parameter with no defaulted overload on purpose: an unscoped read is exactly
 * the hole this module used to have, so there is no signature that permits one. A staff
 * caller passes a staff scope, which resolves to no predicate and leaves their existing
 * cross-tenant access untouched.
 */

type Doc<T> = HydratedDocument<T>;

function employeeName(value: unknown): string | null {
  if (typeof value === 'object' && value !== null && 'firstName' in value) {
    const employee = value as { firstName: string; lastName: string };
    return `${employee.lastName} ${employee.firstName}`.trim();
  }
  return null;
}

function refName(value: unknown): string | null {
  if (typeof value === 'object' && value !== null && 'name' in value) {
    return String((value as { name: string }).name);
  }
  return null;
}

function refId(value: unknown): string {
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return String((value as { _id: Types.ObjectId })._id);
  }
  return String(value ?? '');
}

// -- Shared helpers ----------------------------------------------------------

/**
 * Loads one node of a given kind inside the caller's scope.
 *
 * The ownership predicate is part of the query rather than a check after the fact, so a
 * node belonging to another tenant is indistinguishable from one that does not exist. A
 * "forbidden" reply would confirm the id is real and turn every detail endpoint into an
 * oracle for probing other organisations' identifiers.
 */
async function findNode(
  nodeId: string,
  kind: IObjectNode['kind'],
  scope: ResolvedCustomerScope,
  notFoundMessage: string,
): Promise<Doc<IObjectNode>> {
  const node = await ObjectNode.findOne({
    _id: nodeId,
    kind,
    ...customerScopeFilter(scope),
  });
  if (!node) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, notFoundMessage);
  }
  return node;
}

/** Codes are unique per customer, matching the existing compound index. */
async function assertCodeAvailable(
  customerId: Types.ObjectId,
  code: string,
  excludeId?: Types.ObjectId,
): Promise<void> {
  const filter: FilterQuery<IObjectNode> = { customer: customerId, code };
  if (excludeId) filter._id = { $ne: excludeId };
  const existing = await ObjectNode.findOne(filter).select('_id');
  if (existing) {
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      'Энэ харилцагчид ижил кодтой бичлэг бүртгэгдсэн байна.',
    );
  }
}

async function descendantIds(nodeId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const rows = await ObjectNode.find({ ancestors: nodeId }).select('_id');
  return rows.map((row) => row._id);
}

// -- Counts and delete guards -------------------------------------------------

interface HierarchyCounts {
  buildings: number;
  floors: number;
  objects: number;
}

async function countsUnder(nodeId: Types.ObjectId): Promise<HierarchyCounts> {
  const [buildings, floors, floorIds] = await Promise.all([
    ObjectNode.countDocuments({ kind: 'BUILDING', ancestors: nodeId }),
    ObjectNode.countDocuments({ kind: 'FLOOR', ancestors: nodeId }),
    ObjectNode.find({ kind: 'FLOOR', ancestors: nodeId }).select('_id'),
  ]);

  const objects =
    floorIds.length === 0
      ? 0
      : await ObjectRecord.countDocuments({ floor: { $in: floorIds.map((row) => row._id) } });

  return { buildings, floors, objects };
}

// -- Risk roll-up ------------------------------------------------------------

const EMPTY_RISK_SUMMARY: RiskSummaryDto = {
  counts: [],
  unassessedCount: 0,
  hasCritical: false,
  lastAssessedAt: null,
};

/** One aggregation row: objects on a floor sharing a risk level. */
interface FloorRiskRow {
  _id: { floor: Types.ObjectId; level: RiskLevel | null };
  count: number;
  lastAssessedAt: Date | null;
}

function foldRiskRows(rows: readonly FloorRiskRow[]): RiskSummaryDto {
  const counts = new Map<RiskLevel, number>();
  let unassessedCount = 0;
  let lastAssessedAt: Date | null = null;

  for (const row of rows) {
    const level = row._id.level;
    if (!level) {
      unassessedCount += row.count;
      continue;
    }
    counts.set(level, (counts.get(level) ?? 0) + row.count);
    if (row.lastAssessedAt && (!lastAssessedAt || row.lastAssessedAt > lastAssessedAt)) {
      lastAssessedAt = row.lastAssessedAt;
    }
  }

  return {
    counts: [...counts.entries()].map(([level, count]) => ({ level, count })),
    unassessedCount,
    hasCritical: (counts.get('CRITICAL') ?? 0) > 0 || (counts.get('OUT_OF_SERVICE') ?? 0) > 0,
    lastAssessedAt: lastAssessedAt ? lastAssessedAt.toISOString() : null,
  };
}

/**
 * Risk roll-ups for a whole page of nodes in two queries.
 *
 * Resolving this per row would add four queries per row on top of the counts, so a
 * twenty-project list would issue a hundred. Instead the floors beneath every node are
 * fetched once, the objects on those floors are grouped once, and the result is folded back
 * onto each node through the materialised `ancestors` array.
 *
 * This returns counts per band and a warning marker only. The single worst-case figure
 * exists now — ROLLUP_METHOD settled the method 19.2 had left open — but it is stored on
 * the node by the report module's recalculation and read from there, not recomputed here:
 * the counts answer "how is the equipment distributed", the rollup answers "how bad is the
 * worst of it", and both travel on the DTO.
 */
export async function riskSummariesFor(
  nodeIds: readonly Types.ObjectId[],
  kind: 'SUBTREE' | 'FLOOR',
): Promise<Map<string, RiskSummaryDto>> {
  if (nodeIds.length === 0) return new Map();

  // A floor is its own scope; a project or building owns every floor beneath it.
  const floorToNodes = new Map<string, string[]>();
  let floorIds: Types.ObjectId[];

  if (kind === 'FLOOR') {
    floorIds = [...nodeIds];
    for (const id of nodeIds) floorToNodes.set(String(id), [String(id)]);
  } else {
    const floors = await ObjectNode.find({
      kind: 'FLOOR',
      ancestors: { $in: [...nodeIds] },
    }).select('_id ancestors');

    floorIds = floors.map((floor) => floor._id);
    const wanted = new Set(nodeIds.map(String));

    for (const floor of floors) {
      const owners = floor.ancestors.map(String).filter((ancestor) => wanted.has(ancestor));
      floorToNodes.set(String(floor._id), owners);
    }
  }

  const summaries = new Map<string, RiskSummaryDto>();
  for (const id of nodeIds) summaries.set(String(id), EMPTY_RISK_SUMMARY);
  if (floorIds.length === 0) return summaries;

  const rows = await ObjectRecord.aggregate<FloorRiskRow>([
    { $match: { floor: { $in: floorIds } } },
    {
      $group: {
        _id: { floor: '$floor', level: '$latestAssessment.riskLevel' },
        count: { $sum: 1 },
        lastAssessedAt: { $max: '$latestAssessment.assessedAt' },
      },
    },
  ]);

  const byNode = new Map<string, FloorRiskRow[]>();
  for (const row of rows) {
    for (const nodeId of floorToNodes.get(String(row._id.floor)) ?? []) {
      const bucket = byNode.get(nodeId);
      if (bucket) bucket.push(row);
      else byNode.set(nodeId, [row]);
    }
  }

  for (const [nodeId, nodeRows] of byNode) {
    summaries.set(nodeId, foldRiskRows(nodeRows));
  }

  return summaries;
}

/** Single-node convenience for the detail screens. */
async function riskSummaryFor(
  nodeId: Types.ObjectId,
  kind: 'SUBTREE' | 'FLOOR',
): Promise<RiskSummaryDto> {
  const summaries = await riskSummariesFor([nodeId], kind);
  return summaries.get(String(nodeId)) ?? EMPTY_RISK_SUMMARY;
}

/**
 * Reasons a node may not be deleted.
 *
 * Empty means deletion is allowed. Anything with children, linked objects, planned work or
 * service requests is archived instead, so history is never orphaned.
 */
async function deleteBlockersFor(node: Doc<IObjectNode>): Promise<string[]> {
  const blockers: string[] = [];

  const children = await ObjectNode.countDocuments({ parent: node._id });
  if (children > 0) {
    const label = node.kind === 'PROJECT' ? 'барилга' : 'давхар';
    blockers.push(`${children} ${label} бүртгэлтэй.`);
  }

  if (node.kind === 'FLOOR') {
    const linked = await ObjectRecord.countDocuments({ floor: node._id });
    if (linked > 0) blockers.push(`${linked} объект холбогдсон.`);

    const plan = await FloorPlan.countDocuments({ floor: node._id });
    if (plan > 0) blockers.push('План зураг хавсаргасан.');
  } else {
    const counts = await countsUnder(node._id);
    if (counts.objects > 0) blockers.push(`${counts.objects} объект холбогдсон.`);
  }

  const [plannedWork, requests] = await Promise.all([
    PlannedWork.countDocuments(
      node.kind === 'PROJECT'
        ? { project: node._id }
        : node.kind === 'BUILDING'
          ? { building: node._id }
          : { _id: null },
    ),
    ServiceRequest.countDocuments(
      node.kind === 'PROJECT'
        ? { project: node._id }
        : node.kind === 'BUILDING'
          ? { building: node._id }
          : { floor: node._id },
    ),
  ]);

  if (plannedWork > 0) blockers.push(`${plannedWork} төлөвлөгөөт ажилд ашиглагдсан.`);
  if (requests > 0) blockers.push(`${requests} үйлчилгээний хүсэлтэд ашиглагдсан.`);

  return blockers;
}

// -- Mapping -----------------------------------------------------------------

export async function toProjectDto(
  node: Doc<IObjectNode>,
  riskSummary: RiskSummaryDto,
): Promise<ProjectDto> {
  const counts = await countsUnder(node._id);

  return {
    id: String(node._id),
    code: node.code,
    name: node.name,
    customerId: refId(node.customer),
    customerName: refName(node.customer),
    contractNumber: node.attributes.contractNumber ?? null,
    responsibleEmployeeId: node.attributes.responsibleEmployee
      ? refId(node.attributes.responsibleEmployee)
      : null,
    responsibleEmployeeName: employeeName(node.attributes.responsibleEmployee),
    startDate: node.attributes.startDate?.toISOString() ?? null,
    endDate: node.attributes.endDate?.toISOString() ?? null,
    description: node.description,
    isActive: node.isActive,
    buildingCount: counts.buildings,
    floorCount: counts.floors,
    objectCount: counts.objects,
    riskSummary,
    rollup: await rollupOf(node._id),
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    deleteBlockers: await deleteBlockersFor(node),
  };
}

export async function toBuildingDto(
  node: Doc<IObjectNode>,
  riskSummary: RiskSummaryDto,
): Promise<BuildingDto> {
  const counts = await countsUnder(node._id);

  return {
    id: String(node._id),
    code: node.code,
    name: node.name,
    projectId: node.parent ? refId(node.parent) : '',
    projectName: refName(node.parent),
    customerId: refId(node.customer),
    address: node.attributes.address ?? null,
    gpsLatitude: node.attributes.gpsLatitude ?? null,
    gpsLongitude: node.attributes.gpsLongitude ?? null,
    description: node.description,
    isActive: node.isActive,
    floorCount: counts.floors,
    objectCount: counts.objects,
    riskSummary,
    rollup: await rollupOf(node._id),
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    deleteBlockers: await deleteBlockersFor(node),
  };
}

export async function toFloorDto(
  node: Doc<IObjectNode>,
  riskSummary: RiskSummaryDto,
): Promise<FloorDto> {
  const [objectCount, plan] = await Promise.all([
    ObjectRecord.countDocuments({ floor: node._id }),
    FloorPlan.findOne({ floor: node._id }).select('_id'),
  ]);

  // ancestors is [project, building] for a floor, so the project is the first entry.
  const projectId = node.ancestors[0] ? String(node.ancestors[0]) : '';

  return {
    id: String(node._id),
    code: node.code,
    name: node.name,
    buildingId: node.parent ? refId(node.parent) : '',
    buildingName: refName(node.parent),
    projectId,
    projectName: null,
    customerId: refId(node.customer),
    floorNumber: node.attributes.floorNumber ?? null,
    areaSqm: node.attributes.areaSqm ?? null,
    purpose: node.attributes.purpose ?? null,
    description: node.description,
    isActive: node.isActive,
    hasPlanImage: plan !== null,
    objectCount,
    riskSummary,
    rollup: await rollupOf(node._id),
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
    deleteBlockers: await deleteBlockersFor(node),
  };
}

// -- Project -----------------------------------------------------------------

export async function listProjects(
  query: ProjectListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<PaginatedData<ProjectDto>> {
  // The scope predicate replaces the old `query.customerId` filter outright. For staff the
  // resolver has already folded the requested id into the scope, so filtering is unchanged;
  // for a customer the requested id was discarded and their own tenant is forced here.
  const filter: FilterQuery<IObjectNode> = { kind: 'PROJECT', ...customerScopeFilter(scope) };
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [{ name: pattern }, { code: pattern }];
  }

  const sortField = query.sortBy === 'startDate' ? 'attributes.startDate' : query.sortBy;
  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    ObjectNode.find(filter)
      .populate([
        { path: 'customer', select: 'name' },
        { path: 'attributes.responsibleEmployee', select: 'firstName lastName' },
      ])
      .sort({ [sortField]: query.sortDir === 'asc' ? 1 : -1 })
      .skip(skip)
      .limit(query.limit),
    ObjectNode.countDocuments(filter),
  ]);

  const summaries = await riskSummariesFor(rows.map((row) => row._id), 'SUBTREE');

  return {
    items: await Promise.all(
      rows.map((row) => toProjectDto(row, summaries.get(String(row._id)) ?? EMPTY_RISK_SUMMARY)),
    ),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

async function loadProject(
  projectId: string,
  scope: ResolvedCustomerScope,
): Promise<Doc<IObjectNode>> {
  const node = await ObjectNode.findOne({
    _id: projectId,
    kind: 'PROJECT',
    ...customerScopeFilter(scope),
  }).populate([
    { path: 'customer', select: 'name' },
    { path: 'attributes.responsibleEmployee', select: 'firstName lastName' },
  ]);
  if (!node) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Төсөл олдсонгүй.');
  }
  return node;
}

export async function getProjectById(
  projectId: string,
  scope: ResolvedCustomerScope,
): Promise<ProjectDto> {
  const node = await loadProject(projectId, scope);
  return toProjectDto(node, await riskSummaryFor(node._id, 'SUBTREE'));
}

export async function createProject(
  input: CreateProjectInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ProjectDto> {
  // The owner comes from the scope, not from the payload. A customer sending another
  // organisation's id is refused rather than silently rewritten.
  const ownerCustomerId = resolveOwnerCustomerId(scope, input.customerId);

  const customer = await Customer.findById(ownerCustomerId).select('_id isActive');
  if (!customer) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Харилцагч олдсонгүй.', [
      { field: 'customerId', message: 'Харилцагч олдсонгүй.' },
    ]);
  }

  await assertCodeAvailable(customer._id, input.code);

  if (input.responsibleEmployeeId) {
    const employee = await Employee.findById(input.responsibleEmployeeId).select('_id');
    if (!employee) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Хариуцагч ажилтан олдсонгүй.', [
        { field: 'responsibleEmployeeId', message: 'Ажилтан олдсонгүй.' },
      ]);
    }
  }

  const node = await ObjectNode.create({
    kind: 'PROJECT',
    code: input.code,
    name: input.name,
    parent: null,
    customer: customer._id,
    ancestors: [],
    description: input.description ?? null,
    attributes: {
      contractNumber: input.contractNumber ?? null,
      responsibleEmployee: input.responsibleEmployeeId
        ? new Types.ObjectId(input.responsibleEmployeeId)
        : null,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
    },
    isActive: true,
  });

  await recordAudit({
    entityType: 'Project',
    entityId: node._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: { code: node.code, name: node.name },
  });

  return getProjectById(String(node._id), scope);
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ProjectDto> {
  // The update schema carries no `customerId`, so a project cannot be reassigned to
  // another tenant through this path; the scoped load is what stops one being edited.
  const node = await findNode(projectId, 'PROJECT', scope, 'Төсөл олдсонгүй.');
  const before = { code: node.code, name: node.name, isActive: node.isActive };

  if (input.code !== undefined && input.code !== node.code) {
    await assertCodeAvailable(node.customer, input.code, node._id);
    node.code = input.code;
  }
  if (input.name !== undefined) node.name = input.name;
  if (input.description !== undefined) node.description = input.description ?? null;
  if (input.isActive !== undefined) node.isActive = input.isActive;

  if (input.contractNumber !== undefined) {
    node.attributes.contractNumber = input.contractNumber ?? null;
  }
  if (input.responsibleEmployeeId !== undefined) {
    node.attributes.responsibleEmployee = input.responsibleEmployeeId
      ? new Types.ObjectId(input.responsibleEmployeeId)
      : null;
  }
  if (input.startDate !== undefined) {
    node.attributes.startDate = input.startDate ? new Date(input.startDate) : null;
  }
  if (input.endDate !== undefined) {
    node.attributes.endDate = input.endDate ? new Date(input.endDate) : null;
  }

  const start = node.attributes.startDate;
  const end = node.attributes.endDate;
  if (start && end && end.getTime() < start.getTime()) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Дуусах огноо эхлэх огнооноос эрт байж болохгүй.',
      [{ field: 'endDate', message: 'Огнооны дараалал буруу.' }],
    );
  }

  node.markModified('attributes');
  await node.save();

  await recordAudit({
    entityType: 'Project',
    entityId: node._id,
    action: input.isActive !== undefined && input.isActive !== before.isActive
      ? 'StatusChanged'
      : 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: before,
    newValue: { code: node.code, name: node.name, isActive: node.isActive },
  });

  return getProjectById(projectId, scope);
}

export async function deleteProject(
  projectId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  const node = await findNode(projectId, 'PROJECT', scope, 'Төсөл олдсонгүй.');
  const blockers = await deleteBlockersFor(node);

  if (blockers.length > 0) {
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      `Хамааралтай бичлэгтэй тул устгах боломжгүй. ${blockers.join(' ')} Архивлана уу.`,
    );
  }

  await ObjectNode.deleteOne({ _id: node._id });

  await recordAudit({
    entityType: 'Project',
    entityId: node._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'project deleted',
    oldValue: { code: node.code, name: node.name },
  });
}

// -- Building ----------------------------------------------------------------

export async function listBuildings(
  query: BuildingListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<PaginatedData<BuildingDto>> {
  const filter: FilterQuery<IObjectNode> = { kind: 'BUILDING', ...customerScopeFilter(scope) };
  if (query.projectId) filter.parent = new Types.ObjectId(query.projectId);
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [{ name: pattern }, { code: pattern }];
  }

  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await Promise.all([
    ObjectNode.find(filter)
      .populate({ path: 'parent', select: 'name' })
      .sort({ name: 1 })
      .skip(skip)
      .limit(query.limit),
    ObjectNode.countDocuments(filter),
  ]);

  const summaries = await riskSummariesFor(rows.map((row) => row._id), 'SUBTREE');

  return {
    items: await Promise.all(
      rows.map((row) => toBuildingDto(row, summaries.get(String(row._id)) ?? EMPTY_RISK_SUMMARY)),
    ),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getBuildingById(
  buildingId: string,
  scope: ResolvedCustomerScope,
): Promise<BuildingDto> {
  const node = await ObjectNode.findOne({
    _id: buildingId,
    kind: 'BUILDING',
    ...customerScopeFilter(scope),
  }).populate({ path: 'parent', select: 'name' });
  if (!node) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Барилга олдсонгүй.');
  }
  return toBuildingDto(node, await riskSummaryFor(node._id, 'SUBTREE'));
}

export async function createBuilding(
  input: CreateBuildingInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<BuildingDto> {
  // The parent is resolved inside the scope, so a caller cannot hang a building under
  // another tenant's project: an out-of-scope project simply does not resolve.
  const project = await findNode(input.projectId, 'PROJECT', scope, 'Төсөл олдсонгүй.');

  // An archived project must not accept new operational records.
  if (!project.isActive) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Архивласан төсөлд шинэ барилга нэмэх боломжгүй.',
      [{ field: 'projectId', message: 'Төсөл архивлагдсан.' }],
    );
  }

  await assertCodeAvailable(project.customer, input.code);

  const node = await ObjectNode.create({
    kind: 'BUILDING',
    code: input.code,
    name: input.name,
    parent: project._id,
    customer: project.customer,
    ancestors: [project._id],
    description: input.description ?? null,
    attributes: {
      address: input.address ?? null,
      gpsLatitude: input.gpsLatitude ?? null,
      gpsLongitude: input.gpsLongitude ?? null,
    },
    isActive: true,
  });

  await recordAudit({
    entityType: 'Building',
    entityId: node._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: { code: node.code, name: node.name, project: String(project._id) },
  });

  return getBuildingById(String(node._id), scope);
}

export async function updateBuilding(
  buildingId: string,
  input: UpdateBuildingInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<BuildingDto> {
  const node = await findNode(buildingId, 'BUILDING', scope, 'Барилга олдсонгүй.');
  const before = { code: node.code, name: node.name, isActive: node.isActive };

  if (input.code !== undefined && input.code !== node.code) {
    await assertCodeAvailable(node.customer, input.code, node._id);
    node.code = input.code;
  }
  if (input.name !== undefined) node.name = input.name;
  if (input.description !== undefined) node.description = input.description ?? null;
  if (input.isActive !== undefined) node.isActive = input.isActive;
  if (input.address !== undefined) node.attributes.address = input.address ?? null;
  if (input.gpsLatitude !== undefined) node.attributes.gpsLatitude = input.gpsLatitude ?? null;
  if (input.gpsLongitude !== undefined) node.attributes.gpsLongitude = input.gpsLongitude ?? null;

  node.markModified('attributes');
  await node.save();

  await recordAudit({
    entityType: 'Building',
    entityId: node._id,
    action: input.isActive !== undefined && input.isActive !== before.isActive
      ? 'StatusChanged'
      : 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: before,
    newValue: { code: node.code, name: node.name, isActive: node.isActive },
  });

  return getBuildingById(buildingId, scope);
}

export async function deleteBuilding(
  buildingId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  const node = await findNode(buildingId, 'BUILDING', scope, 'Барилга олдсонгүй.');
  const blockers = await deleteBlockersFor(node);

  if (blockers.length > 0) {
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      `Хамааралтай бичлэгтэй тул устгах боломжгүй. ${blockers.join(' ')} Архивлана уу.`,
    );
  }

  await ObjectNode.deleteOne({ _id: node._id });

  await recordAudit({
    entityType: 'Building',
    entityId: node._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'building deleted',
    oldValue: { code: node.code, name: node.name },
  });
}

// -- Floor -------------------------------------------------------------------

export async function listFloors(
  query: FloorListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<PaginatedData<FloorDto>> {
  const filter: FilterQuery<IObjectNode> = { kind: 'FLOOR', ...customerScopeFilter(scope) };
  if (query.buildingId) filter.parent = new Types.ObjectId(query.buildingId);
  if (query.projectId) filter.ancestors = new Types.ObjectId(query.projectId);
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [{ name: pattern }, { code: pattern }];
  }

  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await Promise.all([
    ObjectNode.find(filter)
      .populate({ path: 'parent', select: 'name' })
      .sort({ 'attributes.floorNumber': 1, name: 1 })
      .skip(skip)
      .limit(query.limit),
    ObjectNode.countDocuments(filter),
  ]);

  const summaries = await riskSummariesFor(rows.map((row) => row._id), 'FLOOR');
  let items = await Promise.all(
    rows.map((row) => toFloorDto(row, summaries.get(String(row._id)) ?? EMPTY_RISK_SUMMARY)),
  );

  // Plan presence is a derived flag, so it is filtered after mapping rather than in the
  // query. The list is bounded by the page size, so this stays cheap.
  if (query.hasPlanImage !== undefined) {
    items = items.filter((item) => item.hasPlanImage === query.hasPlanImage);
  }

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getFloorById(
  floorId: string,
  scope: ResolvedCustomerScope,
): Promise<FloorDto> {
  const node = await ObjectNode.findOne({
    _id: floorId,
    kind: 'FLOOR',
    ...customerScopeFilter(scope),
  }).populate({ path: 'parent', select: 'name' });
  if (!node) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Давхар олдсонгүй.');
  }

  const dto = await toFloorDto(node, await riskSummaryFor(node._id, 'FLOOR'));
  const project = node.ancestors[0]
    ? await ObjectNode.findById(node.ancestors[0]).select('name')
    : null;

  return { ...dto, projectName: project?.name ?? null };
}

export async function createFloor(
  input: CreateFloorInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<FloorDto> {
  // As with a building, the parent is resolved inside the scope, so a floor cannot be
  // added to another tenant's building.
  const building = await findNode(input.buildingId, 'BUILDING', scope, 'Барилга олдсонгүй.');

  if (!building.isActive) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Архивласан барилгад шинэ давхар нэмэх боломжгүй.',
      [{ field: 'buildingId', message: 'Барилга архивлагдсан.' }],
    );
  }

  await assertCodeAvailable(building.customer, input.code);

  const node = await ObjectNode.create({
    kind: 'FLOOR',
    code: input.code,
    name: input.name,
    parent: building._id,
    customer: building.customer,
    ancestors: [...building.ancestors, building._id],
    description: input.description ?? null,
    attributes: {
      floorNumber: input.floorNumber ?? null,
      areaSqm: input.areaSqm ?? null,
      purpose: input.purpose ?? null,
    },
    isActive: true,
  });

  await recordAudit({
    entityType: 'Floor',
    entityId: node._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: { code: node.code, name: node.name, building: String(building._id) },
  });

  return getFloorById(String(node._id), scope);
}

export async function updateFloor(
  floorId: string,
  input: UpdateFloorInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<FloorDto> {
  const node = await findNode(floorId, 'FLOOR', scope, 'Давхар олдсонгүй.');
  const before = { code: node.code, name: node.name, isActive: node.isActive };

  if (input.code !== undefined && input.code !== node.code) {
    await assertCodeAvailable(node.customer, input.code, node._id);
    node.code = input.code;
  }
  if (input.name !== undefined) node.name = input.name;
  if (input.description !== undefined) node.description = input.description ?? null;
  if (input.isActive !== undefined) node.isActive = input.isActive;
  if (input.floorNumber !== undefined) node.attributes.floorNumber = input.floorNumber ?? null;
  if (input.areaSqm !== undefined) node.attributes.areaSqm = input.areaSqm ?? null;
  if (input.purpose !== undefined) node.attributes.purpose = input.purpose ?? null;

  node.markModified('attributes');
  await node.save();

  await recordAudit({
    entityType: 'Floor',
    entityId: node._id,
    action: input.isActive !== undefined && input.isActive !== before.isActive
      ? 'StatusChanged'
      : 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: before,
    newValue: { code: node.code, name: node.name, isActive: node.isActive },
  });

  return getFloorById(floorId, scope);
}

export async function deleteFloor(
  floorId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  const node = await findNode(floorId, 'FLOOR', scope, 'Давхар олдсонгүй.');
  const blockers = await deleteBlockersFor(node);

  if (blockers.length > 0) {
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      `Хамааралтай бичлэгтэй тул устгах боломжгүй. ${blockers.join(' ')} Архивлана уу.`,
    );
  }

  await ObjectNode.deleteOne({ _id: node._id });

  await recordAudit({
    entityType: 'Floor',
    entityId: node._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'floor deleted',
    oldValue: { code: node.code, name: node.name },
  });
}

export { descendantIds };
