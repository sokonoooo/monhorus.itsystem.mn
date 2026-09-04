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
import { sendPdf } from '../report-pdf/pdf.response';
import { loadReportBranding } from '../report-pdf/report-branding';
import { getRiskBands } from '../settings/settings.service';
import { loadTaskPhotos, MAX_PHOTOS_PER_TASK } from '../report-pdf/report-images';
import * as service from './inspection-report.service';

/**
 * Thin HTTP layer for the consolidated inspection report. Every rule lives in the
 * service; these handlers only resolve the planned work and shape the envelope.
 */

/**
 * The planned work this request names, or a 404.
 *
 * The actor is passed because the load is scoped: `findPlannedWorkOrThrow` intersects the
 * id with `resolveAssignedWorkFilter`, so a caller bounded by assignment cannot reach a job
 * that is not theirs — see that function for why the predicate sits in the service and why
 * the answer is not-found rather than forbidden.
 */
async function work(req: Request) {
  return service.findPlannedWorkOrThrow(pathParam(req, 'plannedWorkId'), requireAuth(req));
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
    // Held rather than discarded, because the branding below needs the work's customer and
    // the report DTO carries only its name.
    const plannedWork = await work(req);
    const report = await service.getReport(plannedWork);

    // The photographs each sub-task already carries. The report DTO names them; this
    // reads and re-encodes the bytes, which is work the JSON endpoint has no reason to do.
    const photos = await loadTaskPhotos(
      report.groups.flatMap((group) =>
        group.tasks.map((task) => ({
          taskId: task.taskId,
          fileIds: task.attachments.map((file) => file.id),
        })),
      ),
      MAX_PHOTOS_PER_TASK,
    );

    // The customer's own letterhead, when they have set one. Null otherwise, and the
    // header then prints the operator's logo alone as it always has.
    const branding = await loadReportBranding(plannedWork.customer);
    // The tables print the administrator's band names, the same ladder `overallLabel` was
    // resolved against, so one page cannot carry two vocabularies.
    const bands = await getRiskBands();
    const pdf = await renderPdf(inspectionReportDocument(report, branding, photos, bands))
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
