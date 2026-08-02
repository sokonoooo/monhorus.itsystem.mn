import { canManageRole, type PermissionKey, type UserRole } from '@monhorus/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '../common/errors/app-error';
import { ERROR_CODES } from '../common/errors/error-codes';

/**
 * Permission gate for the dynamic RBAC model. Must run after `authenticate`, which
 * resolves the effective permission set onto req.auth.
 *
 * Passing several keys requires ALL of them. For an any-of check use
 * `requireAnyPermission`.
 */
export function requirePermission(...required: PermissionKey[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;

    if (!auth) {
      next(AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED));
      return;
    }

    const missing = required.filter((key) => !auth.permissions.has(key));
    if (missing.length > 0) {
      next(
        AppError.forbidden(
          ERROR_CODES.FORBIDDEN,
          'Энэ үйлдлийг хийх эрх байхгүй байна.',
        ),
      );
      return;
    }

    next();
  };
}

export function requireAnyPermission(...accepted: PermissionKey[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;

    if (!auth) {
      next(AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED));
      return;
    }

    if (!accepted.some((key) => auth.permissions.has(key))) {
      next(AppError.forbidden());
      return;
    }

    next();
  };
}

/** Imperative check for use inside a service, where a guard cannot be mounted. */
export function hasPermission(
  auth: { permissions: ReadonlySet<PermissionKey> } | undefined,
  key: PermissionKey,
): boolean {
  return auth?.permissions.has(key) ?? false;
}

export function assertPermission(
  auth: { permissions: ReadonlySet<PermissionKey> } | undefined,
  key: PermissionKey,
): void {
  if (!hasPermission(auth, key)) {
    throw AppError.forbidden();
  }
}

/**
 * Role-Based Access Control gate. Must run after `authenticate`.
 *
 * Usage:
 *   authorize('admin', 'head_admin')   // user creation, passcode reset
 *   authorize('head_admin')            // reserved operations
 */
export function authorize(...allowedRoles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;

    if (!auth) {
      next(AppError.unauthorized(ERROR_CODES.UNAUTHENTICATED));
      return;
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(auth.role)) {
      next(AppError.forbidden());
      return;
    }

    next();
  };
}

/**
 * Second-tier privilege check applied to the TARGET of an operation.
 *
 * The specification lets both admins and head_admins provision users and reset
 * passcodes, but acting on another administrator is reserved for the head_admin.
 * Without this check a plain admin could mint a head_admin account, or reset the
 * head_admin's passcode, and take over the system.
 */
export function assertCanManageRole(actorRole: UserRole, targetRole: UserRole): void {
  if (canManageRole(actorRole, targetRole)) {
    return;
  }

  if (actorRole === 'admin') {
    throw AppError.forbidden(
      ERROR_CODES.INSUFFICIENT_PRIVILEGES,
      'Админ эрхтэй хэрэглэгчийг зөвхөн ерөнхий админ удирдана.',
    );
  }

  throw AppError.forbidden();
}
