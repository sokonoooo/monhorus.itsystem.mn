import {
  PERMISSIONS,
  changeEmployeeStatusSchema,
  createEmployeeSchema,
  employeeListQuerySchema,
  employeeSalarySchema,
  linkSystemAccessSchema,
  systemAccessActionSchema,
  updateEmployeeSchema,
  updateSystemAccessRolesSchema,
} from '@monhorus/shared';
import { Router } from 'express';
import { z } from 'zod';

import { authenticate, enforcePasswordChange } from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { employeeDocumentRouter } from '../storage/storage.routes';
import * as employeeController from './employee.controller';

const employeeIdParamSchema = z.object({
  employeeId: z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.'),
});

export const employeeRouter = Router();

// Authentication and the forced-password-change gate apply to the whole module.
// Individual permissions are then asserted per route.
employeeRouter.use(authenticate, enforcePasswordChange);

employeeRouter.get(
  '/',
  requirePermission(PERMISSIONS.EMPLOYEE_VIEW),
  validate({ query: employeeListQuerySchema }),
  employeeController.listEmployeesHandler,
);

employeeRouter.post(
  '/',
  requirePermission(PERMISSIONS.EMPLOYEE_CREATE),
  validate({ body: createEmployeeSchema }),
  employeeController.createEmployeeHandler,
);

/**
 * The signed-in account's own employee record.
 *
 * MOUNT ORDER IS LOAD-BEARING. Express matches in declaration order, so this must stay
 * above `/:employeeId` or 'me' is captured as an employee id — where it would fail the
 * ObjectId regex and 400, silently taking the endpoint away.
 *
 * AUTHENTICATION ONLY, no permission key. Deliberate:
 *
 *   - There is nothing to authorise. The record returned is chosen by the server from
 *     `req.auth.employeeId`; the request carries no id, so the endpoint has exactly one
 *     possible answer per caller and cannot be pointed at anyone else. `employee.view` is
 *     the key for reading OTHER people, and requiring it here is what produced the leak
 *     this endpoint exists to fix: the mobile app was granted directory-wide read purely
 *     so it could find its own row, and got every colleague's РД, phone and email with it.
 *   - A new narrow key (`employee.view_self`) was considered and rejected. It would have to
 *     be seeded on every staff role and migrated onto every existing role document, and
 *     `seedRbac` is prune-only, so any role an administrator had already trimmed would
 *     never receive it — leaving accounts that can sign in but cannot see who they are, for
 *     no gain, since the key would be granted to everyone who could ever call this anyway.
 *   - It is consistent with `GET /auth/me`, which likewise gates self-identity on
 *     authentication alone.
 *
 * A caller with no employee link (an admin or a customer, ordinarily) gets a 404 carrying a
 * message that says so, not an empty profile.
 */
employeeRouter.get('/me', employeeController.getMyEmployeeRecordHandler);

employeeRouter.get(
  '/:employeeId',
  requirePermission(PERMISSIONS.EMPLOYEE_VIEW),
  validate({ params: employeeIdParamSchema }),
  employeeController.getEmployeeHandler,
);

employeeRouter.patch(
  '/:employeeId',
  requirePermission(PERMISSIONS.EMPLOYEE_UPDATE),
  validate({ params: employeeIdParamSchema, body: updateEmployeeSchema }),
  employeeController.updateEmployeeHandler,
);

employeeRouter.post(
  '/:employeeId/status',
  requirePermission(PERMISSIONS.EMPLOYEE_CHANGE_STATUS),
  validate({ params: employeeIdParamSchema, body: changeEmployeeStatusSchema }),
  employeeController.changeStatusHandler,
);

// Salary is gated by its own pair of permissions. A caller with employee.view but
// without employee.view_salary receives a detail payload with the field absent.
employeeRouter.get(
  '/:employeeId/salary',
  requirePermission(PERMISSIONS.EMPLOYEE_VIEW_SALARY),
  validate({ params: employeeIdParamSchema }),
  employeeController.listSalaryHandler,
);

employeeRouter.post(
  '/:employeeId/salary',
  requirePermission(PERMISSIONS.EMPLOYEE_MANAGE_SALARY),
  validate({ params: employeeIdParamSchema, body: employeeSalarySchema }),
  employeeController.upsertSalaryHandler,
);

employeeRouter.get(
  '/:employeeId/certificate',
  requirePermission(PERMISSIONS.EMPLOYEE_PRINT_CERTIFICATE),
  validate({ params: employeeIdParamSchema }),
  employeeController.certificateHandler,
);

// Linking an employee to a login is separately permissioned from editing the record.
employeeRouter.post(
  '/:employeeId/system-access',
  requirePermission(PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS),
  validate({ params: employeeIdParamSchema, body: linkSystemAccessSchema }),
  employeeController.systemAccessHandler,
);

// The rest of the access lifecycle. Each action is refused server-side when it targets
// the caller's own account, whatever permissions the caller holds.
employeeRouter.patch(
  '/:employeeId/system-access/roles',
  requirePermission(PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS),
  validate({ params: employeeIdParamSchema, body: updateSystemAccessRolesSchema }),
  employeeController.systemAccessRolesHandler,
);

employeeRouter.post(
  '/:employeeId/system-access/suspend',
  requirePermission(PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS),
  validate({ params: employeeIdParamSchema, body: systemAccessActionSchema }),
  employeeController.suspendSystemAccessHandler,
);

employeeRouter.post(
  '/:employeeId/system-access/restore',
  requirePermission(PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS),
  validate({ params: employeeIdParamSchema, body: systemAccessActionSchema }),
  employeeController.restoreSystemAccessHandler,
);

// Revoking unlinks the login from the employee. Neither the employee record nor the
// user document is deleted, so the audit trail stays intact.
employeeRouter.post(
  '/:employeeId/system-access/revoke',
  requirePermission(PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS),
  validate({ params: employeeIdParamSchema, body: systemAccessActionSchema }),
  employeeController.revokeSystemAccessHandler,
);

// Documents are a sub-resource of an employee; mergeParams gives the child router
// access to :employeeId so ownership can be enforced on every operation.
employeeRouter.use('/:employeeId/documents', employeeDocumentRouter);
