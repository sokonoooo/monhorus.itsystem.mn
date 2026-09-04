import {
  PERMISSIONS,
  createPlannedWorkSchema,
  createPlannedWorkTaskSchema,
  plannedWorkListQuerySchema,
  plannedWorkMaterialsSchema,
  plannedWorkTransitionSchema,
  recordTaskMaterialUsageSchema,
  recordTaskProgressSchema,
  reschedulePlannedWorkSchema,
  returnPlannedWorkReportSchema,
  type CreatePlannedWorkInput,
  type CreatePlannedWorkTaskInput,
  type PlannedWorkListQueryInput,
  type PlannedWorkMaterialsInput,
  type PlannedWorkTransitionInput,
  type RecordTaskMaterialUsageInput,
  type RecordTaskProgressInput,
  type ReschedulePlannedWorkInput,
  type ReturnPlannedWorkReportInput,
  type UpdatePlannedWorkInput,
  type UpdatePlannedWorkReportInput,
  type UpdatePlannedWorkTaskInput,
  updatePlannedWorkReportSchema,
  updatePlannedWorkSchema,
  updatePlannedWorkTaskSchema,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import { z } from 'zod';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { created, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requireAnyPermission, requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { inspectionReportRouter } from '../inspection-report/inspection-report.routes';
import { upload } from '../storage/storage.service';
import * as plannedWorkService from './planned-work.service';
import {
  approveReport,
  buildReportPreview,
  loadReportState,
  returnReport,
  submitReport,
  taskPhotoIdsOf,
  toReportDto,
  updateReport,
} from './planned-work.report.service';
import { plannedWorkReportDocument } from '../report-pdf/planned-work-report.pdf';
import { plannedWorkPhotoReportDocument } from '../report-pdf/planned-work-photo-report.pdf';
import { renderPdf } from '../report-pdf/pdf.renderer';
import { sendPdf } from '../report-pdf/pdf.response';
import { loadReportBranding } from '../report-pdf/report-branding';
import { loadTaskPhotos, MAX_PHOTOS_PER_TASK } from '../report-pdf/report-images';
import {
  requirePlannedWorkAssignmentScope,
  resolveAssignedWorkFilter,
} from './planned-work.scope';
import { PlannedWork, type IPlannedWork } from './planned-work.models';
import { transitionPlannedWork } from './planned-work.transition.service';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');
const workParams = z.object({ plannedWorkId: objectId });
const taskParams = z.object({ plannedWorkId: objectId, taskId: objectId });
const photoParams = z.object({ plannedWorkId: objectId, taskId: objectId, fileId: objectId });

export const plannedWorkRouter = Router();

plannedWorkRouter.use(authenticate, enforcePasswordChange);

/**
 * The consolidated inspection report lives under the planned work it describes, so its
 * router is mounted here rather than registered as a sibling of /planned-work. Mounted
 * first so the nested path is resolved before the single-segment record routes.
 *
 * Its authoring routes ride on `planned_work.submit_report`, which the field tier holds, so
 * they are technician-reachable writes on a planned work and get the same assignment scope
 * as everything else. The guard is mounted here rather than inside that router because the
 * parent id is a fact about THIS path; it applies to writes only.
 *
 * READS ARE NOT UNGUARDED, they are guarded elsewhere — and that is the whole premise this
 * guard passes GETs through on. `planned-work.scope.ts` states it: by the time a read
 * reaches a handler, the loader beneath it has already applied the same predicate, which is
 * true of `getPlannedWorkById` and of the nested inspection-report reads.
 *
 * IT WAS NOT TRUE OF THE REPORT READS. `GET /:plannedWorkId/report`, `/report/pdf` and
 * `/report/photo-pdf` loaded through the raw `findPlannedWorkOrThrow`, so every holder of
 * `planned_work.view` — which is every technician — could read the consolidated report,
 * print the PDF, or pull the photographic report of any job in the company: customer, site,
 * crew and photographs. They now go through [findReadableWorkOrThrow] below, which restores
 * the premise rather than qualifying it.
 */
plannedWorkRouter.use(
  '/:plannedWorkId/inspection-report',
  requirePlannedWorkAssignmentScope(),
  inspectionReportRouter,
);

/**
 * The list.
 *
 * `planned_work.view` says who may call this; the auth context passed to the service says
 * which records the answer may contain. Both are required, and the second is not optional
 * plumbing: without it the filter is built entirely from query parameters and a technician
 * who omits `employeeId` receives every job in the company. See
 * `resolveAssignedWorkFilter` in planned-work.scope.ts for the predicate and for which
 * permissions lift it.
 */
plannedWorkRouter.get(
  '/',
  // The portal key admits a CUSTOMER to their OWN work only: `listPlannedWork` resolves the
  // tenant from the account and puts it in the query, so the permission answers "may you
  // look at this module" and the scope answers "at whose records".
  requireAnyPermission(PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PORTAL_PLANNED_WORK_VIEW),
  validate({ query: plannedWorkListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(
        res,
        await plannedWorkService.listPlannedWork(
          req.query as unknown as PlannedWorkListQueryInput,
          requireAuth(req),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.post(
  '/',
  // A customer raising work is a REQUEST: `createPlannedWork` forces PENDING_APPROVAL, an
  // empty crew and their own organisation for a portal caller, whatever the body says.
  requireAnyPermission(PERMISSIONS.PLANNED_WORK_CREATE, PERMISSIONS.PORTAL_PLANNED_WORK_CREATE),
  validate({ body: createPlannedWorkSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await plannedWorkService.createPlannedWork(
        req.body as CreatePlannedWorkInput,
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Төлөвлөгөөт ажил үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.get(
  '/:plannedWorkId',
  // Same split as the list: the portal key gets in, the tenant predicate in the query
  // decides whose record. Another organisation's id is a 404, never a 403.
  requireAnyPermission(PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PORTAL_PLANNED_WORK_VIEW),
  validate({ params: workParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(
        res,
        await plannedWorkService.getPlannedWorkById(
          pathParam(req, 'plannedWorkId'),
          requireAuth(req),
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Ordinary edit. Deliberately cannot write `status` or `plannedEndDate`: lifecycle moves
 * go through /transition and deadline moves go through /reschedule.
 */
plannedWorkRouter.patch(
  '/:plannedWorkId',
  requireAnyPermission(PERMISSIONS.PLANNED_WORK_UPDATE, PERMISSIONS.PORTAL_PLANNED_WORK_CREATE),
  validate({ params: workParams, body: updatePlannedWorkSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await plannedWorkService.updatePlannedWork(
        pathParam(req, 'plannedWorkId'),
        req.body as UpdatePlannedWorkInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Төлөвлөгөөт ажил шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The single lifecycle transition endpoint.
 *
 * Permission and reason requirements are enforced per action inside the transition
 * service, so this route only needs authentication: a caller without the action's
 * permission is rejected there with the same 403. Assignment scope is enforced in the
 * same place and independently of the permission, so a technician holding
 * `planned_work.change_status` still cannot drive a job they were never assigned.
 */
plannedWorkRouter.post(
  '/:plannedWorkId/transition',
  validate({ params: workParams, body: plannedWorkTransitionSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const plannedWorkId = pathParam(req, 'plannedWorkId');
      const work = await plannedWorkService.findPlannedWorkOrThrow(plannedWorkId);

      const result = await transitionPlannedWork(
        work,
        req.body as PlannedWorkTransitionInput,
        auth,
        meta(req),
      );

      ok(
        res,
        await plannedWorkService.getPlannedWorkById(plannedWorkId, auth),
        result.reportCreated
          ? 'Ажил дуусгагдлаа. Нэгдсэн тайлан ноорог төлөвт үүслээ.'
          : 'Төлөв шинэчлэгдлээ.',
      );
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.post(
  '/:plannedWorkId/reschedule',
  requirePermission(PERMISSIONS.PLANNED_WORK_RESCHEDULE),
  validate({ params: workParams, body: reschedulePlannedWorkSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await plannedWorkService.reschedulePlannedWork(
        pathParam(req, 'plannedWorkId'),
        req.body as ReschedulePlannedWorkInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Хугацаа сунгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

// -- Sub-tasks ---------------------------------------------------------------

plannedWorkRouter.post(
  '/:plannedWorkId/tasks',
  requireAnyPermission(PERMISSIONS.PLANNED_WORK_UPDATE, PERMISSIONS.PORTAL_PLANNED_WORK_CREATE),
  validate({ params: workParams, body: createPlannedWorkTaskSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await plannedWorkService.createTask(
        pathParam(req, 'plannedWorkId'),
        req.body as CreatePlannedWorkTaskInput,
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Дэд ажил нэмэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.patch(
  '/:plannedWorkId/tasks/:taskId',
  requireAnyPermission(PERMISSIONS.PLANNED_WORK_UPDATE, PERMISSIONS.PORTAL_PLANNED_WORK_CREATE),
  validate({ params: taskParams, body: updatePlannedWorkTaskSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await plannedWorkService.updateTask(
        pathParam(req, 'plannedWorkId'),
        pathParam(req, 'taskId'),
        req.body as UpdatePlannedWorkTaskInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Дэд ажил шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

/** Quantity entry, available to the workers who actually do the job. */
plannedWorkRouter.post(
  '/:plannedWorkId/tasks/:taskId/progress',
  requirePermission(PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS),
  validate({ params: taskParams, body: recordTaskProgressSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await plannedWorkService.recordTaskProgress(
        pathParam(req, 'plannedWorkId'),
        pathParam(req, 'taskId'),
        req.body as RecordTaskProgressInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Биелэлт бүртгэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

/**
 * What a sub-task consumed of one material registered on the work.
 *
 * Gated on `record_progress`, not on a key of its own: recording what a job took is the
 * same act as recording what it completed, by the same person at the same moment, and the
 * TECHNICIAN preset already holds it. `material.view` is what lets that person read the
 * catalogue to choose from; it is not what lets them write here.
 */
plannedWorkRouter.post(
  '/:plannedWorkId/tasks/:taskId/materials',
  requirePermission(PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS),
  validate({ params: taskParams, body: recordTaskMaterialUsageSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await plannedWorkService.recordTaskMaterialUsageOnWork(
        pathParam(req, 'plannedWorkId'),
        pathParam(req, 'taskId'),
        req.body as RecordTaskMaterialUsageInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Материалын зарцуулалт бүртгэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.delete(
  '/:plannedWorkId/tasks/:taskId',
  requireAnyPermission(PERMISSIONS.PLANNED_WORK_UPDATE, PERMISSIONS.PORTAL_PLANNED_WORK_CREATE),
  validate({ params: taskParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await plannedWorkService.deleteTask(
        pathParam(req, 'plannedWorkId'),
        pathParam(req, 'taskId'),
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Дэд ажил устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

// -- Task evidence photos ----------------------------------------------------

const photoKindSchema = z.object({ kind: z.enum(['BEFORE', 'AFTER']) });

plannedWorkRouter.post(
  '/:plannedWorkId/tasks/:taskId/photos',
  requirePermission(PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS),
  upload.single('file'),
  validate({ params: taskParams, body: photoKindSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const uploaded = req.file;
      if (!uploaded) {
        throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Файл заавал.', [
          { field: 'file', message: 'Зураг сонгоно уу.' },
        ]);
      }

      const result = await plannedWorkService.attachTaskPhoto(
        pathParam(req, 'plannedWorkId'),
        pathParam(req, 'taskId'),
        (req.body as z.infer<typeof photoKindSchema>).kind,
        uploaded,
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Зураг хавсаргагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.delete(
  '/:plannedWorkId/tasks/:taskId/photos/:fileId',
  requirePermission(PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS),
  validate({ params: photoParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await plannedWorkService.detachTaskPhoto(
        pathParam(req, 'plannedWorkId'),
        pathParam(req, 'taskId'),
        pathParam(req, 'fileId'),
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Зураг устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

// -- Planned materials -------------------------------------------------------

plannedWorkRouter.put(
  '/:plannedWorkId/materials',
  requirePermission(PERMISSIONS.PLANNED_WORK_UPDATE),
  validate({ params: workParams, body: plannedWorkMaterialsSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await plannedWorkService.setPlannedMaterials(
        pathParam(req, 'plannedWorkId'),
        req.body as PlannedWorkMaterialsInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Төлөвлөсөн материал шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

// -- Report workflow ---------------------------------------------------------

/**
 * The report reads, bounded by the assignment rule every other single-record read obeys.
 *
 * WHY THIS EXISTS HERE rather than in the loader. `findPlannedWorkOrThrow` is the raw
 * `findById` the write paths use, and they are guarded separately by
 * `assertPlannedWorkAssignmentScope`. The report GETs reached for the same raw loader and
 * had no second guard, so `planned_work.view` alone opened any job's consolidated report —
 * the one place the module's "reads are scoped in the loaders" premise did not hold.
 *
 * `resolveAssignedWorkFilter` is the same predicate `getPlannedWorkById` and both list
 * services apply, and it is deliberately the READ form: it returns null for a caller
 * holding an oversight OR a read-oversight key, so the office — dispatch, management,
 * finance reporting on the work — keeps full reach, and only a caller bounded by
 * assignment is bounded here.
 *
 * ANSWERED AS NOT-FOUND, matching `getPlannedWorkById` and the detail read: replying
 * "forbidden" would confirm the id names a real job and turn the endpoint into an oracle
 * for probing identifiers. The message is the one `findPlannedWorkOrThrow` raises, so an
 * out-of-scope id is indistinguishable from one that was never real.
 *
 * The scope is decided by its own query rather than from the loaded document, following
 * `assertAssignedToActor` in self-progress.policy.ts: one predicate, evaluated by the
 * database, is what keeps this from drifting from the list and the detail read.
 *
 * No customer branch, unlike `getPlannedWorkById`: a CUSTOMER reaches the portal on
 * `portal.planned_work.view` and cannot pass the `planned_work.view` gate on these routes
 * at all, so everybody arriving here is staff.
 */
async function findReadableWorkOrThrow(
  req: Request,
): Promise<Awaited<ReturnType<typeof plannedWorkService.findPlannedWorkOrThrow>>> {
  const plannedWorkId = pathParam(req, 'plannedWorkId');
  const assignmentFilter = await resolveAssignedWorkFilter<IPlannedWork>(requireAuth(req));

  // Null means an oversight holder, who is not bounded by assignment at all. It is never
  // `{}` — see `resolveAssignedWorkFilter` for why that distinction matters.
  if (assignmentFilter) {
    const filter: FilterQuery<IPlannedWork> = {
      _id: new Types.ObjectId(plannedWorkId),
      $and: [assignmentFilter],
    };
    const readable = await PlannedWork.findOne(filter).select('_id').lean();
    if (!readable) {
      throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Төлөвлөгөөт ажил олдсонгүй.');
    }
  }

  return plannedWorkService.findPlannedWorkOrThrow(plannedWorkId);
}


/** Assembled report content plus its current gates. */
plannedWorkRouter.get(
  '/:plannedWorkId/report',
  requirePermission(PERMISSIONS.PLANNED_WORK_VIEW),
  validate({ params: workParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const work = await findReadableWorkOrThrow(req);
      const state = await loadReportState(work);
      const preview = state.preview ?? (await buildReportPreview(work, state.report));

      ok(res, {
        report: state.report ? toReportDto(state.report, auth, state.blockers) : null,
        preview,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The same report, as a PDF laid out like the office's own «Үзлэгийн тайлан».
 *
 * Assembled from `buildReportPreview` — the identical call the JSON endpoint above makes
 * — so the document cannot say anything different from the screen it was exported off.
 * A second query shaped for printing would be a second answer to the same question, and
 * the two would drift.
 *
 * Read-keyed on `planned_work.view`: this renders what the caller may already read, and
 * a download is not a stronger act than the page it copies.
 */
plannedWorkRouter.get(
  '/:plannedWorkId/report/pdf',
  requirePermission(PERMISSIONS.PLANNED_WORK_VIEW),
  validate({ params: workParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const work = await findReadableWorkOrThrow(req);
      const state = await loadReportState(work);
      const preview = state.preview ?? (await buildReportPreview(work, state.report));
      const report = state.report ? toReportDto(state.report, auth, state.blockers) : null;

      // A report that cannot be assembled cannot be printed. The screen renders an empty
      // state here; a download has no equivalent, and answering with a valid-looking PDF
      // of nothing would be worse than saying so.
      if (preview === null) {
        throw AppError.badRequest(
          ERROR_CODES.VALIDATION_ERROR,
          'Тайлан бүрдээгүй тул PDF үүсгэх боломжгүй.',
        );
      }

      const [branding, photos] = await Promise.all([
        // The customer's own letterhead prints beside the operator's. Every planned work
        // names a customer, so what varies is whether that customer has set a logo — and
        // one that has not prints exactly as this report always did.
        loadReportBranding(work.customer),
        // The photographs the sub-tasks carry. The preview reports counts; the document
        // wants the pictures, so they are fetched and re-encoded here.
        taskPhotoIdsOf(work).then((ids) => loadTaskPhotos(ids, MAX_PHOTOS_PER_TASK)),
      ]);

      const pdf = await renderPdf(
        plannedWorkReportDocument(preview, report, branding, photos),
      );
      sendPdf(res, pdf, `tailan-${preview.workNumber}`);
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The same work again, as the photographic report «ТКС-2, ТКС-4 самбар гэрээт ажил».
 *
 * A SECOND document rather than a replacement, and deliberately its own route. The two
 * answer different questions about the same work: `/report/pdf` above is the consolidated
 * record an office files, this one is the photographic record a client is handed. Both are
 * built from the same `buildReportPreview` call, so neither can contradict the other or
 * the screen they are exported from.
 *
 * Keyed identically to the report it copies, for the same reason: rendering what a caller
 * may already read is not a stronger act than reading it — which is precisely why it loads
 * through [findReadableWorkOrThrow] as well. "What the caller may already read" has to be
 * the same set on all three report routes, or this document is the way around the other two.
 */
plannedWorkRouter.get(
  '/:plannedWorkId/report/photo-pdf',
  requirePermission(PERMISSIONS.PLANNED_WORK_VIEW),
  validate({ params: workParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const work = await findReadableWorkOrThrow(req);
      const state = await loadReportState(work);
      const preview = state.preview ?? (await buildReportPreview(work, state.report));
      const report = state.report ? toReportDto(state.report, auth, state.blockers) : null;

      if (preview === null) {
        throw AppError.badRequest(
          ERROR_CODES.VALIDATION_ERROR,
          'Тайлан бүрдээгүй тул PDF үүсгэх боломжгүй.',
        );
      }

      const [branding, photos] = await Promise.all([
        loadReportBranding(work.customer),
        taskPhotoIdsOf(work).then((ids) => loadTaskPhotos(ids, MAX_PHOTOS_PER_TASK)),
      ]);

      const pdf = await renderPdf(
        plannedWorkPhotoReportDocument(preview, report, branding, photos),
      );
      sendPdf(res, pdf, `foto-tailan-${preview.workNumber}`);
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.patch(
  '/:plannedWorkId/report',
  requirePermission(PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT),
  validate({ params: workParams, body: updatePlannedWorkReportSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const plannedWorkId = pathParam(req, 'plannedWorkId');
      const work = await plannedWorkService.findPlannedWorkOrThrow(plannedWorkId);
      await updateReport(work, req.body as UpdatePlannedWorkReportInput, auth, meta(req));
      ok(
        res,
        await plannedWorkService.getPlannedWorkById(plannedWorkId, auth),
        'Тайлан хадгалагдлаа.',
      );
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.post(
  '/:plannedWorkId/report/submit',
  requirePermission(PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT),
  validate({ params: workParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const plannedWorkId = pathParam(req, 'plannedWorkId');
      const work = await plannedWorkService.findPlannedWorkOrThrow(plannedWorkId);
      await submitReport(work, auth, meta(req));
      ok(
        res,
        await plannedWorkService.getPlannedWorkById(plannedWorkId, auth),
        'Тайлан хянуулахаар илгээгдлээ.',
      );
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.post(
  '/:plannedWorkId/report/return',
  requirePermission(PERMISSIONS.PLANNED_WORK_APPROVE_REPORT),
  validate({ params: workParams, body: returnPlannedWorkReportSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const plannedWorkId = pathParam(req, 'plannedWorkId');
      const work = await plannedWorkService.findPlannedWorkOrThrow(plannedWorkId);
      await returnReport(work, req.body as ReturnPlannedWorkReportInput, auth, meta(req));
      ok(
        res,
        await plannedWorkService.getPlannedWorkById(plannedWorkId, auth),
        'Тайлан засуулахаар буцаагдлаа.',
      );
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Approval. The self-approval rule is enforced per record inside the service, because
 * holding the permission is not sufficient: the approver must not be the author or the
 * submitter of this particular report.
 */
plannedWorkRouter.post(
  '/:plannedWorkId/report/approve',
  requirePermission(PERMISSIONS.PLANNED_WORK_APPROVE_REPORT),
  validate({ params: workParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const plannedWorkId = pathParam(req, 'plannedWorkId');
      const work = await plannedWorkService.findPlannedWorkOrThrow(plannedWorkId);
      await approveReport(work, auth, meta(req));
      ok(
        res,
        await plannedWorkService.getPlannedWorkById(plannedWorkId, auth),
        'Тайлан батлагдаж, ажил архивлагдлаа.',
      );
    } catch (error) {
      next(error);
    }
  },
);
