import {
  PERMISSIONS,
  createMaterialItemSchema,
  materialItemListQuerySchema,
  updateMaterialItemSchema,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { created, ok } from '../../common/utils/api-response.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import { pathParam } from '../../common/utils/path-param.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as service from './material.service';

const materialIdParamSchema = z.object({
  materialItemId: z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.'),
});

/**
 * The material catalogue.
 *
 * Reading is separated from editing for the reason every catalogue in this system
 * separates them: a technician picks from the list on every sub-task and must never be
 * able to rewrite it. There is no delete — a material that is no longer stocked is
 * deactivated, so the usage rows that reference it keep resolving.
 */
export const materialRouter = Router();

materialRouter.use(authenticate, enforcePasswordChange);

materialRouter.get(
  '/',
  requirePermission(PERMISSIONS.MATERIAL_VIEW),
  validate({ query: materialItemListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await service.listMaterialItems(req.query as never));
    } catch (error) {
      next(error);
    }
  },
);

materialRouter.post(
  '/',
  requirePermission(PERMISSIONS.MATERIAL_MANAGE),
  validate({ body: createMaterialItemSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      created(
        res,
        await service.createMaterialItem(req.body, auth, meta(req)),
        'Материал бүртгэгдлээ.',
      );
    } catch (error) {
      next(error);
    }
  },
);

materialRouter.patch(
  '/:materialItemId',
  requirePermission(PERMISSIONS.MATERIAL_MANAGE),
  validate({ params: materialIdParamSchema, body: updateMaterialItemSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      ok(
        res,
        await service.updateMaterialItem(
          pathParam(req, 'materialItemId'),
          req.body,
          auth,
          meta(req),
        ),
        'Материал шинэчлэгдлээ.',
      );
    } catch (error) {
      next(error);
    }
  },
);
