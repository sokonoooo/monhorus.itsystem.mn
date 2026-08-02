import {
  PERMISSIONS,
  createPlannedWorkSchema,
  createPlannedWorkTaskSchema,
  createTaskMaterialUsageSchema,
  plannedWorkListQuerySchema,
  plannedWorkMaterialsSchema,
  plannedWorkTransitionSchema,
  recordTaskProgressSchema,
  reschedulePlannedWorkSchema,
  returnPlannedWorkReportSchema,
  type CreatePlannedWorkInput,
  type CreatePlannedWorkTaskInput,
  type PlannedWorkListQueryInput,
  type PlannedWorkMaterialsInput,
  type PlannedWorkTransitionInput,
  type RecordTaskProgressInput,
  type ReschedulePlannedWorkInput,
  type ReturnPlannedWorkReportInput,
  type UpdatePlannedWorkInput,
  type UpdatePlannedWorkReportInput,
  type UpdatePlannedWorkTaskInput,
  updatePlannedWorkReportSchema,
  updatePlannedWorkSchema,
  updatePlannedWorkTaskSchema,
  updateTaskMaterialUsageSchema,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
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
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { inspectionReportRouter } from '../inspection-report/inspection-report.routes';
import { upload } from '../storage/storage.service';
import * as materialService from '../material/material.service';
import * as plannedWorkService from './planned-work.service';
import {
  approveReport,
  buildReportPreview,
  loadReportState,
  returnReport,
  submitReport,
  toReportDto,
  updateReport,
} from './planned-work.report.service';
import { requirePlannedWorkAssignmentScope } from './planned-work.scope';
import { transitionPlannedWork } from './planned-work.transition.service';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');
const workParams = z.object({ plannedWorkId: objectId });
const taskParams = z.object({ plannedWorkId: objectId, taskId: objectId });
const photoParams = z.object({ plannedWorkId: objectId, taskId: objectId, fileId: objectId });
const usageParams = z.object({ plannedWorkId: objectId, taskId: objectId, usageId: objectId });

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
 * parent id is a fact about THIS path; it applies to writes only, leaving the report read
 * on `planned_work.view` exactly as it was.
 */
plannedWorkRouter.use(
  '/:plannedWorkId/inspection-report',
  requirePlannedWorkAssignmentScope(),
  inspectionReportRouter,
);

plannedWorkRouter.get(
  '/',
  requirePermission(PERMISSIONS.PLANNED_WORK_VIEW),
  validate({ query: plannedWorkListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(
        res,
        await plannedWorkService.listPlannedWork(
          req.query as unknown as PlannedWorkListQueryInput,
        ),
      );
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.post(
  '/',
  requirePermission(PERMISSIONS.PLANNED_WORK_CREATE),
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
  requirePermission(PERMISSIONS.PLANNED_WORK_VIEW),
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
  requirePermission(PERMISSIONS.PLANNED_WORK_UPDATE),
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
  requirePermission(PERMISSIONS.PLANNED_WORK_UPDATE),
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
  requirePermission(PERMISSIONS.PLANNED_WORK_UPDATE),
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

// -- Sub-task material usage -------------------------------------------------
//
// Attached to the SUB-TASK rather than to the work, because "which job used the cable" is
// the question maintenance asks and a work-level total cannot answer it. Kept strictly
// apart from `relatedObjects`: the objects are the equipment a sub-task ASSESSES, these
// are the resources it CONSUMED, and mixing them would make a report claim that a spool of
// cable had been inspected.
//
// Reading needs `material.view`; writing rides on `planned_work.record_progress`, the same
// key that lets the person doing the job record what they did — recording what it consumed
// is the same act, and gating it on `material.manage` would mean only a catalogue
// administrator could fill in a technician's sheet.

plannedWorkRouter.get(
  '/:plannedWorkId/tasks/:taskId/materials',
  requirePermission(PERMISSIONS.MATERIAL_VIEW),
  validate({ params: taskParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await materialService.listTaskMaterialUsage(
        pathParam(req, 'plannedWorkId'),
        pathParam(req, 'taskId'),
      );
      ok(res, result);
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.post(
  '/:plannedWorkId/tasks/:taskId/materials',
  requirePermission(PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS),
  validate({ params: taskParams, body: createTaskMaterialUsageSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await materialService.addTaskMaterialUsage(
        pathParam(req, 'plannedWorkId'),
        pathParam(req, 'taskId'),
        req.body,
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Материал бүртгэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.patch(
  '/:plannedWorkId/tasks/:taskId/materials/:usageId',
  requirePermission(PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS),
  validate({ params: usageParams, body: updateTaskMaterialUsageSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await materialService.updateTaskMaterialUsage(
        pathParam(req, 'plannedWorkId'),
        pathParam(req, 'taskId'),
        pathParam(req, 'usageId'),
        req.body,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Материалын бүртгэл шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.delete(
  '/:plannedWorkId/tasks/:taskId/materials/:usageId',
  requirePermission(PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS),
  validate({ params: usageParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await materialService.removeTaskMaterialUsage(
        pathParam(req, 'plannedWorkId'),
        pathParam(req, 'taskId'),
        pathParam(req, 'usageId'),
        requireAuth(req),
        meta(req),
      );
      ok(res, null, 'Материалын бүртгэл устлаа.');
    } catch (error) {
      next(error);
    }
  },
);

plannedWorkRouter.delete(
  '/:plannedWorkId/tasks/:taskId',
  requirePermission(PERMISSIONS.PLANNED_WORK_UPDATE),
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

/** Assembled report content plus its current gates. */
plannedWorkRouter.get(
  '/:plannedWorkId/report',
  requirePermission(PERMISSIONS.PLANNED_WORK_VIEW),
  validate({ params: workParams }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const work = await plannedWorkService.findPlannedWorkOrThrow(
        pathParam(req, 'plannedWorkId'),
      );
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
