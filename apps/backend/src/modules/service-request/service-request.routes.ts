import {
  PERMISSIONS,
  returnWorkReportSchema,
  saveWorkReportSchema,
  type ReturnWorkReportInput,
  type SaveWorkReportInput,
  assignServiceRequestSchema,
  changeServiceRequestStatusSchema,
  createServiceRequestSchema,
  extendSlaSchema,
  serviceRequestListQuerySchema,
  type ServiceRequestListQueryInput,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { resolveCustomerScope } from '../../common/security/customer-scope';
import { created, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import { authenticate, enforcePasswordChange, requireAuth } from '../../middlewares/authenticate.middleware';
import { requireAnyPermission, requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { claimServiceRequest } from './claim.service';
import * as service from './service-request.service';
import * as workReportService from './work-report.service';

const requestIdParamSchema = z.object({
  requestId: z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.'),
});

export const serviceRequestRouter = Router();

serviceRequestRouter.use(authenticate, enforcePasswordChange);

/**
 * The list.
 *
 * A customer reaches this with the portal key and is confined to their own organisation by
 * the resolved scope; `customerId` in the query stays a filter for staff and is discarded
 * for a customer. Permission and scope are both required: the guard says who may call the
 * endpoint, the scope says which records the answer may contain.
 */
serviceRequestRouter.get(
  '/',
  requireAnyPermission(PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW),
  validate({ query: serviceRequestListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as ServiceRequestListQueryInput;
      const scope = resolveCustomerScope(requireAuth(req), query.customerId);
      ok(res, await service.listServiceRequests(query, scope));
    } catch (error) {
      next(error);
    }
  },
);

serviceRequestRouter.post(
  '/',
  requireAnyPermission(
    PERMISSIONS.SERVICE_REQUEST_CREATE,
    PERMISSIONS.PORTAL_SERVICE_REQUEST_CREATE,
  ),
  validate({ body: createServiceRequestSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      // The body's customerId is not passed to the resolver: it is the value under
      // suspicion, and the service decides the owner from this scope instead.
      const result = await service.createServiceRequest(
        req.body,
        resolveCustomerScope(auth),
        auth,
        meta(req),
      );
      created(res, result, 'Үйлчилгээний хүсэлт үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

serviceRequestRouter.get(
  '/:requestId',
  requireAnyPermission(PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW),
  validate({ params: requestIdParamSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const scope = resolveCustomerScope(requireAuth(req));
      ok(res, await service.getServiceRequestById(pathParam(req, 'requestId'), scope));
    } catch (error) {
      next(error);
    }
  },
);

serviceRequestRouter.post(
  '/:requestId/assign',
  requirePermission(PERMISSIONS.DISPATCH_ASSIGN),
  validate({ params: requestIdParamSchema, body: assignServiceRequestSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const result = await service.assignServiceRequest(
        pathParam(req, 'requestId'),
        req.body,
        resolveCustomerScope(auth),
        auth,
        meta(req),
      );
      ok(res, result, 'Ажилтан хуваарилагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Нээлттэй ажил — the caller takes an open request for themselves.
 *
 * `service_request.claim`, NOT `dispatch.assign`: this endpoint can only ever put the
 * authenticated caller on a job that has nobody, so it does not need — and must not
 * require — the authority to move a colleague's work around. It takes no body for the same
 * reason; the claimer is the session, so there is no parameter to tamper with.
 */
serviceRequestRouter.post(
  '/:requestId/claim',
  requirePermission(PERMISSIONS.SERVICE_REQUEST_CLAIM),
  validate({ params: requestIdParamSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const result = await claimServiceRequest(
        pathParam(req, 'requestId'),
        resolveCustomerScope(auth),
        auth,
        meta(req),
      );
      ok(res, result, 'Ажлыг өөртөө авлаа.');
    } catch (error) {
      next(error);
    }
  },
);

serviceRequestRouter.post(
  '/:requestId/status',
  requirePermission(PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS),
  validate({ params: requestIdParamSchema, body: changeServiceRequestStatusSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const result = await service.changeServiceRequestStatus(
        pathParam(req, 'requestId'),
        req.body,
        resolveCustomerScope(auth),
        auth,
        meta(req),
      );
      ok(res, result, 'Төлөв шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

serviceRequestRouter.post(
  '/:requestId/extend-sla',
  requirePermission(PERMISSIONS.DISPATCH_EXTEND_SLA),
  validate({ params: requestIdParamSchema, body: extendSlaSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const result = await service.extendSla(
        pathParam(req, 'requestId'),
        req.body,
        resolveCustomerScope(auth),
        auth,
        meta(req),
      );
      ok(res, result, 'SLA сунгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The section 9.2 work conclusion.
 *
 * Reading and writing follow the request's own permissions: whoever may change a request's
 * status is the reviewer, and whoever may update the request records the conclusion. The
 * conclusion stays staff work, so no portal key is accepted here; reading it would create
 * an empty draft attributed to the reader, which is a technician's action, not a
 * customer's. The scope is still applied so a staff account filtered to one organisation
 * cannot reach another's conclusion.
 */
serviceRequestRouter.get(
  '/:requestId/report',
  requirePermission(PERMISSIONS.SERVICE_REQUEST_VIEW),
  validate({ params: requestIdParamSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      ok(
        res,
        await workReportService.getOrCreateWorkReport(
          pathParam(req, 'requestId'),
          resolveCustomerScope(auth),
          auth,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

serviceRequestRouter.put(
  '/:requestId/report',
  requirePermission(PERMISSIONS.SERVICE_REQUEST_UPDATE),
  validate({ params: requestIdParamSchema, body: saveWorkReportSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const result = await workReportService.saveWorkReport(
        pathParam(req, 'requestId'),
        req.body as SaveWorkReportInput,
        resolveCustomerScope(auth),
        auth,
        meta(req),
      );
      ok(res, result, 'Дүгнэлт хадгалагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

serviceRequestRouter.post(
  '/:requestId/report/submit',
  requirePermission(PERMISSIONS.SERVICE_REQUEST_UPDATE),
  validate({ params: requestIdParamSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const result = await workReportService.submitWorkReport(
        pathParam(req, 'requestId'),
        resolveCustomerScope(auth),
        auth,
        meta(req),
      );
      ok(res, result, 'Дүгнэлт хянуулахаар илгээгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

serviceRequestRouter.post(
  '/:requestId/report/approve',
  requirePermission(PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS),
  validate({ params: requestIdParamSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const result = await workReportService.approveWorkReport(
        pathParam(req, 'requestId'),
        resolveCustomerScope(auth),
        auth,
        meta(req),
      );
      ok(res, result, 'Дүгнэлт батлагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

serviceRequestRouter.post(
  '/:requestId/report/return',
  requirePermission(PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS),
  validate({ params: requestIdParamSchema, body: returnWorkReportSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const result = await workReportService.returnWorkReport(
        pathParam(req, 'requestId'),
        req.body as ReturnWorkReportInput,
        resolveCustomerScope(auth),
        auth,
        meta(req),
      );
      ok(res, result, 'Дүгнэлт буцаагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);
