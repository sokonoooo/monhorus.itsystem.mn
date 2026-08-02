import {
  PERMISSIONS,
  assignRolesSchema,
  createRoleSchema,
  updateRoleSchema,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { created, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import { authenticate, enforcePasswordChange, requireAuth } from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { recordAudit } from '../audit/audit.service';
import { User } from '../user/user.model';
import * as rbacService from './rbac.service';
import { applyRoleAssignment } from './role-assignment.service';

const roleIdParamSchema = z.object({
  roleId: z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.'),
});

export const rbacRouter = Router();

rbacRouter.use(authenticate, enforcePasswordChange);

rbacRouter.get(
  '/permissions',
  requirePermission(PERMISSIONS.RBAC_VIEW),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await rbacService.listPermissions());
    } catch (error) {
      next(error);
    }
  },
);

rbacRouter.get(
  '/roles',
  requirePermission(PERMISSIONS.RBAC_VIEW),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await rbacService.listRoles());
    } catch (error) {
      next(error);
    }
  },
);

rbacRouter.post(
  '/roles',
  requirePermission(PERMISSIONS.RBAC_MANAGE),
  validate({ body: createRoleSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const role = await rbacService.createRole(req.body, auth);

      await recordAudit({
        entityType: 'Permission',
        entityId: role.id,
        action: 'Created',
        actor: { id: auth.userId, role: auth.role, label: auth.fullName },
        meta: meta(req),
        newValue: { key: role.key, permissions: role.permissions },
      });

      created(res, role, 'Role амжилттай үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

rbacRouter.patch(
  '/roles/:roleId',
  requirePermission(PERMISSIONS.RBAC_MANAGE),
  validate({ params: roleIdParamSchema, body: updateRoleSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const { before, after } = await rbacService.updateRole(
        pathParam(req, 'roleId'),
        req.body,
        auth,
      );

      await recordAudit({
        entityType: 'Permission',
        entityId: after.id,
        action: 'Updated',
        actor: { id: auth.userId, role: auth.role, label: auth.fullName },
        meta: meta(req),
        oldValue: { permissions: before.permissions },
        newValue: { permissions: after.permissions },
      });

      ok(res, after, 'Role шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

rbacRouter.delete(
  '/roles/:roleId',
  requirePermission(PERMISSIONS.RBAC_MANAGE),
  validate({ params: roleIdParamSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const role = await rbacService.deleteRole(pathParam(req, 'roleId'), auth);

      await recordAudit({
        entityType: 'Permission',
        entityId: role.id,
        action: 'Cancelled',
        actor: { id: auth.userId, role: auth.role, label: auth.fullName },
        meta: meta(req),
        oldValue: { key: role.key, permissions: role.permissions },
      });

      ok(res, role, 'Role устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Assigns dynamic roles to a user. Separate from the legacy coarse tier.
 *
 * `rbac.manage` on the router is the ENTRY gate and, on its own, decides nothing. The
 * handler used to be the whole implementation — `user.roles = roleIds; await user.save()`
 * — with no cap, no self-target refusal and no protected-role rule, which made this route
 * the shortest path to owning the installation: an actor holding only `rbac.manage`
 * assigned SYSTEM_ADMIN to a victim and to ITSELF and held the entire catalogue on the
 * next request. It also handed the portal-only CUSTOMER role to a technician-tier account
 * (an unfiltered cross-tenant reader), rewrote the head_admin's roles from an admin-tier
 * session, and accepted `roleIds: []` to strip any account to nothing.
 *
 * The decision now belongs entirely to `applyRoleAssignment`, which every other role-write
 * path in the backend also goes through. Nothing about the rules is restated here.
 */
rbacRouter.post(
  '/users/:userId/roles',
  requirePermission(PERMISSIONS.RBAC_MANAGE),
  validate({
    params: z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i) }),
    body: assignRolesSchema,
  }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const user = await User.findById(pathParam(req, 'userId')).select('roles email role status');
      if (!user) {
        // A 404, not a 200 carrying null. The old shape reported "not found" with a success
        // status, which read to a client as an assignment that had quietly done nothing.
        throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хэрэглэгч олдсонгүй.');
      }

      const outcome = await applyRoleAssignment({
        target: user,
        // This endpoint never changes the tier; the account keeps the one it has, and the
        // coherence rule is applied against it.
        targetTier: user.role,
        requested: { kind: 'EXPLICIT', roleIds: req.body.roleIds },
        actor: auth,
        meta: meta(req),
        source: 'POST /rbac/users/:userId/roles',
        reason: 'roles assigned',
      });

      await user.save();

      await recordAudit({
        entityType: 'User',
        entityId: user._id,
        action: 'Updated',
        actor: { id: auth.userId, role: auth.role, label: auth.fullName },
        meta: meta(req),
        reason: 'roles assigned',
        oldValue: { roles: outcome.before },
        newValue: { roles: outcome.after },
      });

      ok(res, { userId: String(user._id), roleIds: outcome.after }, 'Эрх шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);
