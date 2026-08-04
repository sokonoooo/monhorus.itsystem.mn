import type { FloorPlanDto, FloorPlanMetaInput } from '@monhorus/shared';
import { Types, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  assertInCustomerScope,
  customerScopeFilter,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import { deleteStoredFile } from '../storage/storage.service';
import { StoredFile, type IStoredFile } from '../storage/stored-file.model';
import { FloorPlan, ObjectNode, type IFloorPlan } from './object.models';

/**
 * Floor plan image (requirements 11.1, rule 17.3).
 *
 * One current image per floor and nothing more. There is deliberately no version number,
 * no supersededBy chain, no migration and no coordinate model: section 19.2 leaves the
 * plan editor format, scale and coordinate system unapproved, and section 11.2 carries the
 * customer's own note that the placement rules are not yet settled.
 *
 * Section 11.1 does require that "Plan дээрх бүх өөрчлөлт audit history-д хадгалагдана",
 * so every upload, replacement, metadata edit and removal writes an audit record. The
 * audit log is where the history lives, not a version chain.
 */

type Doc<T> = HydratedDocument<T>;

const ALLOWED_PLAN_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);

export function toFloorPlanDto(plan: Doc<IFloorPlan>): FloorPlanDto {
  const file = plan.file as unknown;
  const stored =
    typeof file === 'object' && file !== null && 'originalName' in file
      ? (file as unknown as Doc<IStoredFile>)
      : null;

  return {
    id: String(plan._id),
    floorId: String(plan.floor),
    fileId: stored ? String(stored._id) : String(plan.file),
    fileName: stored?.originalName ?? '',
    downloadUrl: `/api/v1/files/${stored ? String(stored._id) : String(plan.file)}`,
    mimeType: stored?.mimeType ?? '',
    sizeBytes: stored?.sizeBytes ?? 0,
    title: plan.title,
    description: plan.description,
    uploadedById: plan.uploadedBy ? String(plan.uploadedBy) : null,
    uploadedByName: plan.uploadedByName,
    uploadedAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

async function loadPlan(floorId: string): Promise<Doc<IFloorPlan> | null> {
  return FloorPlan.findOne({ floor: new Types.ObjectId(floorId) }).populate({
    path: 'file',
    select: 'originalName mimeType sizeBytes storageKey uploadedByName createdAt',
  });
}

/**
 * Refuses a plan read for a floor outside the caller's scope.
 *
 * Written as an assertion on the fetched owner rather than as a scoped query so that a
 * staff caller keeps today's behaviour exactly: `getFloorPlan` never required the floor to
 * exist, and a staff scope makes this a no-op. A customer asking for a floor that is
 * missing or belongs to another tenant gets the same not-found either way.
 */
async function assertFloorInScope(floorId: string, scope: ResolvedCustomerScope): Promise<void> {
  if (scope.mode === 'STAFF') return;
  const floor = await ObjectNode.findById(floorId).select('customer kind');
  assertInCustomerScope(scope, floor?.kind === 'FLOOR' ? floor.customer : null, 'Давхар олдсонгүй.');
}

export async function getFloorPlan(
  floorId: string,
  scope: ResolvedCustomerScope,
): Promise<FloorPlanDto | null> {
  await assertFloorInScope(floorId, scope);
  const plan = await loadPlan(floorId);
  return plan ? toFloorPlanDto(plan) : null;
}

async function assertFloor(
  floorId: string,
  scope: ResolvedCustomerScope,
): Promise<Types.ObjectId> {
  const floor = await ObjectNode.findOne({
    _id: floorId,
    kind: 'FLOOR',
    ...customerScopeFilter(scope),
  }).select('kind isActive');
  if (!floor) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Давхар олдсонгүй.');
  }
  if (!floor.isActive) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Архивласан давхарт план зураг удирдах боломжгүй.',
    );
  }
  return floor._id;
}

export interface UploadedPlanFile {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

/**
 * Uploads or replaces the floor plan.
 *
 * Replacement removes the previous image outright: there is no version to keep it under,
 * and keeping an unreachable orphan file would be a silent storage leak. The audit record
 * names both the old and the new file so the change remains traceable.
 *
 * Object placements (`Object.planPosition`) are deliberately KEPT across a replacement and
 * across a removal. They are stored normalised to 0..1 of the plan rather than in pixels,
 * and a replacement plan is almost always the same floor redrawn or rescanned, so the pins
 * still land where they belong. Clearing them would silently discard the survey work of
 * placing every panel on the floor, and there is no way to get it back; a pin that ends up
 * slightly off after a genuinely different drawing is dragged, which costs one click. A
 * position is only cleared when the object itself leaves the floor, which is where the
 * placement actually stops meaning anything.
 */
export async function uploadFloorPlan(
  floorId: string,
  uploaded: UploadedPlanFile,
  meta_: FloorPlanMetaInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<FloorPlanDto> {
  if (!ALLOWED_PLAN_MIME_TYPES.has(uploaded.mimetype)) {
    deleteStoredFile(uploaded.filename);
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'План зураг зөвхөн PNG, JPG, WEBP эсвэл PDF байна.',
      [{ field: 'file', message: 'Файлын төрөл зөвшөөрөгдөөгүй.' }],
    );
  }

  const floor = await assertFloor(floorId, scope).catch((error: unknown) => {
    deleteStoredFile(uploaded.filename);
    throw error;
  });

  const stored = await StoredFile.create({
    storageKey: uploaded.filename,
    originalName: uploaded.originalname,
    mimeType: uploaded.mimetype,
    sizeBytes: uploaded.size,
    ownerType: 'FLOOR_PLAN',
    ownerId: floor,
    uploadedBy: new Types.ObjectId(actor.userId),
    uploadedByName: actor.fullName,
  });

  const existing = await FloorPlan.findOne({ floor });
  const previousFileName = existing
    ? (await StoredFile.findById(existing.file).select('originalName'))?.originalName ?? null
    : null;

  if (existing) {
    const previousFileId = existing.file;

    existing.file = stored._id;
    existing.title = meta_.title ?? existing.title;
    existing.description = meta_.description ?? existing.description;
    existing.uploadedBy = new Types.ObjectId(actor.userId);
    existing.uploadedByName = actor.fullName;
    await existing.save();

    const previousFile = await StoredFile.findById(previousFileId);
    if (previousFile) {
      deleteStoredFile(previousFile.storageKey);
      await StoredFile.deleteOne({ _id: previousFile._id });
    }

    await recordAudit({
      entityType: 'FloorPlan',
      entityId: floor,
      action: 'Updated',
      actor: { id: actor.userId, role: actor.role, label: actor.fullName },
      meta,
      reason: 'floor plan replaced',
      oldValue: { fileName: previousFileName },
      newValue: { fileName: stored.originalName, sizeBytes: stored.sizeBytes },
    });

    return (await getFloorPlan(floorId, scope))!;
  }

  await FloorPlan.create({
    floor,
    file: stored._id,
    title: meta_.title ?? null,
    description: meta_.description ?? null,
    uploadedBy: new Types.ObjectId(actor.userId),
    uploadedByName: actor.fullName,
  });

  await recordAudit({
    entityType: 'FloorPlan',
    entityId: floor,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'floor plan uploaded',
    newValue: { fileName: stored.originalName, sizeBytes: stored.sizeBytes },
  });

  return (await getFloorPlan(floorId, scope))!;
}

export async function updateFloorPlanMeta(
  floorId: string,
  input: FloorPlanMetaInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<FloorPlanDto> {
  await assertFloorInScope(floorId, scope);

  const plan = await FloorPlan.findOne({ floor: new Types.ObjectId(floorId) });
  if (!plan) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'План зураг олдсонгүй.');

  const before = { title: plan.title, description: plan.description };

  if (input.title !== undefined) plan.title = input.title ?? null;
  if (input.description !== undefined) plan.description = input.description ?? null;
  await plan.save();

  await recordAudit({
    entityType: 'FloorPlan',
    entityId: plan.floor,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'floor plan metadata updated',
    oldValue: before,
    newValue: { title: plan.title, description: plan.description },
  });

  return (await getFloorPlan(floorId, scope))!;
}

/**
 * Removes the current plan image. Stored object placements survive it, for the reason
 * given on `uploadFloorPlan`: a plan removed and re-uploaded is the same floor.
 */
export async function removeFloorPlan(
  floorId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  await assertFloorInScope(floorId, scope);

  const plan = await FloorPlan.findOne({ floor: new Types.ObjectId(floorId) });
  if (!plan) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'План зураг олдсонгүй.');

  const stored = await StoredFile.findById(plan.file);
  const fileName = stored?.originalName ?? null;

  if (stored) {
    deleteStoredFile(stored.storageKey);
    await StoredFile.deleteOne({ _id: stored._id });
  }
  await FloorPlan.deleteOne({ _id: plan._id });

  await recordAudit({
    entityType: 'FloorPlan',
    entityId: plan.floor,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'floor plan removed',
    oldValue: { fileName },
  });
}
