import { PERMISSIONS } from '@monhorus/shared';
import { Router } from 'express';

import { authenticate, enforcePasswordChange } from '../../middlewares/authenticate.middleware';
import { authorize, requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as userController from './user.controller';
import {
  createUserSchema,
  listUsersQuerySchema,
  resetPasscodeSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userIdParamSchema,
} from './user.validation';

export const userRouter = Router();

/**
 * Every route below is authenticated, blocked while a password change is pending,
 * and restricted to administrative roles. This is the RBAC boundary the spec
 * requires for user creation and passcode reset.
 *
 * The tier is kept and a permission key is required ON TOP of it, per route, because the
 * two answer different questions: the tier says which kind of account may reach the user
 * module at all, and the key says which of these endpoints this particular account was
 * granted. Reading the register and rewriting it are not the same authority, so they do not
 * share a key and the requirement is not mounted here as a blanket `use`. Every seeded
 * administrator holds both keys, so no existing account loses anything.
 */
userRouter.use(authenticate, enforcePasswordChange, authorize('admin', 'head_admin'));

// The register read. `user.view` and not `user.manage`, because the employee screen's
// "link an existing account" picker loads this list to fill a dropdown and has no business
// being able to write anything.
userRouter.get(
  '/',
  requirePermission(PERMISSIONS.USER_VIEW),
  validate({ query: listUsersQuerySchema }),
  userController.listUsersHandler,
);

userRouter.get(
  '/:userId',
  requirePermission(PERMISSIONS.USER_VIEW),
  validate({ params: userIdParamSchema }),
  userController.getUserHandler,
);

// User creation: admin and head_admin holding user.manage. A plain admin attempting to
// create an admin or head_admin is rejected inside the service by assertCanManageRole.
//
// The gates above are a legacy-tier check plus the key for writing the user register, which
// is enough for creating an account but NOT for choosing its dynamic roles: that is role
// assignment, and it is decided by `role-assignment.service.ts`, the single chokepoint every
// write to a user's `roles` in this backend passes through. No third middleware is mounted
// here, because the rule applies only when `roleIds` actually names a selection — an absent
// or empty array means "use the tier default" — and a router-level guard cannot make that
// distinction without restating the policy it exists to centralise.
//
// Do not read this as "role assignment is rbac.manage and that is the whole rule". It is
// not, on this route or on any other: `rbac.manage` is the entry gate for assigning ORDINARY
// roles, and the chokepoint additionally caps what may be delegated, requires
// `rbac.manage_protected` for anything touching SYSTEM_ADMIN or the head_admin tier, refuses
// a tier/role pairing that would produce a cross-tenant reader, and refuses a self-target
// outright.
userRouter.post(
  '/',
  requirePermission(PERMISSIONS.USER_MANAGE),
  validate({ body: createUserSchema }),
  userController.createUserHandler,
);

// Passcode reset: same entry gate, same target-role restriction, so only a
// head_admin can reset another administrator's credential.
userRouter.post(
  '/:userId/reset-passcode',
  requirePermission(PERMISSIONS.USER_MANAGE),
  validate({ params: userIdParamSchema, body: resetPasscodeSchema }),
  userController.resetPasscodeHandler,
);

// Account edit, including the customer organisation the account is scoped to. No key of its
// own: the router-level admin gate, `user.manage` and assertCanManageRole inside the service
// are the same authority that already governs creating and resetting an account, and the
// tenant link is not a weaker action than either of those.
userRouter.patch(
  '/:userId',
  requirePermission(PERMISSIONS.USER_MANAGE),
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  userController.updateUserHandler,
);

// Suspension is how access is taken away, so it is a write on the register like any other.
// The self-target refusal and assertCanManageRole still decide WHICH account may be acted
// on; this key only decides who may reach the endpoint at all.
userRouter.patch(
  '/:userId/status',
  requirePermission(PERMISSIONS.USER_MANAGE),
  validate({ params: userIdParamSchema, body: updateUserStatusSchema }),
  userController.updateUserStatusHandler,
);
