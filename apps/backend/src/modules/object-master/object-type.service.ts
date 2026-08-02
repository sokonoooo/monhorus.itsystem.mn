import type {
  CreateObjectTypeInput,
  ObjectTypeDto,
  ObjectTypeListQueryInput,
  PaginatedData,
  UpdateObjectTypeInput,
} from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import { ObjectRecord, ObjectType, type IObjectType } from './object-master.models';

/**
 * Equipment type registry (requirements 4.1).
 *
 * An administrator-managed catalogue. `generatesConclusion` is the flag that matters
 * today: it decides whether an object of this type may carry an assessment at all.
 * `showOnPlan` and `icon` are stored for the plan editor, which section 19.2 leaves
 * unapproved, so nothing reads them yet.
 */

type Doc<T> = T & { _id: Types.ObjectId };

export function toObjectTypeDto(type: Doc<IObjectType>, objectCount: number): ObjectTypeDto {
  return {
    id: String(type._id),
    code: type.code,
    name: type.name,
    description: type.description,
    category: type.category,
    showOnPlan: type.showOnPlan,
    insidePanel: type.insidePanel,
    generatesConclusion: type.generatesConclusion,
    icon: type.icon,
    isActive: type.isActive,
    objectCount,
    createdAt: type.createdAt.toISOString(),
    updatedAt: type.updatedAt.toISOString(),
  };
}

/** One grouped count, so a list of N types costs one query rather than N. */
async function objectCountsFor(typeIds: readonly Types.ObjectId[]): Promise<Map<string, number>> {
  if (typeIds.length === 0) return new Map();
  const rows = await ObjectRecord.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { objectType: { $in: [...typeIds] } } },
    { $group: { _id: '$objectType', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

export async function listObjectTypes(
  query: ObjectTypeListQueryInput,
): Promise<PaginatedData<ObjectTypeDto>> {
  const filter: FilterQuery<IObjectType> = {};
  if (query.category) filter.category = query.category;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [{ name: pattern }, { code: pattern }];
  }

  const skip = (query.page - 1) * query.limit;
  const [rows, total] = await Promise.all([
    ObjectType.find(filter).sort({ category: 1, name: 1 }).skip(skip).limit(query.limit),
    ObjectType.countDocuments(filter),
  ]);

  const counts = await objectCountsFor(rows.map((row) => row._id));

  return {
    items: rows.map((row) => toObjectTypeDto(row, counts.get(String(row._id)) ?? 0)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getObjectTypeById(objectTypeId: string): Promise<ObjectTypeDto> {
  const type = await ObjectType.findById(objectTypeId);
  if (!type) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Тоноглолын төрөл олдсонгүй.');
  const counts = await objectCountsFor([type._id]);
  return toObjectTypeDto(type, counts.get(String(type._id)) ?? 0);
}

export async function createObjectType(
  input: CreateObjectTypeInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ObjectTypeDto> {
  const existing = await ObjectType.findOne({ code: input.code }).select('_id');
  if (existing) {
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      'Энэ кодтой тоноглолын төрөл бүртгэгдсэн байна.',
    );
  }

  const type = await ObjectType.create({
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    category: input.category,
    showOnPlan: input.showOnPlan,
    insidePanel: input.insidePanel,
    generatesConclusion: input.generatesConclusion,
    icon: input.icon,
    isActive: true,
    createdBy: new Types.ObjectId(actor.userId),
  });

  await recordAudit({
    entityType: 'ObjectType',
    entityId: type._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: { code: type.code, name: type.name, category: type.category },
  });

  return toObjectTypeDto(type, 0);
}

export async function updateObjectType(
  objectTypeId: string,
  input: UpdateObjectTypeInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ObjectTypeDto> {
  const type = await ObjectType.findById(objectTypeId);
  if (!type) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Тоноглолын төрөл олдсонгүй.');

  const before = {
    name: type.name,
    generatesConclusion: type.generatesConclusion,
    isActive: type.isActive,
  };

  if (input.name !== undefined) type.name = input.name;
  if (input.description !== undefined) type.description = input.description ?? null;
  if (input.showOnPlan !== undefined) type.showOnPlan = input.showOnPlan;
  if (input.insidePanel !== undefined) type.insidePanel = input.insidePanel;
  if (input.generatesConclusion !== undefined) type.generatesConclusion = input.generatesConclusion;
  if (input.icon !== undefined) type.icon = input.icon;
  if (input.isActive !== undefined) type.isActive = input.isActive;

  await type.save();

  await recordAudit({
    entityType: 'ObjectType',
    entityId: type._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: before,
    newValue: {
      name: type.name,
      generatesConclusion: type.generatesConclusion,
      isActive: type.isActive,
    },
  });

  const counts = await objectCountsFor([type._id]);
  return toObjectTypeDto(type, counts.get(String(type._id)) ?? 0);
}

/** Deletion is refused while any object still uses the type; deactivate instead. */
export async function deleteObjectType(
  objectTypeId: string,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  const type = await ObjectType.findById(objectTypeId);
  if (!type) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Тоноглолын төрөл олдсонгүй.');

  const inUse = await ObjectRecord.countDocuments({ objectType: type._id });
  if (inUse > 0) {
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      `Энэ төрлийг ${inUse} объект ашиглаж байгаа тул устгах боломжгүй. Идэвхгүй болгоно уу.`,
    );
  }

  await ObjectType.deleteOne({ _id: type._id });

  await recordAudit({
    entityType: 'ObjectType',
    entityId: type._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'object type deleted',
    oldValue: { code: type.code, name: type.name, category: type.category },
  });
}
