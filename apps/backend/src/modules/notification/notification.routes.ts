import {
  PERMISSIONS,
  notificationListQuerySchema,
  type NotificationListQueryInput,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as notificationService from './notification.service';

const notificationIdParam = z.object({
  notificationId: z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.'),
});

export const notificationRouter = Router();

notificationRouter.use(authenticate, enforcePasswordChange);

/**
 * Every route here is scoped to the caller's own inbox by the service, so the permission
 * grants sight of your notifications, never of anybody else's.
 */
notificationRouter.get(
  '/',
  requirePermission(PERMISSIONS.NOTIFICATION_VIEW),
  validate({ query: notificationListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await notificationService.listNotifications(
        req.query as unknown as NotificationListQueryInput,
        requireAuth(req),
      );
      ok(res, result);
    } catch (error) {
      next(error);
    }
  },
);

notificationRouter.get(
  '/unread-count',
  requirePermission(PERMISSIONS.NOTIFICATION_VIEW),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await notificationService.unreadCount(requireAuth(req)));
    } catch (error) {
      next(error);
    }
  },
);

notificationRouter.post(
  '/read-all',
  requirePermission(PERMISSIONS.NOTIFICATION_VIEW),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await notificationService.markAllRead(requireAuth(req));
      ok(res, result, 'Бүх мэдэгдлийг уншсан болголоо.');
    } catch (error) {
      next(error);
    }
  },
);

notificationRouter.post(
  '/:notificationId/read',
  requirePermission(PERMISSIONS.NOTIFICATION_VIEW),
  validate({ params: notificationIdParam }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await notificationService.markRead(
        pathParam(req, 'notificationId'),
        requireAuth(req),
      );
      ok(res, result);
    } catch (error) {
      next(error);
    }
  },
);
