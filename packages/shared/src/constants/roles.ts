export const USER_ROLES = ['customer', 'technician', 'admin', 'head_admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = ['active', 'suspended', 'must_change_password'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Roles permitted to reach user-management endpoints. */
export const ADMIN_ROLES: readonly UserRole[] = ['admin', 'head_admin'];

/**
 * Roles that only a head_admin may create or act upon. A plain admin manages
 * customers and technicians; elevating or resetting another administrator is
 * reserved for the head_admin.
 */
export const PRIVILEGED_ROLES: readonly UserRole[] = ['admin', 'head_admin'];

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  customer: 'Харилцагч',
  technician: 'Ажилтан',
  admin: 'Админ',
  head_admin: 'Ерөнхий админ',
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: 'Идэвхтэй',
  suspended: 'Түр хаагдсан',
  must_change_password: 'Нууц үг солих шаардлагатай',
};

export function isAdminRole(role: UserRole): boolean {
  return ADMIN_ROLES.includes(role);
}

export function isPrivilegedRole(role: UserRole): boolean {
  return PRIVILEGED_ROLES.includes(role);
}

/**
 * Single source of truth for the target-role rule, shared by the backend guard and
 * by both clients so the UI never offers an action the API will reject.
 */
export function canManageRole(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'head_admin') return true;
  if (actorRole === 'admin') return !isPrivilegedRole(targetRole);
  return false;
}
