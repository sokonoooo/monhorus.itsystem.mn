import { PERMISSIONS, type TeamDto } from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';

import { resolveCustomerScope } from '../../common/security/customer-scope';
import { ok } from '../../common/utils/api-response.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { Employee } from '../employee/employee.model';
import { listDispatchCandidates } from '../employee/employee-workload.service';
import { Team } from '../org/org.models';
import { getDispatchBoard } from '../service-request/service-request.service';

const candidateQuerySchema = z.object({
  teamId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  skill: z.string().trim().max(80).optional(),
  search: z.string().trim().max(200).optional(),
  availableOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(100),
});

type CandidateQuery = z.infer<typeof candidateQuerySchema>;

export const dispatchRouter = Router();

dispatchRouter.use(authenticate, enforcePasswordChange, requirePermission(PERMISSIONS.DISPATCH_VIEW));

/**
 * The board.
 *
 * Dispatch is staff work: the router already demands `dispatch.view`, which no customer
 * role holds. The scope is resolved and handed to the service anyway so the intent is
 * visible at the call site and the board cannot become an unscoped read by omission.
 */
dispatchRouter.get(
  '/board',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await getDispatchBoard(resolveCustomerScope(requireAuth(req))));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Employees eligible for assignment, with live workload counts.
 *
 * Reads through the employee module's dispatch projection rather than querying the
 * employee collection here, so there is no second definition of "assignable" and no
 * duplicate employee dataset inside dispatch.
 */
dispatchRouter.get(
  '/employee-candidates',
  validate({ query: candidateQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as CandidateQuery;
      const candidates = await listDispatchCandidates({
        ...(query.teamId ? { teamId: query.teamId } : {}),
        ...(query.skill ? { skill: query.skill } : {}),
        ...(query.search ? { search: query.search } : {}),
        availableOnly: query.availableOnly === 'true',
        limit: query.limit,
      });
      ok(res, candidates);
    } catch (error) {
      next(error);
    }
  },
);

/** Teams eligible for assignment, with their active member count. */
dispatchRouter.get(
  '/team-candidates',
  validate({ query: candidateQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as CandidateQuery;

      const filter: Record<string, unknown> = { isActive: true };
      if (query.search) {
        const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped, 'i');
        filter.$or = [{ name: pattern }, { code: pattern }];
      }

      const teams = await Team.find(filter).sort({ name: 1 }).limit(query.limit);

      // One grouped count rather than a query per team.
      const memberCounts = await Employee.aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            status: 'ACTIVE',
            team: { $in: teams.map((team) => team._id) },
          },
        },
        { $group: { _id: '$team', count: { $sum: 1 } } },
      ]);
      const countByTeam = new Map(memberCounts.map((entry) => [String(entry._id), entry.count]));

      const payload: TeamDto[] = teams.map((team) => ({
        id: String(team._id),
        companyId: String(team.company),
        departmentId: team.department ? String(team.department) : null,
        code: team.code,
        name: team.name,
        leaderEmployeeId: team.leaderEmployee ? String(team.leaderEmployee) : null,
        memberCount: countByTeam.get(String(team._id)) ?? 0,
        isActive: team.isActive,
      }));

      ok(res, payload);
    } catch (error) {
      next(error);
    }
  },
);
