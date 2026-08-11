import type {
  ReturnInspectionReportInput,
  ReviewInspectionReportInput,
  UpdateInspectionReportInput,
} from '@monhorus/shared';
import type { NextFunction, Request, Response } from 'express';

import { created, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import { requireAuth } from '../../middlewares/authenticate.middleware';
import { inspectionReportDocument } from '../report-pdf/inspection-report.pdf';
import { renderPdf } from '../report-pdf/pdf.renderer';
import { contractorName, sendPdf } from '../report-pdf/pdf.response';
import * as service from './inspection-report.service';

/**
 * Thin HTTP layer for the consolidated inspection report. Every rule lives in the
 * service; these handlers only resolve the planned work and shape the envelope.
 */

async function work(req: Request) {
  return service.findPlannedWorkOrThrow(pathParam(req, 'plannedWorkId'));
}

export async function getReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(res, await service.getReport(await work(req)));
  } catch (error) {
    next(error);
  }
}

/**
 * The same report, laid out as the office's own «Үзлэгийн тайлан» and served as a PDF.
 *
 * Built from `service.getReport` — the identical call the JSON handler above makes — so
 * the document and the screen cannot disagree. Read-keyed like the screen: rendering
 * what a caller may already read is not a stronger act than reading it.
 */
export async function getReportPdfHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const report = await service.getReport(await work(req));
    const pdf = await renderPdf(inspectionReportDocument(report, await contractorName()));
    sendPdf(res, pdf, `uzleg-${report.workNumber}`);
  } catch (error) {
    next(error);
  }
}

export async function getReadinessHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    ok(res, await service.readinessOf(await work(req)));
  } catch (error) {
    next(error);
  }
}

export async function generateReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.generateReport(await work(req), requireAuth(req), meta(req));
    created(res, result, 'Үзлэгийн нэгдсэн тайлан үүслээ.');
  } catch (error) {
    next(error);
  }
}

export async function updateReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.updateReport(
      await work(req),
      req.body as UpdateInspectionReportInput,
      requireAuth(req),
      meta(req),
    );
    ok(res, result, 'Тайлан хадгалагдлаа.');
  } catch (error) {
    next(error);
  }
}

export async function submitReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.submitReport(await work(req), requireAuth(req), meta(req));
    ok(res, result, 'Тайлан хянуулахаар илгээгдлээ.');
  } catch (error) {
    next(error);
  }
}

export async function approveReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.approveReport(
      await work(req),
      req.body as ReviewInspectionReportInput,
      requireAuth(req),
      meta(req),
    );
    ok(res, result, 'Тайлан батлагдлаа.');
  } catch (error) {
    next(error);
  }
}

export async function returnReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.returnReport(
      await work(req),
      req.body as ReturnInspectionReportInput,
      requireAuth(req),
      meta(req),
    );
    ok(res, result, 'Тайлан засуулахаар буцаагдлаа.');
  } catch (error) {
    next(error);
  }
}

export async function finaliseReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.finaliseReport(
      await work(req),
      req.body as ReviewInspectionReportInput,
      requireAuth(req),
      meta(req),
    );
    ok(res, result, 'Тайлан эцэслэгдлээ.');
  } catch (error) {
    next(error);
  }
}

export async function reopenReportHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await service.reopenReport(await work(req), requireAuth(req), meta(req));
    ok(res, result, 'Тайлангийн шинэ хувилбар нээгдлээ.');
  } catch (error) {
    next(error);
  }
}
