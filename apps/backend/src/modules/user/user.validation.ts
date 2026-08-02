import { ACCOUNT_STATUSES, USER_ROLES } from '@monhorus/shared';
import { z } from 'zod';

import { emailSchema, strongPasswordSchema } from '../auth/auth.validation';

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');

const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+976)?[- ]?\d{4}[- ]?\d{4}$/, 'Утасны дугаар буруу форматтай байна.');

/** POST /api/v1/users - an admin provisions an account. No self-registration exists. */
export const createUserSchema = z.object({
  fullName: z
    .string({ required_error: 'Нэр заавал.' })
    .trim()
    .min(2, 'Нэр дор хаяж 2 тэмдэгттэй байна.')
    .max(200),
  email: emailSchema,
  password: strongPasswordSchema,
  phone: phoneSchema.nullish(),
  role: z.enum(USER_ROLES, { required_error: 'Эрх заавал сонгоно.' }),
  // Shape only. Whether the link is required, forbidden or points at a real organisation
  // is decided in the service, because the answer depends on the role and on the account
  // as it exists in the database.
  customerId: objectIdSchema.nullish(),
  /**
   * Dynamic RBAC roles for the new account, optional.
   *
   * Omitted — or sent empty, which a form that always submits the field cannot avoid —
   * means "use the default for the chosen role", resolved in the service. An empty array
   * is deliberately NOT read as "no permissions at all": that is precisely the state that
   * left every created account locked out, and nothing about a blank picker says an admin
   * wanted it. Whether the picked roles are allowed at all is decided in the service,
   * because that answer depends on the caller's own permissions.
   */
  roleIds: z.array(objectIdSchema).max(20, 'Хэт олон role сонгосон байна.').optional(),
  requirePasswordChange: z.boolean().default(true),
});

/**
 * PATCH /api/v1/users/:userId - an admin edits an existing account.
 *
 * Every field is optional so a caller can change one thing without restating the rest.
 * `customerId` distinguishes absent from null on purpose: absent keeps whatever link the
 * account already has, null is an explicit request to clear it.
 */
export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Нэр дор хаяж 2 тэмдэгттэй байна.').max(200).optional(),
    phone: phoneSchema.nullish(),
    role: z.enum(USER_ROLES).optional(),
    customerId: objectIdSchema.nullable().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine(
    (value) =>
      value.fullName !== undefined ||
      value.phone !== undefined ||
      value.role !== undefined ||
      value.customerId !== undefined,
    { message: 'Өөрчлөх талбар заавал илгээнэ.' },
  );

/** POST /api/v1/users/:userId/reset-passcode */
export const resetPasscodeSchema = z.object({
  newPassword: strongPasswordSchema,
  reason: z.string().trim().max(500).optional(),
});

export const userIdParamSchema = z.object({
  userId: objectIdSchema,
});

/** PATCH /api/v1/users/:userId/status */
export const updateUserStatusSchema = z.object({
  status: z.enum(['active', 'suspended'], {
    required_error: 'Төлөв заавал.',
    invalid_type_error: 'Зөвхөн active эсвэл suspended утга зөвшөөрнө.',
  }),
  reason: z.string().trim().max(500).optional(),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
  search: z.string().trim().max(200).optional(),
  // Narrows the directory to one organisation's portal accounts, so a customer screen can
  // show its own logins without reading the whole directory and filtering client-side.
  customerId: objectIdSchema.optional(),
});

export type CreateUserBody = z.infer<typeof createUserSchema>;
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
export type ResetPasscodeBody = z.infer<typeof resetPasscodeSchema>;
export type UpdateUserStatusBody = z.infer<typeof updateUserStatusSchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UserIdParam = z.infer<typeof userIdParamSchema>;
