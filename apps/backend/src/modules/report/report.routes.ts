import {
  PERMISSIONS,
  REPORT_KEYS,
  REPORT_LABELS,
  inspectionListQuerySchema,
  kpiQuerySchema,
  reportQuerySchema,
  type InspectionListQueryInput,
  type KpiQueryInput,
  type ReportKey,
  type ReportQueryInput,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { resolveCustomerScope } from '../../common/security/customer-scope';
import { ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as inspectionService from './inspection.service';
import * as reportService from './report.service';

const reportKeyParam = z.object({ reportKey: z.enum(REPORT_KEYS) });

export const reportRouter = Router();

reportRouter.use(authenticate, enforcePasswordChange);

/** The section 15.2 catalogue itself, so the screen never hardcodes the list. */
reportRouter.get(
  '/',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  (_req: Request, res: Response): void => {
    ok(
      res,
      REPORT_KEYS.map((key) => ({ key, label: REPORT_LABELS[key] })),
    );
  },
);

reportRouter.get(
  '/kpi',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  validate({ query: kpiQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as KpiQueryInput;
      ok(res, await reportService.buildKpis(query.dateFrom, query.dateTo));
    } catch (error) {
      next(error);
    }
  },
);

reportRouter.get(
  '/:reportKey',
  requirePermission(PERMISSIONS.REPORT_VIEW),
  validate({ params: reportKeyParam, query: reportQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as ReportQueryInput & { format?: 'csv' };
      const report = await reportService.buildReport(
        pathParam(req, 'reportKey') as ReportKey,
        query,
      );

      if (query.format === 'csv') {
        // Export leaves the system as a file, so it is gated separately from reading
        // (requirements 14.2, rule 17.20).
        if (!req.auth?.permissions.has(PERMISSIONS.REPORT_EXPORT)) {
          res.status(403).json({
            success: false,
            data: null,
            message: 'Тайлан татаж авах эрх байхгүй байна.',
            code: 'INSUFFICIENT_PRIVILEGES',
          });
          return;
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${report.key.toLowerCase()}-${report.generatedAt.slice(0, 10)}.csv"`,
        );
        res.status(200).send(reportService.reportToCsv(report));
        return;
      }

      ok(res, report);
    } catch (error) {
      next(error);
    }
  },
);

export const inspectionRouter = Router();

inspectionRouter.use(authenticate, enforcePasswordChange);

/**
 * Үнэлгээ ба дүгнэлт (consolidated conclusion report).
 *
 * Gated on object_master.view rather than report.view: these are the findings themselves,
 * and anyone who may read an object's conclusions may read them here too. The tenant is
 * resolved from the authenticated account — a client-sent customerId is a filter for
 * staff and is discarded for a customer.
 */
inspectionRouter.get(
  '/',
  requirePermission(PERMISSIONS.OBJECT_MASTER_VIEW),
  validate({ query: inspectionListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as InspectionListQueryInput;
      const scope = resolveCustomerScope(requireAuth(req), query.customerId ?? null);

      // Same route, same filters, same scope — only the rendering differs, so an export
      // can never contain a row the list would have withheld.
      if (query.format === 'csv') {
        const csv = await inspectionService.exportInspectionsCsv(query, scope);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="inspections-${new Date().toISOString().slice(0, 10)}.csv"`,
        );
        // The BOM makes Excel read UTF-8 rather than mangling every Cyrillic heading.
        res.status(200).send(`\uFEFF${csv}`);
        return;
      }

      ok(res, await inspectionService.listInspections(query, scope));
    } catch (error) {
      next(error);
    }
  },
);

inspectionRouter.get(
  '/summary',
  requirePermission(PERMISSIONS.OBJECT_MASTER_VIEW),
  validate({ query: inspectionListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as InspectionListQueryInput;
      const scope = resolveCustomerScope(requireAuth(req), query.customerId ?? null);
      ok(res, await inspectionService.summariseInspections(query, scope));
    } catch (error) {
      next(error);
    }
  },
);
