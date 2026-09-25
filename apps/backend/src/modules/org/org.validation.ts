import { booleanQuerySchema, objectIdSchema, paginationQuerySchema } from '@monhorus/shared';
import { z } from 'zod';

/**
 * Request shapes for the organisation master data.
 *
 * NO SCHEMA HERE ACCEPTS A `code`. Codes are issued by the server from an atomic counter,
 * so a field the client could send would be a field the client could duplicate — and one
 * that could be edited would stop being an identifier the moment somebody used it.
 */

const nameSchema = z
  .string({ required_error: 'Нэр заавал.' })
  .trim()
  .min(2, 'Нэр дор хаяж 2 тэмдэгттэй байна.')
  .max(200);

/**
 * One query shape for every list.
 *
 * `page`/`limit` default rather than being required because the dependent selectors on the
 * employee form ask for a list without knowing anything about paging, and must keep
 * receiving a usable first page.
 */
export const orgListQuerySchema = paginationQuerySchema.extend({
  companyId: objectIdSchema.optional(),
  departmentId: objectIdSchema.optional(),
  includeInactive: booleanQuerySchema.optional(),
  search: z.string().trim().max(200).optional(),
});

export const createCompanySchema = z.object({
  name: nameSchema,
  registrationNumber: z.string().trim().max(32).nullish(),
  address: z.string().trim().max(500).nullish(),
});

export const updateCompanySchema = z
  .object({
    name: nameSchema.optional(),
    registrationNumber: z.string().trim().max(32).nullish(),
    address: z.string().trim().max(500).nullish(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.registrationNumber !== undefined ||
      value.address !== undefined,
    { message: 'Өөрчлөх талбар заавал илгээнэ.' },
  );

export const createDepartmentSchema = z.object({
  companyId: objectIdSchema,
  name: nameSchema,
});

/** The company is deliberately absent: moving a department between companies would rewrite
 *  the org chart under everyone already assigned to it. */
export const updateDepartmentSchema = z.object({
  name: nameSchema,
});

export const createPositionSchema = z.object({
  companyId: objectIdSchema,
  // Null or absent means the position is valid across every department of the company.
  departmentId: objectIdSchema.nullish(),
  name: nameSchema,
});

export const updatePositionSchema = z
  .object({
    name: nameSchema.optional(),
    // Nullable on purpose: null narrows nothing and re-scopes the position company-wide,
    // which is a different request from omitting the field and keeping the current one.
    departmentId: objectIdSchema.nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.departmentId !== undefined, {
    message: 'Өөрчлөх талбар заавал илгээнэ.',
  });

/** Activate/deactivate. Deactivating hides a record from new selections and leaves every
 *  existing assignment intact, so it carries no confirmation or reason field. */
export const setOrgActiveSchema = z.object({
  isActive: z.boolean({ required_error: 'Төлөв заавал.' }),
});

export const companyIdParamSchema = z.object({ companyId: objectIdSchema });
export const departmentIdParamSchema = z.object({ departmentId: objectIdSchema });
export const positionIdParamSchema = z.object({ positionId: objectIdSchema });

export type OrgListQuery = z.infer<typeof orgListQuerySchema>;
export type CreateCompanyBody = z.infer<typeof createCompanySchema>;
export type UpdateCompanyBody = z.infer<typeof updateCompanySchema>;
export type CreateDepartmentBody = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentBody = z.infer<typeof updateDepartmentSchema>;
export type CreatePositionBody = z.infer<typeof createPositionSchema>;
export type UpdatePositionBody = z.infer<typeof updatePositionSchema>;
export type SetOrgActiveBody = z.infer<typeof setOrgActiveSchema>;
