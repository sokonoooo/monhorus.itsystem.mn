import { Router } from 'express';

import { auditRouter } from '../modules/audit/audit.routes';
import { authRouter } from '../modules/auth/auth.routes';
import { calendarRouter } from '../modules/calendar/calendar.routes';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes';
import { diagramRouter } from '../modules/diagram/diagram.routes';
import { employeeRouter } from '../modules/employee/employee.routes';
import { invoiceRouter } from '../modules/invoice/invoice.routes';
import { notificationRouter } from '../modules/notification/notification.routes';
import { objectRouter } from '../modules/objects/object.routes';
import {
  buildingRouter,
  floorRouter,
  projectRouter,
} from '../modules/objects/project.routes';
import {
  objectMasterRouter,
  objectTypeRouter,
} from '../modules/object-master/object-master.routes';
import { materialRouter } from '../modules/material/material.routes';
import { plannedWorkRouter } from '../modules/planned-work/planned-work.routes';
import { portalRouter } from '../modules/portal/portal-summary.routes';
import {
  inspectionRouter,
  reportRouter,
} from '../modules/report/report.routes';
import { reportRegistryRouter } from '../modules/report-record/report-record.routes';
import { orgRouter } from '../modules/org/org.routes';
import { rbacRouter } from '../modules/rbac/rbac.routes';
import { dispatchRouter } from '../modules/dispatch/dispatch.routes';
import { serviceAgreementRouter } from '../modules/service-agreement/service-agreement.routes';
import { settingsRouter } from '../modules/settings/settings.routes';
import { vocabularyRouter } from '../modules/settings/vocabulary.routes';
import { serviceRequestRouter } from '../modules/service-request/service-request.routes';
import { fileRouter } from '../modules/storage/storage.routes';
import { surveyRouter } from '../modules/survey/survey.routes';
import { userRouter } from '../modules/user/user.routes';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/rbac', rbacRouter);
apiRouter.use('/org', orgRouter);
apiRouter.use('/employees', employeeRouter);
apiRouter.use('/objects', objectRouter);
apiRouter.use('/projects', projectRouter);
apiRouter.use('/buildings', buildingRouter);
apiRouter.use('/floors', floorRouter);
apiRouter.use('/object-types', objectTypeRouter);
apiRouter.use('/objects-master', objectMasterRouter);
apiRouter.use('/service-agreements', serviceAgreementRouter);
apiRouter.use('/service-requests', serviceRequestRouter);
apiRouter.use('/materials', materialRouter);
apiRouter.use('/planned-work', plannedWorkRouter);
apiRouter.use('/calendar', calendarRouter);
apiRouter.use('/dispatch', dispatchRouter);
apiRouter.use('/dashboard', dashboardRouter);
// The customer's own aggregate — see portal-summary.routes.ts for why it is not /dashboard.
apiRouter.use('/portal', portalRouter);
apiRouter.use('/diagrams', diagramRouter);
apiRouter.use('/invoices', invoiceRouter);
apiRouter.use('/inspections', inspectionRouter);
apiRouter.use('/reports', reportRouter);
// The registry holds the reports themselves; /reports stays the derived 15.2 catalogue.
apiRouter.use('/reports-registry', reportRegistryRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/surveys', surveyRouter);
apiRouter.use('/settings', settingsRouter);
// Presentation vocabulary, readable by anyone signed in — see vocabulary.routes.ts.
apiRouter.use('/vocabulary', vocabularyRouter);
apiRouter.use('/audit', auditRouter);
apiRouter.use('/files', fileRouter);
