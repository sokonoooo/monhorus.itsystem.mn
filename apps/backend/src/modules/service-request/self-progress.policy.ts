/**
 * WHO MAY MOVE A REQUEST, AND HOW FAR — the field half of it.
 *
 * `service_request.change_status` is the office's whole authority over a request: it gates
 * every transition, and it also gates `report/approve` and `report/return`. That is why a
 * technician could not simply be granted it in order to say "I have arrived", and why two
 * narrower keys exist instead:
 *
 *   - `service_request.self_progress` — the six states in `SELF_PROGRESS_STATUSES`.
 *   - `service_request.approve_report` — approving a submitted conclusion, never returning
 *     one.
 *
 * THIS FILE IS THE ONLY PLACE EITHER IS INTERPRETED, and both are interpreted in the
 * services rather than in the routes, so a future route, a bulk endpoint or an internal
 * caller that reaches the same mutation another way cannot skip the check.
 *
 * TWO INDEPENDENT QUESTIONS, both of which must answer yes for a scoped caller:
 *
 *   1. "May this caller perform this KIND of action" — the permission keys.
 *   2. "Does THIS request belong to them at all" — the assignment scope, which is the same
 *      policy `planned-work.scope.ts` states for planned work and which service requests
 *      share because they carry the same two assignment fields.
 *
 * WHY THE ASSIGNMENT PREDICATE HERE EXCLUDES THE UNCLAIMED QUEUE, when the detail read and
 * the conclusion routes both include it. Those are READS, and admitting the open pool is
 * what lets a technician open a "Нээлттэй" row and read the fault before deciding to take
 * it. Progressing a request is not reading it: driving a job nobody holds through ACCEPTED
 * and ON_SITE without ever claiming it would put work into a state that names no one, and
 * `POST /:id/claim` exists precisely so that taking it is a deliberate, audited act. So
 * `includeUnclaimed` is false on this path and only on this path.
 *
 * WHAT MUST NOT BE DONE INSTEAD: neither new key may be added to `OVERSIGHT_PERMISSIONS`
 * or `READ_OVERSIGHT_PERMISSIONS` in `planned-work.scope.ts`. Both lists mean "this caller
 * supervises other people's work", and putting a field key in either would dissolve the
 * scope that makes these grants safe — a technician would acquire reach over every request
 * in the company on the strength of a key granted so they could report their own arrival.
 */
import {
  PERMISSIONS,
  SELF_PROGRESS_STATUSES,
  type ServiceRequestStatus,
} from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { hasPermission } from '../../middlewares/authorize.middleware';
import { resolveAssignedWorkFilter } from '../planned-work/planned-work.scope';
import { ServiceRequest, type IServiceRequest } from './service-request.model';

/**
 * True when the caller holds the office key, in which case neither narrow key applies and
 * nothing below runs.
 *
 * Every existing holder — SYSTEM_ADMIN, ADMIN, MANAGEMENT, DISPATCH and the `head_admin`
 * tier — keeps exactly the authority they had. The narrow keys ADD a population; they take
 * nothing away from anyone.
 */
export function hasFullStatusAuthority(actor: AuthContext): boolean {
  return hasPermission(actor, PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS);
}

/**
 * 403 rather than 404, matching the planned-work write refusal it mirrors.
 *
 * A caller only reaches this after naming an id they obtained somehow, and the honest
 * reading of a technician doing that is a stale screen or work reassigned away from them
 * between opening the job and pressing the button — which "this is not yours" explains and
 * "it no longer exists" does not.
 */
function refuse(message: string): never {
  throw AppError.forbidden(ERROR_CODES.FORBIDDEN, message);
}

/**
 * Asserts the request names this caller, or their team.
 *
 * Re-queried by id rather than judged from a loaded document, for the reason
 * `resolveAssignmentScope` gives: handlers mutate the record they hold, and deciding from a
 * caller-held document would let an assignment written earlier in the same request satisfy
 * the check that was supposed to authorise it.
 */
async function assertAssignedToActor(
  requestId: Types.ObjectId | string,
  actor: AuthContext,
): Promise<void> {
  const assignmentFilter = await resolveAssignedWorkFilter<IServiceRequest>(actor, {
    includeUnclaimed: false,
  });

  // Null means the caller holds an oversight key and is not bounded by assignment at all.
  // It is never `{}` — see `resolveAssignedWorkFilter` for why that distinction matters.
  if (!assignmentFilter) return;

  const filter: FilterQuery<IServiceRequest> = {
    _id: new Types.ObjectId(String(requestId)),
    $and: [assignmentFilter],
  };

  const mine = await ServiceRequest.findOne(filter).select('_id').lean();
  if (!mine) {
    refuse('Танд хуваарилагдаагүй хүсэлтийн төлөвийг өөрчлөх боломжгүй.');
  }
}

/**
 * The gate on `POST /service-requests/:id/status` for a caller who reached it on
 * `service_request.self_progress` alone.
 *
 * ORDERED AUTHORISE-THEN-VALIDATE, deliberately. A target outside the set is 403 even when
 * the transition would have been legal — the caller is being told they may not make that
 * KIND of move, which is true regardless of where the request currently sits. Only once
 * both permission and scope have passed does `changeServiceRequestStatus` go on to apply
 * `SERVICE_REQUEST_TRANSITIONS` and the `reason` rule, so an illegal move inside the set is
 * still the 400 it always was.
 */
export async function assertSelfProgressAllowed(
  requestId: Types.ObjectId | string,
  to: ServiceRequestStatus,
  actor: AuthContext,
): Promise<void> {
  if (hasFullStatusAuthority(actor)) return;

  if (!SELF_PROGRESS_STATUSES.includes(to)) {
    refuse('Энэ төлөвт шилжүүлэх эрх байхгүй байна.');
  }

  await assertAssignedToActor(requestId, actor);
}

/**
 * The gate on `POST /service-requests/:id/report/approve` for a caller who reached it on
 * `service_request.approve_report` alone.
 *
 * There is no `assertSelfReturnAllowed` beside this and there must not be one: the return
 * route still requires `service_request.change_status` outright, because returning a
 * conclusion is a judgement on somebody else's work.
 */
export async function assertReportApprovalAllowed(
  requestId: Types.ObjectId | string,
  actor: AuthContext,
): Promise<void> {
  if (hasFullStatusAuthority(actor)) return;
  await assertAssignedToActor(requestId, actor);
}
