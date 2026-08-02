import type { PermissionKey } from '@monhorus/shared';

/**
 * Client-side permission helpers.
 *
 * Presentation only. The backend re-checks every permission on every request; these
 * helpers exist so the UI does not render controls that would return 403.
 */
export function hasPermission(
  granted: readonly PermissionKey[] | undefined,
  required: PermissionKey,
): boolean {
  return granted?.includes(required) ?? false;
}

export function hasAllPermissions(
  granted: readonly PermissionKey[] | undefined,
  required: readonly PermissionKey[],
): boolean {
  return required.every((key) => hasPermission(granted, key));
}

export function hasAnyPermission(
  granted: readonly PermissionKey[] | undefined,
  required: readonly PermissionKey[],
): boolean {
  if (required.length === 0) return true;
  return required.some((key) => hasPermission(granted, key));
}
