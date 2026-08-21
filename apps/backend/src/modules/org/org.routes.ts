import { PERMISSIONS } from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';

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
import * as service from './org.service';
import {
  companyIdParamSchema,
  createCompanySchema,
  createDepartmentSchema,
  createPositionSchema,
  departmentIdParamSchema,
  orgListQuerySchema,
  positionIdParamSchema,
  setOrgActiveSchema,
  updateCompanySchema,
  updateDepartmentSchema,
  updatePositionSchema,
  type OrgListQuery,
} from './org.validation';

/**
 * Internal organisation master data — the provider's own companies, departments and
 * positions — serving both the management screens and the dependent selectors on the
 * employee form.
 *
 * Reading is separated from editing the way every catalogue in this system separates
 * them: everyone who fills in an employee card picks from these lists, and almost nobody
 * may rewrite them. There is no delete anywhere below; a record that is no longer used is
 * deactivated, so the assignments referencing it keep resolving.
 */
export const orgRouter = Router();

orgRouter.use(authenticate, enforcePasswordChange);

function listQuery(req: Request): OrgListQuery {
  return req.query as unknown as OrgListQuery;
}

// -- Companies ----------------------------------------------------------------

orgRouter.get(
  '/companies',
  requirePermission(PERMISSIONS.ORG_VIEW),
  validate({ query: orgListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await service.listCompanies(listQuery(req)));
    } catch (error) {
      next(error);
    }
  },
);

orgRouter.post(
  '/companies',
  requirePermission(PERMISSIONS.ORG_MANAGE),
  validate({ body: createCompanySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      created(res, await service.createCompany(req.body, auth, meta(req)), 'Компани бүртгэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

orgRouter.patch(
  '/companies/:companyId',
  requirePermission(PERMISSIONS.ORG_MANAGE),
  validate({ params: companyIdParamSchema, body: updateCompanySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      ok(
        res,
        await service.updateCompany(pathParam(req, 'companyId'), req.body, auth, meta(req)),
        'Компани шинэчлэгдлээ.',
      );
    } catch (error) {
      next(error);
    }
  },
);

orgRouter.patch(
  '/companies/:companyId/status',
  requirePermission(PERMISSIONS.ORG_MANAGE),
  validate({ params: companyIdParamSchema, body: setOrgActiveSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      ok(
        res,
        await service.setCompanyActive(
          pathParam(req, 'companyId'),
          req.body.isActive,
          auth,
          meta(req),
        ),
        'Компанийн төлөв шинэчлэгдлээ.',
      );
    } catch (error) {
      next(error);
    }
  },
);

// -- Departments --------------------------------------------------------------

orgRouter.get(
  '/departments',
  requirePermission(PERMISSIONS.ORG_VIEW),
  validate({ query: orgListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await service.listDepartments(listQuery(req)));
    } catch (error) {
      next(error);
    }
  },
);

orgRouter.post(
  '/departments',
  requirePermission(PERMISSIONS.ORG_MANAGE),
  validate({ body: createDepartmentSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      created(res, await service.createDepartment(req.body, auth, meta(req)), 'Алба бүртгэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

orgRouter.patch(
  '/departments/:departmentId',
  requirePermission(PERMISSIONS.ORG_MANAGE),
  validate({ params: departmentIdParamSchema, body: updateDepartmentSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      ok(
        res,
        await service.updateDepartment(pathParam(req, 'departmentId'), req.body, auth, meta(req)),
        'Алба шинэчлэгдлээ.',
      );
    } catch (error) {
      next(error);
    }
  },
);

orgRouter.patch(
  '/departments/:departmentId/status',
  requirePermission(PERMISSIONS.ORG_MANAGE),
  validate({ params: departmentIdParamSchema, body: setOrgActiveSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      ok(
        res,
        await service.setDepartmentActive(
          pathParam(req, 'departmentId'),
          req.body.isActive,
          auth,
          meta(req),
        ),
        'Албаны төлөв шинэчлэгдлээ.',
      );
    } catch (error) {
      next(error);
    }
  },
);

// -- Positions ----------------------------------------------------------------

orgRouter.get(
  '/positions',
  requirePermission(PERMISSIONS.ORG_VIEW),
  validate({ query: orgListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await service.listPositions(listQuery(req)));
    } catch (error) {
      next(error);
    }
  },
);

orgRouter.post(
  '/positions',
  requirePermission(PERMISSIONS.ORG_MANAGE),
  validate({ body: createPositionSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      created(
        res,
        await service.createPosition(req.body, auth, meta(req)),
        'Албан тушаал бүртгэгдлээ.',
      );
    } catch (error) {
      next(error);
    }
  },
);

orgRouter.patch(
  '/positions/:positionId',
  requirePermission(PERMISSIONS.ORG_MANAGE),
  validate({ params: positionIdParamSchema, body: updatePositionSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      ok(
        res,
        await service.updatePosition(pathParam(req, 'positionId'), req.body, auth, meta(req)),
        'Албан тушаал шинэчлэгдлээ.',
      );
    } catch (error) {
      next(error);
    }
  },
);

orgRouter.patch(
  '/positions/:positionId/status',
  requirePermission(PERMISSIONS.ORG_MANAGE),
  validate({ params: positionIdParamSchema, body: setOrgActiveSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      ok(
        res,
        await service.setPositionActive(
          pathParam(req, 'positionId'),
          req.body.isActive,
          auth,
          meta(req),
        ),
        'Албан тушаалын төлөв шинэчлэгдлээ.',
      );
    } catch (error) {
      next(error);
    }
  },
);

// -- Teams --------------------------------------------------------------------

/** Lookup only, and deliberately still a bare array: nothing consumes a page of teams. */
orgRouter.get(
  '/teams',
  requirePermission(PERMISSIONS.ORG_VIEW),
  validate({ query: orgListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await service.listTeams(listQuery(req)));
    } catch (error) {
      next(error);
    }
  },
);
