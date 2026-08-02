import {
  type CreateMaterialItemInput,
  type CreateTaskMaterialUsageInput,
  type MaterialItemDto,
  type MaterialItemListQueryInput,
  type PaginatedData,
  type TaskMaterialUsageDto,
  type UpdateMaterialItemInput,
  type UpdateTaskMaterialUsageInput,
} from '@monhorus/shared';
import { Types, type FilterQuery, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import { Employee } from '../employee/employee.model';
import {
  PlannedWork,
  PlannedWorkTask,
  type IPlannedWorkTask,
} from '../planned-work/planned-work.models';
import {
  MaterialItem,
  TaskMaterialUsage,
  type IMaterialItem,
  type ITaskMaterialUsage,
} from './material.models';

type Doc<T> = HydratedDocument<T>;

const CATALOGUE_ENTITY = 'MaterialItem';
const USAGE_ENTITY = 'TaskMaterialUsage';

// -- Catalogue ---------------------------------------------------------------

export function toMaterialItemDto(item: Doc<IMaterialItem>): MaterialItemDto {
  return {
    id: String(item._id),
    code: item.code,
    name: item.name,
    category: item.category,
    defaultUnit: item.defaultUnit,
    description: item.description,
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export async function listMaterialItems(
  query: MaterialItemListQueryInput,
): Promise<PaginatedData<MaterialItemDto>> {
  const filter: FilterQuery<IMaterialItem> = {};
  if (query.category) filter.category = query.category;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.search) {
    const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ code: pattern }, { name: pattern }];
  }

  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await Promise.all([
    MaterialItem.find(filter)
      .sort({ [query.sortBy]: query.sortDir === 'asc' ? 1 : -1 })
      .skip(skip)
      .limit(query.limit),
    MaterialItem.countDocuments(filter),
  ]);

  return {
    items: rows.map(toMaterialItemDto),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function createMaterialItem(
  input: CreateMaterialItemInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<MaterialItemDto> {
  const existing = await MaterialItem.findOne({ code: input.code }).select('_id');
  if (existing) {
    throw AppError.conflict(ERROR_CODES.DUPLICATE_KEY, 'Энэ материалын код бүртгэгдсэн байна.');
  }

  const item = await MaterialItem.create({
    ...input,
    description: input.description ?? null,
    createdBy: new Types.ObjectId(actor.userId),
  });

  await recordAudit({
    entityType: CATALOGUE_ENTITY,
    entityId: item._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: { code: item.code, name: item.name, category: item.category },
  });

  return toMaterialItemDto(item);
}

export async function updateMaterialItem(
  itemId: string,
  input: UpdateMaterialItemInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<MaterialItemDto> {
  const item = await MaterialItem.findById(itemId);
  if (!item) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Материал олдсонгүй.');

  if (input.code && input.code !== item.code) {
    const clash = await MaterialItem.findOne({ code: input.code, _id: { $ne: item._id } }).select(
      '_id',
    );
    if (clash) {
      throw AppError.conflict(ERROR_CODES.DUPLICATE_KEY, 'Энэ материалын код бүртгэгдсэн байна.');
    }
  }

  const before = { code: item.code, name: item.name, isActive: item.isActive };

  if (input.code !== undefined) item.code = input.code;
  if (input.name !== undefined) item.name = input.name;
  if (input.category !== undefined) item.category = input.category;
  if (input.defaultUnit !== undefined) item.defaultUnit = input.defaultUnit;
  if (input.description !== undefined) item.description = input.description ?? null;
  if (input.isActive !== undefined) item.isActive = input.isActive;
  await item.save();

  await recordAudit({
    entityType: CATALOGUE_ENTITY,
    entityId: item._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: before,
    newValue: { code: item.code, name: item.name, isActive: item.isActive },
  });

  return toMaterialItemDto(item);
}

// -- Usage -------------------------------------------------------------------

export function toUsageDto(usage: Doc<ITaskMaterialUsage>): TaskMaterialUsageDto {
  return {
    id: String(usage._id),
    taskId: String(usage.task),
    plannedWorkId: String(usage.plannedWork),
    materialItemId: String(usage.materialItem),
    materialCode: usage.materialCode,
    materialName: usage.materialName,
    quantity: usage.quantity,
    unit: usage.unit,
    note: usage.note,
    usedByEmployeeId: usage.usedByEmployee ? String(usage.usedByEmployee) : null,
    usedByName: usage.usedByName,
    usedAt: usage.usedAt.toISOString(),
    recordedByName: usage.recordedByName,
    createdAt: usage.createdAt.toISOString(),
    updatedAt: usage.updatedAt.toISOString(),
  };
}

/**
 * The sub-task a usage row belongs to, verified against its parent work.
 *
 * The task id is checked against the planned work id from the path rather than trusted on
 * its own, so naming another work's sub-task cannot reach this work's rows — both ids
 * arrive from the client and only their AGREEMENT is evidence of anything.
 */
async function loadTaskInWork(
  plannedWorkId: string,
  taskId: string,
): Promise<{ task: Doc<IPlannedWorkTask>; customer: Types.ObjectId | null }> {
  const task = await PlannedWorkTask.findOne({
    _id: new Types.ObjectId(taskId),
    plannedWork: new Types.ObjectId(plannedWorkId),
  });
  if (!task) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Дэд ажил олдсонгүй.');
  }

  const work = await PlannedWork.findById(task.plannedWork).select('customer status');
  if (!work) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Ажил олдсонгүй.');
  }

  return { task, customer: work.customer ?? null };
}

/**
 * Refuses a write once the sub-task is finished.
 *
 * "Add, edit, remove BEFORE final completion" is the rule, and DONE is where it binds: a
 * completed sub-task has already fed the report, so re-writing what it consumed after the
 * fact would change the record of a job that is closed. Reading stays open at every status.
 */
function assertEditable(status: string): void {
  if (status === 'DONE' || status === 'SKIPPED') {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Дууссан дэд ажлын материалын бүртгэлийг өөрчлөх боломжгүй.',
    );
  }
}

export async function listTaskMaterialUsage(
  plannedWorkId: string,
  taskId: string,
): Promise<TaskMaterialUsageDto[]> {
  await loadTaskInWork(plannedWorkId, taskId);
  const rows = await TaskMaterialUsage.find({ task: new Types.ObjectId(taskId) }).sort({
    createdAt: 1,
  });
  return rows.map(toUsageDto);
}

export async function addTaskMaterialUsage(
  plannedWorkId: string,
  taskId: string,
  input: CreateTaskMaterialUsageInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<TaskMaterialUsageDto> {
  const { task, customer } = await loadTaskInWork(plannedWorkId, taskId);
  assertEditable(task.status);

  const material = await MaterialItem.findById(input.materialItemId);
  if (!material) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Материал олдсонгүй.', [
      { field: 'materialItemId', message: 'Материал олдсонгүй.' },
    ]);
  }
  // A retired item stays readable so historic rows resolve, but must not be added afresh.
  if (!material.isActive) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Энэ материал идэвхгүй байна.', [
      { field: 'materialItemId', message: 'Идэвхгүй материалыг сонгох боломжгүй.' },
    ]);
  }

  const { employeeId, employeeName } = await resolveUsedBy(input.usedByEmployeeId, actor);

  const usage = await TaskMaterialUsage.create({
    task: task._id,
    plannedWork: task.plannedWork,
    customer,
    materialItem: material._id,
    materialCode: material.code,
    materialName: material.name,
    quantity: input.quantity,
    unit: input.unit,
    note: input.note ?? null,
    usedByEmployee: employeeId,
    usedByName: employeeName,
    usedAt: boundedUsedAt(input.usedAt),
    recordedBy: new Types.ObjectId(actor.userId),
    recordedByName: actor.fullName,
  });

  await recordAudit({
    entityType: USAGE_ENTITY,
    entityId: usage._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: {
      taskId: String(task._id),
      material: material.code,
      quantity: usage.quantity,
      unit: usage.unit,
    },
  });

  return toUsageDto(usage);
}

export async function updateTaskMaterialUsage(
  plannedWorkId: string,
  taskId: string,
  usageId: string,
  input: UpdateTaskMaterialUsageInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<TaskMaterialUsageDto> {
  const { task } = await loadTaskInWork(plannedWorkId, taskId);
  assertEditable(task.status);

  const usage = await TaskMaterialUsage.findOne({
    _id: new Types.ObjectId(usageId),
    task: task._id,
  });
  if (!usage) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Материалын бүртгэл олдсонгүй.');

  const before = {
    material: usage.materialCode,
    quantity: usage.quantity,
    unit: usage.unit,
  };

  if (input.materialItemId !== undefined) {
    const material = await MaterialItem.findById(input.materialItemId);
    if (!material || !material.isActive) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Материал олдсонгүй.', [
        { field: 'materialItemId', message: 'Материал олдсонгүй эсвэл идэвхгүй байна.' },
      ]);
    }
    usage.materialItem = material._id;
    usage.materialCode = material.code;
    usage.materialName = material.name;
  }
  if (input.quantity !== undefined) usage.quantity = input.quantity;
  if (input.unit !== undefined) usage.unit = input.unit;
  if (input.note !== undefined) usage.note = input.note ?? null;
  if (input.usedAt !== undefined) usage.usedAt = boundedUsedAt(input.usedAt);
  if (input.usedByEmployeeId !== undefined) {
    const resolved = await resolveUsedBy(input.usedByEmployeeId, actor);
    usage.usedByEmployee = resolved.employeeId;
    usage.usedByName = resolved.employeeName;
  }

  await usage.save();

  await recordAudit({
    entityType: USAGE_ENTITY,
    entityId: usage._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: before,
    newValue: { material: usage.materialCode, quantity: usage.quantity, unit: usage.unit },
  });

  return toUsageDto(usage);
}

export async function removeTaskMaterialUsage(
  plannedWorkId: string,
  taskId: string,
  usageId: string,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  const { task } = await loadTaskInWork(plannedWorkId, taskId);
  assertEditable(task.status);

  const usage = await TaskMaterialUsage.findOne({
    _id: new Types.ObjectId(usageId),
    task: task._id,
  });
  if (!usage) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Материалын бүртгэл олдсонгүй.');

  await usage.deleteOne();

  await recordAudit({
    entityType: USAGE_ENTITY,
    entityId: usage._id,
    // No 'Deleted' in the audit vocabulary, and inventing one for a single caller would
    // fragment it. 'Cancelled' is the closest existing meaning: the recorded use is
    // withdrawn, and the row's old value is preserved below so the trail still shows what
    // was there.
    action: 'Cancelled',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: {
      taskId: String(task._id),
      material: usage.materialCode,
      quantity: usage.quantity,
    },
  });
}

/**
 * Who used it.
 *
 * Defaults to the caller's own employee record, because the common case is a technician
 * recording what they themselves just used and making them pick their own name from a list
 * is friction with no purpose. Naming somebody else stays possible for a supervisor writing
 * up a crew's work, and the named employee is verified to exist rather than stored raw.
 */
async function resolveUsedBy(
  requested: string | null | undefined,
  actor: AuthContext,
): Promise<{ employeeId: Types.ObjectId | null; employeeName: string | null }> {
  const id = requested ?? actor.employeeId;
  if (!id) return { employeeId: null, employeeName: null };

  const employee = await Employee.findById(id).select('firstName lastName');
  if (!employee) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ажилтан олдсонгүй.', [
      { field: 'usedByEmployeeId', message: 'Ажилтан олдсонгүй.' },
    ]);
  }
  return {
    employeeId: employee._id,
    employeeName: `${employee.lastName} ${employee.firstName}`.trim(),
  };
}

/**
 * The usage date, refused if it is in the future.
 *
 * A material cannot have been consumed tomorrow, and a mistyped year is the ordinary way
 * that happens. Defaults to now when absent.
 */
function boundedUsedAt(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  if (parsed.getTime() > Date.now() + 60_000) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ашигласан огноо ирээдүйд байж болохгүй.', [
      { field: 'usedAt', message: 'Ирээдүйн огноо оруулах боломжгүй.' },
    ]);
  }
  return parsed;
}
