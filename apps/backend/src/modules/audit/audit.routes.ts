import { PERMISSIONS, type PaginatedData } from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import { z } from 'zod';

import { ok } from '../../common/utils/api-response.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { AuditLog, AUDIT_ACTIONS, type IAuditLog } from './audit-log.model';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');

const auditQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  entityType: z.string().trim().max(64).optional(),
  entityId: objectId.optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  userId: objectId.optional(),
  search: z.string().trim().max(200).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

type AuditQuery = z.infer<typeof auditQuerySchema>;

/**
 * Audit entries that reveal compensation detail.
 *
 * Salary changes are written with a `reason` of "salary changed" and never include
 * amounts, but the existence and timing of a change is still sensitive, so the row is
 * withheld from callers without employee.view_salary.
 */
const SALARY_SENSITIVE_REASONS = ['salary changed'];

export interface AuditEntryDto {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  channel: string | null;
  ip: string | null;
  userAgent: string | null;
  oldValue: unknown;
  newValue: unknown;
  changedFields: string[];
  reason: string | null;
  occurredAt: string;
}

function changedFieldsOf(entry: IAuditLog): string[] {
  const collect = (value: unknown): string[] =>
    typeof value === 'object' && value !== null ? Object.keys(value as Record<string, unknown>) : [];

  // Union of both sides, so a field that only appears in one is still reported.
  return [...new Set([...collect(entry.oldValue), ...collect(entry.newValue)])].filter(
    (field) => field !== 'changedFields',
  );
}

function toDto(entry: IAuditLog & { _id: Types.ObjectId }): AuditEntryDto {
  return {
    id: String(entry._id),
    entityType: entry.entityType,
    entityId: entry.entityId ? String(entry.entityId) : null,
    action: entry.action,
    actorId: entry.user ? String(entry.user) : null,
    actorName: entry.userLabel,
    actorRole: entry.userRole,
    channel: null,
    ip: entry.ip,
    userAgent: entry.userAgent,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    changedFields: changedFieldsOf(entry),
    reason: entry.reason,
    occurredAt: entry.createdAt.toISOString(),
  };
}

export const auditRouter = Router();

// Append-only by design: the model blocks every update and delete path, and no
// mutating route is exposed here.
auditRouter.use(
  authenticate,
  enforcePasswordChange,
  requirePermission(PERMISSIONS.AUDIT_VIEW),
);

auditRouter.get(
  '/',
  validate({ query: auditQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const query = req.query as unknown as AuditQuery;

      const filter: FilterQuery<IAuditLog> = {};
      if (query.entityType) filter.entityType = query.entityType;
      if (query.entityId) filter.entityId = new Types.ObjectId(query.entityId);
      if (query.action) filter.action = query.action;
      if (query.userId) filter.user = new Types.ObjectId(query.userId);

      if (query.search) {
        const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped, 'i');
        filter.$or = [{ userLabel: pattern }, { reason: pattern }, { entityType: pattern }];
      }

      if (query.from || query.to) {
        const range: Record<string, Date> = {};
        if (query.from) range.$gte = new Date(query.from);
        if (query.to) range.$lte = new Date(query.to);
        filter.createdAt = range;
      }

      // Salary-sensitive rows are excluded at the query level rather than filtered
      // after the fact, so the page count stays truthful for the caller.
      if (!auth.permissions.has(PERMISSIONS.EMPLOYEE_VIEW_SALARY)) {
        filter.reason = { $nin: SALARY_SENSITIVE_REASONS };
      }

      const skip = (query.page - 1) * query.limit;

      const [rows, total] = await Promise.all([
        AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
        AuditLog.countDocuments(filter),
      ]);

      const payload: PaginatedData<AuditEntryDto> = {
        items: rows.map(toDto),
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      };

      ok(res, payload);
    } catch (error) {
      next(error);
    }
  },
);

/** Distinct entity types and actions present, for populating the filter controls. */
auditRouter.get(
  '/facets',
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [entityTypes, actions] = await Promise.all([
        AuditLog.distinct('entityType'),
        AuditLog.distinct('action'),
      ]);
      // distinct() is typed from the schema enum, so the values are already strings.
      ok(res, {
        entityTypes: [...entityTypes].map(String).sort(),
        actions: [...actions].map(String).sort(),
      });
    } catch (error) {
      next(error);
    }
  },
);
