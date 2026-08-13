import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { requireAuth } from '../../middlewares/authenticate.middleware';
import { hasPermission } from '../../middlewares/authorize.middleware';
import { Employee } from '../employee/employee.model';
import { PlannedWork } from './planned-work.models';

/**
 * ASSIGNMENT SCOPE for planned work, and for the service requests that carry the same two
 * assignment fields.
 *
 * The single policy that answers "does THIS job belong to this caller at all", as opposed
 * to "may this caller perform this KIND of action", which is what the permission keys
 * answer. It is applied in two shapes: per record, to authorise a write
 * ([assertPlannedWorkAssignmentScope]), and as a query predicate, to bound BOTH a list and a
 * single-record read ([resolveAssignedWorkFilter]). Both shapes read the same rule from the
 * same place, so the set of records a caller may act on can never drift from the set they
 * are shown.
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
 * WHO IS SCOPED, and it is two different populations because there are two questions:
 * for a WRITE, everyone who does not hold one of `OVERSIGHT_PERMISSIONS`; for a READ,
 * everyone who does not hold one of those OR one of `READ_OVERSIGHT_PERMISSIONS`. Both are
 * capability tests, never tier-string tests: `auth.role === 'technician'` describes how an
 * account was provisioned, not what it may do, and a supervisor sitting on the technician
 * tier with a second role must keep the reach that second role gives them.
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
 *
 * THIS SET GOVERNS WRITES ONLY. Reads use it too, but through the union with
 * [READ_OVERSIGHT_PERMISSIONS] below — see that comment for why the two are separate and
 * must not be merged back.
 */
export const OVERSIGHT_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_RESCHEDULE,
  PERMISSIONS.PLANNED_WORK_CANCEL,
  /**
   * Deciding whether a customer's request goes ahead is authority over work other people
   * do, so it belongs here on its own merits — and it has to be here for the gate to
   * function. A PENDING_APPROVAL work has an empty crew by construction, so a scoped caller
   * can never match one: a role granted `planned_work.approve` and nothing else would hold
   * the permission, see the button and be refused by the scope check on every request in
   * the queue. The seeded roles that get this key also hold `planned_work.update` and would
   * have been unscoped anyway, which is exactly why the omission would not have surfaced
   * until somebody built a dedicated approver role.
   */
  PERMISSIONS.PLANNED_WORK_APPROVE,
  PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
  PERMISSIONS.DISPATCH_ASSIGN,
];

/**
 * Holding any one of these ALSO makes a caller unscoped, but for READS ONLY.
 *
 * WHY THERE ARE TWO SETS, AND WHY MERGING THEM BACK IS A MISTAKE.
 *
 * "May look at everyone's work" and "may act on anyone's work" stopped being the same
 * question the moment assignment scope started bounding reads. They used to be answered by
 * one list because only writes were bounded, so the list only ever had to describe
 * supervision. Bounding reads with that same list produced a wrong answer immediately:
 * FINANCE and SALES hold `planned_work.view` and `service_request.view`, hold no supervisory
 * key, and typically have no employee card at all — so their list pages went empty. An
 * accountant cannot invoice a job they cannot see, and a salesperson cannot answer a
 * customer asking about one. Neither of them should be able to reschedule it.
 *
 * The wrong fix, which is the one to reach for and must not be taken, is to add
 * `invoice.view` to [OVERSIGHT_PERMISSIONS]. That list is consulted by
 * `assertPlannedWorkAssignmentScope` on every technician-reachable write, so adding a
 * reporting key there would hand every accountant the authority to drive any job in the
 * company through its lifecycle. The keys below are deliberately reachable only from the
 * read path.
 *
 * WHY EACH KEY IS HERE. Every one means "this role's duty is reporting on work other people
 * do":
 *
 *   - `invoice.view` — billing is downstream of the whole company's completed work, and you
 *     cannot bill what you cannot read. Held by FINANCE, SALES, MANAGEMENT and ADMIN, which
 *     is the entire set of roles this list exists to serve.
 *   - `dispatch.view` — the dispatch board IS the company-wide view of every open request.
 *     Every seeded role that holds it also holds `dispatch.assign` and is already unscoped
 *     by the set above, so this entry exists for the custom read-only board role an
 *     administrator can build in the RBAC screen: it lets them grant sight of the board
 *     without granting the authority to move a colleague's work.
 *
 * `report.view` IS DELIBERATELY ABSENT, and the reason is the important one on this file.
 * It was here, on the reasoning that "the reporting module is company-wide by definition"
 * and that the key is not in the TECHNICIAN default. The second half was true of the default
 * in `permissions.ts` and false of the database: the live TECHNICIAN role document holds
 * `report.view`, because `seedRbac` only prunes keys the catalogue has dropped and
 * `report.view` is still a catalogue key, so a grant made under an older default is never
 * withdrawn. Every technician therefore matched this list and bypassed scoping entirely —
 * the exact leak the scoping was added to close, reintroduced one line lower down.
 *
 * The rule this leaves behind: **authorization is decided by the stored role document, not
 * by `DEFAULT_ROLE_PERMISSIONS`.** Before adding a key here, check who actually holds it
 * (`db.roles.find({permissions: '<key>'}, {key: 1})`), not who the source says should.
 * A key that a field role can plausibly hold is not a statement about oversight.
 *
 * ALSO ABSENT. `report.export` adds nothing — nobody holds it without `report.view`.
 * `audit.view` is about the audit log rather than about work. `employee.view` is the staff
 * directory, and widening on it is exactly the leak `converge-technician-permissions.ts`
 * exists to close.
 */
export const READ_OVERSIGHT_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.INVOICE_VIEW,
  PERMISSIONS.DISPATCH_VIEW,
];

/**
 * True when the caller supervises planned work rather than merely carrying it out.
 *
 * The WRITE question. Unchanged, and deliberately blind to [READ_OVERSIGHT_PERMISSIONS]:
 * reading every job in the company is not authority to touch one.
 */
export function hasPlannedWorkOversight(actor: AuthContext): boolean {
  return OVERSIGHT_PERMISSIONS.some((key) => hasPermission(actor, key));
}

/**
 * True when the caller may LOOK at work that is not theirs.
 *
 * The READ question, and a strict superset of the write one: anyone who may act on
 * everybody's work may obviously also see it, so the union is the whole rule rather than
 * two cases a caller has to remember to check in the right order.
 */
export function hasWorkReadOversight(actor: AuthContext): boolean {
  return (
    hasPlannedWorkOversight(actor) ||
    READ_OVERSIGHT_PERMISSIONS.some((key) => hasPermission(actor, key))
  );
}

/**
 * The refusal, for WRITES.
 *
 * 403 and not 404, and the reasoning behind that has changed even though the status code
 * has not — so read this before making the two paths agree.
 *
 * It used to be justified by `planned_work.view` being unscoped: a technician could
 * already list and open the record, so "not found" would have been a lie about a job they
 * were looking at on screen. That premise is gone. The reads are scoped now, and
 * `getPlannedWorkById` answers an out-of-scope id as 404 precisely so it cannot be used as
 * an oracle for probing identifiers.
 *
 * WHY THIS ONE STAYS 403 ANYWAY. A caller only reaches a write refusal after naming an id
 * they have to have obtained somehow, and the honest reading of a scoped caller doing that
 * is not an attack but a stale screen or a shared link — most often work reassigned away
 * from them between loading the job and pressing the button. "Танд хуваарилагдаагүй ажил"
 * tells that person what happened; a 404 would tell them their job had been deleted. The
 * oracle argument is also much weaker here than on the read: mounting it means issuing
 * state-changing requests against guessed ids, every one of which is audited.
 *
 * THE RESIDUAL, stated rather than hidden: a caller who already holds an id can still tell
 * "exists but not mine" (403 from a write) from "never existed" (404 from a write on a
 * missing record), which the read path deliberately refuses to distinguish. Closing that
 * means answering 404 here too, and accepting that a technician whose job was reassigned is
 * told it no longer exists. That is a product decision, not a mechanical one.
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

/**
 * The same rule as a query predicate, for the LIST endpoints.
 *
 * Returns `null` for an unscoped caller, meaning "add nothing to the filter"; otherwise a
 * predicate the caller's list query must be narrowed by. Null is deliberately not `{}`: an
 * empty object is a filter that matches everything, and a caller that forgot to check for
 * it would silently produce the unscoped list this function exists to prevent, whereas
 * `null` cannot be spread into a filter by accident.
 *
 * WHY IT IS THE SAME `$or` THE PER-RECORD FORM EVALUATES. `resolveAssignmentScope` asks
 * "is this one record mine or my team's"; this asks the collection for every record for
 * which that answer would be yes. Expressing it as one predicate rather than as a
 * post-filter over a page is what keeps `total`, `totalPages` and the page contents
 * consistent — filtering after `skip`/`limit` would report a count the caller cannot see.
 *
 * NO EMPLOYEE CARD MEANS NO ASSIGNED ROWS, not all rows. An account with no
 * `Employee.systemUser` link cannot be named by any assignment, so the honest answer is
 * nothing (plus the open queue, when that is included). There is no code path in which
 * "unknown identity" and "unrestricted" share a return value.
 *
 * Generic over the document because both `PlannedWork` and `ServiceRequest` carry
 * `assignedEmployees` and `assignedTeam` with the same meaning; the shape of the predicate
 * is a fact about assignment, not about either collection.
 */
export interface AssignedWorkFilterOptions {
  /**
   * Also admit records nobody holds — no employee named AND no team.
   *
   * TRUE FOR SERVICE REQUESTS AND FALSE FOR PLANNED WORK, and the asymmetry is the domain's
   * rather than an accommodation. A request with nobody on it is the open queue: it is
   * broadcast to dispatchers by `runUnclaimedSweep`, it is what the employee app's
   * "Нээлттэй" segment lists, and `POST /service-requests/:id/claim` exists precisely so a
   * technician can take one. Hiding it would leave the claim endpoint reachable but its
   * only input invisible, which is not a narrower system — it is a broken one. Planned work
   * has no claim flow and `plannedWorkListQuerySchema` has no unassigned filter, so there
   * is no equivalent queue to admit.
   *
   * What it does NOT admit is a colleague's work: the branch requires BOTH assignment
   * fields to be empty, so a request the moment somebody claims it leaves the open queue and
   * becomes visible only to them, their team and oversight.
   */
  includeUnclaimed?: boolean;
}

export async function resolveAssignedWorkFilter<T>(
  actor: AuthContext,
  options: AssignedWorkFilterOptions = {},
): Promise<FilterQuery<T> | null> {
  // The READ union, not the write set: this predicate only ever bounds a query. See
  // [READ_OVERSIGHT_PERMISSIONS] for why an accountant belongs on the unscoped side of a
  // read and on the scoped side of a write.
  if (hasWorkReadOversight(actor)) return null;

  const branches: Record<string, unknown>[] = [];

  if (actor.employeeId) {
    const me = new Types.ObjectId(actor.employeeId);
    const employee = await Employee.findById(me).select('team').lean();

    branches.push({ assignedEmployees: me });

    // A null team contributes no branch at all. Matching `assignedTeam: null` would hand
    // every teamless employee every unassigned-to-a-team job, which is the same two-nulls
    // mistake the per-record form guards against above.
    if (employee?.team != null) {
      branches.push({ assignedTeam: new Types.ObjectId(String(employee.team)) });
    }
  }

  if (options.includeUnclaimed) {
    branches.push({ assignedEmployees: { $size: 0 }, assignedTeam: null });
  }

  // `_id: { $in: [] }` is an index-usable "match nothing", unlike `$where` or a sentinel id.
  // Reached by an account with no employee card on a collection with no open queue.
  if (branches.length === 0) return { _id: { $in: [] } } as FilterQuery<T>;

  return { $or: branches } as FilterQuery<T>;
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

/** Methods that only read. See the note on [requirePlannedWorkAssignmentScope]. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Route guard form, for sub-routers mounted under `/:plannedWorkId` whose handlers live
 * outside this module and therefore cannot call the policy themselves.
 *
 * WHERE READS ARE SCOPED NOW, BECAUSE THIS COMMENT USED TO SAY THEY WERE NOT.
 *
 * It said "assignment scope restricts acting, not looking — reads stay on
 * `planned_work.view` alone", on the reasoning that what a technician may SEE is a separate
 * decision from what they may DO. That reasoning has been reversed, and this is why: the
 * list endpoints took no auth context at all, so `GET /planned-work` and
 * `GET /service-requests` built their filter purely from client query parameters. Any
 * account holding `planned_work.view` — which is every technician — could ask for the
 * unfiltered list and receive every job in the company: customers, addresses, contact
 * names, fault descriptions and the identity of the colleague holding each one. "Looking"
 * at the whole company's work is not a smaller act than acting on one job of it; it is the
 * larger one, and it was the one nothing was checking.
 *
 * The scope is therefore enforced on the LIST QUERY, in [resolveAssignedWorkFilter], which
 * both list services now apply: a scoped caller's filter is intersected with "assigned to
 * me OR to my team", so the rows, the total and the page count are all bounded by the same
 * predicate. `employeeId` and `teamId` in the query string survive as ADDITIONAL narrowing
 * on top of it — a dispatcher may still filter to one person — but they can no longer
 * widen anything, because they are ANDed with a predicate the client cannot influence.
 *
 * SINGLE-RECORD READS ARE SCOPED TOO, but not here. `getPlannedWorkById` and
 * `getServiceRequestById` build the same predicate into their own `findOne`, so an
 * out-of-scope id is answered 404 and is indistinguishable from one that never existed.
 * Doing it in the loaders rather than in this guard is what stops a future route from
 * reaching either record by id without the check, and it is why this guard still passes
 * GETs straight through: by the time a read reaches a handler, the loader beneath it has
 * already decided.
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
