import {
  PERMISSIONS,
  createDiagramSchema,
  setActiveStepSchema,
  updateDiagramSchema,
  updateDiagramViewportSchema,
  type CreateDiagramInput,
  type SetActiveStepInput,
  type UpdateDiagramInput,
  type UpdateDiagramViewportInput,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { created, noContent, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as diagramService from './diagram.service';

const diagramIdParam = z.object({
  diagramId: z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.'),
});

export const diagramRouter = Router();

diagramRouter.use(authenticate, enforcePasswordChange);

diagramRouter.get(
  '/',
  requirePermission(PERMISSIONS.DIAGRAM_VIEW),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await diagramService.listDiagrams());
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The dashboard's canvas.
 *
 * Declared before `/:diagramId` so "dashboard" is not matched as an id. Returns null when
 * nothing has been drawn yet, so the page can offer to start one rather than show an error.
 */
diagramRouter.get(
  '/dashboard',
  requirePermission(PERMISSIONS.DIAGRAM_VIEW),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await diagramService.getDashboardDiagram());
    } catch (error) {
      next(error);
    }
  },
);

diagramRouter.get(
  '/:diagramId',
  requirePermission(PERMISSIONS.DIAGRAM_VIEW),
  validate({ params: diagramIdParam }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await diagramService.getDiagram(pathParam(req, 'diagramId')));
    } catch (error) {
      next(error);
    }
  },
);

diagramRouter.post(
  '/',
  requirePermission(PERMISSIONS.DIAGRAM_MANAGE),
  validate({ body: createDiagramSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await diagramService.createDiagram(
        req.body as CreateDiagramInput,
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Схем зураг үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

diagramRouter.put(
  '/:diagramId',
  requirePermission(PERMISSIONS.DIAGRAM_MANAGE),
  validate({ params: diagramIdParam, body: updateDiagramSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await diagramService.updateDiagram(
        pathParam(req, 'diagramId'),
        req.body as UpdateDiagramInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Схем зураг хадгалагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

diagramRouter.patch(
  '/:diagramId/viewport',
  requirePermission(PERMISSIONS.DIAGRAM_MANAGE),
  validate({ params: diagramIdParam, body: updateDiagramViewportSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await diagramService.updateViewport(
        pathParam(req, 'diagramId'),
        req.body as UpdateDiagramViewportInput,
      );
      ok(res, result);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Changing the shown timeline step.
 *
 * Gated on view rather than manage: choosing which operating state to look at is reading,
 * not editing, and the diagram's structure is untouched.
 */
diagramRouter.patch(
  '/:diagramId/active-step',
  requirePermission(PERMISSIONS.DIAGRAM_VIEW),
  validate({ params: diagramIdParam, body: setActiveStepSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await diagramService.setActiveStep(
        pathParam(req, 'diagramId'),
        req.body as SetActiveStepInput,
      );
      ok(res, result);
    } catch (error) {
      next(error);
    }
  },
);

diagramRouter.delete(
  '/:diagramId',
  requirePermission(PERMISSIONS.DIAGRAM_MANAGE),
  validate({ params: diagramIdParam }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await diagramService.deleteDiagram(
        pathParam(req, 'diagramId'),
        requireAuth(req),
        meta(req),
      );
      noContent(res, 'Схем зураг устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);
