import { z } from 'zod';

import { MATERIAL_CATEGORIES, MATERIAL_UNITS } from '../constants/material';
import { booleanQuerySchema, isoDateSchema, objectIdSchema, sortDirSchema } from './common.schema';

/**
 * Material catalogue and per-sub-task usage.
 *
 * Shared verbatim by the Express validator and the web forms, so the two cannot drift.
 * Nothing here validates availability: there are no stock balances to check against, and
 * inventing a check that always passes would read as one that works.
 */

export const materialCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Материалын код дор хаяж 2 тэмдэгттэй байна.')
  .max(32, 'Материалын код 32 тэмдэгтээс урт байж болохгүй.')
  .regex(/^[A-Z0-9./-]+$/, 'Материалын код зөвхөн үсэг, тоо, зураас, цэг агуулна.');

export const createMaterialItemSchema = z.object({
  code: materialCodeSchema,
  name: z.string().trim().min(1, 'Нэр заавал.').max(200),
  category: z.enum(MATERIAL_CATEGORIES, { required_error: 'Ангилал заавал.' }),
  defaultUnit: z.enum(MATERIAL_UNITS, { required_error: 'Хэмжих нэгж заавал.' }),
  description: z.string().trim().max(1000).nullish(),
});

/**
 * Every field optional, but at least one required.
 *
 * A PATCH with an empty body is a caller mistake, not a no-op worth a 200: it usually
 * means the form serialised nothing and the user believes they saved.
 */
export const updateMaterialItemSchema = createMaterialItemSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Өөрчлөх талбар заавал илгээнэ.',
  });

export const materialItemListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  search: z.string().trim().max(200).optional(),
  category: z.enum(MATERIAL_CATEGORIES).optional(),
  /** Omitted returns both; the pickers pass `true` so retired rows stop being offered. */
  isActive: booleanQuerySchema.optional(),
  sortBy: z.enum(['code', 'name', 'category', 'createdAt']).default('code'),
  sortDir: sortDirSchema.default('asc'),
});

/**
 * One material consumed on one sub-task.
 *
 * `usedByEmployeeId` is optional and defaults server-side to the caller's own employee
 * record: the common case is the technician recording what they themselves just used, and
 * making them pick their own name from a list is friction with no purpose. Naming someone
 * else stays possible for a supervisor writing up a crew's work.
 */
export const createTaskMaterialUsageSchema = z.object({
  materialItemId: objectIdSchema,
  quantity: z
    .number({ required_error: 'Тоо хэмжээ заавал.', invalid_type_error: 'Тоо хэмжээ буруу.' })
    .positive('Тоо хэмжээ 0-ээс их байна.')
    .max(1_000_000, 'Тоо хэмжээ хэт их байна.'),
  unit: z.enum(MATERIAL_UNITS, { required_error: 'Хэмжих нэгж заавал.' }),
  note: z.string().trim().max(1000).nullish(),
  usedByEmployeeId: objectIdSchema.nullish(),
  /** Defaults to now. Bounded server-side so a row cannot be dated into the future. */
  usedAt: isoDateSchema.optional(),
});

export const updateTaskMaterialUsageSchema = createTaskMaterialUsageSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Өөрчлөх талбар заавал илгээнэ.',
  });

export type CreateMaterialItemInput = z.infer<typeof createMaterialItemSchema>;
export type UpdateMaterialItemInput = z.infer<typeof updateMaterialItemSchema>;
export type MaterialItemListQueryInput = z.infer<typeof materialItemListQuerySchema>;
export type CreateTaskMaterialUsageInput = z.infer<typeof createTaskMaterialUsageSchema>;
export type UpdateTaskMaterialUsageInput = z.infer<typeof updateTaskMaterialUsageSchema>;
