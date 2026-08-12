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
import { Counter, nextSequenceValue } from '../../common/models/counter.model';
import {
  customerScopeFilter,
  resolveOwnerCustomerId,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import type { AuthContext } from '../../common/types/express';
import { CREATOR_POPULATE, creatorName } from '../../common/utils/creator.util';
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

/**
 * The prefix each generated code carries, and the only place the vocabulary is written
 * down.
 *
 * These three are what keep the kinds apart in a namespace that does NOT separate them:
 * the unique index is `{ customer, code }` with no `kind` in it, so every project,
 * building and floor of one customer draws from one pool of strings. Numbering each kind
 * from 1 is only safe because `PRJ-001`, `BLD-001` and `FLR-001` cannot collide.
 */
const CODE_PREFIXES = { PROJECT: 'PRJ', BUILDING: 'BLD', FLOOR: 'FLR' } as const;

type GeneratedCodeKind = keyof typeof CODE_PREFIXES;

/**
 * How many times a code may be re-drawn before the attempt is abandoned.
 *
 * Each retry advances the atomic counter, so the candidates never repeat and the loop is
 * making real progress rather than spinning; the bound exists so a collection full of
 * hand-typed `PRJ-001`..`PRJ-020` fails with a sentence instead of looping forever.
 */
const MAX_CODE_ATTEMPTS = 25;

/** Numbered per customer per kind, because the unique index is per customer. */
function codeCounterKey(customerId: Types.ObjectId, kind: GeneratedCodeKind): string {
  return `object-node-code:${String(customerId)}:${kind}`;
}

/**
 * Brings a fresh counter up to what this customer already has.
 *
 * Codes were typed by hand before this existed, and the dev seed still writes `PRJ-1`, so
 * a counter starting from zero would offer a code the customer is already using. The scan
 * runs once per (customer, kind): after the counter document exists it is never repeated,
 * so creating in a loop costs one atomic increment apiece.
 *
 * `$max` rather than `$set` is what makes the seed safe against a concurrent allocation.
 * If a create has already pushed the counter past the scanned maximum, `$max` leaves it
 * alone; two seeds racing each other are idempotent for the same reason.
 *
 * Only codes in the generated SHAPE are scanned. A customer whose buildings are called
 * `A-WING` and `TOWER-2` has nothing to teach a counter that issues `BLD-007`, and those
 * codes stay exactly as they are — the collision check below is what protects them.
 */
async function seedCodeCounter(
  key: string,
  customerId: Types.ObjectId,
  kind: GeneratedCodeKind,
): Promise<void> {
  if (await Counter.exists({ key })) return;

  const prefix = CODE_PREFIXES[kind];
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const existing = await ObjectNode.find({
    customer: customerId,
    kind,
    code: pattern,
  }).select('code');

  let highest = 0;
  for (const row of existing) {
    const match = pattern.exec(row.code);
    const value = match ? Number(match[1]) : 0;
    if (Number.isSafeInteger(value) && value > highest) highest = value;
  }
  if (highest === 0) return;

  await Counter.updateOne({ key }, { $max: { value: highest } }, { upsert: true });
}

/**
 * The next free code for a customer's next project, building or floor.
 *
 * RACE-FREE BY CONSTRUCTION. The number comes from the atomic counter — a single
 * `findOneAndUpdate` with `$inc`, which is atomic on a standalone mongod and needs no
 * transaction — so ten simultaneous creates are handed ten different numbers. Counting
 * existing rows instead would hand all ten the same one.
 *
 * DELETED CODES ARE NEVER REISSUED, and that falls out of the same design rather than
 * being a rule enforced somewhere: the counter only ever moves up, and it is not consulted
 * about what is still in the collection. Deleting `PRJ-004` leaves a gap, and the next
 * project is `PRJ-005`. A skipped candidate leaves the same kind of gap, which is the
 * behaviour invoice numbering here already lives with.
 *
 * The existence check on top of the counter covers what the counter cannot know: a code
 * typed by hand after the counter was seeded, or one belonging to a DIFFERENT kind, since
 * the index those share is per customer and blind to kind.
 */
async function allocateNodeCode(
  customerId: Types.ObjectId,
  kind: GeneratedCodeKind,
): Promise<string> {
  const key = codeCounterKey(customerId, kind);
  await seedCodeCounter(key, customerId, kind);

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const sequence = await nextSequenceValue(key);
    // Padded to three so a list sorts the way a reader expects for the first 999, and
    // simply grows past it — PRJ-1000 is ugly but correct, and truncating would collide.
    const candidate = `${CODE_PREFIXES[kind]}-${String(sequence).padStart(3, '0')}`;

    if (await ObjectNode.exists({ customer: customerId, code: candidate })) continue;
    return candidate;
  }

  throw AppError.conflict(
    ERROR_CODES.DUPLICATE_KEY,
    'Энэ харилцагчид чөлөөтэй код олдсонгүй.',
  );
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

/** What a node's direct children are called, for the "N x бүртгэлтэй" blocker. */
const CHILD_LABEL: Record<IObjectNode['kind'], string> = {
  CUSTOMER: 'төсөл',
  PROJECT: 'барилга',
  BUILDING: 'давхар',
  FLOOR: 'өрөө/бүс',
  ROOM: 'самбар',
  PANEL: 'хэлхээ',
  CIRCUIT: 'төхөөрөмж',
  DEVICE: 'дэд бүртгэл',
};

/**
 * Which location field on a service request points at a node of this kind.
 *
 * One map rather than a chain of conditionals: the chain read `PROJECT ? project : BUILDING
 * ? building : floor`, so a zone was checked against the `floor` field and its requests were
 * never found — deleting a referenced zone would have orphaned every one of them.
 */
const REQUEST_LOCATION_FIELD: Record<IObjectNode['kind'], string | null> = {
  CUSTOMER: null,
  PROJECT: 'project',
  BUILDING: 'building',
  FLOOR: 'floor',
  ROOM: 'room',
  PANEL: 'panel',
  CIRCUIT: 'circuit',
  DEVICE: 'device',
};

/**
 * Reasons a node may not be deleted.
 *
 * Empty means deletion is allowed. Anything with children, linked objects, planned work or
 * service requests is archived instead, so history is never orphaned.
 */
export async function deleteBlockersFor(node: Doc<IObjectNode>): Promise<string[]> {
  const blockers: string[] = [];

  const children = await ObjectNode.countDocuments({ parent: node._id });
  if (children > 0) {
    blockers.push(`${children} ${CHILD_LABEL[node.kind]} бүртгэлтэй.`);
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

  const requestField = REQUEST_LOCATION_FIELD[node.kind];

  const [plannedWork, requests] = await Promise.all([
    PlannedWork.countDocuments(
      node.kind === 'PROJECT'
        ? { project: node._id }
        : node.kind === 'BUILDING'
          ? { building: node._id }
          : { _id: null },
    ),
    requestField === null
      ? 0
      : ServiceRequest.countDocuments({ [requestField]: node._id }),
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
    createdByName: creatorName(node.createdBy),
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
    createdByName: creatorName(node.createdBy),
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
    createdByName: creatorName(node.createdBy),
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
        CREATOR_POPULATE,
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
    CREATOR_POPULATE,
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

  if (input.responsibleEmployeeId) {
    const employee = await Employee.findById(input.responsibleEmployeeId).select('_id');
    if (!employee) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Хариуцагч ажилтан олдсонгүй.', [
        { field: 'responsibleEmployeeId', message: 'Ажилтан олдсонгүй.' },
      ]);
    }
  }

  // Allocated last, after every other reason to reject the request has been ruled out: a
  // number drawn for a create that then fails validation is a number nobody ever sees.
  const code = await allocateNodeCode(customer._id, 'PROJECT');

  const node = await ObjectNode.create({
    kind: 'PROJECT',
    code,
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
    createdBy: new Types.ObjectId(actor.userId),
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
      .populate([{ path: 'parent', select: 'name' }, CREATOR_POPULATE])
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
  }).populate([{ path: 'parent', select: 'name' }, CREATOR_POPULATE]);
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

  // Allocated last, after every other reason to reject the request has been ruled out: a
  // number drawn for a create that then fails validation is a number nobody ever sees.
  const code = await allocateNodeCode(project.customer, 'BUILDING');

  const node = await ObjectNode.create({
    kind: 'BUILDING',
    code,
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
    createdBy: new Types.ObjectId(actor.userId),
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
      .populate([{ path: 'parent', select: 'name' }, CREATOR_POPULATE])
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
  }).populate([{ path: 'parent', select: 'name' }, CREATOR_POPULATE]);
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

  // Allocated last, after every other reason to reject the request has been ruled out: a
  // number drawn for a create that then fails validation is a number nobody ever sees.
  const code = await allocateNodeCode(building.customer, 'FLOOR');

  const node = await ObjectNode.create({
    kind: 'FLOOR',
    code,
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
    createdBy: new Types.ObjectId(actor.userId),
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
