import { z } from 'zod';

import { ALL_PERMISSIONS, type PermissionKey } from '../constants/permissions';
import { objectIdSchema } from './common.schema';

/**
 * Permission keys are validated against the canonical catalogue, so a role can
 * never be granted a permission the backend does not know how to enforce.
 */
export const permissionKeySchema = z.custom<PermissionKey>(
  (value) => typeof value === 'string' && (ALL_PERMISSIONS as readonly string[]).includes(value),
  { message: 'Тодорхойгүй permission.' },
);

export const roleKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Role key дор хаяж 2 тэмдэгттэй байна.')
  .max(48)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Role key зөвхөн том үсэг, тоо, доогуур зураас агуулна.');

export const createRoleSchema = z.object({
  key: roleKeySchema,
  name: z.string().trim().min(2, 'Нэр заавал.').max(120),
  description: z.string().trim().max(500).nullish(),
  permissions: z.array(permissionKeySchema).max(200).default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullish(),
  permissions: z.array(permissionKeySchema).max(200).optional(),
});

export const assignRolesSchema = z.object({
  roleIds: z.array(objectIdSchema).max(20),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type AssignRolesInput = z.infer<typeof assignRolesSchema>;
