import {
  PERMISSIONS,
  cancelInvoiceSchema,
  createInvoiceSchema,
  generateMonthlyInvoicesSchema,
  invoiceGenerationPreviewQuerySchema,
  invoiceListQuerySchema,
  recordInvoicePaymentSchema,
  sendInvoiceSchema,
  updateInvoiceSchema,
  type CancelInvoiceInput,
  type CreateInvoiceInput,
  type GenerateMonthlyInvoicesInput,
  type InvoiceGenerationPreviewQueryInput,
  type InvoiceListQueryInput,
  type RecordInvoicePaymentInput,
  type SendInvoiceInput,
  type UpdateInvoiceInput,
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
import * as invoiceService from './invoice.service';

const invoiceIdParam = z.object({
  invoiceId: z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.'),
});

export const invoiceRouter = Router();

invoiceRouter.use(authenticate, enforcePasswordChange);

invoiceRouter.get(
  '/',
  requirePermission(PERMISSIONS.INVOICE_VIEW),
  validate({ query: invoiceListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await invoiceService.listInvoices(req.query as unknown as InvoiceListQueryInput));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Preview must come before `/:invoiceId`, otherwise "generation-preview" is matched as an
 * invoice id and rejected by the id pattern.
 */
invoiceRouter.get(
  '/generation-preview',
  requirePermission(PERMISSIONS.INVOICE_MANAGE),
  validate({ query: invoiceGenerationPreviewQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as InvoiceGenerationPreviewQueryInput;
      ok(res, await invoiceService.previewMonthlyInvoices(query.billingPeriod));
    } catch (error) {
      next(error);
    }
  },
);

invoiceRouter.get(
  '/:invoiceId',
  requirePermission(PERMISSIONS.INVOICE_VIEW),
  validate({ params: invoiceIdParam }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await invoiceService.getInvoice(pathParam(req, 'invoiceId')));
    } catch (error) {
      next(error);
    }
  },
);

invoiceRouter.post(
  '/',
  requirePermission(PERMISSIONS.INVOICE_MANAGE),
  validate({ body: createInvoiceSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await invoiceService.createInvoice(
        req.body as CreateInvoiceInput,
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Нэхэмжлэл үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

invoiceRouter.post(
  '/generate-monthly',
  requirePermission(PERMISSIONS.INVOICE_MANAGE),
  validate({ body: generateMonthlyInvoicesSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await invoiceService.generateMonthlyInvoices(
        req.body as GenerateMonthlyInvoicesInput,
        requireAuth(req),
        meta(req),
      );
      created(res, result, `${result.created.length} нэхэмжлэл үүслээ.`);
    } catch (error) {
      next(error);
    }
  },
);

invoiceRouter.patch(
  '/:invoiceId',
  requirePermission(PERMISSIONS.INVOICE_MANAGE),
  validate({ params: invoiceIdParam, body: updateInvoiceSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await invoiceService.updateInvoice(
        pathParam(req, 'invoiceId'),
        req.body as UpdateInvoiceInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Нэхэмжлэл шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

invoiceRouter.post(
  '/:invoiceId/send',
  requirePermission(PERMISSIONS.INVOICE_SEND),
  validate({ params: invoiceIdParam, body: sendInvoiceSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await invoiceService.sendInvoice(
        pathParam(req, 'invoiceId'),
        req.body as SendInvoiceInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Нэхэмжлэл илгээгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

invoiceRouter.post(
  '/:invoiceId/payment',
  requirePermission(PERMISSIONS.INVOICE_RECORD_PAYMENT),
  validate({ params: invoiceIdParam, body: recordInvoicePaymentSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await invoiceService.recordPayment(
        pathParam(req, 'invoiceId'),
        req.body as RecordInvoicePaymentInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Төлбөр бүртгэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

invoiceRouter.post(
  '/:invoiceId/cancel',
  requirePermission(PERMISSIONS.INVOICE_CANCEL),
  validate({ params: invoiceIdParam, body: cancelInvoiceSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await invoiceService.cancelInvoice(
        pathParam(req, 'invoiceId'),
        req.body as CancelInvoiceInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Нэхэмжлэл цуцлагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

invoiceRouter.delete(
  '/:invoiceId',
  requirePermission(PERMISSIONS.INVOICE_MANAGE),
  validate({ params: invoiceIdParam }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await invoiceService.deleteInvoice(
        pathParam(req, 'invoiceId'),
        requireAuth(req),
        meta(req),
      );
      noContent(res, 'Нэхэмжлэл устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);
