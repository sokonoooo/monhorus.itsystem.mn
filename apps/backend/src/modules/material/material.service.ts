import {
  type CreateMaterialItemInput,
  type MaterialItemDto,
  type MaterialItemListQueryInput,
  type PaginatedData,
  type UpdateMaterialItemInput,
} from '@monhorus/shared';
import { Types, type FilterQuery, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import { MaterialItem, type IMaterialItem } from './material.models';

type Doc<T> = HydratedDocument<T>;

const CATALOGUE_ENTITY = 'MaterialItem';

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
