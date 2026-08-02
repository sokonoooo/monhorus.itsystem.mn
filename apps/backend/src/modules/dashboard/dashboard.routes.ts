import {
  PERMISSIONS,
  dashboardCustomWidgetSchema,
  dashboardLayoutSchema,
  type DashboardCustomWidgetInput,
  type DashboardLayoutInput,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { created, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import {
  buildInsight,
  createCustomWidget,
  deleteCustomWidget,
  updateCustomWidget,
} from './dashboard-insight.service';
import {
  buildDashboardSummary,
  getDashboardLayout,
  resetDashboardLayout,
  saveDashboardLayout,
} from './dashboard.service';

/**
 * Single aggregate dashboard endpoint, requirements section 15.1.
 *
 * Sections the caller cannot see are omitted from the payload rather than zeroed, so the
 * UI can distinguish "no permission" from "the value really is zero". Each block is
 * computed only when its permission is held, so an unauthorised caller does not pay for
 * the query either.
 */
export const dashboardRouter = Router();

dashboardRouter.use(
  authenticate,
  enforcePasswordChange,
  requirePermission(PERMISSIONS.DASHBOARD_VIEW),
);

dashboardRouter.get(
  '/summary',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await buildDashboardSummary(requireAuth(req)));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The caller's own dashboard arrangement.
 *
 * Needs no permission beyond dashboard.view: a layout only reorders and hides blocks the
 * payload was already willing to send, so it can never widen what somebody sees.
 */
dashboardRouter.get(
  '/layout',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await getDashboardLayout(requireAuth(req)));
    } catch (error) {
      next(error);
    }
  },
);

dashboardRouter.put(
  '/layout',
  validate({ body: dashboardLayoutSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await saveDashboardLayout(
        req.body as DashboardLayoutInput,
        requireAuth(req),
      );
      ok(res, result, 'Хяналтын самбар хадгалагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

dashboardRouter.delete(
  '/layout',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await resetDashboardLayout(requireAuth(req)), 'Үндсэн байрлал сэргээгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

// -- User-built widgets --------------------------------------------------------

/**
 * Authoring a saved question is its own authority.
 *
 * Reading the board stays on `dashboard.view`, because a widget only ever draws records
 * the caller could already list. Defining one is gated separately: it is a standing query
 * over the whole request history, and the figures it puts on a board outlive the moment
 * somebody thought to ask for them.
 */
const widgetIdParams = z.object({
  widgetId: z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.'),
});

dashboardRouter.post(
  '/custom-widgets',
  requirePermission(PERMISSIONS.DASHBOARD_CUSTOMISE),
  validate({ body: dashboardCustomWidgetSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await createCustomWidget(
        req.body as DashboardCustomWidgetInput,
        requireAuth(req),
      );
      created(res, result, 'Хэсэг үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

dashboardRouter.put(
  '/custom-widgets/:widgetId',
  requirePermission(PERMISSIONS.DASHBOARD_CUSTOMISE),
  validate({ params: widgetIdParams, body: dashboardCustomWidgetSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await updateCustomWidget(
        pathParam(req, 'widgetId'),
        req.body as DashboardCustomWidgetInput,
        requireAuth(req),
      );
      ok(res, result, 'Хэсэг шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

dashboardRouter.delete(
  '/custom-widgets/:widgetId',
  requirePermission(PERMISSIONS.DASHBOARD_CUSTOMISE),
  validate({ params: widgetIdParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await deleteCustomWidget(pathParam(req, 'widgetId'), requireAuth(req));
      ok(res, null, 'Хэсэг устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The figures behind one saved question.
 *
 * Only `dashboard.view` here, because the aggregation itself re-checks the caller's right
 * to read the underlying records — a definition written while holding a permission must
 * not keep answering after it is taken away.
 */
dashboardRouter.get(
  '/custom-widgets/:widgetId/insight',
  validate({ params: widgetIdParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await buildInsight(pathParam(req, 'widgetId'), requireAuth(req)));
    } catch (error) {
      next(error);
    }
  },
);
