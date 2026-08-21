import { PERMISSIONS } from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';

import { resolveCustomerScope } from '../../common/security/customer-scope';
import { ok } from '../../common/utils/api-response.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { buildPortalSummary } from './portal-summary.service';

/**
 * The customer portal's own aggregate.
 *
 * Separate from `/dashboard` on purpose. That one answers company-wide questions behind
 * `dashboard.view`, a permission no customer role holds and none should — the numbers on it
 * are other organisations' as much as their own. This returns the same SHAPE of answer for
 * exactly one organisation: the caller's, resolved from the account rather than the request.
 */
export const portalRouter = Router();

portalRouter.use(
  authenticate,
  enforcePasswordChange,
  requirePermission(PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW),
);

portalRouter.get(
  '/summary',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      // No `customerId` is read from the query: for a customer the scope comes from the
      // account, and a staff caller reaching this route gets their own empty window rather
      // than a cross-tenant total they could not have asked for here anyway.
      ok(res, await buildPortalSummary(resolveCustomerScope(auth), auth.permissions));
    } catch (error) {
      next(error);
    }
  },
);
