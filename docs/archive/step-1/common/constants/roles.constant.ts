/**
 * Role model per requirement section 3 (Оролцогч талууд).
 * Three top-level roles; the admin role is further split by sub-permission (3.1).
 */
export const USER_ROLES = ['ADMIN', 'EMPLOYEE', 'CUSTOMER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_ROLE_LABELS_MN: Record<UserRole, string> = {
  ADMIN: 'Админ',
  EMPLOYEE: 'Ажилтан',
  CUSTOMER: 'Хэрэглэгч',
};

/**
 * Internal admin duties per requirement 3.1 (Админ дорх дотоод үүрэг).
 * SYSTEM_ADMIN implicitly satisfies every other permission check.
 */
export const ADMIN_PERMISSIONS = [
  'MANAGEMENT',
  'DISPATCH',
  'FINANCE',
  'SALES',
  'SYSTEM_ADMIN',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const ADMIN_PERMISSION_LABELS_MN: Record<AdminPermission, string> = {
  MANAGEMENT: 'Менежмент',
  DISPATCH: 'Dispatch',
  FINANCE: 'Санхүү',
  SALES: 'Борлуулалт/харилцагч',
  SYSTEM_ADMIN: 'Системийн админ',
};

export const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_LABELS_MN: Record<UserStatus, string> = {
  INVITED: 'Урьсан',
  ACTIVE: 'Идэвхтэй',
  SUSPENDED: 'Түр зогсоосон',
  DISABLED: 'Идэвхгүй',
};

/** Only ACTIVE accounts may hold a session. */
export const LOGIN_ALLOWED_STATUSES: readonly UserStatus[] = ['ACTIVE'];

export const SUPPORTED_LOCALES = ['mn', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
