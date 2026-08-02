import {
  PERMISSIONS,
  plannedWorkIdParamSchema,
  returnInspectionReportSchema,
  reviewInspectionReportSchema,
  updateInspectionReportSchema,
} from '@monhorus/shared';
import { Router } from 'express';

import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import {
  approveReportHandler,
  finaliseReportHandler,
  generateReportHandler,
  getReadinessHandler,
  getReportHandler,
  reopenReportHandler,
  returnReportHandler,
  submitReportHandler,
  updateReportHandler,
} from './inspection-report.controller';

/**
 * Mounted under /planned-work/:plannedWorkId/inspection-report, so `mergeParams` is what
 * makes the parent id visible here. Authentication is applied by the parent router.
 *
 * No new permission keys: viewing rides on planned_work.view, authoring on
 * planned_work.submit_report and every review action on planned_work.approve_report.
 */
export const inspectionReportRouter = Router({ mergeParams: true });

const params = { params: plannedWorkIdParamSchema };

inspectionReportRouter.get(
  '/',
  requirePermission(PERMISSIONS.PLANNED_WORK_VIEW),
  validate(params),
  getReportHandler,
);

inspectionReportRouter.get(
  '/readiness',
  requirePermission(PERMISSIONS.PLANNED_WORK_VIEW),
  validate(params),
  getReadinessHandler,
);

inspectionReportRouter.post(
  '/',
  requirePermission(PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT),
  validate(params),
  generateReportHandler,
);

inspectionReportRouter.patch(
  '/',
  requirePermission(PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT),
  validate({ ...params, body: updateInspectionReportSchema }),
  updateReportHandler,
);

inspectionReportRouter.post(
  '/submit',
  requirePermission(PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT),
  validate(params),
  submitReportHandler,
);

inspectionReportRouter.post(
  '/approve',
  requirePermission(PERMISSIONS.PLANNED_WORK_APPROVE_REPORT),
  validate({ ...params, body: reviewInspectionReportSchema }),
  approveReportHandler,
);

inspectionReportRouter.post(
  '/return',
  requirePermission(PERMISSIONS.PLANNED_WORK_APPROVE_REPORT),
  validate({ ...params, body: returnInspectionReportSchema }),
  returnReportHandler,
);

inspectionReportRouter.post(
  '/finalise',
  requirePermission(PERMISSIONS.PLANNED_WORK_APPROVE_REPORT),
  validate({ ...params, body: reviewInspectionReportSchema }),
  finaliseReportHandler,
);

inspectionReportRouter.post(
  '/reopen',
  requirePermission(PERMISSIONS.PLANNED_WORK_APPROVE_REPORT),
  validate(params),
  reopenReportHandler,
);
