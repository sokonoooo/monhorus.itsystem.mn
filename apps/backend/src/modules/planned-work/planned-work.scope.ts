import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import { Types } from 'mongoose';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { requireAuth } from '../../middlewares/authenticate.middleware';
import { hasPermission } from '../../middlewares/authorize.middleware';
import { Employee } from '../employee/employee.model';
import { PlannedWork } from './planned-work.models';

/**
 * ASSIGNMENT SCOPE for planned work.
 *
 * The single policy that answers "may this caller act on THIS job at all", as opposed to
 * "may this caller perform this KIND of action", which is what the permission keys answer.
 *
 * The two questions are independent and both must be answered yes. Before this existed
 * only the second was asked, and the consequence was live and confirmed: a technician who
 * had never been assigned to a planned work drove it through PLAN, START, PAUSE, RESUME
 * and COMPLETE, recorded task progress on it, uploaded evidence photos against it and
 * submitted its report. Holding `planned_work.change_status` was authority over every job
 * in the company.
 *
 * THE RULE. A scoped caller may act on a planned work only when
 *   - the employee record the authenticated account is linked to appears in
 *     `PlannedWork.assignedEmployees`, or
 *   - that employee's `Employee.team` equals the work's `PlannedWork.assignedTeam`.
 *
 * WHO IS SCOPED. Everyone who does not hold one of `OVERSIGHT_PERMISSIONS` below. This is
 * a capability test, never a tier-string test: `auth.role === 'technician'` describes how
 * an account was provisioned, not what it may do, and a supervisor sitting on the
 * technician tier with a second role must keep the reach that second role gives them.
 *
 * WHAT NEVER WIDENS SCOPE. The four keys the TECHNICIAN default grants —
 * `planned_work.view`, `planned_work.change_status`, `planned_work.record_progress` and
 * `planned_work.submit_report` — are absent from the oversight list on purpose, and no
 * combination of them lifts the restriction. That is the point of keeping permission and
 * data scope independent: a technician who acquires an extra *doing* key is still confined
 * to their own jobs. Acquiring one of the oversight keys is a different act entirely — it
 * is a deliberate promotion to authority over other people's work, and it is the only way
 * to leave the scope.
 */

/**
 * Holding any one of these makes a caller unscoped.
 *
 * Every key here is authority over work OTHER PEOPLE do rather than authority to do the
 * work: creating a job for someone, reassigning or rescheduling one, cancelling one,
 * approving the write-up of one, or dispatching one. Not one of them appears in the
 * TECHNICIAN default set, so the field tier is scoped by construction, while
 *
 *   - DISPATCH  keeps full reach through `dispatch.assign`,
 *   - MANAGEMENT and ADMIN through `planned_work.update` and the rest,
 *   - SYSTEM_ADMIN through holding everything, and
 *   - `head_admin` through the hardcoded superuser union in `resolveEffectivePermissions`.
 *
 * A custom role built in the RBAC screen lands wherever its keys put it, which is the
 * intended behaviour: an administrator who grants `planned_work.update` to a role has
 * said that role supervises planned work.
 */
export const OVERSIGHT_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_RESCHEDULE,
  PERMISSIONS.PLANNED_WORK_CANCEL,
  PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
  PERMISSIONS.DISPATCH_ASSIGN,
];

/** True when the caller supervises planned work rather than merely carrying it out. */
export function hasPlannedWorkOversight(actor: AuthContext): boolean {
  return OVERSIGHT_PERMISSIONS.some((key) => hasPermission(actor, key));
}

/**
 * The refusal.
 *
 * 403 and not 404, which is a deliberate departure from `assertInCustomerScope`. That
 * helper reports an out-of-tenant record as missing because for a customer the EXISTENCE
 * of another organisation's record is itself the secret, and a 403 would turn the detail
 * endpoint into an oracle for probing identifiers. Neither half of that reasoning holds
 * here: `planned_work.view` is unscoped, so a technician can already list and open this
 * exact record, and answering "not found" for a job they are looking at on screen would
 * be a lie that reads as data loss. The repository's convention is therefore satisfied by
 * the other half of the same rule — a record you may see but may not act on is 403 — which
 * is what the transition service already returns for a missing permission.
 */
function refuse(): never {
  throw AppError.forbidden(
    ERROR_CODES.FORBIDDEN,
    'Танд хуваарилагдаагүй ажил дээр үйлдэл хийх боломжгүй.',
  );
}

/**
 * The decision, without an opinion on how to report it.
 *
 * `UNSCOPED` and `ASSIGNED` both mean "may act". They are kept apart so a caller that
 * needs to describe the reason — the available-actions list, say — can.
 */
export type AssignmentScopeDecision = 'UNSCOPED' | 'ASSIGNED' | 'NOT_ASSIGNED' | 'NO_WORK';

/**
 * Resolves assignment scope for one planned work.
 *
 * TAKES AN ID, NOT A DOCUMENT, ON PURPOSE. Handlers load the work and then mutate it, and
 * `updatePlannedWork` in particular writes `assignedEmployees` and `assignedTeam` straight
 * onto the in-memory document. Deciding from a caller-held document would let an assignment
 * written earlier in the same request satisfy the check that was supposed to authorise it.
 * Reading the two fields back out of the collection here means the decision is always made
 * against persisted state that this request has not touched.
 *
 * The acting employee comes from `AuthContext.employeeId`, which the authenticate
 * middleware resolves from the current `Employee.systemUser` link on every request. It is
 * never read from the body, the query or the path, so there is no "act as" parameter to
 * forge. Team membership is likewise read from the `Employee` record rather than taken from
 * the client, so a client-supplied team is not merely ignored — it has nowhere to enter.
 */
export async function resolveAssignmentScope(
  plannedWorkId: Types.ObjectId | string,
  actor: AuthContext,
): Promise<AssignmentScopeDecision> {
  if (hasPlannedWorkOversight(actor)) return 'UNSCOPED';

  // No employee card means no assignment can name this caller. Null is legitimate — most
  // office accounts have no card — but it is "no record", never "any record".
  if (!actor.employeeId) return 'NOT_ASSIGNED';

  const [assignment, employee] = await Promise.all([
    PlannedWork.findById(plannedWorkId).select('assignedEmployees assignedTeam').lean(),
    Employee.findById(new Types.ObjectId(actor.employeeId)).select('team').lean(),
  ]);

  if (!assignment) return 'NO_WORK';

  const directlyAssigned = assignment.assignedEmployees.some(
    (id) => String(id) === actor.employeeId,
  );

  // A null team on either side is not a match: two unassigned nulls must not read as
  // "same team", which would hand every teamless technician every teamless job.
  const onAssignedTeam =
    employee?.team != null &&
    assignment.assignedTeam != null &&
    String(employee.team) === String(assignment.assignedTeam);

  return directlyAssigned || onAssignedTeam ? 'ASSIGNED' : 'NOT_ASSIGNED';
}

/** Non-throwing form, for building the UI's action list rather than gating a write. */
export async function isWithinAssignmentScope(
  plannedWorkId: Types.ObjectId | string,
  actor: AuthContext,
): Promise<boolean> {
  const decision = await resolveAssignmentScope(plannedWorkId, actor);
  return decision === 'UNSCOPED' || decision === 'ASSIGNED';
}

/**
 * Asserts the caller may act on this planned work. Throws, or returns silently.
 *
 * THE ONE CALL every technician-reachable planned-work write makes. It is invoked from the
 * services rather than from the routes so that it cannot be skipped by a future route, a
 * bulk endpoint or an internal caller that reaches the same mutation another way.
 */
export async function assertPlannedWorkAssignmentScope(
  plannedWorkId: Types.ObjectId | string,
  actor: AuthContext,
): Promise<void> {
  const decision = await resolveAssignmentScope(plannedWorkId, actor);

  // Genuinely absent record: report it as such, the same as every other loader here.
  if (decision === 'NO_WORK') {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Төлөвлөгөөт ажил олдсонгүй.');
  }
  if (decision === 'NOT_ASSIGNED') refuse();
}

/**
 * A NOTE ON TASK IDS, because assignment scope alone is not enough for the task routes.
 *
 * `/:plannedWorkId/tasks/:taskId/...` carries two independent identifiers, and this policy
 * only authorises the first. A caller assigned to job A could otherwise pass A's id past
 * the scope check and then name a task belonging to job B, writing progress, evidence or a
 * score onto a job they have no claim to. What stops that is `findTask` in
 * `planned-work.service.ts`, whose query is `{ _id: taskId, plannedWork: plannedWorkId }`
 * — the pairing is verified, not just the parent. Any future handler that reaches a task
 * by id must scope it by its parent the same way; do not add a bare `findById`.
 */

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/** Methods that only read. Assignment scope restricts acting, not looking. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Route guard form, for sub-routers mounted under `/:plannedWorkId` whose handlers live
 * outside this module and therefore cannot call the policy themselves.
 *
 * Applies to writes only. Reads stay on `planned_work.view` alone, exactly as they were:
 * narrowing what a technician may SEE is a separate decision from what they may DO, and
 * making it here would silently change the job-list and job-card behaviour.
 *
 * A malformed id is passed through untouched so the child router's own params schema
 * produces the usual 400 rather than this guard producing a cast error.
 */
export function requirePlannedWorkAssignmentScope(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (READ_METHODS.has(req.method)) {
      next();
      return;
    }

    const plannedWorkId = req.params.plannedWorkId;
    if (typeof plannedWorkId !== 'string' || !OBJECT_ID_PATTERN.test(plannedWorkId)) {
      next();
      return;
    }

    try {
      assertPlannedWorkAssignmentScope(plannedWorkId, requireAuth(req))
        .then(() => next())
        .catch(next);
    } catch (error) {
      // `requireAuth` throws synchronously when the guard is ever mounted somewhere
      // `authenticate` has not run. Routed to the error handler rather than to Express's
      // default, which would answer 500 for what is a 401.
      next(error);
    }
  };
}
