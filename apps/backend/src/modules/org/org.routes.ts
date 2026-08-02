import { PERMISSIONS, type CompanyDto, type DepartmentDto, type PositionDto, type TeamDto } from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';

import { ok } from '../../common/utils/api-response.util';
import { authenticate, enforcePasswordChange } from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { Company, Department, Position, Team } from './org.models';

/**
 * Organisation lookup endpoints backing the dependent selectors on the employee form.
 *
 * Each child endpoint requires its parent id, which is what makes it impossible for
 * the client to fetch a department list that is not scoped to the chosen company.
 */

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');

const lookupQuerySchema = z.object({
  companyId: objectId.optional(),
  departmentId: objectId.optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
  search: z.string().trim().max(200).optional(),
});

type LookupQuery = z.infer<typeof lookupQuerySchema>;

function activeFilter(query: LookupQuery): Record<string, unknown> {
  return query.includeInactive === 'true' ? {} : { isActive: true };
}

function searchFilter(query: LookupQuery): Record<string, unknown> {
  if (!query.search) return {};
  const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(escaped, 'i');
  return { $or: [{ name: pattern }, { code: pattern }] };
}

export const orgRouter = Router();

orgRouter.use(authenticate, enforcePasswordChange, requirePermission(PERMISSIONS.ORG_VIEW));

orgRouter.get(
  '/companies',
  validate({ query: lookupQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as LookupQuery;
      const companies = await Company.find({ ...activeFilter(query), ...searchFilter(query) })
        .sort({ name: 1 })
        .limit(200);

      const payload: CompanyDto[] = companies.map((company) => ({
        id: String(company._id),
        code: company.code,
        name: company.name,
        registrationNumber: company.registrationNumber,
        address: company.address,
        isActive: company.isActive,
      }));
      ok(res, payload);
    } catch (error) {
      next(error);
    }
  },
);

orgRouter.get(
  '/departments',
  validate({ query: lookupQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as LookupQuery;
      // Without a company the list is empty by design, so the UI cannot present
      // departments belonging to a company the user has not chosen.
      if (!query.companyId) {
        ok(res, [] as DepartmentDto[]);
        return;
      }

      const departments = await Department.find({
        company: new Types.ObjectId(query.companyId),
        ...activeFilter(query),
        ...searchFilter(query),
      }).sort({ name: 1 });

      const payload: DepartmentDto[] = departments.map((department) => ({
        id: String(department._id),
        companyId: String(department.company),
        code: department.code,
        name: department.name,
        isActive: department.isActive,
      }));
      ok(res, payload);
    } catch (error) {
      next(error);
    }
  },
);

orgRouter.get(
  '/positions',
  validate({ query: lookupQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as LookupQuery;
      if (!query.companyId) {
        ok(res, [] as PositionDto[]);
        return;
      }

      // A position with a null department is company-wide and therefore always valid.
      const departmentClause = query.departmentId
        ? { $or: [{ department: null }, { department: new Types.ObjectId(query.departmentId) }] }
        : {};

      const positions = await Position.find({
        company: new Types.ObjectId(query.companyId),
        ...departmentClause,
        ...activeFilter(query),
        ...searchFilter(query),
      }).sort({ name: 1 });

      const payload: PositionDto[] = positions.map((position) => ({
        id: String(position._id),
        companyId: String(position.company),
        departmentId: position.department ? String(position.department) : null,
        code: position.code,
        name: position.name,
        isActive: position.isActive,
      }));
      ok(res, payload);
    } catch (error) {
      next(error);
    }
  },
);

orgRouter.get(
  '/teams',
  validate({ query: lookupQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as LookupQuery;
      if (!query.companyId) {
        ok(res, [] as TeamDto[]);
        return;
      }

      const departmentClause = query.departmentId
        ? { $or: [{ department: null }, { department: new Types.ObjectId(query.departmentId) }] }
        : {};

      const teams = await Team.find({
        company: new Types.ObjectId(query.companyId),
        ...departmentClause,
        ...activeFilter(query),
        ...searchFilter(query),
      }).sort({ name: 1 });

      const payload: TeamDto[] = teams.map((team) => ({
        id: String(team._id),
        companyId: String(team.company),
        departmentId: team.department ? String(team.department) : null,
        code: team.code,
        name: team.name,
        leaderEmployeeId: team.leaderEmployee ? String(team.leaderEmployee) : null,
        isActive: team.isActive,
      }));
      ok(res, payload);
    } catch (error) {
      next(error);
    }
  },
);
