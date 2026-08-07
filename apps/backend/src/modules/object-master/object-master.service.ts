import {
  LOAD_MEASUREMENT_KIND_LABELS,
  LOAD_MEASUREMENT_KIND_UNIT,
  LOAD_MEASUREMENT_UNIT_LABELS,
  RISK_LEVEL_LABELS,
  acceptsPhase,
  riskLevelFor,
  type LoadMeasurementDto,
  type ObjectIcon,
  type CreateObjectAssessmentInput,
  type CreateObjectInput,
  type LinkFloorObjectsInput,
  type ObjectAssessmentDto,
  type ObjectCodeSuggestionDto,
  type ObjectDetailDto,
  type ObjectHistoryDto,
  type ObjectHistoryEntryDto,
  type ObjectListItemDto,
  type ObjectListQueryInput,
  type ObjectPhotoDto,
  type ObjectRefDto,
  type PaginatedData,
  type UpdateObjectInput,
  type UpdateObjectPositionInput,
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
import { logger } from '../../config/logger';
import { AuditLog } from '../audit/audit-log.model';
import { recordAudit } from '../audit/audit.service';
import { notify } from '../notification/notification.service';
import { Employee } from '../employee/employee.model';
import { Customer, ObjectNode } from '../objects/object.models';
import { Report, ReportItem, type IReport } from '../report-record/report-record.model';
import { applyReportSafely, writeReport } from '../report-record/report-record.service';
import { recalculateFrom } from '../report-record/rollup.service';
import { ServiceRequest } from '../service-request/service-request.model';
import { getRiskBands } from '../settings/settings.service';
import { StoredFile, type IStoredFile } from '../storage/stored-file.model';
import { appendAssessmentHistory } from './assessment-history.service';
import { loadFiguresOf } from './load.service';
import { objectTypeIconUrl } from './object-type.service';
import {
  ObjectAssessment,
  ObjectRecord,
  ObjectType,
  type ILoadMeasurement,
  type IObject,
  type IObjectAssessment,
} from './object-master.models';

type Doc<T> = HydratedDocument<T>;

/** Narrows a possibly-unpopulated objectType reference to the fields the DTO needs. */
function populatedType(
  value: unknown,
): {
  _id: Types.ObjectId;
  code: string;
  name: string;
  icon: ObjectIcon;
  iconFile?: Types.ObjectId | null;
  generatesConclusion?: boolean;
  showOnPlan?: boolean;
} | null {
  if (typeof value !== 'object' || value === null || !('code' in value)) return null;
  return value as unknown as {
    _id: Types.ObjectId;
    code: string;
    name: string;
    icon: ObjectIcon;
    iconFile?: Types.ObjectId | null;
    generatesConclusion?: boolean;
    showOnPlan?: boolean;
  };
}

// -- Mapping -----------------------------------------------------------------

function photoDto(value: unknown): ObjectPhotoDto | null {
  if (typeof value !== 'object' || value === null || !('storageKey' in value)) return null;
  const file = value as unknown as Doc<IStoredFile>;
  return {
    id: String(file._id),
    name: file.originalName,
    downloadUrl: `/api/v1/files/${String(file._id)}`,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    uploadedByName: file.uploadedByName,
    uploadedAt: file.createdAt.toISOString(),
  };
}

function objectRef(value: unknown): ObjectRefDto | null {
  if (typeof value !== 'object' || value === null || !('category' in value)) return null;
  const node = value as { _id: Types.ObjectId; code: string; name: string; category: IObject['category'] };
  return { id: String(node._id), code: node.code, name: node.name, category: node.category };
}

function named(value: unknown): string | null {
  if (typeof value === 'object' && value !== null && 'name' in value) {
    return String((value as { name: string }).name);
  }
  return null;
}

const LIST_POPULATE = [
  // `iconFile` is projected, not populated: the DTO needs the id to build a download path
  // and nothing else about the file, so populating it would buy a lookup per row for data
  // no client reads.
  { path: 'objectType', select: 'code name icon iconFile generatesConclusion showOnPlan' },
  { path: 'customer', select: 'name' },
  { path: 'floor', select: 'name parent' },
] as const;

const PHOTO_SELECT = 'originalName mimeType sizeBytes uploadedByName storageKey createdAt';

export interface ListMappingContext {
  buildingNames: ReadonlyMap<string, string>;
}

export async function toObjectListItemDto(
  object: Doc<IObject>,
  context: ListMappingContext = { buildingNames: new Map() },
): Promise<ObjectListItemDto> {
  const figures = await loadFiguresOf(object);
  const floor = object.floor as unknown;
  const floorId = floor
    ? typeof floor === 'object' && '_id' in (floor as object)
      ? String((floor as { _id: Types.ObjectId })._id)
      : String(floor)
    : null;
  const parentId =
    typeof floor === 'object' && floor !== null && 'parent' in floor
      ? String((floor as { parent: Types.ObjectId | null }).parent ?? '')
      : '';

  const type = populatedType(object.objectType);

  return {
    id: String(object._id),
    code: object.code,
    name: object.name,
    category: object.category,
    objectType: type
      ? {
          id: String(type._id),
          code: type.code,
          name: type.name,
          icon: type.icon,
          // The custom SVG when the registry has one, null to fall back to `icon` above.
          // A projection that forgot the field reads as null, i.e. as the old behaviour.
          iconUrl: objectTypeIconUrl(type.iconFile ?? null),
          // The registry's own answer to "may this appear on a plan". Defaulted rather
          // than asserted: a projection that forgot the field must read as "not on the
          // plan", never as a marker drawn on the strength of an undefined.
          showOnPlan: type.showOnPlan === true,
        }
      : null,
    customerId: String(
      typeof object.customer === 'object' && object.customer !== null && '_id' in object.customer
        ? (object.customer as { _id: Types.ObjectId })._id
        : object.customer,
    ),
    customerName: named(object.customer),
    floorId,
    floorName: named(floor),
    buildingName: context.buildingNames.get(parentId) ?? null,
    // Carried on the list item, not only on the detail: the plan draws every marker from
    // one `GET /floors/:floorId/objects` call rather than fetching each object.
    planPosition: object.planPosition
      ? { x: object.planPosition.x, y: object.planPosition.y }
      : null,
    status: object.status,
    latestAssessment: object.latestAssessment
      ? {
          id: String(object.latestAssessment.assessment),
          score: object.latestAssessment.score,
          riskLevel: object.latestAssessment.riskLevel,
          assessedAt: object.latestAssessment.assessedAt.toISOString(),
          assessedByName: object.latestAssessment.assessedByName,
          conclusion: object.latestAssessment.conclusion,
          recommendation: object.latestAssessment.recommendation,
          repairRequired: object.latestAssessment.repairRequired,
          revisitRequired: object.latestAssessment.revisitRequired,
          revisitDate: object.latestAssessment.revisitDate?.toISOString() ?? null,
        }
      : null,
    calculatedLoad: figures.calculated,
    measuredLoadKw: object.measuredLoadKw,
    loadVariance: figures.variance,
    createdAt: object.createdAt.toISOString(),
  };
}

/** Building names for a batch of floors, so a list of N objects costs one extra query. */
async function buildingNamesForFloors(
  objects: readonly Doc<IObject>[],
): Promise<ReadonlyMap<string, string>> {
  const parentIds = new Set<string>();
  for (const object of objects) {
    const floor = object.floor as unknown;
    if (typeof floor === 'object' && floor !== null && 'parent' in floor) {
      const parent = (floor as { parent: Types.ObjectId | null }).parent;
      if (parent) parentIds.add(String(parent));
    }
  }
  if (parentIds.size === 0) return new Map();

  const buildings = await ObjectNode.find({
    _id: { $in: [...parentIds].map((id) => new Types.ObjectId(id)) },
  }).select('name');

  return new Map(buildings.map((building) => [String(building._id), building.name]));
}

// -- Validation --------------------------------------------------------------

async function resolveObjectType(
  objectTypeId: string,
  category: IObject['category'],
): Promise<Doc<import('./object-master.models').IObjectType>> {
  const type = await ObjectType.findById(objectTypeId);
  if (!type) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Тоноглолын төрөл олдсонгүй.', [
      { field: 'objectTypeId', message: 'Төрөл олдсонгүй.' },
    ]);
  }
  if (type.category !== category) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Сонгосон төрөл энэ ангилалд хамаарахгүй байна.',
      [{ field: 'objectTypeId', message: 'Ангилал таарахгүй.' }],
    );
  }
  // An archived type must not appear in a new operational selection.
  if (!type.isActive) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Идэвхгүй болгосон төрлийг шинэ объектод сонгох боломжгүй.',
      [{ field: 'objectTypeId', message: 'Төрөл идэвхгүй байна.' }],
    );
  }
  return type;
}

/** A floor must exist, be a FLOOR, be active, and belong to the object's customer. */
async function assertFloorUsable(floorId: string, customerId: Types.ObjectId): Promise<Types.ObjectId> {
  const floor = await ObjectNode.findById(floorId).select('kind customer isActive');
  if (!floor || floor.kind !== 'FLOOR') {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Давхар олдсонгүй.', [
      { field: 'floorId', message: 'Давхар олдсонгүй.' },
    ]);
  }
  if (String(floor.customer) !== String(customerId)) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Давхар нь объектын харилцагчид хамаарахгүй байна.',
      [{ field: 'floorId', message: 'Харилцагч таарахгүй.' }],
    );
  }
  if (!floor.isActive) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Архивласан давхарт объект холбох боломжгүй.',
      [{ field: 'floorId', message: 'Давхар архивлагдсан.' }],
    );
  }
  return floor._id;
}

/**
 * The building a floor stands in, or null when the object is not on a floor.
 *
 * A floor's building is normally its direct `parent`, which is what the `buildingId` list
 * filter above relies on, but the section 4 hierarchy admits a ROOM level and nothing stops
 * a deeper tree, so the whole ancestor chain is searched for the BUILDING node. This is the
 * same widening `assertFloorInBuilding` in planned-work applies when it accepts either
 * `parent` or an entry in `ancestors`.
 *
 * Null has one meaning here: "no building could be established for this end". A floorless
 * object and a floor whose chain carries no BUILDING both produce it, and both are treated
 * the same way by the caller.
 */
async function buildingOfFloor(floorId: Types.ObjectId | null): Promise<Types.ObjectId | null> {
  if (!floorId) return null;
  const floor = await ObjectNode.findById(floorId).select('parent ancestors');
  if (!floor) return null;

  const candidates = [...(floor.parent ? [floor.parent] : []), ...floor.ancestors];
  if (candidates.length === 0) return null;

  const building = await ObjectNode.findOne({ _id: { $in: candidates }, kind: 'BUILDING' }).select(
    '_id',
  );
  return building?._id ?? null;
}

/**
 * Both ends of an object-to-object connection must stand in the same building.
 *
 * A circuit is fed by a panel in its own building and a device hangs off a circuit in its
 * own building; a cable does not run between two towers. Without this a customer with
 * twelve buildings could feed a second-floor socket from a panel across the site, and every
 * load figure, single-line trace and panel ratio derived from the link would describe wiring
 * that does not exist.
 *
 * THE FLOORLESS RULE: a connection is refused only when BOTH ends resolve to a building and
 * the two differ. An object with no floor has no building, so there is no conflict to
 * detect — refusing it instead would break the documented workflow the create schema is
 * built around, where an object is registered in the master list before it is placed
 * (`floorId` is nullish, and `/objects/new` offers the floor as an optional choice). The
 * check therefore constrains assets that HAVE a building rather than demanding that every
 * asset have one. The same silence applies when a floor's chain carries no BUILDING node:
 * there is nothing to compare, and an incomplete hierarchy is not the caller's fault.
 */
async function assertSameBuilding(
  ownerBuildingId: Types.ObjectId | null,
  related: Pick<IObject, 'floor'>,
  field: string,
): Promise<void> {
  if (!ownerBuildingId || !related.floor) return;

  const relatedBuildingId = await buildingOfFloor(related.floor);
  if (!relatedBuildingId) return;
  if (String(relatedBuildingId) === String(ownerBuildingId)) return;

  throw AppError.badRequest(
    ERROR_CODES.VALIDATION_ERROR,
    'Холбогдох объект өөр барилгад байрлаж байна.',
    [{ field, message: 'Зөвхөн нэг барилгын объектыг холбоно.' }],
  );
}

/**
 * A referenced object must exist, share the customer, be of the expected category, be in
 * service, and stand in the same building as the object referencing it.
 *
 * `ownerBuildingId` is the ALREADY-RESOLVED building of the referencing object, not a floor
 * id the caller sent: the create and update paths have each established the floor the object
 * will actually sit on by the time they get here, so matching against it is matching against
 * the stored state rather than against a hint from the client.
 */
async function assertRelatedObject(
  relatedId: string,
  expected: IObject['category'],
  customerId: Types.ObjectId,
  field: string,
  ownerBuildingId: Types.ObjectId | null,
): Promise<Types.ObjectId> {
  const related = await ObjectRecord.findById(relatedId).select('category customer status floor');
  if (!related || related.category !== expected) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Холбогдох объект олдсонгүй.', [
      { field, message: 'Объект олдсонгүй эсвэл ангилал таарахгүй.' },
    ]);
  }
  if (String(related.customer) !== String(customerId)) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Холбогдох объект өөр харилцагчид хамаарч байна.',
      [{ field, message: 'Харилцагч таарахгүй.' }],
    );
  }
  if (related.status === 'DECOMMISSIONED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Ашиглалтаас гарсан объектод холбох боломжгүй.',
      [{ field, message: 'Объект ашиглалтаас гарсан.' }],
    );
  }
  await assertSameBuilding(ownerBuildingId, related, field);
  return related._id;
}

// -- Read --------------------------------------------------------------------

/**
 * Lists objects inside the caller's scope.
 *
 * The scope predicate replaces the old `query.customerId` filter. For staff the resolver
 * has already folded the requested id into the scope, so filtering behaves exactly as
 * before; for a customer the id they sent was discarded and their own tenant is forced.
 */
export async function listObjects(
  query: ObjectListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<PaginatedData<ObjectListItemDto>> {
  const filter: FilterQuery<IObject> = { ...customerScopeFilter(scope) };

  if (query.category) filter.category = query.category;
  if (query.objectTypeId) filter.objectType = new Types.ObjectId(query.objectTypeId);
  if (query.status) filter.status = query.status;
  if (query.floorId) filter.floor = new Types.ObjectId(query.floorId);
  if (query.riskLevel) filter['latestAssessment.riskLevel'] = query.riskLevel;
  // The linking picker asks for objects not yet placed on any floor.
  if (query.unlinkedOnly) filter.floor = null;

  if (query.buildingId) {
    // Scoped as well, so a building id from another tenant resolves to no floors rather
    // than relying on the object-level predicate alone to catch it.
    const floors = await ObjectNode.find({
      kind: 'FLOOR',
      parent: new Types.ObjectId(query.buildingId),
      ...customerScopeFilter(scope),
    }).select('_id');
    filter.floor = { $in: floors.map((floor) => floor._id) };
  }

  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [{ name: pattern }, { code: pattern }];
  }

  const skip = (query.page - 1) * query.limit;
  const sort: Record<string, 1 | -1> = { [query.sortBy]: query.sortDir === 'asc' ? 1 : -1 };

  const [rows, total] = await Promise.all([
    ObjectRecord.find(filter).populate([...LIST_POPULATE]).sort(sort).skip(skip).limit(query.limit),
    ObjectRecord.countDocuments(filter),
  ]);

  const buildingNames = await buildingNamesForFloors(rows);
  const items = await Promise.all(
    rows.map((row) => toObjectListItemDto(row, { buildingNames })),
  );

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

/**
 * Loads one object inside the caller's scope.
 *
 * The ownership predicate is part of the query, so another tenant's object is reported as
 * not-found rather than forbidden: a forbidden reply would confirm the id exists and make
 * the endpoint an oracle for probing other organisations' identifiers.
 */
async function findObjectOrThrow(
  objectId: string,
  scope: ResolvedCustomerScope,
): Promise<Doc<IObject>> {
  const object = await ObjectRecord.findOne({
    _id: objectId,
    ...customerScopeFilter(scope),
  }).populate([
    ...LIST_POPULATE,
    { path: 'photos', select: PHOTO_SELECT },
    { path: 'circuit.panel', select: 'code name category' },
    { path: 'circuit.startPointObject', select: 'code name category' },
    { path: 'circuit.endPointObject', select: 'code name category' },
    { path: 'equipment.circuit', select: 'code name category' },
    { path: 'equipment.panel', select: 'code name category' },
  ]);
  if (!object) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Объект олдсонгүй.');
  return object;
}

/** Reasons deletion is refused. Empty means it is allowed. */
export async function deleteBlockersOf(object: Doc<IObject>): Promise<string[]> {
  const blockers: string[] = [];

  const assessments = await ObjectAssessment.countDocuments({ object: object._id });
  if (assessments > 0) {
    blockers.push(`${assessments} үнэлгээний бүртгэлтэй. Архивлана уу.`);
  }

  if (object.category === 'PANEL') {
    const circuits = await ObjectRecord.countDocuments({ 'circuit.panel': object._id });
    if (circuits > 0) blockers.push(`${circuits} хэлхээ энэ самбарт холбогдсон.`);

    // The same rule as the circuits above and as the circuit's own devices below: a
    // reference that would be left dangling blocks the delete rather than being cleared
    // behind the caller's back. A mounted device is as real a dependant as a circuit.
    const mounted = await ObjectRecord.countDocuments({ 'equipment.panel': object._id });
    if (mounted > 0) blockers.push(`${mounted} тоноглол энэ самбарт байрлаж байна.`);
  }

  if (object.category === 'CIRCUIT') {
    const fed = await ObjectRecord.countDocuments({ 'equipment.circuit': object._id });
    if (fed > 0) blockers.push(`${fed} тоноглол энэ хэлхээнд холбогдсон.`);
  }

  const referenced = await ObjectRecord.countDocuments({
    $or: [
      { 'circuit.startPointObject': object._id },
      { 'circuit.endPointObject': object._id },
    ],
  });
  if (referenced > 0) blockers.push(`${referenced} хэлхээний эхлэх/дуусах цэг болж байна.`);

  const requests = await ServiceRequest.countDocuments({ device: object._id });
  if (requests > 0) blockers.push(`${requests} үйлчилгээний хүсэлтэд холбогдсон.`);

  return blockers;
}

export async function getObjectById(
  objectId: string,
  scope: ResolvedCustomerScope,
): Promise<ObjectDetailDto> {
  const object = await findObjectOrThrow(objectId, scope);
  const buildingNames = await buildingNamesForFloors([object]);
  const base = await toObjectListItemDto(object, { buildingNames });
  const figures = await loadFiguresOf(object);

  const [childCircuits, childEquipment, mountedEquipment] = await Promise.all([
    object.category === 'PANEL'
      ? ObjectRecord.find({ 'circuit.panel': object._id }).populate([...LIST_POPULATE]).sort({ code: 1 })
      : Promise.resolve([]),
    object.category === 'CIRCUIT'
      ? ObjectRecord.find({ 'equipment.circuit': object._id })
          .populate([...LIST_POPULATE])
          .sort({ code: 1 })
      : Promise.resolve([]),
    // Devices bolted into this enclosure. Read by the same shape as the circuits beside
    // them, and independently of them: a device may be both mounted here and fed from a
    // circuit here, and it belongs in both lists rather than being deduplicated away.
    object.category === 'PANEL'
      ? ObjectRecord.find({ 'equipment.panel': object._id })
          .populate([...LIST_POPULATE])
          .sort({ code: 1 })
      : Promise.resolve([]),
  ]);

  const canAssess = populatedType(object.objectType)?.generatesConclusion === true;

  return {
    ...base,
    description: object.description,
    notes: object.notes,
    updatedAt: object.updatedAt.toISOString(),
    photos: object.photos
      .map(photoDto)
      .filter((photo): photo is ObjectPhotoDto => photo !== null),
    panel:
      object.category === 'PANEL'
        ? {
            capacityKw: object.panel?.capacityKw ?? null,
            location: object.panel?.location ?? null,
            protection: object.panel?.protection ?? null,
          }
        : null,
    circuit:
      object.category === 'CIRCUIT'
        ? {
            panel: objectRef(object.circuit?.panel),
            startPoint: objectRef(object.circuit?.startPointObject),
            endPoint: objectRef(object.circuit?.endPointObject),
            breakerRating: object.circuit?.breakerRating ?? null,
            cableType: object.circuit?.cableType ?? null,
            cableSectionMm2: object.circuit?.cableSectionMm2 ?? null,
            cableLengthM: object.circuit?.cableLengthM ?? null,
            permittedCapacityKw: object.circuit?.permittedCapacityKw ?? null,
          }
        : null,
    equipment:
      object.category === 'EQUIPMENT'
        ? {
            circuit: objectRef(object.equipment?.circuit),
            panel: objectRef(object.equipment?.panel),
            ratedPowerKw: object.equipment?.ratedPowerKw ?? null,
            quantity: object.equipment?.quantity ?? null,
            usageCoefficient: object.equipment?.usageCoefficient ?? null,
            installedAt: object.equipment?.installedAt?.toISOString() ?? null,
            warrantyUntil: object.equipment?.warrantyUntil?.toISOString() ?? null,
          }
        : null,
    childCircuits: await Promise.all(
      childCircuits.map((entry) => toObjectListItemDto(entry, { buildingNames })),
    ),
    childEquipment: await Promise.all(
      childEquipment.map((entry) => toObjectListItemDto(entry, { buildingNames })),
    ),
    mountedEquipment: await Promise.all(
      mountedEquipment.map((entry) => toObjectListItemDto(entry, { buildingNames })),
    ),
    loadPercent: figures.percent,
    reserveKw: figures.reserve,
    canAssess,
    deleteBlockers: await deleteBlockersOf(object),
  };
}

// -- Code suggestion ---------------------------------------------------------

/** Codes are stored in a 64-char field, and `-NN` has to fit inside it. */
const MAX_CODE_LENGTH = 64;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The next free code for something registered under a panel.
 *
 * ON THE SERVER, NOT IN THE FORM. Uniqueness is per customer and is enforced by an index
 * the client cannot see: a browser can only count the rows it happens to have fetched, so
 * a client-side guess would propose a code already taken by a device on another floor and
 * the user would discover it as a 409 after filling the whole form in. Asking the database
 * is the only way to answer the question the database is going to be asked.
 *
 * A SUGGESTION, NOT A RESERVATION. Nothing is written and nothing is locked. The field
 * stays editable, and two people opening the form at the same moment are both offered the
 * same code — the unique (customer, code) index is what actually decides, and the second
 * save is refused there exactly as it is today for a hand-typed duplicate.
 *
 * Derived as `<panel code>-NN` so a device's identifier reads as "the nth thing in
 * CT-LDB-1" without a lookup. The scan is bounded by the number of codes already in that
 * family, so a free one is always reached.
 */
export async function suggestObjectCode(
  panelId: string,
  scope: ResolvedCustomerScope,
): Promise<ObjectCodeSuggestionDto> {
  // Scoped, and narrowed to a PANEL: another tenant's panel — and any object that is not a
  // panel — reads as not found rather than as a source of codes.
  const panel = await ObjectRecord.findOne({
    _id: panelId,
    category: 'PANEL',
    ...customerScopeFilter(scope),
  }).select('code customer');
  if (!panel) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Самбар олдсонгүй.');

  // Room kept for the longest suffix the loop below can produce, and a trailing dash on
  // the panel's own code dropped so the result never reads `CT-LDB--01`.
  const base = panel.code.slice(0, MAX_CODE_LENGTH - 5).replace(/-+$/, '');

  const family = await ObjectRecord.find({
    customer: panel.customer,
    code: new RegExp(`^${escapeRegex(base)}-\\d+$`),
  }).select('code');
  const taken = new Set(family.map((entry) => entry.code));

  // One more candidate than there are taken codes in the family guarantees a free one.
  for (let sequence = 1; sequence <= taken.size + 1; sequence += 1) {
    const candidate = `${base}-${String(sequence).padStart(2, '0')}`;
    if (!taken.has(candidate)) return { code: candidate, basedOn: panel.code };
  }

  // Unreachable: the loop above runs once more than there are codes to collide with.
  throw AppError.conflict(ERROR_CODES.DUPLICATE_KEY, 'Чөлөөтэй код олдсонгүй.');
}

// -- Create and update -------------------------------------------------------

export async function createObject(
  input: CreateObjectInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ObjectDetailDto> {
  // The owner comes from the scope, not from the payload. Every downstream reference check
  // below compares against this id, so a floor, panel or circuit belonging to another
  // organisation is already refused by the existing same-customer guards.
  const ownerCustomerId = resolveOwnerCustomerId(scope, input.customerId);

  const customer = await Customer.findById(ownerCustomerId).select('_id');
  if (!customer) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Харилцагч олдсонгүй.', [
      { field: 'customerId', message: 'Харилцагч олдсонгүй.' },
    ]);
  }

  await resolveObjectType(input.objectTypeId, input.category);

  const duplicate = await ObjectRecord.findOne({
    customer: customer._id,
    code: input.code,
  }).select('_id');
  if (duplicate) {
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      'Энэ харилцагчид ижил кодтой объект бүртгэгдсэн байна.',
    );
  }

  const floorId = input.floorId ? await assertFloorUsable(input.floorId, customer._id) : null;
  // Resolved once and handed to every reference check below, so a three-reference circuit
  // costs one building lookup for itself rather than three.
  const ownerBuildingId = await buildingOfFloor(floorId);

  // The shared schema already refuses this combination; repeated here because the service
  // is the layer that owns the rule and a direct caller must not store a pin with no plan
  // behind it.
  if (input.planPosition && !floorId) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'План дээрх байрлалыг давхар сонгосон үед л тэмдэглэнэ.',
      [{ field: 'planPosition', message: 'Давхар сонгоно уу.' }],
    );
  }

  const payload: Record<string, unknown> = {
    code: input.code,
    name: input.name,
    category: input.category,
    objectType: new Types.ObjectId(input.objectTypeId),
    customer: customer._id,
    floor: floorId,
    planPosition: input.planPosition ?? null,
    status: 'ACTIVE',
    description: input.description ?? null,
    notes: input.notes ?? null,
    panel: null,
    circuit: null,
    equipment: null,
  };

  if (input.category === 'PANEL') {
    payload.panel = {
      capacityKw: input.panel.capacityKw ?? null,
      location: input.panel.location ?? null,
      protection: input.panel.protection ?? null,
    };
  } else if (input.category === 'CIRCUIT') {
    payload.circuit = {
      panel: input.circuit.panelId
        ? await assertRelatedObject(
            input.circuit.panelId,
            'PANEL',
            customer._id,
            'circuit.panelId',
            ownerBuildingId,
          )
        : null,
      startPointObject: input.circuit.startPointObjectId
        ? await assertRelatedObject(
            input.circuit.startPointObjectId,
            'PANEL',
            customer._id,
            'circuit.startPointObjectId',
            ownerBuildingId,
          )
        : null,
      endPointObject: input.circuit.endPointObjectId
        ? await assertRelatedObject(
            input.circuit.endPointObjectId,
            'EQUIPMENT',
            customer._id,
            'circuit.endPointObjectId',
            ownerBuildingId,
          )
        : null,
      breakerRating: input.circuit.breakerRating ?? null,
      cableType: input.circuit.cableType ?? null,
      cableSectionMm2: input.circuit.cableSectionMm2 ?? null,
      cableLengthM: input.circuit.cableLengthM ?? null,
      permittedCapacityKw: input.circuit.permittedCapacityKw ?? null,
    };
  } else {
    payload.equipment = {
      circuit: input.equipment.circuitId
        ? await assertRelatedObject(
            input.equipment.circuitId,
            'CIRCUIT',
            customer._id,
            'equipment.circuitId',
            ownerBuildingId,
          )
        : null,
      /**
       * The enclosure the device is mounted in, checked by exactly the same gate as every
       * other object→object reference: it must exist, be a PANEL, belong to this customer,
       * not be decommissioned, and stand in this object's building.
       *
       * Accepted alongside `circuitId` rather than instead of it. Nothing about this edge
       * feeds the load calculation — see the comment on `IEquipmentAttributes.panel`.
       */
      panel: input.equipment.panelId
        ? await assertRelatedObject(
            input.equipment.panelId,
            'PANEL',
            customer._id,
            'equipment.panelId',
            ownerBuildingId,
          )
        : null,
      ratedPowerKw: input.equipment.ratedPowerKw ?? null,
      quantity: input.equipment.quantity ?? null,
      usageCoefficient: input.equipment.usageCoefficient ?? null,
      installedAt: input.equipment.installedAt ? new Date(input.equipment.installedAt) : null,
      warrantyUntil: input.equipment.warrantyUntil ? new Date(input.equipment.warrantyUntil) : null,
    };
  }

  payload.createdBy = new Types.ObjectId(actor.userId);
  const object = await ObjectRecord.create(payload);

  await recordAudit({
    entityType: 'Object',
    entityId: object._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: { code: object.code, name: object.name, category: object.category },
  });

  return getObjectById(String(object._id), scope);
}

export async function updateObject(
  objectId: string,
  input: UpdateObjectInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ObjectDetailDto> {
  // The update schema carries no `customerId`, so an object cannot be reassigned to
  // another tenant; the scoped load is what stops another tenant's object being edited.
  const object = await ObjectRecord.findOne({ _id: objectId, ...customerScopeFilter(scope) });
  if (!object) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Объект олдсонгүй.');

  const before = {
    name: object.name,
    status: object.status,
    floor: object.floor ? String(object.floor) : null,
  };

  if (input.objectTypeId !== undefined) {
    await resolveObjectType(input.objectTypeId, object.category);
    object.objectType = new Types.ObjectId(input.objectTypeId);
  }
  if (input.name !== undefined) object.name = input.name;
  if (input.description !== undefined) object.description = input.description ?? null;
  if (input.notes !== undefined) object.notes = input.notes ?? null;
  if (input.status !== undefined) object.status = input.status;

  if (input.floorId !== undefined) {
    object.floor = input.floorId ? await assertFloorUsable(input.floorId, object.customer) : null;
    // Taking the object off the floor takes its pin with it: a coordinate on a plan the
    // object is no longer on points at nothing.
    if (!object.floor) object.planPosition = null;
  }

  if (input.planPosition !== undefined) {
    if (input.planPosition && !object.floor) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'План дээрх байрлалыг давхар сонгосон үед л тэмдэглэнэ.',
        [{ field: 'planPosition', message: 'Давхар сонгоно уу.' }],
      );
    }
    object.planPosition = input.planPosition ?? null;
  }

  /**
   * The building every reference below is judged against.
   *
   * Read AFTER `input.floorId` has been applied, so a request that moves the object and
   * re-points its panel in one go is judged against the floor it is actually landing on
   * rather than the one it is leaving. Resolved only when a reference could be written, so
   * a rename does not pay for two extra lookups.
   */
  const ownerBuildingId =
    input.circuit || input.equipment ? await buildingOfFloor(object.floor) : null;

  // Only the block belonging to this object's category is writable; the schema already
  // rejects the others, and this is the second gate.
  if (object.category === 'PANEL' && input.panel) {
    object.panel = {
      capacityKw: input.panel.capacityKw ?? object.panel?.capacityKw ?? null,
      location: input.panel.location ?? object.panel?.location ?? null,
      protection: input.panel.protection ?? object.panel?.protection ?? null,
    };
  }
  if (object.category === 'CIRCUIT' && input.circuit) {
    object.circuit = {
      panel: input.circuit.panelId
        ? await assertRelatedObject(
            input.circuit.panelId,
            'PANEL',
            object.customer,
            'circuit.panelId',
            ownerBuildingId,
          )
        : (object.circuit?.panel ?? null),
      startPointObject: input.circuit.startPointObjectId
        ? await assertRelatedObject(
            input.circuit.startPointObjectId,
            'PANEL',
            object.customer,
            'circuit.startPointObjectId',
            ownerBuildingId,
          )
        : (object.circuit?.startPointObject ?? null),
      endPointObject: input.circuit.endPointObjectId
        ? await assertRelatedObject(
            input.circuit.endPointObjectId,
            'EQUIPMENT',
            object.customer,
            'circuit.endPointObjectId',
            ownerBuildingId,
          )
        : (object.circuit?.endPointObject ?? null),
      breakerRating: input.circuit.breakerRating ?? object.circuit?.breakerRating ?? null,
      cableType: input.circuit.cableType ?? object.circuit?.cableType ?? null,
      cableSectionMm2: input.circuit.cableSectionMm2 ?? object.circuit?.cableSectionMm2 ?? null,
      cableLengthM: input.circuit.cableLengthM ?? object.circuit?.cableLengthM ?? null,
      permittedCapacityKw:
        input.circuit.permittedCapacityKw ?? object.circuit?.permittedCapacityKw ?? null,
    };
  }
  if (object.category === 'EQUIPMENT' && input.equipment) {
    object.equipment = {
      circuit: input.equipment.circuitId
        ? await assertRelatedObject(
            input.equipment.circuitId,
            'CIRCUIT',
            object.customer,
            'equipment.circuitId',
            ownerBuildingId,
          )
        : (object.equipment?.circuit ?? null),
      // Same "omitted means leave it alone" rule the circuit above follows, and the same
      // reference gate. A mount is never inferred from a circuit or vice versa.
      panel: input.equipment.panelId
        ? await assertRelatedObject(
            input.equipment.panelId,
            'PANEL',
            object.customer,
            'equipment.panelId',
            ownerBuildingId,
          )
        : (object.equipment?.panel ?? null),
      ratedPowerKw: input.equipment.ratedPowerKw ?? object.equipment?.ratedPowerKw ?? null,
      quantity: input.equipment.quantity ?? object.equipment?.quantity ?? null,
      usageCoefficient:
        input.equipment.usageCoefficient ?? object.equipment?.usageCoefficient ?? null,
      installedAt: input.equipment.installedAt
        ? new Date(input.equipment.installedAt)
        : (object.equipment?.installedAt ?? null),
      warrantyUntil: input.equipment.warrantyUntil
        ? new Date(input.equipment.warrantyUntil)
        : (object.equipment?.warrantyUntil ?? null),
    };
  }

  await object.save();

  await recordAudit({
    entityType: 'Object',
    entityId: object._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: before,
    newValue: {
      name: object.name,
      status: object.status,
      floor: object.floor ? String(object.floor) : null,
    },
  });

  return getObjectById(objectId, scope);
}

/**
 * Moves or clears the object's pin on the floor plan.
 *
 * Separate from `updateObject` so dragging a marker costs one small request instead of a
 * round trip through the strict per-category payload. The permission and the tenant scope
 * are the same as an update's: this writes to the object, so nothing about it is looser.
 */
export async function updateObjectPosition(
  objectId: string,
  input: UpdateObjectPositionInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ObjectDetailDto> {
  const object = await ObjectRecord.findOne({ _id: objectId, ...customerScopeFilter(scope) });
  if (!object) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Объект олдсонгүй.');

  if (input.planPosition && !object.floor) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'План дээрх байрлалыг давхарт холбогдсон объектод л тэмдэглэнэ.',
      [{ field: 'planPosition', message: 'Объект давхарт холбогдоогүй байна.' }],
    );
  }

  const before = object.planPosition
    ? { x: object.planPosition.x, y: object.planPosition.y }
    : null;

  object.planPosition = input.planPosition ?? null;
  await object.save();

  // Every other mutation in this module writes an audit row; moving equipment on the plan
  // is a change to the registration and is recorded the same way.
  await recordAudit({
    entityType: 'Object',
    entityId: object._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: input.planPosition ? 'plan position updated' : 'plan position cleared',
    oldValue: { planPosition: before },
    newValue: { planPosition: input.planPosition ?? null },
  });

  return getObjectById(objectId, scope);
}

export async function deleteObject(
  objectId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  const object = await ObjectRecord.findOne({ _id: objectId, ...customerScopeFilter(scope) });
  if (!object) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Объект олдсонгүй.');

  const blockers = await deleteBlockersOf(object);
  if (blockers.length > 0) {
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      `Хамааралтай бичлэгтэй тул устгах боломжгүй. ${blockers.join(' ')}`,
    );
  }

  await ObjectRecord.deleteOne({ _id: object._id });

  await recordAudit({
    entityType: 'Object',
    entityId: object._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'object deleted',
    oldValue: { code: object.code, name: object.name, category: object.category },
  });
}

// -- Floor linking -----------------------------------------------------------

/**
 * Links existing objects to a floor.
 *
 * The objects are never copied or re-created; only their `floor` reference moves. Moving
 * an object that already sat on another floor is audited on both sides so the history
 * shows where it came from.
 */
export async function linkObjectsToFloor(
  floorId: string,
  input: LinkFloorObjectsInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<number> {
  const floor = await ObjectNode.findOne({
    _id: floorId,
    kind: 'FLOOR',
    ...customerScopeFilter(scope),
  }).select('kind customer isActive name');
  if (!floor) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Давхар олдсонгүй.');
  }
  if (!floor.isActive) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Архивласан давхарт объект холбох боломжгүй.',
    );
  }

  const ids = input.objectIds.map((id) => new Types.ObjectId(id));
  // Scoped, so an object outside the caller's tenant is simply absent from the result and
  // reported as not found below rather than confirmed to exist.
  const objects = await ObjectRecord.find({ _id: { $in: ids }, ...customerScopeFilter(scope) });

  if (objects.length !== ids.length) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Зарим объект олдсонгүй.', [
      { field: 'objectIds', message: 'Объект олдсонгүй.' },
    ]);
  }

  for (const object of objects) {
    if (String(object.customer) !== String(floor.customer)) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        `"${object.name}" объект өөр харилцагчид хамаарч байна.`,
        [{ field: 'objectIds', message: 'Харилцагч таарахгүй.' }],
      );
    }
  }

  let linked = 0;
  for (const object of objects) {
    const previousFloor = object.floor ? String(object.floor) : null;
    if (previousFloor === String(floor._id)) continue;

    object.floor = floor._id;
    // The pin belonged to the floor it came from, so a move leaves the object unplaced on
    // the new plan rather than at the same fraction of a different drawing.
    object.planPosition = null;
    await object.save();
    linked += 1;

    await recordAudit({
      entityType: 'Object',
      entityId: object._id,
      action: 'Assigned',
      actor: { id: actor.userId, role: actor.role, label: actor.fullName },
      meta,
      reason: 'linked to floor',
      oldValue: { floor: previousFloor },
      newValue: { floor: String(floor._id), floorName: floor.name },
    });
  }

  return linked;
}

export async function unlinkObjectFromFloor(
  floorId: string,
  objectId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  const object = await ObjectRecord.findOne({
    _id: new Types.ObjectId(objectId),
    floor: new Types.ObjectId(floorId),
    ...customerScopeFilter(scope),
  });
  if (!object) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Энэ давхарт холбогдсон объект олдсонгүй.');
  }

  object.floor = null;
  // Unlinking removes the placement, and the pin is part of the placement.
  object.planPosition = null;
  await object.save();

  // The object itself survives: unlinking removes the placement, never the master record.
  await recordAudit({
    entityType: 'Object',
    entityId: object._id,
    action: 'Assigned',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'unlinked from floor',
    oldValue: { floor: floorId },
    newValue: { floor: null },
  });
}

// -- Assessment --------------------------------------------------------------

/**
 * Turns the submitted readings into what is stored, and resolves the one kW head.
 *
 * TWO HOMES, ONE FACT. `measuredLoadKw` is the authoritative summable figure — the floor
 * roll-up adds it and nothing else — and an `ACTIVE_POWER` reading is that same quantity
 * written in the readings list. Either may be supplied and each populates the other; both
 * supplied with different numbers is refused, never reconciled, so the two can not end up
 * disagreeing in the database and no entered figure is silently discarded.
 *
 * The kind/unit pairing is re-checked here even though `loadMeasurementSchema` already
 * checks it, for the same reason the evidence guard above is repeated: the service owns the
 * rule, and a caller that reaches it without going through the route must not be able to
 * store a current in kilowatts — a row that would then read as power everywhere.
 */
function resolveMeasurements(input: CreateObjectAssessmentInput): {
  measurements: ILoadMeasurement[];
  measuredLoadKw: number | null;
} {
  const issues: { field: string; message: string }[] = [];
  const measurements: ILoadMeasurement[] = (input.measurements ?? []).map((reading, index) => {
    const expected = LOAD_MEASUREMENT_KIND_UNIT[reading.kind];
    if (reading.unit !== expected) {
      issues.push({
        field: `measurements.${index}.unit`,
        message:
          `"${LOAD_MEASUREMENT_KIND_LABELS[reading.kind]}"-ыг зөвхөн ` +
          `${LOAD_MEASUREMENT_UNIT_LABELS[expected]} нэгжээр бүртгэнэ.`,
      });
    }
    return {
      kind: reading.kind,
      value: reading.value,
      unit: reading.unit,
      phase: acceptsPhase(reading.kind) ? (reading.phase ?? null) : null,
    };
  });

  const power = measurements.find((reading) => reading.kind === 'ACTIVE_POWER');
  const given = input.measuredLoadKw ?? null;

  if (power && given !== null && Math.abs(power.value - given) > 1e-6) {
    issues.push({
      field: 'measuredLoadKw',
      message: `Хэмжсэн ачаалал (${given} кВт) болон бүртгэсэн чадал (${power.value} кВт) зөрж байна.`,
    });
  }

  if (issues.length > 0) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Ачааллын хэмжилт шаардлага хангахгүй байна.',
      issues,
    );
  }

  return { measurements, measuredLoadKw: given ?? power?.value ?? null };
}

function measurementDto(reading: ILoadMeasurement): LoadMeasurementDto {
  return {
    kind: reading.kind,
    value: reading.value,
    unit: reading.unit,
    phase: reading.phase ?? null,
  };
}

function assessmentDto(entry: Doc<IObjectAssessment>): ObjectAssessmentDto {
  return {
    id: String(entry._id),
    objectId: String(entry.object),
    previousScore: entry.previousScore,
    newScore: entry.newScore,
    riskLevel: entry.riskLevel,
    assessedById: entry.assessedBy ? String(entry.assessedBy) : null,
    assessedByName: entry.assessedByName,
    judgedById: entry.judgedBy ? String(entry.judgedBy) : null,
    judgedByName: entry.judgedByName,
    assessedAt: entry.assessedAt.toISOString(),
    photos: entry.photos.map(photoDto).filter((photo): photo is ObjectPhotoDto => photo !== null),
    conclusion: entry.conclusion,
    recommendation: entry.recommendation,
    actionTaken: entry.actionTaken,
    measuredLoadKw: entry.measuredLoadKw,
    // Grandfathered rows predate the field and come back with an empty list, not a null.
    measurements: (entry.measurements ?? []).map(measurementDto),
    repairRequired: entry.repairRequired,
    revisitRequired: entry.revisitRequired,
    revisitDate: entry.revisitDate?.toISOString() ?? null,
    revisitOwnerName: entry.revisitOwnerName,
    sourceLabel: entry.sourceLabel,
    createdAt: entry.createdAt.toISOString(),
  };
}

/**
 * Records an assessment (requirements 9.2 and 10.1).
 *
 * Append-only: the previous entry is never touched. The band-conditional requirements of
 * section 10.1 are applied here rather than in the schema, because the bands are
 * configurable per section 16.1 and only the backend knows the current thresholds.
 */
export async function recordAssessment(
  objectId: string,
  input: CreateObjectAssessmentInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ObjectAssessmentDto> {
  const object = await ObjectRecord.findOne({
    _id: objectId,
    ...customerScopeFilter(scope),
  }).populate({
    path: 'objectType',
    select: 'generatesConclusion name',
  });
  if (!object) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Объект олдсонгүй.');

  if (populatedType(object.objectType)?.generatesConclusion !== true) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Энэ төрлийн объектод дүгнэлт бүртгэхээр тохируулагдаагүй байна.',
    );
  }

  /**
   * Evidence is required before anything else is judged.
   *
   * The create schema already refuses an empty list, so an HTTP caller never reaches
   * this; the guard is repeated here because the service is the layer that owns the
   * rule, and a caller reaching it directly must not be able to store a score with no
   * picture behind it. It is checked first so the reply names the missing evidence
   * rather than burying it under the band-conditional fields.
   */
  const photoIds = input.photoIds ?? [];
  if (photoIds.length === 0) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Үнэлгээнд нотлох зураг заавал хавсаргана.',
      [{ field: 'photoIds', message: 'Дор хаяж нэг зураг хавсаргана уу.' }],
    );
  }

  const photoObjectIds = photoIds.map((id) => new Types.ObjectId(id));
  const photoFiles = await StoredFile.find({
    _id: { $in: photoObjectIds },
    ownerType: 'OBJECT',
  }).select(PHOTO_SELECT);

  if (photoFiles.length !== photoObjectIds.length) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Хавсаргасан зураг олдсонгүй.',
      [{ field: 'photoIds', message: 'Зургийг дахин хуулна уу.' }],
    );
  }

  // Resolved once, before anything is written: every later use of the kW figure reads
  // `measuredLoadKw` from here rather than from `input`, so the reading list and the
  // summable head are decided in one place.
  const { measurements, measuredLoadKw } = resolveMeasurements(input);

  const bands = await getRiskBands();
  const riskLevel = riskLevelFor(input.newScore, bands);

  // Section 10.1 conditional requirements, keyed on the resolved band.
  const issues: { field: string; message: string }[] = [];
  const conclusion = input.conclusion?.trim() ?? '';
  const recommendation = input.recommendation?.trim() ?? '';

  if (riskLevel === 'CRITICAL' || riskLevel === 'OUT_OF_SERVICE') {
    if (!conclusion) issues.push({ field: 'conclusion', message: 'Улаан/хар төлөвт дүгнэлт заавал.' });
    if (!recommendation) {
      issues.push({ field: 'recommendation', message: 'Улаан/хар төлөвт зөвлөмж заавал.' });
    }
    if (!input.actionTaken?.trim()) {
      issues.push({ field: 'actionTaken', message: 'Улаан/хар төлөвт авах арга хэмжээ заавал.' });
    }
  } else if (riskLevel === 'ATTENTION' || riskLevel === 'SCHEDULE_REPAIR') {
    if (!recommendation) {
      issues.push({ field: 'recommendation', message: 'Шар/улбар шар төлөвт зөвлөмж заавал.' });
    }
    if (!input.revisitRequired && !input.repairRequired) {
      issues.push({
        field: 'revisitRequired',
        message: 'Шар/улбар шар төлөвт засвар эсвэл давтан үзлэгийн огноо заавал.',
      });
    }
  }

  if (issues.length > 0) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Үнэлгээний түвшинд шаардагдах мэдээлэл дутуу байна.',
      issues,
    );
  }

  let revisitOwnerName: string | null = null;
  if (input.revisitOwnerEmployeeId) {
    const employee = await Employee.findById(input.revisitOwnerEmployeeId).select(
      'firstName lastName',
    );
    if (!employee) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Хариуцагч ажилтан олдсонгүй.', [
        { field: 'revisitOwnerEmployeeId', message: 'Ажилтан олдсонгүй.' },
      ]);
    }
    revisitOwnerName = `${employee.lastName} ${employee.firstName}`.trim();
  }

  const now = new Date();
  const previousScore = object.latestAssessment?.score ?? null;

  // Through the shared writer, which is also what the report path now uses. No
  // `sourceReportItem`: a manual assessment is an event, not a correctable record, so it
  // deduplicates against nothing and every recording appends — exactly as before.
  const assessment = await appendAssessmentHistory({
    object: object._id,
    previousScore,
    newScore: input.newScore,
    riskLevel,
    assessedBy: new Types.ObjectId(actor.userId),
    assessedByName: actor.fullName,
    assessedAt: now,
    photos: photoObjectIds,
    conclusion: conclusion || null,
    recommendation: recommendation || null,
    actionTaken: input.actionTaken ?? null,
    measuredLoadKw,
    measurements,
    repairRequired: input.repairRequired,
    revisitRequired: input.revisitRequired,
    revisitDate: input.revisitDate ? new Date(input.revisitDate) : null,
    revisitOwner: input.revisitOwnerEmployeeId
      ? new Types.ObjectId(input.revisitOwnerEmployeeId)
      : null,
    revisitOwnerName,
    sourceLabel: null,
  });

  object.latestAssessment = {
    assessment: assessment._id,
    score: input.newScore,
    riskLevel,
    assessedAt: now,
    assessedByName: actor.fullName,
    conclusion: conclusion || null,
    recommendation: recommendation || null,
    repairRequired: input.repairRequired,
    revisitRequired: input.revisitRequired,
    revisitDate: input.revisitDate ? new Date(input.revisitDate) : null,
  };

  // Rule 17.16: the measured reading is stored on its own, never folded into the
  // calculated figure. Still kW-only: an amp or volt reading never moves this head, so the
  // floor roll-up that sums it is untouched by the readings list.
  if (measuredLoadKw !== null) {
    object.measuredLoadKw = measuredLoadKw;
  }

  // Rule 17.9: a black-band object must not remain in active use.
  if (riskLevel === 'OUT_OF_SERVICE' && object.status === 'ACTIVE') {
    object.status = 'DECOMMISSIONED';
  }

  await object.save();

  /**
   * Write-through to the unified report store, strictly after the assessment is durable.
   *
   * The ObjectAssessment row and the denormalised head above remain the record of what
   * happened; the Report row and the hierarchy figures are derived from it. Deriving
   * after the save means a failure here can only lose a derived view, never the
   * assessment itself — and it must not become an error reply, because the caller would
   * retry a request that already succeeded and record the assessment twice. Each step is
   * guarded on its own: the rollup reads `latestAssessment`, not the Report, so a failed
   * report write has no reason to leave the hierarchy stale as well.
   */
  try {
    const report = await writeReport({
      type: 'OBJECT_ASSESSMENT',
      // Authoritative the moment it is recorded: this path has no review step, and
      // landing it as anything but approved would invent one.
      status: 'APPROVED',
      title: `${object.name} — тоноглолын үнэлгээ`.slice(0, 200),
      // No sourceId: a manual assessment is an event, not a correctable record, so every
      // recording is its own report and nothing deduplicates a re-assessment.
      sourceType: 'MANUAL',
      sourceId: null,
      conclusion: conclusion || null,
      recommendation: recommendation || null,
      items: [
        {
          object: object._id,
          score: input.newScore,
          // The item's observation is what was done on the spot; the Дүгнэлт and Зөвлөмж
          // repeat the report's because a one-object report has nothing to split.
          observation: input.actionTaken ?? null,
          conclusion: conclusion || null,
          recommendation: recommendation || null,
          measuredLoadKw,
          evidenceAttachments: photoObjectIds,
        },
      ],
      actor: { id: new Types.ObjectId(actor.userId), name: actor.fullName },
      occurredAt: now,
    });
    await applyReportSafely(report._id);
  } catch (error) {
    logger.error({ err: error, objectId: String(object._id) }, 'Failed to write assessment report');
  }

  try {
    await recalculateFrom(object.floor);
  } catch (error) {
    logger.error({ err: error, objectId: String(object._id) }, 'Failed to recalculate rollup');
  }

  // The evidence was parked on the uploader; transfer ownership to the object so the
  // download permission check resolves against the real owning entity.
  await StoredFile.updateMany(
    {
      _id: { $in: photoObjectIds },
      ownerType: 'OBJECT',
      uploadedBy: new Types.ObjectId(actor.userId),
    },
    { $set: { ownerId: object._id } },
  );

  await recordAudit({
    entityType: 'Object',
    entityId: object._id,
    action: 'StatusChanged',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'assessment recorded',
    oldValue: { score: previousScore },
    newValue: {
      score: input.newScore,
      riskLevel,
      status: object.status,
      // The evidence is part of what was recorded, so the log carries it too.
      photos: photoIds,
    },
  });

  /**
   * Section 14.3 raises a notification once an object falls out of the green band, and
   * again when the conclusion asks for a repair or a revisit. The band comparison uses the
   * resolved level rather than a hardcoded score, so a re-banding in settings moves the
   * trigger with it.
   */
  if (riskLevel !== 'NORMAL') {
    await notify({
      event: 'RISK_ASSESSMENT_RAISED',
      title: `${object.name}: ${RISK_LEVEL_LABELS[riskLevel]} (${input.newScore}%)`,
      body: input.conclusion ?? null,
      entityType: 'Object',
      entityId: object._id,
      linkPath: object.floor ? `/floors/${String(object.floor)}/objects/${String(object._id)}` : null,
      permission: 'object_master.view',
      excludeUserId: actor.userId,
    });
  }

  if (input.repairRequired || input.revisitRequired) {
    await notify({
      event: input.repairRequired ? 'REPAIR_REQUIRED' : 'REVISIT_REQUIRED',
      title: input.repairRequired
        ? `${object.name}: засвар шаардлагатай`
        : `${object.name}: дахин үзлэг шаардлагатай`,
      body: input.recommendation ?? null,
      entityType: 'Object',
      entityId: object._id,
      linkPath: object.floor ? `/floors/${String(object.floor)}/objects/${String(object._id)}` : null,
      permission: 'object_master.view',
      excludeUserId: actor.userId,
    });
  }

  // The created document holds the photo ids only; the caller needs the file metadata,
  // and it was already read above, so it is mapped here rather than re-queried.
  return {
    ...assessmentDto(assessment),
    photos: photoFiles.map(photoDto).filter((photo): photo is ObjectPhotoDto => photo !== null),
  };
}

// -- History -----------------------------------------------------------------

/**
 * Consolidated object history.
 *
 * The findings all come from one place — the report items naming this equipment — so a
 * manual assessment, a planned-work result, a service conclusion and a consolidation
 * appear in the same timeline with the report's own type as the row kind. Reading the
 * producers separately is what this replaces: the service-request rows used to be looked
 * up by an id from a different collection and could never match. Audit rows stay as they
 * are, because they record changes to the registration rather than findings about it.
 */
export async function getObjectHistory(
  objectId: string,
  scope: ResolvedCustomerScope,
): Promise<ObjectHistoryDto> {
  const object = await ObjectRecord.findOne({
    _id: objectId,
    ...customerScopeFilter(scope),
  }).select('_id name');
  if (!object) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Объект олдсонгүй.');

  const [assessments, items, auditRows] = await Promise.all([
    ObjectAssessment.find({ object: object._id })
      .populate({ path: 'photos', select: PHOTO_SELECT })
      .sort({ assessedAt: -1 }),
    ReportItem.find({ object: object._id }).sort({ createdAt: -1 }).limit(100).lean(),
    AuditLog.find({ entityType: 'Object', entityId: object._id })
      .sort({ createdAt: -1 })
      .limit(100),
  ]);

  const reports = await Report.find({ _id: { $in: items.map((item) => item.report) } }).lean<
    (IReport & { _id: Types.ObjectId })[]
  >();
  const reportById = new Map(reports.map((report) => [String(report._id), report]));

  const timeline: ObjectHistoryEntryDto[] = [];

  for (const item of items) {
    const report = reportById.get(String(item.report));
    if (!report) continue;

    timeline.push({
      id: `REPORT:${String(item._id)}`,
      kind: report.type,
      occurredAt: report.occurredAt.toISOString(),
      title:
        item.score !== null
          ? `${report.reportNumber} · Үнэлгээ ${item.score}/100`
          : `${report.reportNumber} · ${report.title}`,
      // The per-object finding, falling back to the report-level narrative when the item
      // itself recorded none.
      detail: item.conclusion ?? report.conclusion,
      actorName: report.approvedByName ?? report.createdByName,
      newScore: item.score,
      riskLevel: item.riskLevel,
      linkPath:
        report.sourceType === 'PLANNED_WORK' && report.sourceId
          ? `/planned-work/${String(report.sourceId)}`
          : report.sourceType === 'SERVICE_REQUEST' && report.sourceId
            ? `/service-requests/${String(report.sourceId)}`
            : null,
    });

    // A load reading is its own event on the timeline rather than a detail of the finding:
    // it is the figure the floor load totals are built from, so it has to be traceable to
    // the visit that took it.
    if (item.measuredLoadKw !== null) {
      timeline.push({
        id: `MEASUREMENT:${String(item._id)}`,
        kind: 'MEASUREMENT',
        occurredAt: report.occurredAt.toISOString(),
        title: `Хэмжсэн ачаалал ${item.measuredLoadKw} кВт`,
        detail: null,
        actorName: report.approvedByName ?? report.createdByName,
      });
    }
  }

  for (const entry of auditRows) {
    timeline.push({
      id: `AUDIT:${String(entry._id)}`,
      kind: 'AUDIT',
      occurredAt: entry.createdAt.toISOString(),
      title: entry.action,
      detail: entry.reason,
      actorName: entry.userLabel,
      linkPath: null,
    });
  }

  timeline.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

  return { assessments: assessments.map(assessmentDto), timeline };
}
