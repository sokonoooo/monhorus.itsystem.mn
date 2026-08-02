import { type ServiceRequestDetailDto } from '@monhorus/shared';
import { Types } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  customerScopeFilter,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import { Employee } from '../employee/employee.model';
import { notify } from '../notification/notification.service';
import { CLAIMABLE_STATUSES, ServiceRequest } from './service-request.model';
import { getServiceRequestById } from './service-request.service';

/**
 * Нээлттэй ажил — taking unassigned work for yourself.
 *
 * Distinct from assignment, and deliberately so. `dispatch.assign` is the authority to put
 * somebody ELSE on a job and belongs to a dispatcher; claiming only ever writes the
 * caller's own employee id onto work that currently has nobody, and is gated on
 * `service_request.claim`, which a technician holds. Nothing here accepts an employee id
 * from the request body — the claimer is resolved from the session, so the endpoint has no
 * parameter through which one employee could be put on a job by another.
 */

/**
 * The caller's own employee record, refused unless it can actually do the work.
 *
 * Every check here is about the CLAIMER rather than the request, and each has a distinct
 * failure a caller can act on, so they are reported separately rather than as one refusal.
 */
async function resolveClaimant(actor: AuthContext): Promise<{
  employeeId: Types.ObjectId;
  label: string;
}> {
  if (!actor.employeeId) {
    throw AppError.forbidden(
      ERROR_CODES.FORBIDDEN,
      'Таны бүртгэл ажилтны картад холбогдоогүй тул ажил авах боломжгүй.',
    );
  }

  const employee = await Employee.findById(actor.employeeId).select(
    'status firstName lastName employeeCode',
  );
  if (!employee) {
    throw AppError.forbidden(ERROR_CODES.FORBIDDEN, 'Ажилтны бүртгэл олдсонгүй.');
  }

  // The same rule assignment applies to a dispatcher's choice: an employee on leave or
  // terminated is not assignable, and claiming must not be a way around it.
  if (employee.status !== 'ACTIVE') {
    throw AppError.forbidden(
      ERROR_CODES.FORBIDDEN,
      'Зөвхөн идэвхтэй ажилтан ажил авах боломжтой.',
    );
  }

  return {
    employeeId: employee._id,
    label: `${employee.lastName} ${employee.firstName}`.trim(),
  };
}

/**
 * Claims one open request for the caller.
 *
 * THE CLAIM ITSELF IS ONE ATOMIC WRITE. The whole point of this endpoint is that two
 * technicians tapping "Өөртөө авах" at the same moment cannot both succeed, and a
 * read-then-save cannot promise that: both would read an unassigned row, both would find
 * it free, and the second save would quietly overwrite the first, leaving one employee
 * believing they hold a job that is now somebody else's.
 *
 * `findOneAndUpdate` with the open condition IN THE FILTER makes the check and the write
 * one operation the database orders for us. The loser matches nothing and gets null, which
 * is reported as "already taken" rather than as a failure — because it is not one, it is
 * the correct outcome of a race.
 *
 * The scope filter is folded into the same predicate rather than checked first, so a
 * cross-tenant claim cannot succeed even if the request is genuinely open: a customer-tier
 * caller's scope narrows the filter to their own organisation and simply matches nothing.
 */
export async function claimServiceRequest(
  requestId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ServiceRequestDetailDto> {
  const claimant = await resolveClaimant(actor);

  // Read once before the write, purely to tell the three "cannot be claimed" cases apart.
  // The answer is NOT trusted — the atomic update below re-asserts every condition — but
  // without it every refusal would read "already taken", including a request that does not
  // exist and one the caller may not see.
  const existing = await ServiceRequest.findOne({
    _id: new Types.ObjectId(requestId),
    ...customerScopeFilter(scope),
  }).select('status assignedEmployees assignedTeam requestNumber');

  if (!existing) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хүсэлт олдсонгүй.');
  }

  if (!CLAIMABLE_STATUSES.includes(existing.status as (typeof CLAIMABLE_STATUSES)[number])) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Энэ хүсэлт нээлттэй биш байна.',
    );
  }

  const now = new Date();
  const claimed = await ServiceRequest.findOneAndUpdate(
    {
      _id: new Types.ObjectId(requestId),
      ...customerScopeFilter(scope),
      // Both conditions re-checked inside the atomic filter. Status alone is not enough:
      // a request can be UNASSIGNED and still name a team, and claiming one of those would
      // silently drop the team.
      status: { $in: CLAIMABLE_STATUSES },
      assignedEmployees: { $size: 0 },
      assignedTeam: null,
    },
    {
      $set: {
        assignedEmployees: [claimant.employeeId],
        status: 'ASSIGNED',
        // The open interval is over, so the unclaimed sweep must stop considering this row
        // and any future re-opening starts a fresh interval.
        openedForClaimAt: null,
        unclaimedNotifiedFor: null,
      },
      $push: {
        statusHistory: {
          _id: new Types.ObjectId(),
          fromStatus: existing.status,
          toStatus: 'ASSIGNED',
          reason: `${claimant.label} ажлыг өөртөө авав.`,
          changedBy: new Types.ObjectId(actor.userId),
          changedByName: actor.fullName,
          changedAt: now,
        },
      },
    },
    { new: true },
  );

  if (!claimed) {
    // Matched nothing under a filter we know named a real, in-scope request: somebody else
    // won the race between the read above and this write.
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      'Энэ ажлыг өөр ажилтан аль хэдийн авсан байна.',
    );
  }

  await recordAudit({
    entityType: 'Work',
    entityId: claimed._id,
    action: 'Assigned',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'self-assigned from the open queue',
    oldValue: { assignedEmployees: [], status: existing.status },
    newValue: {
      assignedEmployees: [String(claimant.employeeId)],
      status: 'ASSIGNED',
      claimedBy: claimant.label,
    },
  });

  // Dispatchers are told, not the claimer: they are the people who would otherwise still
  // be looking at it on the board.
  await notify({
    event: 'SERVICE_REQUEST_ASSIGNED',
    title: `${claimed.requestNumber} ажлыг ${claimant.label} өөртөө авлаа`,
    body: claimed.description.slice(0, 300),
    entityType: 'Work',
    entityId: claimed._id,
    linkPath: `/service-requests/${String(claimed._id)}`,
    permission: 'dispatch.view',
    excludeUserId: actor.userId,
  });

  return getServiceRequestById(requestId, scope);
}
