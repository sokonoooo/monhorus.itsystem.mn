import { PERMISSIONS, calendarQuerySchema, type CalendarQueryInput } from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';

import { ok } from '../../common/utils/api-response.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requireAnyPermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { buildCalendar } from './calendar.service';

export const calendarRouter = Router();

calendarRouter.use(authenticate, enforcePasswordChange);

/**
 * The calendar has no permission of its own: it is a projection of planned work and
 * service requests, and each source is filtered by the permission that governs it. A
 * caller who can read at least one source gets a calendar containing only that source.
 *
 * THE GUARD IS NOT THE SCOPE. Every technician holds both view keys, so passing this line
 * says nothing about whose schedule the caller may read. That second question is answered
 * inside `buildCalendar`, by the same `resolveAssignedWorkFilter` the two list endpoints
 * use — see its note there. Do not mistake this guard for the boundary.
 */
calendarRouter.get(
  '/',
  requireAnyPermission(PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.SERVICE_REQUEST_VIEW),
  validate({ query: calendarQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(
        res,
        await buildCalendar(req.query as unknown as CalendarQueryInput, requireAuth(req)),
      );
    } catch (error) {
      next(error);
    }
  },
);
