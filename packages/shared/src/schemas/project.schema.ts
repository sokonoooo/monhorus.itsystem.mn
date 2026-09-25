import { z } from 'zod';

import {
  booleanQuerySchema,
  dateOrderRefinement,
  isoDateSchema,
  objectIdSchema,
  sortDirSchema,
} from './common.schema';

/**
 * Project module CRUD contracts (requirements 4.2).
 *
 * Parent references are absent from every update schema: re-parenting a building or a
 * floor would silently invalidate the objects linked beneath it, so a move is a separate,
 * explicit operation rather than a field on the edit form.
 *
 * `code` IS ABSENT FROM ALL SIX SCHEMAS, and its absence is the contract.
 *
 * A project, building and floor code is issued by the server — `PRJ-001`, `BLD-001`,
 * `FLR-001`, numbered per customer per kind against an atomic counter. It is absent from
 * the CREATE schemas because there is nothing for a caller to say: the number is drawn
 * from state only the server holds, and a code the browser proposed could only ever be a
 * guess at it. It is absent from the UPDATE schemas — which are `.strict()`, so a request
 * carrying one is REFUSED rather than quietly ignored — because a code that can be edited
 * is not an identifier. Renaming a floor must leave the label on somebody's drawing alone.
 *
 * The DTOs still carry `code` as a required string. Nothing about reading it changed;
 * only who decides it.
 */

// -- Project -----------------------------------------------------------------

export const createProjectSchema = z
  .object({
    customerId: objectIdSchema,
    name: z.string().trim().min(2, 'Төслийн нэр заавал.').max(200),
    contractNumber: z.string().trim().max(64).nullish(),
    responsibleEmployeeId: objectIdSchema.nullish(),
    startDate: isoDateSchema.nullish(),
    endDate: isoDateSchema.nullish(),
    description: z.string().trim().max(4000).nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate) {
      dateOrderRefinement(
        'startDate',
        'endDate',
        'Дуусах огноо эхлэх огнооноос эрт байж болохгүй.',
      )(value as Record<string, unknown>, ctx);
    }
  });

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    contractNumber: z.string().trim().max(64).nullish(),
    responsibleEmployeeId: objectIdSchema.nullish(),
    startDate: isoDateSchema.nullish(),
    endDate: isoDateSchema.nullish(),
    description: z.string().trim().max(4000).nullish(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const projectListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  customerId: objectIdSchema.optional(),
  isActive: booleanQuerySchema.optional(),
  sortBy: z.enum(['name', 'code', 'startDate', 'createdAt']).default('name'),
  sortDir: sortDirSchema,
});

// -- Building ----------------------------------------------------------------

const latitude = z
  .number()
  .min(-90, 'Өргөрөг -90 ба 90 хооронд байна.')
  .max(90, 'Өргөрөг -90 ба 90 хооронд байна.');
const longitude = z
  .number()
  .min(-180, 'Уртраг -180 ба 180 хооронд байна.')
  .max(180, 'Уртраг -180 ба 180 хооронд байна.');

const buildingCoordinateRefinement = (
  value: { gpsLatitude?: number | null; gpsLongitude?: number | null },
  ctx: z.RefinementCtx,
): void => {
  // A half-supplied coordinate points nowhere, so both or neither.
  const hasLat = value.gpsLatitude !== null && value.gpsLatitude !== undefined;
  const hasLng = value.gpsLongitude !== null && value.gpsLongitude !== undefined;
  if (hasLat !== hasLng) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [hasLat ? 'gpsLongitude' : 'gpsLatitude'],
      message: 'Өргөрөг, уртрагийг хамт бөглөнө.',
    });
  }
};

export const createBuildingSchema = z
  .object({
    projectId: objectIdSchema,
    name: z.string().trim().min(2, 'Барилгын нэр заавал.').max(200),
    address: z.string().trim().max(500).nullish(),
    gpsLatitude: latitude.nullish(),
    gpsLongitude: longitude.nullish(),
    description: z.string().trim().max(4000).nullish(),
  })
  .superRefine(buildingCoordinateRefinement);

export const updateBuildingSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    address: z.string().trim().max(500).nullish(),
    gpsLatitude: latitude.nullish(),
    gpsLongitude: longitude.nullish(),
    description: z.string().trim().max(4000).nullish(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine(buildingCoordinateRefinement);

export const buildingListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  projectId: objectIdSchema.optional(),
  customerId: objectIdSchema.optional(),
  isActive: booleanQuerySchema.optional(),
});

// -- Floor -------------------------------------------------------------------

export const createFloorSchema = z.object({
  buildingId: objectIdSchema,
  name: z.string().trim().min(1, 'Давхрын нэр заавал.').max(200),
  /** Signed so a basement can be -1. */
  floorNumber: z.number().int('Давхрын дугаар бүхэл тоо байна.').min(-20).max(200).nullish(),
  areaSqm: z.number().positive('Талбай 0-ээс их байна.').nullish(),
  purpose: z.string().trim().max(200).nullish(),
  description: z.string().trim().max(4000).nullish(),
});

export const updateFloorSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    floorNumber: z.number().int().min(-20).max(200).nullish(),
    areaSqm: z.number().positive().nullish(),
    purpose: z.string().trim().max(200).nullish(),
    description: z.string().trim().max(4000).nullish(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const floorListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().trim().max(200).optional(),
  buildingId: objectIdSchema.optional(),
  projectId: objectIdSchema.optional(),
  isActive: booleanQuerySchema.optional(),
  hasPlanImage: booleanQuerySchema.optional(),
});

/** Metadata carried with a plan upload, and editable afterwards on its own. */
export const floorPlanMetaSchema = z.object({
  title: z.string().trim().max(200).nullish(),
  description: z.string().trim().max(2000).nullish(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProjectListQueryInput = z.infer<typeof projectListQuerySchema>;
export type CreateBuildingInput = z.infer<typeof createBuildingSchema>;
export type UpdateBuildingInput = z.infer<typeof updateBuildingSchema>;
export type BuildingListQueryInput = z.infer<typeof buildingListQuerySchema>;
export type CreateFloorInput = z.infer<typeof createFloorSchema>;
export type UpdateFloorInput = z.infer<typeof updateFloorSchema>;
export type FloorListQueryInput = z.infer<typeof floorListQuerySchema>;
export type FloorPlanMetaInput = z.infer<typeof floorPlanMetaSchema>;
