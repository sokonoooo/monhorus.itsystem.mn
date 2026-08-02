import {
  PERMISSIONS,
  buildingListQuerySchema,
  createBuildingSchema,
  createFloorSchema,
  createProjectSchema,
  floorListQuerySchema,
  floorPlanMetaSchema,
  linkFloorObjectsSchema,
  objectListQuerySchema,
  projectListQuerySchema,
  updateBuildingSchema,
  updateFloorSchema,
  updateProjectSchema,
  type BuildingListQueryInput,
  type CreateBuildingInput,
  type CreateFloorInput,
  type CreateProjectInput,
  type FloorListQueryInput,
  type FloorPlanMetaInput,
  type LinkFloorObjectsInput,
  type ObjectListQueryInput,
  type ProjectListQueryInput,
  type UpdateBuildingInput,
  type UpdateFloorInput,
  type UpdateProjectInput,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
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
import { floorLoadSummary } from '../object-master/load.service';
import * as objectMasterService from '../object-master/object-master.service';
import { upload } from '../storage/storage.service';
import * as floorPlanService from './floor-plan.service';
import { buildProjectGraph } from '../diagram/project-graph.service';
import * as projectService from './project.service';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');

/**
 * The tenant every handler below reads and writes within.
 *
 * `requested` is whatever the client asked to filter by. It is honoured for staff and
 * discarded for a customer, so passing it through is safe by construction and no handler
 * has to remember to withhold it.
 */
function scopeOf(req: Request, requested?: string): ResolvedCustomerScope {
  return resolveCustomerScope(requireAuth(req), requested ?? null);
}

/**
 * Project module routes: Project -> Building -> Floor, plus the floor's plan image and its
 * object links. Objects themselves are created and edited through the object master
 * routes; a floor only links to what already exists.
 *
 * Read endpoints a customer must reach accept either the staff permission or the matching
 * portal permission. Both the permission and the scope are enforced: the permission answers
 * "may you look at this module", the scope answers "at whose records", and neither is
 * sufficient on its own. Every write endpoint keeps its staff-only guard.
 */
export const projectRouter = Router();

projectRouter.use(authenticate, enforcePasswordChange);

// -- Project -----------------------------------------------------------------

projectRouter.get(
  '/',
  requireAnyPermission(PERMISSIONS.OBJECT_VIEW, PERMISSIONS.PORTAL_PROJECT_VIEW),
  validate({ query: projectListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as ProjectListQueryInput;
      ok(res, await projectService.listProjects(query, scopeOf(req, query.customerId)));
    } catch (error) {
      next(error);
    }
  },
);

projectRouter.post(
  '/',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ body: createProjectSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await projectService.createProject(
        req.body as CreateProjectInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Төсөл үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

projectRouter.get(
  '/:projectId',
  requireAnyPermission(PERMISSIONS.OBJECT_VIEW, PERMISSIONS.PORTAL_PROJECT_VIEW),
  validate({ params: z.object({ projectId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await projectService.getProjectById(pathParam(req, 'projectId'), scopeOf(req)));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The project's objects as a graph.
 *
 * Generated from the hierarchy and the electrical relations on every request, so it cannot
 * drift from the records. Nothing is stored, so there is nothing to version.
 */
projectRouter.get(
  '/:projectId/graph',
  requirePermission(PERMISSIONS.OBJECT_VIEW),
  validate({ params: z.object({ projectId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const projectId = pathParam(req, 'projectId');
      // The graph builder takes an id and knows nothing about tenants, so the project is
      // loaded through the scoped path first. That resolves cross-tenant access to the same
      // 404 as every other detail read rather than leaving one endpoint reachable by id
      // alone. Staff scope makes this a no-op beyond the extra lookup.
      await projectService.getProjectById(projectId, scopeOf(req));
      ok(res, await buildProjectGraph(projectId));
    } catch (error) {
      next(error);
    }
  },
);

projectRouter.patch(
  '/:projectId',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ params: z.object({ projectId: objectId }), body: updateProjectSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await projectService.updateProject(
        pathParam(req, 'projectId'),
        req.body as UpdateProjectInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Төсөл шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

projectRouter.delete(
  '/:projectId',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ params: z.object({ projectId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await projectService.deleteProject(
        pathParam(req, 'projectId'),
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      noContent(res, 'Төсөл устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

// -- Building ----------------------------------------------------------------

export const buildingRouter = Router();

buildingRouter.use(authenticate, enforcePasswordChange);

buildingRouter.get(
  '/',
  requireAnyPermission(PERMISSIONS.OBJECT_VIEW, PERMISSIONS.PORTAL_BUILDING_VIEW),
  validate({ query: buildingListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as BuildingListQueryInput;
      ok(res, await projectService.listBuildings(query, scopeOf(req, query.customerId)));
    } catch (error) {
      next(error);
    }
  },
);

buildingRouter.post(
  '/',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ body: createBuildingSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await projectService.createBuilding(
        req.body as CreateBuildingInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Барилга үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

buildingRouter.get(
  '/:buildingId',
  requireAnyPermission(PERMISSIONS.OBJECT_VIEW, PERMISSIONS.PORTAL_BUILDING_VIEW),
  validate({ params: z.object({ buildingId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await projectService.getBuildingById(pathParam(req, 'buildingId'), scopeOf(req)));
    } catch (error) {
      next(error);
    }
  },
);

buildingRouter.patch(
  '/:buildingId',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ params: z.object({ buildingId: objectId }), body: updateBuildingSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await projectService.updateBuilding(
        pathParam(req, 'buildingId'),
        req.body as UpdateBuildingInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Барилга шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

buildingRouter.delete(
  '/:buildingId',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ params: z.object({ buildingId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await projectService.deleteBuilding(
        pathParam(req, 'buildingId'),
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      noContent(res, 'Барилга устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

// -- Floor -------------------------------------------------------------------

export const floorRouter = Router();

floorRouter.use(authenticate, enforcePasswordChange);

floorRouter.get(
  '/',
  requireAnyPermission(PERMISSIONS.OBJECT_VIEW, PERMISSIONS.PORTAL_FLOOR_VIEW),
  validate({ query: floorListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // The floor list query carries no customerId, so there is nothing for staff to
      // request here; a customer is still scoped to their own tenant.
      ok(
        res,
        await projectService.listFloors(
          req.query as unknown as FloorListQueryInput,
          scopeOf(req),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

floorRouter.post(
  '/',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ body: createFloorSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await projectService.createFloor(
        req.body as CreateFloorInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Давхар үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

floorRouter.get(
  '/:floorId',
  requireAnyPermission(PERMISSIONS.OBJECT_VIEW, PERMISSIONS.PORTAL_FLOOR_VIEW),
  validate({ params: z.object({ floorId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await projectService.getFloorById(pathParam(req, 'floorId'), scopeOf(req)));
    } catch (error) {
      next(error);
    }
  },
);

projectRouter.get(
  '/:projectId/buildings',
  requireAnyPermission(PERMISSIONS.OBJECT_VIEW, PERMISSIONS.PORTAL_BUILDING_VIEW),
  validate({ params: z.object({ projectId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(
        res,
        await projectService.listBuildings(
          {
            page: 1,
            limit: 100,
            projectId: pathParam(req, 'projectId'),
          } as BuildingListQueryInput,
          scopeOf(req),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

floorRouter.patch(
  '/:floorId',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ params: z.object({ floorId: objectId }), body: updateFloorSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await projectService.updateFloor(
        pathParam(req, 'floorId'),
        req.body as UpdateFloorInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Давхар шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

floorRouter.delete(
  '/:floorId',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ params: z.object({ floorId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await projectService.deleteFloor(
        pathParam(req, 'floorId'),
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      noContent(res, 'Давхар устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

// -- Floor plan image --------------------------------------------------------

floorRouter.get(
  '/:floorId/plan',
  requireAnyPermission(PERMISSIONS.OBJECT_VIEW, PERMISSIONS.PORTAL_FLOOR_VIEW),
  validate({ params: z.object({ floorId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Null rather than 404: "no plan yet" is a normal state with its own empty screen.
      ok(res, await floorPlanService.getFloorPlan(pathParam(req, 'floorId'), scopeOf(req)));
    } catch (error) {
      next(error);
    }
  },
);

/** Upload or replace. There is one current image per floor and no version chain. */
floorRouter.put(
  '/:floorId/plan',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  upload.single('file'),
  validate({ params: z.object({ floorId: objectId }), body: floorPlanMetaSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uploaded = req.file;
      if (!uploaded) {
        throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Файл заавал.', [
          { field: 'file', message: 'План зураг сонгоно уу.' },
        ]);
      }

      const result = await floorPlanService.uploadFloorPlan(
        pathParam(req, 'floorId'),
        uploaded,
        req.body as FloorPlanMetaInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'План зураг хадгалагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

floorRouter.patch(
  '/:floorId/plan',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ params: z.object({ floorId: objectId }), body: floorPlanMetaSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await floorPlanService.updateFloorPlanMeta(
        pathParam(req, 'floorId'),
        req.body as FloorPlanMetaInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'План зургийн мэдээлэл шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

floorRouter.delete(
  '/:floorId/plan',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ params: z.object({ floorId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await floorPlanService.removeFloorPlan(
        pathParam(req, 'floorId'),
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      noContent(res, 'План зураг устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

// -- Floor object links ------------------------------------------------------

floorRouter.get(
  '/:floorId/objects',
  requireAnyPermission(PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.PORTAL_OBJECT_VIEW),
  validate({ params: z.object({ floorId: objectId }), query: objectListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as ObjectListQueryInput;
      ok(
        res,
        await objectMasterService.listObjects(
          { ...query, floorId: pathParam(req, 'floorId') },
          scopeOf(req, query.customerId),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

floorRouter.post(
  '/:floorId/objects',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ params: z.object({ floorId: objectId }), body: linkFloorObjectsSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const linked = await objectMasterService.linkObjectsToFloor(
        pathParam(req, 'floorId'),
        req.body as LinkFloorObjectsInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      ok(res, { linked }, `${linked} объект холбогдлоо.`);
    } catch (error) {
      next(error);
    }
  },
);

floorRouter.delete(
  '/:floorId/objects/:objectId',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ params: z.object({ floorId: objectId, objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await objectMasterService.unlinkObjectFromFloor(
        pathParam(req, 'floorId'),
        pathParam(req, 'objectId'),
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      noContent(res, 'Объектын холбоос салгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

/** Section 11.5 roll-up for the floor. */
floorRouter.get(
  '/:floorId/load',
  requireAnyPermission(PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.PORTAL_OBJECT_VIEW),
  validate({ params: z.object({ floorId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(
        res,
        await floorLoadSummary(new Types.ObjectId(pathParam(req, 'floorId')), scopeOf(req)),
      );
    } catch (error) {
      next(error);
    }
  },
);
