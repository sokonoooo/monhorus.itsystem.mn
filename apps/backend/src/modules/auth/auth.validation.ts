import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Shared password policy. Applied to new passwords only, never to a login attempt. */
export const strongPasswordSchema = z
  .string({ required_error: 'Нууц үг заавал.' })
  .min(PASSWORD_MIN_LENGTH, `Нууц үг дор хаяж ${PASSWORD_MIN_LENGTH} тэмдэгттэй байна.`)
  .max(PASSWORD_MAX_LENGTH, `Нууц үг ${PASSWORD_MAX_LENGTH} тэмдэгтээс урт байж болохгүй.`)
  .regex(/[A-Za-zА-Яа-яӨөҮү]/, 'Нууц үг дор хаяж нэг үсэг агуулна.')
  .regex(/\d/, 'Нууц үг дор хаяж нэг тоо агуулна.');

export const emailSchema = z
  .string({ required_error: 'Имэйл заавал.' })
  .trim()
  .toLowerCase()
  .email('Имэйл хаяг буруу форматтай байна.')
  .max(254);

/** POST /api/v1/auth/login */
export const loginSchema = z.object({
  email: emailSchema,
  // Deliberately not strength-checked: an existing password must be accepted
  // verbatim even if the policy has since been tightened.
  password: z.string({ required_error: 'Нууц үг заавал.' }).min(1, 'Нууц үг заавал.'),
});

/** POST /api/v1/auth/refresh */
export const refreshSchema = z.object({
  refreshToken: z.string({ required_error: 'Refresh token заавал.' }).min(20),
});

/** POST /api/v1/auth/logout */
export const logoutSchema = z.object({
  refreshToken: z.string({ required_error: 'Refresh token заавал.' }).min(20),
});

/** POST /api/v1/auth/change-password */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ required_error: 'Одоогийн нууц үг заавал.' }).min(1),
    newPassword: strongPasswordSchema,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'Шинэ нууц үг өмнөхөөсөө ялгаатай байна.',
  });

/**
 * Asking for a reset link.
 *
 * Only an address, and it is validated only for shape. Whether it belongs to anybody is
 * never revealed to the caller — see `requestPasswordReset`.
 */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

/**
 * Redeeming a reset link.
 *
 * The token is checked for length only. Anything more specific — a format, a prefix — would
 * hand back a way to tell a malformed token from a wrong one, and the endpoint answers the
 * same either way.
 */
export const resetPasswordSchema = z.object({
  token: z
    .string({ required_error: 'Холбоос буруу байна.' })
    .min(16, 'Холбоос буруу байна.')
    .max(256, 'Холбоос буруу байна.'),
  newPassword: strongPasswordSchema,
});

export type LoginBody = z.infer<typeof loginSchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
export type RefreshBody = z.infer<typeof refreshSchema>;
export type LogoutBody = z.infer<typeof logoutSchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;
