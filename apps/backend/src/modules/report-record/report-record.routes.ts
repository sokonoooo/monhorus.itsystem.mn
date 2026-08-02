import {
  PERMISSIONS,
  consolidateReportsSchema,
  reportListQuerySchema,
  returnReportSchema,
  type ConsolidateReportsInput,
  type ReportListQueryInput,
  type ReturnReportInput,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { resolveCustomerScope } from '../../common/security/customer-scope';
import { created, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as consolidationService from './consolidation.service';
import * as reportQueryService from './report-query.service';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');

/**
 * The central report registry — every report the system holds, whatever produced it.
 *
 * Mounted at /reports-registry because /reports is the section 15.2 catalogue of derived
 * tabular reports; this is the store those tabulations are drawn from. Reads are gated on
 * object_master.view, matching /inspections: these are the findings themselves, and
 * anyone who may read an object's conclusions may read them here too. The tenant boundary
 * is resolved from the authenticated account, never from the query string.
 */
export const reportRegistryRouter = Router();

reportRegistryRouter.use(authenticate, enforcePasswordChange);

const reportParams = z.object({ reportId: objectId });

/**
 * The consolidation workflow, mounted BEFORE the `/:reportId` read so the literal
 * `/consolidations` segment is never captured as a report id.
 *
 * Permissions, and why each: creating and submitting a consolidation is AUTHORING a
 * дүгнэлт over equipment, which is what `object_master.assess` already means. Approving
 * or returning one is the other half of the submit/approve separation and carries
 * `report.approve`; releasing it to the customer carries `report.publish`. Three
 * different keys, so no single holder authors, signs off and releases the same finding
 * unless someone deliberately grants all three.
 */
reportRegistryRouter.post(
  '/consolidations',
  requirePermission(PERMISSIONS.OBJECT_MASTER_ASSESS),
  validate({ body: consolidateReportsSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = await consolidationService.createConsolidatedReport(
        req.body as ConsolidateReportsInput,
        requireAuth(req),
        meta(req),
      );
      created(res, dto, 'Нэгдсэн тайлан үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

reportRegistryRouter.post(
  '/consolidations/:reportId/submit',
  requirePermission(PERMISSIONS.OBJECT_MASTER_ASSESS),
  validate({ params: reportParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = await consolidationService.submitConsolidatedReport(
        pathParam(req, 'reportId'),
        requireAuth(req),
        meta(req),
      );
      ok(res, dto, 'Тайлан хянуулахаар илгээгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

reportRegistryRouter.post(
  '/consolidations/:reportId/approve',
  requirePermission(PERMISSIONS.REPORT_APPROVE),
  validate({ params: reportParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = await consolidationService.approveConsolidatedReport(
        pathParam(req, 'reportId'),
        requireAuth(req),
        meta(req),
      );
      ok(res, dto, 'Тайлан батлагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

reportRegistryRouter.post(
  '/consolidations/:reportId/return',
  requirePermission(PERMISSIONS.REPORT_APPROVE),
  validate({ params: reportParams, body: returnReportSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = await consolidationService.returnConsolidatedReport(
        pathParam(req, 'reportId'),
        req.body as ReturnReportInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, dto, 'Тайлан засуулахаар буцаагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

reportRegistryRouter.post(
  '/consolidations/:reportId/publish',
  requirePermission(PERMISSIONS.REPORT_PUBLISH),
  validate({ params: reportParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const dto = await consolidationService.publishConsolidatedReport(
        pathParam(req, 'reportId'),
        requireAuth(req),
        meta(req),
      );
      ok(res, dto, 'Тайлан нийтлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

reportRegistryRouter.get(
  '/',
  requirePermission(PERMISSIONS.OBJECT_MASTER_VIEW),
  validate({ query: reportListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as ReportListQueryInput;
      const scope = resolveCustomerScope(requireAuth(req), query.customerId ?? null);
      ok(res, await reportQueryService.listReports(query, scope));
    } catch (error) {
      next(error);
    }
  },
);

reportRegistryRouter.get(
  '/:reportId',
  requirePermission(PERMISSIONS.OBJECT_MASTER_VIEW),
  validate({ params: z.object({ reportId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const scope = resolveCustomerScope(requireAuth(req), null);
      ok(res, await reportQueryService.getReportById(pathParam(req, 'reportId'), scope));
    } catch (error) {
      next(error);
    }
  },
);
