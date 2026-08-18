import type {
  CreateObjectTypeInput,
  ObjectTypeAttributeDto,
  ObjectTypeDto,
  ObjectTypeListQueryInput,
  PaginatedData,
  UpdateObjectTypeInput,
} from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { CREATOR_POPULATE, creatorName } from '../../common/utils/creator.util';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import { deleteStoredFile } from '../storage/storage.service';
import { StoredFile } from '../storage/stored-file.model';
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

/**
 * The download path for a type's custom icon, or null.
 *
 * One place, so the list, the detail and the object rows cannot drift on how the url is
 * spelled. Null is the signal to fall back to the `icon` enum — the DTO never invents a
 * placeholder path for a type that has no custom icon.
 */
export function objectTypeIconUrl(iconFile: Types.ObjectId | null | undefined): string | null {
  return iconFile ? `/api/v1/files/${String(iconFile)}` : null;
}

/**
 * The type's attribute definitions, in the order they are stored.
 *
 * Mapped rather than handed straight out because a mongoose document array is not a plain
 * array and its sub-documents are not plain objects: passing one through would ship mongoose
 * internals on the wire and make the DTO's `readonly` claim a lie. `?? []` covers a type
 * document written before the path existed.
 */
export function toObjectTypeAttributeDtos(
  attributes: IObjectType['attributes'] | undefined,
): ObjectTypeAttributeDto[] {
  return (attributes ?? []).map((attribute) => ({
    key: attribute.key,
    label: attribute.label,
    type: attribute.type,
    required: attribute.required,
    options: (attribute.options ?? []).map((option) => ({
      value: option.value,
      label: option.label,
    })),
  }));
}

/** The attribute keys in order, which is what an audit reader needs to see a change. */
function attributeKeysOf(type: Pick<IObjectType, 'attributes'>): string[] {
  return (type.attributes ?? []).map((attribute) => attribute.key);
}

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
    iconFileId: type.iconFile ? String(type.iconFile) : null,
    iconUrl: objectTypeIconUrl(type.iconFile),
    attributes: toObjectTypeAttributeDtos(type.attributes),
    isActive: type.isActive,
    objectCount,
    createdByName: creatorName(type.createdBy),
    createdAt: type.createdAt.toISOString(),
    updatedAt: type.updatedAt.toISOString(),
  };
}

/**
 * Checks a claimed icon id and transfers the file onto the type.
 *
 * The upload route parks the file on the uploader, because the type it belongs to does not
 * exist yet at that point. This is where it stops being an orphan.
 *
 * Only an `OBJECT_TYPE`-owned file is accepted. That is the whole check: it means an id
 * cannot be pointed at somebody's HR document, a floor plan or a service-request photo to
 * make a private file readable through the icon's permissions, which are broader than any
 * of theirs. The file's contents were sanitised at upload and are not re-examined here —
 * every `OBJECT_TYPE` file in the store went through the parser to get there.
 */
async function resolveIconFile(iconFileId: string): Promise<Types.ObjectId> {
  const file = await StoredFile.findById(iconFileId);
  if (!file || file.ownerType !== 'OBJECT_TYPE') {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Айкон файл олдсонгүй.', [
      { field: 'iconFileId', message: 'Айконыг дахин хуулна уу.' },
    ]);
  }
  return file._id as Types.ObjectId;
}

/** Transfers a resolved icon off the uploader and onto the type that now owns it. */
async function claimIconFile(iconFile: Types.ObjectId, typeId: Types.ObjectId): Promise<void> {
  await StoredFile.updateOne({ _id: iconFile }, { $set: { ownerId: typeId } });
}

/**
 * Removes a replaced or cleared icon, bytes and row together.
 *
 * Nothing else can reference it — an icon file is claimed by exactly one type — so leaving
 * it behind would only accumulate unreachable files in the upload directory.
 */
async function releaseIconFile(iconFile: Types.ObjectId | null): Promise<void> {
  if (!iconFile) return;
  const file = await StoredFile.findById(iconFile);
  if (!file) return;
  deleteStoredFile(file.storageKey);
  await StoredFile.deleteOne({ _id: file._id });
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
    ObjectType.find(filter)
      .populate(CREATOR_POPULATE)
      .sort({ category: 1, name: 1 })
      .skip(skip)
      .limit(query.limit),
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
  const type = await ObjectType.findById(objectTypeId).populate(CREATOR_POPULATE);
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

  // Resolved BEFORE the type is written, so a bad id fails the request instead of leaving a
  // registered type behind. Re-owning the file has to wait for an id, and is done below.
  const iconFile = input.iconFileId ? await resolveIconFile(input.iconFileId) : null;

  const type = await ObjectType.create({
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    category: input.category,
    showOnPlan: input.showOnPlan,
    insidePanel: input.insidePanel,
    generatesConclusion: input.generatesConclusion,
    icon: input.icon,
    iconFile,
    attributes: input.attributes,
    isActive: true,
    createdBy: new Types.ObjectId(actor.userId),
  });

  if (iconFile) await claimIconFile(iconFile, type._id);

  await recordAudit({
    entityType: 'ObjectType',
    entityId: type._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: { code: type.code, name: type.name, category: type.category },
  });

  // Resolved on the way out so the row the client inserts into the list carries the creator
  // it was just stamped with, rather than a dash until the next refetch.
  await type.populate(CREATOR_POPULATE);

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
    // The keys rather than the whole definitions: an audit row is read by a human asking
    // "which attribute disappeared", and the option lists would bury that under their own
    // bulk. The audit log is append-only, so this is the only record of a removal.
    attributeKeys: attributeKeysOf(type),
  };

  if (input.name !== undefined) type.name = input.name;
  if (input.description !== undefined) type.description = input.description ?? null;
  if (input.showOnPlan !== undefined) type.showOnPlan = input.showOnPlan;
  if (input.insidePanel !== undefined) type.insidePanel = input.insidePanel;
  if (input.generatesConclusion !== undefined) type.generatesConclusion = input.generatesConclusion;
  if (input.icon !== undefined) type.icon = input.icon;
  if (input.isActive !== undefined) type.isActive = input.isActive;
  /**
   * The whole list, replaced. Add, edit, delete and reorder are all "the array should now
   * look like this", so there is nothing to patch element-wise — and assigning the array
   * wholesale is also what makes the new ORDER stick, which an element-wise update could not
   * express at all.
   *
   * Safe to replace freely because a removed definition does not cascade: the values already
   * recorded against it stay on their objects, and `mergeAttributeValues` preserves them
   * through every later edit. See `IObject.attributeValues`.
   */
  if (input.attributes !== undefined) type.attributes = input.attributes;

  /**
   * Set, replace or clear the custom icon. Three-valued: absent leaves it alone, an id
   * replaces it, `null` clears it and the type falls back to the `icon` enum.
   *
   * The replaced file is deleted, not orphaned, and only AFTER the type has been saved
   * pointing somewhere else — so a failure between the two leaves a type with an icon
   * rather than a type pointing at bytes that are gone.
   */
  const replacedIcon = type.iconFile;
  let iconChanged = false;

  if (input.iconFileId !== undefined) {
    const next = input.iconFileId ? await resolveIconFile(input.iconFileId) : null;
    iconChanged = String(next ?? '') !== String(replacedIcon ?? '');
    if (iconChanged) {
      if (next) await claimIconFile(next, type._id);
      type.iconFile = next;
    }
  }

  await type.save();

  if (iconChanged) await releaseIconFile(replacedIcon);

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
      attributeKeys: attributeKeysOf(type),
    },
  });

  await type.populate(CREATOR_POPULATE);

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
  // The icon belonged to this type alone; with the type gone nothing can ever reach it.
  await releaseIconFile(type.iconFile);

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
