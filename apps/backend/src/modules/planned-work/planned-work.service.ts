import {
  PERMISSIONS,
  progressPercentOf,
  riskLevelFor,
  type CreatePlannedWorkInput,
  type CreatePlannedWorkTaskInput,
  type PaginatedData,
  type PlannedWorkDto,
  type PlannedWorkListItemDto,
  type PlannedWorkListQueryInput,
  type PlannedWorkMaterialsInput,
  type PlannedWorkPauseDto,
  type PlannedWorkPhotoDto,
  type PlannedWorkScheduleChangeDto,
  type PlannedWorkTaskDto,
  type RecordTaskProgressInput,
  type ReschedulePlannedWorkInput,
  type UpdatePlannedWorkInput,
  type UpdatePlannedWorkTaskInput,
} from '@monhorus/shared';
import { Types, type FilterQuery, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import {
  customerScopeFilter,
  resolveCustomerScope,
} from '../../common/security/customer-scope';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { hasPermission } from '../../middlewares/authorize.middleware';
import { recordAudit } from '../audit/audit.service';
import { Employee } from '../employee/employee.model';
import { ObjectRecord } from '../object-master/object-master.models';
import { ObjectNode } from '../objects/object.models';
import { Team } from '../org/org.models';
import { getRiskBands } from '../settings/settings.service';
import { StoredFile, type IStoredFile } from '../storage/stored-file.model';
import { deleteStoredFile } from '../storage/storage.service';
import { plannedWorkMaterialsOf } from './planned-work.materials.service';
import {
  PlannedWork,
  PlannedWorkTask,
  nextWorkNumber,
  type IPlannedWork,
  type IPlannedWorkTask,
} from './planned-work.models';
import {
  clearOverdueAfterReschedule,
  effectiveStatusOf,
  markOverdueIfNeeded,
  reconcileOverdueForWorks,
} from './planned-work.overdue.service';
import {
  applyDerivedTaskState,
  completionBlockersOf,
  floorProgressOf,
  isIncludedTask,
  missingTaskEvidenceOf,
  recalculatePlannedWorkProgress,
  taskDurationMinutes,
} from './planned-work.progress.service';
import { loadReportState, reportStatusesFor, toReportDto } from './planned-work.report.service';
import {
  assertPlannedWorkAssignmentScope,
  isWithinAssignmentScope,
  resolveAssignedWorkFilter,
} from './planned-work.scope';
import { availableActionsFor } from './planned-work.transition.service';

/**
 * A loaded Mongoose document. `HydratedDocument` carries both the plain fields and the
 * document methods (`save`, `populate`), which a bare intersection with `_id` does not.
 */
type Doc<T> = HydratedDocument<T>;

/**
 * Planned work service (requirements section 7).
 *
 * Everything the client displays as progress or status comes from here. In particular
 * `effectiveStatus` and every progress figure are computed against server time and
 * stored quantities, never supplied by the caller.
 */

// -- Hierarchy validation ----------------------------------------------------

interface ResolvedLocation {
  projectId: Types.ObjectId | null;
  buildingId: Types.ObjectId;
  customerId: Types.ObjectId;
}

/**
 * Resolves and validates the project/building pair.
 *
 * The project is optional: internal maintenance, ad hoc jobs and work on a site with no
 * project anchor on the building alone, and the tenant then comes from the building.
 * When a project IS given the building must sit inside it, and the tenant comes from the
 * project. There is deliberately no check that the project has no other planned work: a
 * project may run any number of them concurrently.
 */
async function resolveLocation(
  projectId: string | null,
  buildingId: string,
): Promise<ResolvedLocation> {
  const building = await ObjectNode.findById(buildingId).select('kind parent ancestors customer');
  if (!building || building.kind !== 'BUILDING') {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Барилга олдсонгүй.', [
      { field: 'buildingId', message: 'Барилга олдсонгүй.' },
    ]);
  }

  if (!projectId) {
    return {
      projectId: null,
      buildingId: building._id,
      customerId: building.customer,
    };
  }

  const project = await ObjectNode.findById(projectId).select('kind customer isActive');
  if (!project || project.kind !== 'PROJECT') {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Төсөл олдсонгүй.', [
      { field: 'projectId', message: 'Төсөл олдсонгүй.' },
    ]);
  }

  const belongsToProject =
    String(building.parent) === String(project._id) ||
    building.ancestors.some((ancestor) => String(ancestor) === String(project._id));

  if (!belongsToProject) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Барилга сонгосон төсөлд хамаарахгүй байна.',
      [{ field: 'buildingId', message: 'Барилга төсөлд хамаарахгүй.' }],
    );
  }

  return {
    projectId: project._id,
    buildingId: building._id,
    customerId: project.customer,
  };
}

/** A task floor must sit inside the work's building. */
async function assertFloorInBuilding(
  floorId: string,
  buildingId: Types.ObjectId,
): Promise<Types.ObjectId> {
  const floor = await ObjectNode.findById(floorId).select('kind parent ancestors');
  if (!floor || floor.kind !== 'FLOOR') {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Давхар олдсонгүй.', [
      { field: 'floorId', message: 'Давхар олдсонгүй.' },
    ]);
  }

  const inBuilding =
    String(floor.parent) === String(buildingId) ||
    floor.ancestors.some((ancestor) => String(ancestor) === String(buildingId));

  if (!inBuilding) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Давхар сонгосон барилгад хамаарахгүй байна.',
      [{ field: 'floorId', message: 'Давхар барилгад хамаарахгүй.' }],
    );
  }

  return floor._id;
}

async function assertEmployeesExist(employeeIds: readonly string[]): Promise<Types.ObjectId[]> {
  if (employeeIds.length === 0) return [];
  const ids = employeeIds.map((id) => new Types.ObjectId(id));
  const found = await Employee.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ажилтан олдсонгүй.', [
      { field: 'assignedEmployeeIds', message: 'Сонгосон ажилтан олдсонгүй.' },
    ]);
  }
  return ids;
}

/**
 * The equipment a sub-task names, verified all the way down the hierarchy.
 *
 * Selection follows Project → Building → Floor → Equipment, and every link of that chain
 * is re-derived here from the ids the SERVER already trusts rather than from anything the
 * client sent. Two separate things are checked, because they fail differently:
 *
 *   1. TENANCY. The object must belong to the work's customer. Without this a sub-task
 *      could name another organisation's panel and the approved report would publish a
 *      finding onto equipment its owner never consented to have inspected.
 *   2. LOCATION. The object must sit on the sub-task's floor when the sub-task names one,
 *      and otherwise anywhere inside the work's building. Tenancy alone is not enough: a
 *      customer with twelve buildings would otherwise let a sub-task on the second floor
 *      of one tower report on a panel in another, and the finding would land in the wrong
 *      equipment history with the wrong location trail.
 *
 * `floorId` is the ALREADY-VALIDATED floor from `assertFloorInBuilding`, not the raw
 * input: that function has established the floor really is inside this work's building, so
 * matching against it transitively establishes the building too.
 */
async function assertRelatedObjects(
  objectIds: readonly string[],
  customerId: Types.ObjectId,
  scope: { floorId: Types.ObjectId | null; buildingId: Types.ObjectId | null },
): Promise<Types.ObjectId[]> {
  const unique = [...new Set(objectIds)];
  if (unique.length === 0) return [];

  const ids = unique.map((id) => new Types.ObjectId(id));
  const objects = await ObjectRecord.find({ _id: { $in: ids }, customer: customerId }).select(
    'code name floor',
  );

  if (objects.length !== ids.length) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Холбогдох объект олдсонгүй эсвэл өөр харилцагчид хамаарч байна.',
      [{ field: 'relatedObjectIds', message: 'Зөвхөн энэ харилцагчийн объектыг сонгоно.' }],
    );
  }

  // The floors the sub-task's equipment is allowed to sit on. A sub-task that names a
  // floor admits that floor alone; one that does not admits every floor in the building.
  let allowedFloors: Set<string> | null = null;
  if (scope.floorId) {
    allowedFloors = new Set([String(scope.floorId)]);
  } else if (scope.buildingId) {
    const floors = await ObjectNode.find({ kind: 'FLOOR', ancestors: scope.buildingId })
      .select('_id')
      .lean();
    allowedFloors = new Set(floors.map((floor) => String(floor._id)));
  }

  if (allowedFloors) {
    const stray = objects.filter(
      (object) => !object.floor || !allowedFloors.has(String(object.floor)),
    );
    if (stray.length > 0) {
      const names = stray.map((object) => object.code || object.name).join(', ');
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        `Сонгосон тоноглол энэ ажлын байршилд хамаарахгүй байна: ${names}`,
        [
          {
            field: 'relatedObjectIds',
            message: scope.floorId
              ? 'Зөвхөн тухайн давхрын тоноглолыг сонгоно.'
              : 'Зөвхөн энэ барилгын тоноглолыг сонгоно.',
          },
        ],
      );
    }
  }

  return ids;
}

async function assertTeamExists(teamId: string): Promise<Types.ObjectId> {
  const team = await Team.findById(teamId).select('_id');
  if (!team) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Баг олдсонгүй.', [
      { field: 'assignedTeamId', message: 'Баг олдсонгүй.' },
    ]);
  }
  return team._id;
}

/** A sub-task must lie inside its parent's planned window. */
function assertTaskWithinWorkWindow(
  work: Pick<IPlannedWork, 'plannedStartDate' | 'plannedEndDate'>,
  start: Date,
  end: Date,
): void {
  if (start.getTime() < work.plannedStartDate.getTime()) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Дэд ажлын эхлэх огноо ажлын хугацаанаас эрт байна.',
      [{ field: 'plannedStartDate', message: 'Ажлын хугацаанд байх ёстой.' }],
    );
  }
  if (end.getTime() > work.plannedEndDate.getTime()) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Дэд ажлын дуусах огноо ажлын хугацаанаас хойш байна.',
      [{ field: 'plannedEndDate', message: 'Ажлын хугацаанд байх ёстой.' }],
    );
  }
  if (end.getTime() < start.getTime()) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Дэд ажлын дуусах огноо эхлэх огнооноос эрт байна.',
      [{ field: 'plannedEndDate', message: 'Огнооны дараалал буруу.' }],
    );
  }
}

/** Archived and cancelled records are read-only apart from audited corrections. */
function assertMutable(work: Pick<IPlannedWork, 'status'>): void {
  if (work.status === 'ARCHIVED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Архивласан ажлыг өөрчлөх боломжгүй.',
    );
  }
  if (work.status === 'CANCELLED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Цуцлагдсан ажлыг өөрчлөх боломжгүй.',
    );
  }
}

// -- Mapping -----------------------------------------------------------------

const LIST_POPULATE = [
  { path: 'customer', select: 'name' },
  { path: 'project', select: 'name' },
  { path: 'building', select: 'name' },
  { path: 'assignedEmployees', select: 'firstName lastName' },
  { path: 'assignedTeam', select: 'name' },
] as const;

function namedRef(value: unknown): { id: string; name: string } {
  if (typeof value === 'object' && value !== null && 'name' in value) {
    const node = value as { _id: Types.ObjectId; name: string };
    return { id: String(node._id), name: node.name };
  }
  return { id: value ? String(value) : '', name: '' };
}

function employeeRefs(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'object' && entry !== null && 'firstName' in entry) {
      const employee = entry as { _id: Types.ObjectId; firstName: string; lastName: string };
      return {
        id: String(employee._id),
        name: `${employee.lastName} ${employee.firstName}`.trim(),
      };
    }
    return { id: String(entry), name: '' };
  });
}

function pauseDto(entry: IPlannedWork['pauseHistory'][number]): PlannedWorkPauseDto {
  const durationMinutes = entry.resumedAt
    ? Math.max(0, Math.round((entry.resumedAt.getTime() - entry.pausedAt.getTime()) / 60_000))
    : null;

  return {
    pausedAt: entry.pausedAt.toISOString(),
    pausedById: entry.pausedBy ? String(entry.pausedBy) : null,
    pausedByName: entry.pausedByName,
    reason: entry.reason,
    resumedAt: entry.resumedAt?.toISOString() ?? null,
    resumedById: entry.resumedBy ? String(entry.resumedBy) : null,
    resumedByName: entry.resumedByName,
    durationMinutes,
  };
}

function scheduleDto(
  entry: IPlannedWork['scheduleHistory'][number],
): PlannedWorkScheduleChangeDto {
  return {
    changedAt: entry.changedAt.toISOString(),
    changedById: entry.changedBy ? String(entry.changedBy) : null,
    changedByName: entry.changedByName,
    previousPlannedEndDate: entry.previousPlannedEndDate.toISOString(),
    newPlannedEndDate: entry.newPlannedEndDate.toISOString(),
    reason: entry.reason,
    clearedOverdue: entry.clearedOverdue,
  };
}

/**
 * Maps a photo reference to its DTO.
 *
 * An unpopulated entry is a bare ObjectId, which has no `storageKey`; those return null
 * and are filtered out rather than emitting a half-built photo record.
 */
function photoDto(value: unknown): PlannedWorkPhotoDto | null {
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

export function toTaskDto(
  task: Doc<IPlannedWorkTask>,
  floorNames: ReadonlyMap<string, string>,
): PlannedWorkTaskDto {
  const completed = Math.min(task.completedQuantity, task.totalQuantity);

  return {
    id: String(task._id),
    plannedWorkId: String(task.plannedWork),
    floorId: task.floor ? String(task.floor) : null,
    floorName: task.floor ? (floorNames.get(String(task.floor)) ?? null) : null,
    title: task.title,
    description: task.description,
    unit: task.unit,
    totalQuantity: task.totalQuantity,
    completedQuantity: task.completedQuantity,
    remainingQuantity: Math.max(0, task.totalQuantity - completed),
    progressPercent: progressPercentOf(task.totalQuantity, completed),
    status: task.status,
    plannedStartDate: task.plannedStartDate.toISOString(),
    plannedEndDate: task.plannedEndDate.toISOString(),
    assignedEmployeeId: task.assignedEmployee ? String(task.assignedEmployee) : null,
    assignedEmployeeName: employeeRefs([task.assignedEmployee])[0]?.name || null,
    relatedObjects: task.relatedObjects.map(namedRef),
    note: task.note,
    conclusion: task.conclusion,
    conclusionById: task.conclusionBy ? String(task.conclusionBy) : null,
    conclusionByName: task.conclusionByName,
    conclusionAt: task.conclusionAt?.toISOString() ?? null,
    durationMinutes: taskDurationMinutes(task),
    score: task.score,
    riskLevel: task.riskLevel,
    recommendation: task.recommendation,
    beforePhotos: task.beforePhotos.map(photoDto).filter((photo): photo is PlannedWorkPhotoDto =>
      photo !== null,
    ),
    afterPhotos: task.afterPhotos.map(photoDto).filter((photo): photo is PlannedWorkPhotoDto =>
      photo !== null,
    ),
    missingEvidence: missingTaskEvidenceOf(task),
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function toListItemDto(
  work: Doc<IPlannedWork>,
  reportStatus: PlannedWorkListItemDto['reportStatus'],
  now: Date,
): PlannedWorkListItemDto {
  const completed = Math.min(work.completedQuantity, work.totalQuantity);

  return {
    id: String(work._id),
    workNumber: work.workNumber,
    title: work.title,
    customer: namedRef(work.customer),
    project: work.project ? namedRef(work.project) : null,
    building: namedRef(work.building),
    lifecycleStatus: work.status,
    effectiveStatus: effectiveStatusOf(work, now),
    plannedStartDate: work.plannedStartDate.toISOString(),
    plannedEndDate: work.plannedEndDate.toISOString(),
    actualStartDate: work.actualStartDate?.toISOString() ?? null,
    actualEndDate: work.actualEndDate?.toISOString() ?? null,
    overdueAt: work.overdueAt?.toISOString() ?? null,
    completedLate: work.completedLate,
    delayMinutes: work.delayMinutes,
    totalQuantity: work.totalQuantity,
    completedQuantity: work.completedQuantity,
    remainingQuantity: Math.max(0, work.totalQuantity - completed),
    progressPercent: work.progressPercent,
    taskCount: work.taskCount,
    assignedEmployees: employeeRefs(work.assignedEmployees),
    assignedTeam: work.assignedTeam ? namedRef(work.assignedTeam) : null,
    reportStatus,
    createdAt: work.createdAt.toISOString(),
  };
}

async function loadDetail(
  work: Doc<IPlannedWork>,
  actor: AuthContext,
  now: Date,
): Promise<PlannedWorkDto> {
  const tasks = await PlannedWorkTask.find({ plannedWork: work._id })
    .populate([
      { path: 'beforePhotos', select: 'originalName mimeType sizeBytes uploadedByName storageKey createdAt' },
      { path: 'afterPhotos', select: 'originalName mimeType sizeBytes uploadedByName storageKey createdAt' },
      { path: 'assignedEmployee', select: 'firstName lastName' },
      { path: 'relatedObjects', select: 'name' },
    ])
    .sort({ plannedStartDate: 1, title: 1 });

  const floorIds = [
    ...new Set(tasks.filter((task) => task.floor).map((task) => String(task.floor))),
  ];
  const floors = floorIds.length
    ? await ObjectNode.find({
        _id: { $in: floorIds.map((id) => new Types.ObjectId(id)) },
      }).select('name')
    : [];
  const floorNames = new Map(floors.map((floor) => [String(floor._id), floor.name]));

  const [materials, reportState, assignmentAllowed] = await Promise.all([
    plannedWorkMaterialsOf(work),
    loadReportState(work),
    // Resolved once here so the action list a technician is shown matches what the write
    // endpoints will actually accept. Reading the record stays unscoped.
    isWithinAssignmentScope(work._id, actor),
  ]);

  const blockers = completionBlockersOf(tasks);

  return {
    ...toListItemDto(work, reportState.report?.status ?? null, now),
    description: work.description,
    updatedAt: work.updatedAt.toISOString(),
    originalPlannedEndDate: work.originalPlannedEndDate.toISOString(),
    currentPauseStartedAt: work.currentPauseStartedAt?.toISOString() ?? null,
    totalPausedMinutes: work.totalPausedMinutes,
    pauseHistory: work.pauseHistory.map(pauseDto),
    scheduleHistory: work.scheduleHistory.map(scheduleDto),
    cancelReason: work.cancelReason,
    cancelledBy: {
      id: work.cancelledBy ? String(work.cancelledBy) : null,
      name: work.cancelledByName,
      at: work.cancelledAt?.toISOString() ?? null,
    },
    archivedBy: {
      id: work.archivedBy ? String(work.archivedBy) : null,
      name: work.archivedByName,
      at: work.archivedAt?.toISOString() ?? null,
    },
    tasks: tasks.map((task) => toTaskDto(task, floorNames)),
    floorProgress: floorProgressOf(tasks, floorNames),
    materials,
    report: reportState.report
      ? toReportDto(reportState.report, actor, reportState.blockers)
      : null,
    availableActions: availableActionsFor(work, actor, blockers.length === 0, assignmentAllowed),
    completionBlockers: blockers,
  };
}

// `findPopulated` used to live here, loading a work by id with its display references and
// no notion of who was asking. Its one caller was `getPlannedWorkById`, which now has to
// build a scoped query instead, so an unscoped by-id loader would be nothing but a way to
// reintroduce the hole. Deleted rather than left for convenience.

async function findRaw(plannedWorkId: string): Promise<Doc<IPlannedWork>> {
  const work = await PlannedWork.findById(plannedWorkId);
  if (!work) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Төлөвлөгөөт ажил олдсонгүй.');
  }
  return work;
}

// -- Read --------------------------------------------------------------------

/**
 * The single-record read, bounded by the same assignment rule the list is.
 *
 * WHY THE SCOPE IS HERE AND NOT ON THE ROUTE. Every write in this module returns the
 * updated record through this function, so putting the predicate here means a future
 * endpoint cannot reach a planned work by id without passing it. It is safe for those
 * callers by construction: each of them already required either an oversight permission or
 * assignment scope to perform the write, so the record they are handing back is one this
 * check admits.
 *
 * ANSWERED AS NOT-FOUND, matching `assertInCustomerScope` rather than the 403 the write
 * path returns. The reasoning that made a 403 right for writes was that `planned_work.view`
 * was unscoped, so the caller could already list and open the record and "not found" would
 * have read as data loss. That premise is gone — the caller can no longer list or open it —
 * and what is left is the tenancy argument: answering "forbidden" for an id confirms the
 * record exists, which turns this endpoint into an oracle for probing identifiers. So an
 * out-of-scope id is indistinguishable from one that was never real.
 */
export async function getPlannedWorkById(
  plannedWorkId: string,
  actor: AuthContext,
): Promise<PlannedWorkDto> {
  const now = new Date();

  const scope = resolveCustomerScope(actor);
  const filter: FilterQuery<IPlannedWork> = {
    _id: new Types.ObjectId(plannedWorkId),
    // In the QUERY, not a check on the loaded document, so another organisation's work is
    // indistinguishable from one that does not exist. Answering "forbidden" would confirm
    // the id is real and turn this into a probe for other tenants' identifiers.
    ...customerScopeFilter(scope),
  };

  // Skipped for a customer for the same reason the list skips it: no employee card.
  if (scope.mode === 'STAFF') {
    const assignmentFilter = await resolveAssignedWorkFilter<IPlannedWork>(actor);
    if (assignmentFilter) filter.$and = [assignmentFilter];
  }

  const work = await PlannedWork.findOne(filter).populate([...LIST_POPULATE]);
  if (!work) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Төлөвлөгөөт ажил олдсонгүй.');
  }

  // Fallback reconciliation, so a stamp is never missing because the job has not run.
  await markOverdueIfNeeded(work, now);
  return loadDetail(work, actor, now);
}

/**
 * The board.
 *
 * TAKES THE CALLER, and not only the query. Assignment scope is enforced here rather than
 * left to the client: this list used to build its filter purely from query parameters, so
 * a technician who simply omitted `employeeId` received every planned work in the company.
 * `resolveAssignedWorkFilter` returns the "mine or my team's" predicate for a scoped caller
 * and null for one holding an oversight key, and it reads the acting employee from
 * `AuthContext`, never from the request — see planned-work.scope.ts.
 *
 * The predicate is ANDed rather than merged, so `employeeId`/`teamId` keep working as
 * ADDITIONAL narrowing and cannot widen the result. `$and` is also what keeps it from
 * colliding with the `$or` the search term already occupies.
 */
export async function listPlannedWork(
  query: PlannedWorkListQueryInput,
  actor: AuthContext,
): Promise<PaginatedData<PlannedWorkListItemDto>> {
  const now = new Date();
  const scope = resolveCustomerScope(actor);
  const filter: FilterQuery<IPlannedWork> = { ...customerScopeFilter(scope) };

  /**
   * Assignment scope is a STAFF question and is skipped for a customer.
   *
   * It narrows to the work an employee is on, and a portal account has no employee card —
   * so applying it would answer the empty list for every customer. Tenancy is a customer's
   * boundary and `customerScopeFilter` above has already applied it.
   */
  if (scope.mode === 'STAFF') {
    const assignmentFilter = await resolveAssignedWorkFilter<IPlannedWork>(actor);
    if (assignmentFilter) filter.$and = [assignmentFilter];
  }

  /**
   * A customer's own tenant is already pinned, so a `customerId` they send is DISCARDED
   * rather than honoured — the same rule the service-request list follows. Trusting it
   * would let the filter widen the very boundary it sits inside.
   */
  if (scope.mode === 'STAFF' && query.customerId) {
    filter.customer = new Types.ObjectId(query.customerId);
  }
  if (query.projectId) filter.project = new Types.ObjectId(query.projectId);
  if (query.buildingId) filter.building = new Types.ObjectId(query.buildingId);
  if (query.employeeId) filter.assignedEmployees = new Types.ObjectId(query.employeeId);
  if (query.teamId) filter.assignedTeam = new Types.ObjectId(query.teamId);

  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [{ workNumber: pattern }, { title: pattern }];
  }

  if (query.from || query.to) {
    // A work overlaps the window when it starts before the window ends and ends after
    // the window starts.
    if (query.to) filter.plannedStartDate = { $lte: new Date(query.to) };
    if (query.from) filter.plannedEndDate = { $gte: new Date(query.from) };
  }

  /**
   * Status filtering runs on EFFECTIVE status.
   *
   * OVERDUE is expressed as a query over the persisted lifecycle status plus the
   * deadline, so the reported total stays truthful instead of being filtered after
   * paging. Selecting a lifecycle status excludes records that currently read as
   * overdue, which is what makes the two figures add up on the dashboard.
   */
  if (query.status === 'OVERDUE') {
    filter.status = { $in: ['PLANNED', 'STARTED', 'PAUSED'] };
    filter.plannedEndDate = { ...(filter.plannedEndDate as object), $lt: now };
  } else if (query.status) {
    filter.status = query.status;
    if (['PLANNED', 'STARTED', 'PAUSED'].includes(query.status)) {
      filter.plannedEndDate = { ...(filter.plannedEndDate as object), $gte: now };
    }
  } else if (!query.includeArchived) {
    // Archived work is history; it is hidden unless explicitly requested.
    filter.status = { $ne: 'ARCHIVED' };
  }

  const skip = (query.page - 1) * query.limit;
  const sort: Record<string, 1 | -1> = { [query.sortBy]: query.sortDir === 'asc' ? 1 : -1 };

  const [rows, total] = await Promise.all([
    PlannedWork.find(filter)
      .populate([...LIST_POPULATE])
      .sort(sort)
      .skip(skip)
      .limit(query.limit),
    PlannedWork.countDocuments(filter),
  ]);

  await reconcileOverdueForWorks(rows, now);

  const reportStatuses = await reportStatusesFor(rows.map((row) => row._id));
  let items = rows.map((row) =>
    toListItemDto(row, reportStatuses.get(String(row._id)) ?? null, now),
  );

  if (query.reportStatus) {
    items = items.filter((item) => item.reportStatus === query.reportStatus);
  }

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

// -- Create and update -------------------------------------------------------

export async function createPlannedWork(
  input: CreatePlannedWorkInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PlannedWorkDto> {
  /**
   * A CUSTOMER may raise work, and what they raise is a REQUEST rather than a plan.
   *
   * Decided from the authenticated account, never from the body: `resolveCustomerScope`
   * reads the tenant off the account, so a customer cannot raise work in another
   * organisation's name however the payload is shaped. Three things are then forced
   * regardless of what was sent —
   *
   *   - the status is PENDING_APPROVAL, so it is not yet a commitment;
   *   - the crew is empty, which is what makes "cannot be assigned before approval" true
   *     of the DATA rather than a rule the caller is trusted to follow;
   *   - the owner is their own organisation.
   *
   * Staff creation is completely unchanged and still lands in DRAFT with whatever crew the
   * planner named.
   */
  const scope = resolveCustomerScope(actor);
  const raisedByCustomer = scope.mode === 'CUSTOMER';

  const location = await resolveLocation(input.projectId ?? null, input.buildingId);

  if (raisedByCustomer && String(location.customerId) !== scope.customerId) {
    // The location chain named somebody else's building. Reported as a validation failure
    // rather than a 403 so it cannot be used to probe which building ids exist.
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Барилга танай байгууллагад хамаарахгүй байна.',
      [{ field: 'buildingId', message: 'Өөр байгууллагын барилга.' }],
    );
  }

  const employeeIds = raisedByCustomer
    ? []
    : await assertEmployeesExist(input.assignedEmployeeIds);
  const teamId =
    !raisedByCustomer && input.assignedTeamId ? await assertTeamExists(input.assignedTeamId) : null;

  const plannedEndDate = new Date(input.plannedEndDate);

  const work = await PlannedWork.create({
    workNumber: await nextWorkNumber(),
    project: location.projectId,
    building: location.buildingId,
    customer: location.customerId,
    title: input.title,
    description: input.description ?? null,
    plannedStartDate: new Date(input.plannedStartDate),
    plannedEndDate,
    // Captured once so a later reschedule cannot erase the original commitment.
    originalPlannedEndDate: plannedEndDate,
    status: raisedByCustomer ? 'PENDING_APPROVAL' : 'DRAFT',
    assignedEmployees: employeeIds,
    assignedTeam: teamId,
    createdBy: new Types.ObjectId(actor.userId),
  });

  await recordAudit({
    entityType: 'PlannedWork',
    entityId: work._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: {
      workNumber: work.workNumber,
      title: work.title,
      plannedStartDate: work.plannedStartDate.toISOString(),
      plannedEndDate: work.plannedEndDate.toISOString(),
    },
  });

  return getPlannedWorkById(String(work._id), actor);
}

export async function updatePlannedWork(
  plannedWorkId: string,
  input: UpdatePlannedWorkInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PlannedWorkDto> {
  const work = await findRaw(plannedWorkId);
  assertMutable(work);

  const before = {
    title: work.title,
    plannedStartDate: work.plannedStartDate.toISOString(),
    building: String(work.building),
  };

  if (input.buildingId !== undefined) {
    const location = await resolveLocation(
      work.project ? String(work.project) : null,
      input.buildingId,
    );
    // On a project-less work the containment check above never ran, so the replacement
    // building could otherwise silently move the record into another tenant.
    if (String(location.customerId) !== String(work.customer)) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Барилга сонгосон харилцагчид хамаарахгүй байна.',
        [{ field: 'buildingId', message: 'Барилга өөр харилцагчийнх байна.' }],
      );
    }
    work.building = location.buildingId;
  }
  if (input.title !== undefined) work.title = input.title;
  if (input.description !== undefined) work.description = input.description ?? null;

  if (input.plannedStartDate !== undefined) {
    const start = new Date(input.plannedStartDate);
    if (start.getTime() > work.plannedEndDate.getTime()) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Эхлэх огноо дуусах огнооноос хойш байж болохгүй.',
        [{ field: 'plannedStartDate', message: 'Огнооны дараалал буруу.' }],
      );
    }
    work.plannedStartDate = start;
  }

  /**
   * NOBODY IS ASSIGNED TO A WORK THAT HAS NOT BEEN APPROVED.
   *
   * This is the second half of the gate. Forcing an empty crew at creation stops a customer
   * assigning; this stops anyone else doing it through the ordinary edit path while the
   * request is still pending. Refused rather than ignored — a planner who believes they
   * have staffed a job and has not is worse off than one who gets an error.
   */
  if (
    work.status === 'PENDING_APPROVAL' &&
    (input.assignedEmployeeIds !== undefined || input.assignedTeamId !== undefined)
  ) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Батлагдаагүй ажилд хариуцагч томилох боломжгүй. Эхлээд батална уу.',
      [{ field: 'assignedEmployeeIds', message: 'Батлагдсаны дараа томилно.' }],
    );
  }

  if (input.assignedEmployeeIds !== undefined) {
    work.assignedEmployees = await assertEmployeesExist(input.assignedEmployeeIds);
  }
  if (input.assignedTeamId !== undefined) {
    work.assignedTeam = input.assignedTeamId ? await assertTeamExists(input.assignedTeamId) : null;
  }

  await work.save();

  await recordAudit({
    entityType: 'PlannedWork',
    entityId: work._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: before,
    newValue: {
      title: work.title,
      plannedStartDate: work.plannedStartDate.toISOString(),
      building: String(work.building),
    },
  });

  return getPlannedWorkById(plannedWorkId, actor);
}

/**
 * Authorised reschedule.
 *
 * This is the ONLY path that may move the deadline, and therefore the only path that can
 * lift an overdue state. Pausing never shifts the schedule and resuming never adds the
 * paused duration back: an extension is always an explicit, permissioned, audited act.
 */
export async function reschedulePlannedWork(
  plannedWorkId: string,
  input: ReschedulePlannedWorkInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PlannedWorkDto> {
  const work = await findRaw(plannedWorkId);
  assertMutable(work);

  if (work.status === 'COMPLETED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Дууссан ажлын хугацааг сунгах шаардлагагүй.',
    );
  }

  const now = new Date();
  const previous = work.plannedEndDate;
  const next = new Date(input.plannedEndDate);

  if (next.getTime() === previous.getTime()) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Шинэ дуусах огноо өмнөхтэй ижил байна.',
      [{ field: 'plannedEndDate', message: 'Огноо өөрчлөгдөөгүй.' }],
    );
  }
  if (next.getTime() < work.plannedStartDate.getTime()) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Дуусах огноо эхлэх огнооноос эрт байж болохгүй.',
      [{ field: 'plannedEndDate', message: 'Огнооны дараалал буруу.' }],
    );
  }

  // Sub-tasks must remain inside the window after the change.
  const tasksOutside = await PlannedWorkTask.countDocuments({
    plannedWork: work._id,
    plannedEndDate: { $gt: next },
  });
  if (tasksOutside > 0) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Дэд ажлын хугацаа шинэ дуусах огнооноос хойш байна.',
      [{ field: 'plannedEndDate', message: 'Дэд ажлуудын хугацааг эхлээд тохируулна уу.' }],
    );
  }

  work.plannedEndDate = next;
  const clearedOverdue = await clearOverdueAfterReschedule(work, now);

  work.scheduleHistory.push({
    changedAt: now,
    changedBy: new Types.ObjectId(actor.userId),
    changedByName: actor.fullName,
    previousPlannedEndDate: previous,
    newPlannedEndDate: next,
    reason: input.reason,
    clearedOverdue,
  });

  await work.save();

  await recordAudit({
    entityType: 'PlannedWork',
    entityId: work._id,
    action: 'PLANNED_WORK_RESCHEDULED',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: input.reason,
    oldValue: {
      plannedEndDate: previous.toISOString(),
      effectiveStatus: 'OVERDUE',
      overdueCleared: false,
    },
    newValue: {
      plannedEndDate: next.toISOString(),
      effectiveStatus: effectiveStatusOf(work, now),
      overdueCleared: clearedOverdue,
    },
  });

  return getPlannedWorkById(plannedWorkId, actor);
}

// -- Tasks -------------------------------------------------------------------

export async function createTask(
  plannedWorkId: string,
  input: CreatePlannedWorkTaskInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PlannedWorkDto> {
  const work = await findRaw(plannedWorkId);
  assertMutable(work);

  const start = new Date(input.plannedStartDate);
  const end = new Date(input.plannedEndDate);
  assertTaskWithinWorkWindow(work, start, end);

  const floorId = input.floorId ? await assertFloorInBuilding(input.floorId, work.building) : null;
  const assignedEmployee = input.assignedEmployeeId
    ? (await assertEmployeesExist([input.assignedEmployeeId]))[0]
    : null;
  const relatedObjects = await assertRelatedObjects(input.relatedObjectIds, work.customer, {
    floorId,
    buildingId: work.building,
  });

  const task = await PlannedWorkTask.create({
    plannedWork: work._id,
    floor: floorId,
    title: input.title,
    description: input.description ?? null,
    unit: input.unit,
    totalQuantity: input.totalQuantity,
    completedQuantity: 0,
    status: 'PENDING',
    plannedStartDate: start,
    plannedEndDate: end,
    assignedEmployee: assignedEmployee ?? null,
    relatedObjects,
  });

  await recalculatePlannedWorkProgress(work._id);

  await recordAudit({
    entityType: 'PlannedWorkTask',
    entityId: task._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: {
      plannedWork: work.workNumber,
      title: task.title,
      totalQuantity: task.totalQuantity,
    },
  });

  return getPlannedWorkById(plannedWorkId, actor);
}

async function findTask(
  plannedWorkId: string,
  taskId: string,
): Promise<Doc<IPlannedWorkTask>> {
  const task = await PlannedWorkTask.findOne({
    _id: new Types.ObjectId(taskId),
    // Scoped by parent so a task cannot be reached through a mismatched work.
    plannedWork: new Types.ObjectId(plannedWorkId),
  });
  if (!task) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Дэд ажил олдсонгүй.');
  }
  return task;
}

export async function updateTask(
  plannedWorkId: string,
  taskId: string,
  input: UpdatePlannedWorkTaskInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PlannedWorkDto> {
  const work = await findRaw(plannedWorkId);
  assertMutable(work);
  const task = await findTask(plannedWorkId, taskId);

  const before = {
    title: task.title,
    totalQuantity: task.totalQuantity,
    plannedStartDate: task.plannedStartDate.toISOString(),
    plannedEndDate: task.plannedEndDate.toISOString(),
  };

  if (input.floorId !== undefined) {
    task.floor = input.floorId ? await assertFloorInBuilding(input.floorId, work.building) : null;
  }
  if (input.title !== undefined) task.title = input.title;
  if (input.description !== undefined) task.description = input.description ?? null;
  if (input.unit !== undefined) task.unit = input.unit;

  if (input.totalQuantity !== undefined) {
    // Completed quantity may never exceed the total, so shrinking the total clamps it.
    task.totalQuantity = input.totalQuantity;
    if (task.completedQuantity > task.totalQuantity) {
      task.completedQuantity = task.totalQuantity;
    }
  }

  const nextStart = input.plannedStartDate ? new Date(input.plannedStartDate) : task.plannedStartDate;
  const nextEnd = input.plannedEndDate ? new Date(input.plannedEndDate) : task.plannedEndDate;
  if (input.plannedStartDate !== undefined || input.plannedEndDate !== undefined) {
    assertTaskWithinWorkWindow(work, nextStart, nextEnd);
    task.plannedStartDate = nextStart;
    task.plannedEndDate = nextEnd;
  }

  if (input.assignedEmployeeId !== undefined) {
    task.assignedEmployee = input.assignedEmployeeId
      ? ((await assertEmployeesExist([input.assignedEmployeeId]))[0] ?? null)
      : null;
  }

  if (input.relatedObjectIds !== undefined) {
    // The floor in force after this edit, so moving a sub-task and its equipment in one
    // request is validated against where it is going rather than where it was.
    task.relatedObjects = await assertRelatedObjects(input.relatedObjectIds, work.customer, {
      floorId: task.floor,
      buildingId: work.building,
    });
  }

  applyDerivedTaskState(task);
  await task.save();
  await recalculatePlannedWorkProgress(work._id);

  await recordAudit({
    entityType: 'PlannedWorkTask',
    entityId: task._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: before,
    newValue: {
      title: task.title,
      totalQuantity: task.totalQuantity,
      plannedStartDate: task.plannedStartDate.toISOString(),
      plannedEndDate: task.plannedEndDate.toISOString(),
    },
  });

  return getPlannedWorkById(plannedWorkId, actor);
}

/**
 * Writes the Дүгнэлт and, ONLY when its text actually changed, stamps the author.
 *
 * Authorship is deliberately not stamped on every progress write. Every member of the
 * assigned team may record progress on every sub-task, each write replaces the last, and
 * the sheet resends the conclusion it loaded — so an unconditional stamp would credit the
 * verdict to whoever last nudged the quantity rather than to whoever wrote the sentence.
 *
 * Blank and null are the same absence here, so resending an untouched empty field is not a
 * change, and clearing the text clears the whole triple rather than leaving a name hanging
 * on a conclusion that no longer exists.
 */
function applyConclusion(
  task: Doc<IPlannedWorkTask>,
  next: string | null,
  actor: AuthContext,
): void {
  if ((next ?? '') === (task.conclusion ?? '')) return;

  task.conclusion = next;

  if ((next ?? '').trim().length === 0) {
    task.conclusionBy = null;
    task.conclusionByName = null;
    task.conclusionAt = null;
    return;
  }

  task.conclusionBy = new Types.ObjectId(actor.userId);
  task.conclusionByName = actor.fullName ?? null;
  task.conclusionAt = new Date();
}

/**
 * Records progress on a task.
 *
 * The caller supplies completed quantity, the Тайлбар note, the 0-100 score and the
 * recommendation. Two things are never accepted from the caller: task STATUS, which is
 * derived from quantity plus the evidence gate, and the risk band, which section 10.1
 * makes a function of the score against the thresholds in force.
 */
export async function recordTaskProgress(
  plannedWorkId: string,
  taskId: string,
  input: RecordTaskProgressInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PlannedWorkDto> {
  const work = await findRaw(plannedWorkId);
  assertMutable(work);
  await assertPlannedWorkAssignmentScope(work._id, actor);

  if (work.status === 'DRAFT') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Төлөвлөгдөөгүй ажилд биелэлт бүртгэх боломжгүй.',
    );
  }

  // Scoped by parent, so naming a task that belongs to a different job is a 404 rather
  // than a way to write progress onto work the caller was never assigned.
  const task = await findTask(plannedWorkId, taskId);

  if (input.completedQuantity > task.totalQuantity) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      `Биелэлт төлөвлөсөн тооноос их байж болохгүй. Дээд хэмжээ: ${task.totalQuantity}.`,
      [{ field: 'completedQuantity', message: 'Төлөвлөсөн тооноос их байна.' }],
    );
  }

  const before = {
    completedQuantity: task.completedQuantity,
    status: task.status,
    score: task.score,
    riskLevel: task.riskLevel,
  };

  task.completedQuantity = input.completedQuantity;
  if (input.started !== undefined) task.explicitlyStarted = input.started;
  if (input.skipped !== undefined) task.skipped = input.skipped;
  if (input.note !== undefined) task.note = input.note ?? null;
  if (input.conclusion !== undefined) applyConclusion(task, input.conclusion ?? null, actor);
  if (input.recommendation !== undefined) task.recommendation = input.recommendation ?? null;

  // Re-derived on every score change so a band can never drift from the score it describes.
  if (input.score !== undefined) {
    task.score = input.score ?? null;
    task.riskLevel =
      input.score === null ? null : riskLevelFor(input.score, await getRiskBands());
  }

  // Any recorded quantity implies the task has begun.
  if (task.completedQuantity > 0) task.explicitlyStarted = true;

  applyDerivedTaskState(task);
  await task.save();

  const summary = await recalculatePlannedWorkProgress(work._id);

  await recordAudit({
    entityType: 'PlannedWorkTask',
    entityId: task._id,
    action: 'StatusChanged',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'progress recorded',
    oldValue: before,
    newValue: {
      completedQuantity: task.completedQuantity,
      status: task.status,
      score: task.score,
      riskLevel: task.riskLevel,
      workProgressPercent: summary.progressPercent,
    },
  });

  return getPlannedWorkById(plannedWorkId, actor);
}

export async function deleteTask(
  plannedWorkId: string,
  taskId: string,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PlannedWorkDto> {
  const work = await findRaw(plannedWorkId);
  assertMutable(work);
  const task = await findTask(plannedWorkId, taskId);

  if (task.completedQuantity > 0) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Биелэлт бүртгэгдсэн дэд ажлыг устгах боломжгүй. Шаардлагагүй бол хийгдээгүй болгож тэмдэглэнэ.',
    );
  }

  // Evidence files belong to the task; removing the task removes its photos too.
  const photoIds = [...task.beforePhotos, ...task.afterPhotos];
  if (photoIds.length > 0) {
    const files = await StoredFile.find({ _id: { $in: photoIds } });
    for (const file of files) deleteStoredFile(file.storageKey);
    await StoredFile.deleteMany({ _id: { $in: photoIds } });
  }

  await PlannedWorkTask.deleteOne({ _id: task._id });
  await recalculatePlannedWorkProgress(work._id);

  await recordAudit({
    entityType: 'PlannedWorkTask',
    entityId: task._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'task removed',
    oldValue: { title: task.title, totalQuantity: task.totalQuantity },
  });

  return getPlannedWorkById(plannedWorkId, actor);
}

// -- Planned materials -------------------------------------------------------

/**
 * Replaces the planned material list.
 *
 * The whole list is sent at once: a row is only a name, a quantity and a unit, with no
 * identifier to address a partial update to.
 */
export async function setPlannedMaterials(
  plannedWorkId: string,
  input: PlannedWorkMaterialsInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PlannedWorkDto> {
  const work = await findRaw(plannedWorkId);
  assertMutable(work);

  const before = work.plannedMaterials.map((entry) => ({
    name: entry.name,
    quantity: entry.quantity,
    unit: entry.unit,
  }));

  work.plannedMaterials = input.materials.map((entry) => ({
    name: entry.name,
    quantity: entry.quantity,
    unit: entry.unit,
  }));
  await work.save();

  await recordAudit({
    entityType: 'PlannedWork',
    entityId: work._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'planned materials changed',
    oldValue: { materials: before },
    newValue: {
      materials: work.plannedMaterials.map((entry) => ({
        name: entry.name,
        quantity: entry.quantity,
        unit: entry.unit,
      })),
    },
  });

  return getPlannedWorkById(plannedWorkId, actor);
}

// -- Task photos -------------------------------------------------------------

export type TaskPhotoKind = 'BEFORE' | 'AFTER';

export async function attachTaskPhoto(
  plannedWorkId: string,
  taskId: string,
  kind: TaskPhotoKind,
  uploaded: { filename: string; originalname: string; mimetype: string; size: number },
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PlannedWorkDto> {
  const work = await findRaw(plannedWorkId);

  // Refused before the upload is adopted, and the temporary file is removed on the way
  // out: a rejected caller must not leave bytes on disk.
  try {
    await assertPlannedWorkAssignmentScope(work._id, actor);
  } catch (error) {
    deleteStoredFile(uploaded.filename);
    throw error;
  }

  const task = await findTask(plannedWorkId, taskId);

  if (work.status === 'ARCHIVED' || work.status === 'CANCELLED') {
    deleteStoredFile(uploaded.filename);
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Хаагдсан ажилд зураг хавсаргах боломжгүй.',
    );
  }

  if (!uploaded.mimetype.startsWith('image/')) {
    deleteStoredFile(uploaded.filename);
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Зөвхөн зураг хавсаргана.', [
      { field: 'file', message: 'Зургийн файл сонгоно уу.' },
    ]);
  }

  const stored = await StoredFile.create({
    storageKey: uploaded.filename,
    originalName: uploaded.originalname,
    mimeType: uploaded.mimetype,
    sizeBytes: uploaded.size,
    ownerType: 'PLANNED_WORK_TASK',
    ownerId: task._id,
    uploadedBy: new Types.ObjectId(actor.userId),
    uploadedByName: actor.fullName,
  });

  if (kind === 'BEFORE') task.beforePhotos.push(stored._id);
  else task.afterPhotos.push(stored._id);

  // Adding evidence can complete a task whose quantity was already finished.
  applyDerivedTaskState(task);
  await task.save();
  await recalculatePlannedWorkProgress(work._id);

  await recordAudit({
    entityType: 'PlannedWorkTask',
    entityId: task._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: kind === 'BEFORE' ? 'before photo uploaded' : 'after photo uploaded',
    newValue: { fileId: String(stored._id), name: stored.originalName },
  });

  return getPlannedWorkById(plannedWorkId, actor);
}

export async function detachTaskPhoto(
  plannedWorkId: string,
  taskId: string,
  fileId: string,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PlannedWorkDto> {
  const work = await findRaw(plannedWorkId);
  assertMutable(work);
  await assertPlannedWorkAssignmentScope(work._id, actor);
  const task = await findTask(plannedWorkId, taskId);

  const target = new Types.ObjectId(fileId);
  const wasBefore = task.beforePhotos.some((id) => String(id) === fileId);
  const wasAfter = task.afterPhotos.some((id) => String(id) === fileId);
  if (!wasBefore && !wasAfter) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Зураг олдсонгүй.');
  }

  task.beforePhotos = task.beforePhotos.filter((id) => String(id) !== fileId);
  task.afterPhotos = task.afterPhotos.filter((id) => String(id) !== fileId);

  const stored = await StoredFile.findById(target);
  if (stored) {
    deleteStoredFile(stored.storageKey);
    await StoredFile.deleteOne({ _id: target });
  }

  // Removing evidence can pull a task back out of DONE, which is intentional.
  applyDerivedTaskState(task);
  await task.save();
  await recalculatePlannedWorkProgress(work._id);

  await recordAudit({
    entityType: 'PlannedWorkTask',
    entityId: task._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'photo removed',
    oldValue: { fileId },
  });

  return getPlannedWorkById(plannedWorkId, actor);
}

/** Exposed so the routes can hand the caller's permission set to the detail mapper. */
export function canRecordProgress(actor: AuthContext): boolean {
  return hasPermission(actor, PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS);
}

export { isIncludedTask, findRaw as findPlannedWorkOrThrow };
