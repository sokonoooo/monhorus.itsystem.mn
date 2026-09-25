import {
  PERMISSIONS,
  createSurveyQuestionSchema,
  reorderSurveyQuestionsSchema,
  submitSurveyResponseSchema,
  surveyResponseListQuerySchema,
  surveyResultsQuerySchema,
  updateSurveyQuestionSchema,
  type CreateSurveyQuestionInput,
  type ReorderSurveyQuestionsInput,
  type SubmitSurveyResponseInput,
  type SurveyResponseListQueryInput,
  type SurveyResultsQueryInput,
  type UpdateSurveyQuestionInput,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { resolveCustomerScope } from '../../common/security/customer-scope';
import { created, noContent, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requireAnyPermission, requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { getSurveyResults } from './survey-analytics.service';
import * as service from './survey.service';

/**
 * The satisfaction survey, mounted at /surveys.
 *
 * THREE POPULATIONS behind one router, separated by permission rather than by mount point:
 *   - `survey.manage_questions` writes the catalogue;
 *   - `survey.view_results` reads what came back;
 *   - `portal.survey.submit` is the customer, and reaches only the three portal routes.
 *
 * The customer routes resolve a tenant scope as well as checking the permission: the guard
 * says who may call the endpoint, the scope says which records the answer may contain. The
 * results routes deliberately do NOT narrow by assignment — see `survey-analytics.service.ts`
 * for why the `employee` field is not a readership list.
 */
export const surveyRouter = Router();

surveyRouter.use(authenticate, enforcePasswordChange);

const questionIdParamSchema = z.object({
  questionId: z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.'),
});

const requestIdParamSchema = z.object({
  requestId: z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.'),
});

/* ------------------------------------------------------------------ catalogue */

/**
 * The catalogue, inactive questions included.
 *
 * Readable by whoever may edit it OR read the results, because the results screen labels its
 * columns from here and would otherwise have to be granted the editing key to draw a table.
 */
surveyRouter.get(
  '/questions',
  requireAnyPermission(PERMISSIONS.SURVEY_MANAGE_QUESTIONS, PERMISSIONS.SURVEY_VIEW_RESULTS),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await service.listSurveyQuestions());
    } catch (error) {
      next(error);
    }
  },
);

surveyRouter.post(
  '/questions',
  requirePermission(PERMISSIONS.SURVEY_MANAGE_QUESTIONS),
  validate({ body: createSurveyQuestionSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await service.createSurveyQuestion(
        req.body as CreateSurveyQuestionInput,
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Асуулт нэмэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

surveyRouter.patch(
  '/questions/:questionId',
  requirePermission(PERMISSIONS.SURVEY_MANAGE_QUESTIONS),
  validate({ params: questionIdParamSchema, body: updateSurveyQuestionSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await service.updateSurveyQuestion(
        pathParam(req, 'questionId'),
        req.body as UpdateSurveyQuestionInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Асуулт шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

surveyRouter.delete(
  '/questions/:questionId',
  requirePermission(PERMISSIONS.SURVEY_MANAGE_QUESTIONS),
  validate({ params: questionIdParamSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await service.deleteSurveyQuestion(
        pathParam(req, 'questionId'),
        requireAuth(req),
        meta(req),
      );
      noContent(res, 'Асуулт устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

/** POST rather than PATCH: the body is an order, not a patch to any one question. */
surveyRouter.post(
  '/questions/reorder',
  requirePermission(PERMISSIONS.SURVEY_MANAGE_QUESTIONS),
  validate({ body: reorderSurveyQuestionsSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await service.reorderSurveyQuestions(
        req.body as ReorderSurveyQuestionsInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Дараалал хадгалагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

/* --------------------------------------------------------------------- portal */

surveyRouter.get(
  '/pending',
  requirePermission(PERMISSIONS.PORTAL_SURVEY_SUBMIT),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      ok(res, await service.listPendingSurveys(resolveCustomerScope(auth)));
    } catch (error) {
      next(error);
    }
  },
);

surveyRouter.get(
  '/requests/:requestId/form',
  requirePermission(PERMISSIONS.PORTAL_SURVEY_SUBMIT),
  validate({ params: requestIdParamSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      ok(
        res,
        await service.getSurveyForm(pathParam(req, 'requestId'), resolveCustomerScope(auth)),
      );
    } catch (error) {
      next(error);
    }
  },
);

/** One technician per call; a client with five people to rate makes five calls. */
surveyRouter.post(
  '/requests/:requestId/responses',
  requirePermission(PERMISSIONS.PORTAL_SURVEY_SUBMIT),
  validate({ params: requestIdParamSchema, body: submitSurveyResponseSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const result = await service.submitSurveyResponse(
        pathParam(req, 'requestId'),
        req.body as SubmitSurveyResponseInput,
        resolveCustomerScope(auth),
        auth,
        meta(req),
      );
      created(res, result, 'Үнэлгээ бүртгэгдлээ. Баярлалаа.');
    } catch (error) {
      next(error);
    }
  },
);

/* -------------------------------------------------------------------- results */

surveyRouter.get(
  '/responses',
  requirePermission(PERMISSIONS.SURVEY_VIEW_RESULTS),
  validate({ query: surveyResponseListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const query = req.query as unknown as SurveyResponseListQueryInput;
      ok(res, await service.listSurveyResponses(query, resolveCustomerScope(auth)));
    } catch (error) {
      next(error);
    }
  },
);

surveyRouter.get(
  '/results',
  requirePermission(PERMISSIONS.SURVEY_VIEW_RESULTS),
  validate({ query: surveyResultsQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const query = req.query as unknown as SurveyResultsQueryInput;
      ok(res, await getSurveyResults(query, resolveCustomerScope(auth)));
    } catch (error) {
      next(error);
    }
  },
);
