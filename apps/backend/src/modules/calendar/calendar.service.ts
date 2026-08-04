import {
  PERMISSIONS,
  PLANNED_WORK_STATUS_LABELS,
  SERVICE_REQUEST_STATUS_LABELS,
  type CalendarEventDto,
  type CalendarQueryInput,
  type CalendarResultDto,
  type CalendarSource,
} from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import type { AuthContext } from '../../common/types/express';
import { env } from '../../config/env';
import { hasPermission } from '../../middlewares/authorize.middleware';
import {
  PlannedWork,
  type IPlannedWork,
} from '../planned-work/planned-work.models';
import {
  effectiveStatusOf,
  reconcileOverdueForWorks,
} from '../planned-work/planned-work.overdue.service';
import { resolveAssignedWorkFilter } from '../planned-work/planned-work.scope';
import { ServiceRequest, type IServiceRequest } from '../service-request/service-request.model';

/**
 * Calendar projection.
 *
 * Every entry is a view of a record owned by another module. There is no calendar-only
 * entity, so nothing can appear here that cannot be opened in its source screen.
 *
 * Dates and statuses come from the source modules unchanged: planned work supplies its
 * backend-derived effective status and quantity-weighted progress, and a service request
 * supplies its own status and SLA deadline. The client performs no status arithmetic.
 */

function namedRef(value: unknown): { id: string; name: string } | null {
  if (typeof value === 'object' && value !== null && 'name' in value) {
    const node = value as { _id: Types.ObjectId; name: string };
    return { id: String(node._id), name: node.name };
  }
  return null;
}

function employeeNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'object' && entry !== null && 'firstName' in entry) {
        const employee = entry as { firstName: string; lastName: string };
        return `${employee.lastName} ${employee.firstName}`.trim();
      }
      return '';
    })
    .filter((name) => name.length > 0);
}

async function plannedWorkEvents(
  query: CalendarQueryInput,
  actor: AuthContext,
  from: Date,
  to: Date,
  now: Date,
): Promise<CalendarEventDto[]> {
  const filter: FilterQuery<IPlannedWork> = {
    // Overlap test: starts on or before the window ends, ends on or after it starts.
    plannedStartDate: { $lte: to },
    plannedEndDate: { $gte: from },
    // Cancelled work is not a schedule commitment and would only add noise.
    status: { $ne: 'CANCELLED' },
  };

  // The same predicate `GET /planned-work` is bounded by. See the note on [buildCalendar].
  const assignmentFilter = await resolveAssignedWorkFilter<IPlannedWork>(actor);
  if (assignmentFilter) filter.$and = [assignmentFilter];

  if (query.customerId) filter.customer = new Types.ObjectId(query.customerId);
  if (query.projectId) filter.project = new Types.ObjectId(query.projectId);
  if (query.buildingId) filter.building = new Types.ObjectId(query.buildingId);
  if (query.employeeId) filter.assignedEmployees = new Types.ObjectId(query.employeeId);
  if (query.teamId) filter.assignedTeam = new Types.ObjectId(query.teamId);

  const rows = await PlannedWork.find(filter)
    .populate([
      { path: 'customer', select: 'name' },
      { path: 'building', select: 'name' },
      { path: 'assignedEmployees', select: 'firstName lastName' },
    ])
    .sort({ plannedStartDate: 1 })
    .limit(500);

  // Fallback overdue reconciliation, so the calendar cannot show a stale state.
  await reconcileOverdueForWorks(rows, now);

  return rows.map((row) => {
    const effectiveStatus = effectiveStatusOf(row, now);
    return {
      id: `PLANNED_WORK:${String(row._id)}`,
      source: 'PLANNED_WORK' as const,
      sourceId: String(row._id),
      reference: row.workNumber,
      title: row.title,
      start: row.plannedStartDate.toISOString(),
      end: row.plannedEndDate.toISOString(),
      status: effectiveStatus,
      statusLabel: PLANNED_WORK_STATUS_LABELS[effectiveStatus],
      isOverdue: effectiveStatus === 'OVERDUE',
      isUrgent: false,
      customerName: namedRef(row.customer)?.name ?? null,
      buildingName: namedRef(row.building)?.name ?? null,
      assignedNames: employeeNames(row.assignedEmployees),
      progressPercent: row.progressPercent,
      detailPath: `/planned-work/${String(row._id)}`,
    };
  });
}

async function serviceRequestEvents(
  query: CalendarQueryInput,
  actor: AuthContext,
  from: Date,
  to: Date,
  now: Date,
): Promise<CalendarEventDto[]> {
  /**
   * A request occupies the span between its creation and its SLA deadline. Requests with
   * no deadline are excluded rather than pinned to an arbitrary date, so the calendar
   * never invents a schedule commitment that does not exist.
   */
  const filter: FilterQuery<IServiceRequest> = {
    slaDueAt: { $ne: null, $gte: from },
    createdAt: { $lte: to },
  };

  /**
   * `includeUnclaimed`, exactly as `listServiceRequests` passes it. A request nobody holds
   * is the open queue rather than a colleague's business, and the employee app offers it
   * for the taking under "Нээлттэй"; dropping it here would make the calendar disagree with
   * the list it is a projection of. The moment somebody claims a request it leaves the
   * queue and becomes visible only to them, their team and oversight.
   */
  const assignmentFilter = await resolveAssignedWorkFilter<IServiceRequest>(actor, {
    includeUnclaimed: true,
  });
  if (assignmentFilter) filter.$and = [assignmentFilter];

  if (query.customerId) filter.customer = new Types.ObjectId(query.customerId);
  if (query.projectId) filter.project = new Types.ObjectId(query.projectId);
  if (query.buildingId) filter.building = new Types.ObjectId(query.buildingId);
  if (query.employeeId) filter.assignedEmployees = new Types.ObjectId(query.employeeId);
  if (query.teamId) filter.assignedTeam = new Types.ObjectId(query.teamId);

  const rows = await ServiceRequest.find(filter)
    .populate([
      { path: 'customer', select: 'name' },
      { path: 'building', select: 'name' },
      { path: 'assignedEmployees', select: 'firstName lastName' },
    ])
    .sort({ slaDueAt: 1 })
    .limit(500);

  return rows.map((row) => {
    const dueAt = row.slaDueAt ?? row.createdAt;
    // A settled request is no longer chasing its deadline, so it never reads as overdue.
    const settled = row.status === 'COMPLETED' || row.status === 'CANCELLED';

    return {
      id: `SERVICE_REQUEST:${String(row._id)}`,
      source: 'SERVICE_REQUEST' as const,
      sourceId: String(row._id),
      reference: row.requestNumber,
      title: row.description.slice(0, 120),
      start: row.createdAt.toISOString(),
      end: dueAt.toISOString(),
      status: row.status,
      statusLabel: SERVICE_REQUEST_STATUS_LABELS[row.status],
      isOverdue: !settled && dueAt.getTime() < now.getTime(),
      isUrgent: row.isUrgent,
      customerName: namedRef(row.customer)?.name ?? null,
      buildingName: namedRef(row.building)?.name ?? null,
      assignedNames: employeeNames(row.assignedEmployees),
      // A request has no quantity-based progress figure to report.
      progressPercent: null,
      detailPath: `/service-requests/${String(row._id)}`,
    };
  });
}

/**
 * Builds the calendar for a window.
 *
 * Each source is included only when the caller may read that module, so a user without
 * planned-work access sees their requests and nothing else rather than a 403.
 *
 * TWO INDEPENDENT QUESTIONS, AND THIS USED TO ASK ONLY THE FIRST. `hasPermission` below
 * answers "may this caller read this KIND of record"; `resolveAssignedWorkFilter`, applied
 * inside both source queries, answers "which of those records are theirs at all". The
 * calendar asked only the permission question, and its filters were built purely from
 * client query parameters — so a technician who simply omitted `employeeId` received up to
 * 500 planned works and 500 requests per window covering the entire company, each row
 * carrying `assignedNames`, the customer and the building. The list endpoints had the same
 * hole and were closed; the calendar is a projection of exactly those two collections, so
 * leaving it open left the closed doors pointless. There is deliberately no second copy of
 * the rule here: the predicate comes from planned-work.scope.ts, the one place that owns it.
 *
 * A caller holding an oversight key is unaffected — `resolveAssignedWorkFilter` returns
 * null for them and nothing is added to the filter — so a dispatcher, a manager and an
 * accountant still see the whole organisation's schedule.
 *
 * `employeeId` and `teamId` survive as ADDITIONAL narrowing: they are ANDed with a
 * predicate the client cannot influence, so a dispatcher can still filter the board to one
 * person while a scoped caller naming a colleague gets nothing rather than that colleague.
 */
export async function buildCalendar(
  query: CalendarQueryInput,
  actor: AuthContext,
): Promise<CalendarResultDto> {
  const from = new Date(query.from);
  const to = new Date(query.to);
  const now = new Date();

  const requested: readonly CalendarSource[] = query.sources ?? [
    'PLANNED_WORK',
    'SERVICE_REQUEST',
  ];

  const permitted = requested.filter((source) =>
    source === 'PLANNED_WORK'
      ? hasPermission(actor, PERMISSIONS.PLANNED_WORK_VIEW)
      : hasPermission(actor, PERMISSIONS.SERVICE_REQUEST_VIEW),
  );

  const groups = await Promise.all(
    permitted.map((source) =>
      source === 'PLANNED_WORK'
        ? plannedWorkEvents(query, actor, from, to, now)
        : serviceRequestEvents(query, actor, from, to, now),
    ),
  );

  let events = groups.flat();

  // Status is a free-text filter because the two sources use different vocabularies.
  if (query.status) {
    events = events.filter((event) => event.status === query.status);
  }

  events.sort((left, right) => left.start.localeCompare(right.start));

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    timezone: env.APP_TIMEZONE,
    events,
  };
}
