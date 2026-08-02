import { z } from 'zod';

import { OBJECT_NODE_KINDS } from '../types/object.types';
import { emailSchema, objectIdSchema, phoneSchema } from './common.schema';

/**
 * Customer and object-hierarchy write schemas.
 *
 * Requirements rule 17.2: a V1 customer is always an organisation, so there is no
 * individual-customer variant here even though the admin prototype offers one.
 */
export const createCustomerSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Код дор хаяж 2 тэмдэгттэй байна.')
    .max(32)
    .regex(/^[A-Z0-9-]+$/, 'Код зөвхөн том үсэг, тоо, зураас агуулна.'),
  name: z.string().trim().min(2, 'Нэр заавал.').max(200),
  registrationNumber: z.string().trim().max(32).nullish(),
  taxNumber: z.string().trim().max(32).nullish(),
  phone: phoneSchema.nullish(),
  email: emailSchema.nullish(),
  address: z.string().trim().max(500).nullish(),
  contactPerson: z.string().trim().max(200).nullish(),
  responsibleEmployeeId: objectIdSchema.nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const createObjectNodeSchema = z.object({
  kind: z.enum(OBJECT_NODE_KINDS, { required_error: 'Объектын төрөл заавал.' }),
  code: z.string().trim().min(1, 'Код заавал.').max(64),
  name: z.string().trim().min(1, 'Нэр заавал.').max(200),
  customerId: objectIdSchema,
  /** Null only for a root-level node such as a project. */
  parentId: objectIdSchema.nullish(),
  riskScore: z
    .number()
    .int('Оноо бүхэл тоо байна.')
    .min(0, 'Оноо 0-ээс бага байж болохгүй.')
    .max(100, 'Оноо 100-аас их байж болохгүй.')
    .nullish(),
});

export const updateObjectNodeSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  code: z.string().trim().min(1).max(64).optional(),
  riskScore: z.number().int().min(0).max(100).nullish(),
  isActive: z.boolean().optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CreateObjectNodeInput = z.infer<typeof createObjectNodeSchema>;
export type UpdateObjectNodeInput = z.infer<typeof updateObjectNodeSchema>;
