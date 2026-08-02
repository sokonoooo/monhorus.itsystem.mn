import {
  PERMISSIONS,
  createObjectAssessmentSchema,
  createObjectSchema,
  createObjectTypeSchema,
  objectListQuerySchema,
  objectTypeListQuerySchema,
  updateObjectSchema,
  updateObjectTypeSchema,
  type CreateObjectAssessmentInput,
  type CreateObjectInput,
  type CreateObjectTypeInput,
  type ObjectListQueryInput,
  type ObjectTypeListQueryInput,
  type UpdateObjectInput,
  type UpdateObjectTypeInput,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import {
  resolveCustomerScope,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import { created, noContent, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requireAnyPermission, requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as reportQueryService from '../report-record/report-query.service';
import * as objectService from './object-master.service';
import * as objectTypeService from './object-type.service';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');

/**
 * The tenant every object handler reads and writes within.
 *
 * `requested` is honoured for staff and discarded for a customer, so a customer sending
 * another organisation's id gets their own records rather than that organisation's.
 */
function scopeOf(req: Request, requested?: string): ResolvedCustomerScope {
  return resolveCustomerScope(requireAuth(req), requested ?? null);
}

// -- Section 4.1 type registry ----------------------------------------------

export const objectTypeRouter = Router();

objectTypeRouter.use(authenticate, enforcePasswordChange);

objectTypeRouter.get(
  '/',
  requirePermission(PERMISSIONS.OBJECT_MASTER_VIEW),
  validate({ query: objectTypeListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(
        res,
        await objectTypeService.listObjectTypes(req.query as unknown as ObjectTypeListQueryInput),
      );
    } catch (error) {
      next(error);
    }
  },
);

objectTypeRouter.post(
  '/',
  requirePermission(PERMISSIONS.OBJECT_TYPE_MANAGE),
  validate({ body: createObjectTypeSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectTypeService.createObjectType(
        req.body as CreateObjectTypeInput,
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Тоноглолын төрөл үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

objectTypeRouter.get(
  '/:objectTypeId',
  requirePermission(PERMISSIONS.OBJECT_MASTER_VIEW),
  validate({ params: z.object({ objectTypeId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await objectTypeService.getObjectTypeById(pathParam(req, 'objectTypeId')));
    } catch (error) {
      next(error);
    }
  },
);

objectTypeRouter.patch(
  '/:objectTypeId',
  requirePermission(PERMISSIONS.OBJECT_TYPE_MANAGE),
  validate({ params: z.object({ objectTypeId: objectId }), body: updateObjectTypeSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectTypeService.updateObjectType(
        pathParam(req, 'objectTypeId'),
        req.body as UpdateObjectTypeInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Тоноглолын төрөл шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

objectTypeRouter.delete(
  '/:objectTypeId',
  requirePermission(PERMISSIONS.OBJECT_TYPE_MANAGE),
  validate({ params: z.object({ objectTypeId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await objectTypeService.deleteObjectType(
        pathParam(req, 'objectTypeId'),
        requireAuth(req),
        meta(req),
      );
      noContent(res, 'Тоноглолын төрөл устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

// -- Objects -----------------------------------------------------------------

export const objectMasterRouter = Router();

objectMasterRouter.use(authenticate, enforcePasswordChange);

objectMasterRouter.get(
  '/',
  requireAnyPermission(PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.PORTAL_OBJECT_VIEW),
  validate({ query: objectListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as ObjectListQueryInput;
      ok(res, await objectService.listObjects(query, scopeOf(req, query.customerId)));
    } catch (error) {
      next(error);
    }
  },
);

objectMasterRouter.post(
  '/',
  requirePermission(PERMISSIONS.OBJECT_MASTER_MANAGE),
  validate({ body: createObjectSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectService.createObject(
        req.body as CreateObjectInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Объект үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

objectMasterRouter.get(
  '/:objectId',
  requireAnyPermission(PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.PORTAL_OBJECT_VIEW),
  validate({ params: z.object({ objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await objectService.getObjectById(pathParam(req, 'objectId'), scopeOf(req)));
    } catch (error) {
      next(error);
    }
  },
);

objectMasterRouter.patch(
  '/:objectId',
  requirePermission(PERMISSIONS.OBJECT_MASTER_MANAGE),
  validate({ params: z.object({ objectId }), body: updateObjectSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectService.updateObject(
        pathParam(req, 'objectId'),
        req.body as UpdateObjectInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Объект шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

objectMasterRouter.delete(
  '/:objectId',
  requirePermission(PERMISSIONS.OBJECT_MASTER_MANAGE),
  validate({ params: z.object({ objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await objectService.deleteObject(
        pathParam(req, 'objectId'),
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      noContent(res, 'Объект устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

// -- Assessment and history --------------------------------------------------

/**
 * Records an assessment. Append-only: this endpoint never updates a previous entry, and
 * there is deliberately no PATCH or DELETE for an assessment.
 */
objectMasterRouter.post(
  '/:objectId/assessments',
  requirePermission(PERMISSIONS.OBJECT_MASTER_ASSESS),
  validate({ params: z.object({ objectId }), body: createObjectAssessmentSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectService.recordAssessment(
        pathParam(req, 'objectId'),
        req.body as CreateObjectAssessmentInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Үнэлгээ бүртгэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Deliberately staff-only. The timeline folds in audit rows, planned-work tasks and
 * internal service-request detail, none of which is customer-facing, so no portal
 * permission is accepted here. The scope is still threaded through, so the guard is not
 * the only thing standing between a caller and another tenant's object.
 */
/**
 * Every report holding a finding on this equipment, all four types in one list.
 *
 * Read from the unified store through the item index rather than from any one producer,
 * so a planned-work result and a service conclusion appear beside a manual assessment.
 * The scope narrows a customer to their own equipment and to published reports.
 */
objectMasterRouter.get(
  '/:objectId/reports',
  requirePermission(PERMISSIONS.OBJECT_MASTER_VIEW),
  validate({ params: z.object({ objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await reportQueryService.listObjectReports(pathParam(req, 'objectId'), scopeOf(req)));
    } catch (error) {
      next(error);
    }
  },
);

objectMasterRouter.get(
  '/:objectId/history',
  requirePermission(PERMISSIONS.OBJECT_MASTER_VIEW),
  validate({ params: z.object({ objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await objectService.getObjectHistory(pathParam(req, 'objectId'), scopeOf(req)));
    } catch (error) {
      next(error);
    }
  },
);
