import {
  DASHBOARD_CUSTOM_WIDGET_KEY,
  DEFAULT_DASHBOARD_LAYOUT,
  INVOICE_REVENUE_STATUSES,
  PERMISSIONS,
  PLANNED_WORK_STATUS_LABELS,
  RISK_LEVELS,
  SERVICE_REQUEST_STATUSES,
  SERVICE_REQUEST_STATUS_LABELS,
  SETTING_KEYS,
  aggregateProgress,
  slaConfigOf,
  reconcileDashboardLayout,
  type PlannedWorkEffectiveStatus,
  type PlannedWorkLifecycleStatus,
  type DashboardLayoutDto,
  type DashboardWidgetPreference,
  type DashboardLayoutInput,
  type DashboardFinanceSummary,
  type DashboardPlannedWorkSummary,
  type DashboardRiskSummary,
  type DashboardSlice,
  type DashboardSummaryDto,
  type DashboardTodayItem,
  type DashboardTodaySummary,
  type DashboardMonthPoint,
  type DashboardTrendPoint,
  type DashboardWorkloadRow,
  type RiskLevel,
  type ServiceRequestStatus,
} from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { dayBounds, dayBoundsAgo, localDateString, monthStart } from '../../common/utils/day-bounds.util';
import { monthEnd, monthWindow, windowStart } from '../../common/utils/month-window.util';
import { env } from '../../config/env';
import { effectiveStatusOf, overdueBoundary } from '../planned-work/planned-work.overdue.service';
import { listCustomWidgets } from './dashboard-insight.service';
import { DashboardLayout, type IDashboardWidgetPreference } from './dashboard-layout.model';
import { Employee } from '../employee/employee.model';
import { Invoice } from '../invoice/invoice.model';
import { ObjectRecord } from '../object-master/object-master.models';
import { riskScopeFilter } from '../object-master/risk-scope';
import { Customer, ObjectNode } from '../objects/object.models';
import { PlannedWork, type IPlannedWork } from '../planned-work/planned-work.models';
import { resolveAssignedWorkFilter } from '../planned-work/planned-work.scope';
import { ServiceRequest, type IServiceRequest } from '../service-request/service-request.model';
import { slaBreachFilter } from '../service-request/sla.service';
import { getSettings } from '../settings/settings.service';
import { ServiceAgreement } from '../service-agreement/service-agreement.model';

/** Statuses that mean the work is live: assigned or being carried out. */
const ACTIVE_REQUEST_STATUSES: readonly ServiceRequestStatus[] = [
  'ASSIGNED',
  'ACCEPTED',
  'ON_THE_WAY',
  'ON_SITE',
  'IN_PROGRESS',
  'WAITING',
];

const SETTLED_REQUEST_STATUSES: readonly ServiceRequestStatus[] = ['COMPLETED', 'CANCELLED'];

const TREND_DAYS = 14;

/** How far the long view reaches. Six, matching the span the portal risk history uses. */
const MONTHLY_TREND_MONTHS = 6;
/**
 * How many rows the Today list carries. A cap on the LIST only — never on the counters
 * beside it, which are queries. See `todayBlock`.
 */
const TODAY_ITEM_LIMIT = 40;
const WORKLOAD_ROW_LIMIT = 8;

/**
 * Narrows a dashboard query to the records the caller is allowed to be counted against.
 *
 * `$and` rather than a spread, which is how every other call site of
 * `resolveAssignedWorkFilter` combines it. The predicate is an `$or`, and two of the
 * filters below already occupy `$or` themselves — the near-breach filter and the today
 * query — so spreading would silently overwrite one of them and widen the result to
 * every record in the company. That is the precise shape of the leak this scoping
 * exists to close, so it must not be reintroduced by the merge.
 *
 * A `null` scope means the caller holds an oversight key and is not bounded at all. It
 * is never `{}`: see `resolveAssignedWorkFilter` for why that distinction is load-bearing.
 */
function withScope<T>(filter: FilterQuery<T>, scope: FilterQuery<T> | null): FilterQuery<T> {
  if (!scope) return filter;
  return { ...filter, $and: [scope] };
}

function nameOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('name' in value)) return null;
  return String((value as { name: unknown }).name);
}

// -- Section 15.1 blocks -------------------------------------------------------

async function customerBlock(): Promise<DashboardSummaryDto['customers']> {
  const [totalCustomers, activeServiceAgreements, totalProjects, totalBuildings, totalFloors] =
    await Promise.all([
      Customer.countDocuments({ isActive: true }),
      // The agreement module exists now, so this is a real count rather than the zero
      // that stood in while it did not.
      ServiceAgreement.countDocuments({ status: 'ACTIVE' }),
      ObjectNode.countDocuments({ kind: 'PROJECT', isActive: true }),
      ObjectNode.countDocuments({ kind: 'BUILDING', isActive: true }),
      ObjectNode.countDocuments({ kind: 'FLOOR', isActive: true }),
    ]);

  return { totalCustomers, activeServiceAgreements, totalProjects, totalBuildings, totalFloors };
}

async function employeeBlock(): Promise<DashboardSummaryDto['employees']> {
  const totalActiveEmployees = await Employee.countDocuments({ status: 'ACTIVE' });
  const assignedEmployeeIds = await ServiceRequest.distinct('assignedEmployees', {
    status: { $in: ACTIVE_REQUEST_STATUSES },
  });
  const assignedEmployees = assignedEmployeeIds.length;

  return {
    totalActiveEmployees,
    availableEmployees: Math.max(0, totalActiveEmployees - assignedEmployees),
    assignedEmployees,
  };
}

/** Section 15.1 "Ажилтан/багийн ачаалал", as a bar chart row per employee. */
async function workloadBlock(todayStart: Date, todayEnd: Date): Promise<DashboardWorkloadRow[]> {
  const grouped = await ServiceRequest.aggregate<{
    _id: Types.ObjectId;
    activeCount: number;
    completedToday: number;
  }>([
    {
      $match: {
        $or: [
          { status: { $in: ACTIVE_REQUEST_STATUSES } },
          { status: 'COMPLETED', completedAt: { $gte: todayStart, $lte: todayEnd } },
        ],
      },
    },
    { $unwind: '$assignedEmployees' },
    {
      $group: {
        _id: '$assignedEmployees',
        activeCount: {
          $sum: { $cond: [{ $in: ['$status', ACTIVE_REQUEST_STATUSES] }, 1, 0] },
        },
        completedToday: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
      },
    },
    { $sort: { activeCount: -1 } },
    { $limit: WORKLOAD_ROW_LIMIT },
  ]);

  if (grouped.length === 0) return [];

  const employees = await Employee.find({ _id: { $in: grouped.map((row) => row._id) } })
    .select('firstName lastName')
    .lean();
  const byId = new Map(employees.map((employee) => [String(employee._id), employee]));

  return grouped.map((row) => {
    const employee = byId.get(String(row._id));
    return {
      employeeId: String(row._id),
      employeeName: employee ? `${employee.lastName} ${employee.firstName}` : '-',
      activeCount: row.activeCount,
      completedToday: row.completedToday,
    };
  });
}

async function requestBlock(
  now: Date,
  todayStart: Date,
  todayEnd: Date,
  scope: FilterQuery<IServiceRequest> | null,
): Promise<{
  requests: NonNullable<DashboardSummaryDto['requests']>;
  byStatus: DashboardSlice[];
}> {
  const open = { status: { $nin: SETTLED_REQUEST_STATUSES } };

  /**
   * Near breach is the configured share of the SLA window being consumed, exactly as
   * [evaluateSla] defines it — not "falls due before midnight". The two are different
   * sets: a standard request raised an hour ago is due today and nowhere near breach,
   * while an urgent one raised five hours ago on a six-hour window is past the threshold
   * whatever the clock says. The threshold is read from settings so it moves with the
   * configuration rather than being fixed here.
   */
  const slaConfig = slaConfigOf(await getSettings());
  const consumedSlaMs = { $subtract: [now, '$slaStartedAt'] };
  const slaWindowMs = { $subtract: ['$slaDueAt', '$slaStartedAt'] };
  const nearBreachFilter: FilterQuery<IServiceRequest> = {
    ...open,
    // Already past due is BREACHED, which is its own count and not this one.
    slaDueAt: { $gt: now },
    $expr: {
      $and: [
        // A non-positive window has no ratio to consume; `evaluateSla` treats it as zero
        // consumed rather than as instantly near breach.
        { $gt: ['$slaDueAt', '$slaStartedAt'] },
        { $gte: [consumedSlaMs, { $multiply: [slaConfig.nearBreachRatio, slaWindowMs] }] },
      ],
    },
  };

  const [
    newRequests,
    unassignedRequests,
    urgentRequests,
    inProgress,
    dueToday,
    nearBreach,
    breached,
    completedToday,
    statusGroups,
  ] = await Promise.all([
    ServiceRequest.countDocuments(withScope<IServiceRequest>({ status: 'NEW' }, scope)),
    ServiceRequest.countDocuments(
      withScope<IServiceRequest>({ status: { $in: ['NEW', 'UNASSIGNED'] } }, scope),
    ),
    ServiceRequest.countDocuments(withScope<IServiceRequest>({ isUrgent: true, ...open }, scope)),
    ServiceRequest.countDocuments(
      withScope<IServiceRequest>(
        { status: { $in: ['ACCEPTED', 'ON_THE_WAY', 'ON_SITE', 'IN_PROGRESS'] } },
        scope,
      ),
    ),
    ServiceRequest.countDocuments(
      withScope<IServiceRequest>({ slaDueAt: { $gte: now, $lte: todayEnd }, ...open }, scope),
    ),
    ServiceRequest.countDocuments(withScope<IServiceRequest>(nearBreachFilter, scope)),
    // "SLA зөрчил" is [slaBreachFilter], the query form of the one definition the KPI
    // tile and the 15.2 SLA report also count on. This tile used to ask only for work that
    // is open and past due, so a breach that was later completed vanished from the number
    // the moment it was closed and the three screens never agreed.
    ServiceRequest.countDocuments(withScope<IServiceRequest>(slaBreachFilter(now), scope)),
    ServiceRequest.countDocuments(
      withScope<IServiceRequest>(
        { status: 'COMPLETED', completedAt: { $gte: todayStart, $lte: todayEnd } },
        scope,
      ),
    ),
    ServiceRequest.aggregate<{ _id: ServiceRequestStatus; count: number }>([
      // The scope has to lead the pipeline rather than filter the grouped output: the
      // `$group` has already collapsed the documents by then and there is nothing left
      // to match an assignment against.
      ...(scope ? [{ $match: scope as Record<string, unknown> }] : []),
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const statusCounts = new Map(statusGroups.map((row) => [row._id, row.count]));

  return {
    requests: {
      newRequests,
      unassignedRequests,
      urgentRequests,
      // Near breach is the SLA window being consumed past the configured ratio and not
      // yet run out; breached is past due. `dueToday` is the calendar figure and stays
      // its own field.
      slaNearBreach: nearBreach,
      slaBreached: breached,
      inProgress,
      dueToday,
      completedToday,
    },
    // Zero-count slices are dropped: a chart legend listing eleven statuses with ten
    // zeroes hides the one that matters.
    byStatus: SERVICE_REQUEST_STATUSES.map((status) => ({
      key: status,
      label: SERVICE_REQUEST_STATUS_LABELS[status],
      count: statusCounts.get(status) ?? 0,
    })).filter((slice) => slice.count > 0),
  };
}

/** Fourteen days of created versus completed, for the trend line. */
async function trendBlock(
  now: Date,
  scope: FilterQuery<IServiceRequest> | null,
): Promise<DashboardTrendPoint[]> {
  const timeZone = env.APP_TIMEZONE;
  const from = dayBoundsAgo(now, timeZone, TREND_DAYS - 1).start;

  const [created, completed] = await Promise.all([
    ServiceRequest.find(withScope<IServiceRequest>({ createdAt: { $gte: from } }, scope))
      .select('createdAt')
      .lean(),
    ServiceRequest.find(withScope<IServiceRequest>({ completedAt: { $gte: from } }, scope))
      .select('completedAt')
      .lean(),
  ]);

  // Bucketing happens here rather than in an aggregation `$dateToString`, because the
  // day boundary has to be the Ulaanbaatar one and the pipeline would bucket by UTC.
  const createdByDay = new Map<string, number>();
  for (const row of created) {
    const key = localDateString(row.createdAt, timeZone);
    createdByDay.set(key, (createdByDay.get(key) ?? 0) + 1);
  }

  const completedByDay = new Map<string, number>();
  for (const row of completed) {
    if (!row.completedAt) continue;
    const key = localDateString(row.completedAt, timeZone);
    completedByDay.set(key, (completedByDay.get(key) ?? 0) + 1);
  }

  const points: DashboardTrendPoint[] = [];
  for (let offset = TREND_DAYS - 1; offset >= 0; offset -= 1) {
    const { date } = dayBoundsAgo(now, timeZone, offset);
    points.push({
      date,
      created: createdByDay.get(date) ?? 0,
      completed: completedByDay.get(date) ?? 0,
    });
  }
  return points;
}

/**
 * Six months of raised-request counts.
 *
 * The long view beside the fourteen-day one. They answer different questions — "what is
 * happening this fortnight" and "is the workload growing" — and a reader looking for the
 * second in a daily line has to do the arithmetic themselves.
 *
 * Bucketed in the pipeline with an explicit `timezone`, which `$dateToString` supports and
 * the day-level trend above cannot use because it needs the same boundary the rest of that
 * block already computes in JavaScript.
 *
 * Every month in the window is returned, including the empty ones: a gap in a series reads
 * as "no data" and a zero reads as "nothing happened", and those are different answers.
 */
async function monthlyTrendBlock(
  now: Date,
  scope: FilterQuery<IServiceRequest> | null,
): Promise<DashboardMonthPoint[]> {
  const timeZone = env.APP_TIMEZONE;
  const months = monthWindow(now, timeZone, MONTHLY_TREND_MONTHS);

  const rows = await ServiceRequest.aggregate<{ _id: string; count: number }>([
    {
      $match: withScope<IServiceRequest>(
        {
          createdAt: {
            $gte: windowStart(months, timeZone),
            $lt: monthEnd(months[months.length - 1]!, timeZone),
          },
        },
        scope,
      ),
    },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: timeZone } },
        count: { $sum: 1 },
      },
    },
  ]);

  const found = new Map(rows.map((row) => [row._id, row.count]));
  return months.map((month) => ({ month, count: found.get(month) ?? 0 }));
}

/**
 * «Дууссан» for the planned-work tile.
 *
 * ARCHIVED belongs here. `archiveAfterReportApproval` is reachable only from the report
 * approval flow and refuses anything whose status is not already COMPLETED, so ARCHIVED
 * means "finished, written up and signed off" — the most complete state a planned work
 * reaches, not a hidden one. The block used to exclude it outright, which made «Дууссан»
 * count only work finished but NOT yet approved: approving the report removed the work
 * from the numerator, so a tenant that keeps up with its paperwork watched the tile trend
 * toward zero while the crew was doing everything right.
 *
 * Same set as `PLANNED_WORK_DELIVERED_STATUSES` in `report.service.ts`, which is the
 * numerator of PLANNED_WORK_COMPLETION_RATE — the KPI that carries this tile's own label,
 * «Төлөвлөгөөт ажлын гүйцэтгэл». The two are restated rather than shared only because
 * they sit in different modules; they must be changed together, and belong in
 * `packages/shared/src/constants/planned-work.ts` next to the lifecycle vocabulary.
 */
const PLANNED_WORK_DELIVERED_STATUSES: readonly PlannedWorkEffectiveStatus[] = [
  'COMPLETED',
  'ARCHIVED',
];

/**
 * What «Нийт» does NOT count — the denominator's exclusion list.
 *
 * The tile answers «of the work this business committed to, how much is done», so the
 * denominator is work actually committed to. `total: works.length` over
 * `{ status: { $ne: 'ARCHIVED' } }` answered neither question: it dropped the most
 * complete state there is and counted scratch pads and cancellations as outstanding.
 *
 *   - CANCELLED is out. A cancellation is a decision not to do the work, not a failure
 *     to do it; leaving it in means every cancellation permanently lowers the tile.
 *   - DRAFT is out. Never submitted to anybody, deletable by its author, nothing promised.
 *   - PENDING_APPROVAL and REJECTED are out. Both are submitted but unapproved, and
 *     approval is the point at which a work becomes «Төлөвлөгдсөн»; charging the delivery
 *     crew for the approver's queue is not a measure of delivery.
 *
 * Everything else stays in: PLANNED, STARTED and PAUSED are outstanding commitments,
 * COMPLETED and ARCHIVED are met ones. OVERDUE never appears because it is derived on
 * read, so an overdue work sits here under its stored PLANNED/STARTED/PAUSED status —
 * committed and not yet done, which is correct.
 *
 * VERBATIM the list `report.service.ts` applies to PLANNED_WORK_COMPLETION_RATE
 * (`PLANNED_WORK_UNCOMMITTED_STATUSES`), deliberately: the tile and the KPI are the same
 * question asked on two screens, and they were previously free to disagree.
 *
 * Written as an EXCLUSION list rather than an inclusion one so a lifecycle status added
 * later lands in the denominator and is visible, rather than vanishing from both halves
 * of the ratio without a sound.
 */
const PLANNED_WORK_UNCOMMITTED_STATUSES: readonly PlannedWorkLifecycleStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'REJECTED',
  'CANCELLED',
];

async function plannedWorkBlock(
  now: Date,
  scope: FilterQuery<IPlannedWork> | null,
): Promise<DashboardPlannedWorkSummary> {
  const works = await PlannedWork.find(
    withScope<IPlannedWork>(
      { status: { $nin: PLANNED_WORK_UNCOMMITTED_STATUSES } },
      scope,
    ),
  )
    .select('status plannedEndDate totalQuantity completedQuantity')
    .lean();

  let inProgress = 0;
  let overdue = 0;
  let completed = 0;

  for (const work of works) {
    const effective = effectiveStatusOf(work, now);
    if (effective === 'OVERDUE') overdue += 1;
    else if (effective === 'STARTED') inProgress += 1;
    else if (PLANNED_WORK_DELIVERED_STATUSES.includes(effective)) completed += 1;
  }

  /**
   * Quantity-weighted, through the same aggregation the progress service uses, so the
   * dashboard figure is the one the planned-work module would compute over the same set.
   * The mean of the per-work percentages is a different number: it lets a single-task job
   * outweigh a five-hundred-task one, which is exactly the weighting doctrine this
   * codebase settled.
   *
   * Weighted over the SAME committed set as the counters above, which is what repairs the
   * second half of this block's bias: the previous set excluded every archived work — the
   * ones that are genuinely finished — while including every DRAFT at 0%, so the bar was
   * pushed down from both ends at once.
   *
   * NOTE for whoever owns `packages/shared/src/types/dashboard.types.ts`: the doc on
   * `averageProgress` still says "across non-archived work". That is now stale and should
   * read "across committed work"; it is out of this module's scope to edit.
   */
  const progress = aggregateProgress(
    works.map((work) => ({
      totalQuantity: work.totalQuantity,
      // Clamp as the progress service does: a stored overshoot must not inflate the rollup.
      completedQuantity: Math.min(work.completedQuantity, work.totalQuantity),
    })),
  );

  return {
    total: works.length,
    inProgress,
    overdue,
    completed,
    // Null, not zero, when there is nothing to weigh: no work at all, or no quantity
    // recorded against any of it. Zero would read as "everything is at 0%".
    averageProgress: progress.totalQuantity === 0 ? null : progress.progressPercent,
  };
}

/**
 * Section 15.1 risk counts.
 *
 * Read from the object master records and their current band. The previous version
 * queried `ObjectNode` with `kind: 'DEVICE'` and a `riskScore` field, which the object
 * module superseded, so it silently reported nothing no matter how many assessments
 * existed.
 */
async function riskBlock(): Promise<DashboardRiskSummary> {
  const grouped = await ObjectRecord.aggregate<{ _id: RiskLevel | null; count: number }>([
    // Equipment that has been taken out of service is not a live risk. Same predicate the
    // rollup, the inspection counters and the project summary use; see `risk-scope.ts`.
    { $match: { ...riskScopeFilter } },
    { $group: { _id: '$latestAssessment.riskLevel', count: { $sum: 1 } } },
  ]);

  const byLevelMap = new Map<RiskLevel | null, number>(
    grouped.map((row) => [row._id ?? null, row.count]),
  );

  const byLevel = RISK_LEVELS.map((level) => ({
    level,
    count: byLevelMap.get(level) ?? 0,
  })).filter((entry) => entry.count > 0);

  return {
    byLevel,
    totalAssessedObjects: byLevel.reduce((sum, entry) => sum + entry.count, 0),
    unassessedObjects: byLevelMap.get(null) ?? 0,
  };
}

async function financeBlock(now: Date): Promise<DashboardFinanceSummary> {
  const settings = await getSettings();
  const currency = String(settings[SETTING_KEYS.CURRENCY]);
  const from = monthStart(now, env.APP_TIMEZONE);
  const dueBoundary = dayBounds(now, env.APP_TIMEZONE).start;

  const [monthRows, statusRows, overdueRows] = await Promise.all([
    Invoice.aggregate<{ _id: null; revenue: number }>([
      // Same set as the MONTHLY_REVENUE KPI, from the same constant: the two are one
      // number reached by two code paths and must never disagree. A draft is not revenue.
      { $match: { issueDate: { $gte: from }, status: { $in: INVOICE_REVENUE_STATUSES } } },
      { $group: { _id: null, revenue: { $sum: '$total' } } },
    ]),
    Invoice.aggregate<{ _id: string; count: number; total: number }>([
      { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$total' } } },
    ]),
    Invoice.aggregate<{ _id: null; count: number; total: number }>([
      { $match: { status: 'SENT', dueDate: { $lt: dueBoundary } } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$total' } } },
    ]),
  ]);

  const byStatusMap = new Map(statusRows.map((row) => [row._id, row]));
  const overdue = overdueRows[0];
  const sentCount = byStatusMap.get('SENT')?.count ?? 0;

  /**
   * Overdue is derived from the due date, so it is not a stored status and has to be
   * carved out of the sent bucket rather than read as its own row.
   */
  const byStatus: DashboardSlice[] = [
    { key: 'DRAFT', label: 'Ноорог', count: byStatusMap.get('DRAFT')?.count ?? 0 },
    { key: 'SENT', label: 'Илгээсэн', count: Math.max(0, sentCount - (overdue?.count ?? 0)) },
    { key: 'OVERDUE', label: 'Хугацаа хэтэрсэн', count: overdue?.count ?? 0 },
    { key: 'PAID', label: 'Төлөгдсөн', count: byStatusMap.get('PAID')?.count ?? 0 },
  ].filter((slice) => slice.count > 0);

  return {
    monthRevenue: monthRows[0]?.revenue ?? 0,
    receivableTotal: byStatusMap.get('SENT')?.total ?? 0,
    overdueTotal: overdue?.total ?? 0,
    byStatus,
    currency,
  };
}

// -- Today ---------------------------------------------------------------------

/**
 * What still needs doing today.
 *
 * This replaced the audit-log tail. A list of what has already been recorded answers a
 * different question from what is outstanding, and only the second one is actionable
 * from a dashboard.
 *
 * "Today" is the Ulaanbaatar day, not the server's day: the two differ for eight hours
 * of every day when the process runs in UTC, which is the normal deployment.
 */
async function todayBlock(
  now: Date,
  permissions: ReadonlySet<string>,
  requestScope: FilterQuery<IServiceRequest> | null,
  workScope: FilterQuery<IPlannedWork> | null,
): Promise<DashboardTodaySummary> {
  const timeZone = env.APP_TIMEZONE;
  const { start, end, date } = dayBounds(now, timeZone);

  const canSeeRequests = permissions.has(PERMISSIONS.SERVICE_REQUEST_VIEW);
  const canSeePlannedWork = permissions.has(PERMISSIONS.PLANNED_WORK_VIEW);

  const items: DashboardTodayItem[] = [];

  /**
   * Anything that lands today: due today, already past due and unfinished, or urgent and
   * still open. An overdue job from last week is today's problem too.
   *
   * Named and reused rather than inlined, because the counters below must ask about the
   * SAME set the list is drawn from. They are separate queries against this filter, not
   * a second reading of the rows the list happens to have loaded.
   */
  const requestBase: FilterQuery<IServiceRequest> = {
    status: { $nin: SETTLED_REQUEST_STATUSES },
    $or: [{ slaDueAt: { $lte: end } }, { isUrgent: true }],
  };

  const workBase: FilterQuery<IPlannedWork> = {
    status: { $in: ['PLANNED', 'STARTED', 'PAUSED'] },
    plannedStartDate: { $lte: end },
  };

  if (canSeeRequests) {
    const requests = await ServiceRequest.find(withScope<IServiceRequest>(requestBase, requestScope))
      .populate([
        { path: 'customer', select: 'name' },
        { path: 'building', select: 'name' },
        { path: 'assignedEmployees', select: 'firstName lastName' },
      ])
      .sort({ slaDueAt: 1 })
      .limit(TODAY_ITEM_LIMIT)
      .lean();

    for (const request of requests) {
      const assignees = Array.isArray(request.assignedEmployees)
        ? (request.assignedEmployees as unknown as { firstName: string; lastName: string }[])
        : [];
      items.push({
        id: String(request._id),
        kind: 'SERVICE_REQUEST',
        reference: request.requestNumber,
        title: request.description.slice(0, 120),
        customerName: nameOf(request.customer),
        locationLabel: nameOf(request.building),
        assigneeNames: assignees.map((entry) => `${entry.lastName} ${entry.firstName}`),
        status: request.status,
        statusLabel: SERVICE_REQUEST_STATUS_LABELS[request.status],
        dueAt: request.slaDueAt.toISOString(),
        isUrgent: request.isUrgent,
        isOverdue: request.slaDueAt < now,
        linkPath: `/service-requests/${String(request._id)}`,
      });
    }
  }

  if (canSeePlannedWork) {
    const works = await PlannedWork.find(withScope<IPlannedWork>(workBase, workScope))
      .populate([
        { path: 'customer', select: 'name' },
        { path: 'building', select: 'name' },
        { path: 'assignedEmployees', select: 'firstName lastName' },
      ])
      .sort({ plannedEndDate: 1 })
      .limit(TODAY_ITEM_LIMIT)
      .lean();

    for (const work of works) {
      const assignees = Array.isArray(work.assignedEmployees)
        ? (work.assignedEmployees as unknown as { firstName: string; lastName: string }[])
        : [];
      const effective = effectiveStatusOf(work, now);
      items.push({
        id: String(work._id),
        kind: 'PLANNED_WORK',
        reference: work.workNumber,
        title: work.title,
        customerName: nameOf(work.customer),
        locationLabel: nameOf(work.building),
        assigneeNames: assignees.map((entry) => `${entry.lastName} ${entry.firstName}`),
        status: effective,
        statusLabel: PLANNED_WORK_STATUS_LABELS[effective],
        dueAt: work.plannedEndDate.toISOString(),
        isUrgent: false,
        isOverdue: effective === 'OVERDUE',
        linkPath: `/planned-work/${String(work._id)}`,
      });
    }
  }

  // Overdue first, then urgent, then by deadline: the order the day should be worked.
  items.sort((left, right) => {
    if (left.isOverdue !== right.isOverdue) return left.isOverdue ? -1 : 1;
    if (left.isUrgent !== right.isUrgent) return left.isUrgent ? -1 : 1;
    return (left.dueAt ?? '').localeCompare(right.dueAt ?? '');
  });

  /**
   * THE COUNTERS ARE QUERIES, NOT A SECOND READING OF THE LIST.
   *
   * They used to be `items.filter(...).length` over the merged array above, which put two
   * distortions in one payload. The array is two `.limit(40)` fetches, so every counter
   * saturated at forty per kind — forty-five overdue jobs printed «Хугацаа хэтэрсэн 40»,
   * and «Яаралтай» counted only the urgent rows the deadline sort happened to admit. And
   * the array holds up to eighty rows while the list beneath renders forty, so the
   * counters were computed over a set the reader could not see either.
   *
   * `completedCount` was already a real `countDocuments` and was rendered beside them, so
   * one counter in the row was a total and four were artefacts of a page size. They now
   * all follow that shape: same base filter, same scope, one predicate each.
   *
   * The LIST stays capped. A counter is a total and a list is a page of it; separating
   * them is the fix, not raising the limit.
   */
  const countRequests = (extra: FilterQuery<IServiceRequest>): Promise<number> =>
    canSeeRequests
      ? ServiceRequest.countDocuments(
          withScope<IServiceRequest>({ ...requestBase, ...extra }, requestScope),
        )
      : Promise.resolve(0);

  const countWorks = (extra: FilterQuery<IPlannedWork>): Promise<number> =>
    canSeePlannedWork
      ? PlannedWork.countDocuments(withScope<IPlannedWork>({ ...workBase, ...extra }, workScope))
      : Promise.resolve(0);

  /**
   * The instant a planned work's deadline must fall before to read as OVERDUE: the start
   * of today in Ulaanbaatar, which is exactly what `effectiveStatusOf` applies to the
   * rows in the list. Taken from the single funnel rather than restated, so the counter
   * and the badges on the rows can never drift apart.
   */
  const overdueFrom = overdueBoundary(now);

  const [
    dueRequests,
    dueWorks,
    overdueRequests,
    overdueWorks,
    urgentRequests,
    unassignedRequests,
    unassignedWorks,
    completedCount,
  ] = await Promise.all([
    // Due by the end of today. A request admitted only for being urgent, with a deadline
    // later in the week, is outside this — the same test the list rows carry.
    countRequests({ slaDueAt: { $lte: end } }),
    countWorks({ plannedEndDate: { $lte: end } }),

    countRequests({ slaDueAt: { $lt: now } }),
    countWorks({ plannedEndDate: { $lt: overdueFrom } }),

    // Only a request can be urgent; a planned work is never flagged, so there is no
    // second query to add here rather than a zero to hide.
    countRequests({ isUrgent: true }),

    // Asked of the stored array rather than of the populated names the rows carry. The
    // two agree unless an assignment points at an employee record that no longer exists,
    // and then this is the honest answer: nobody was assigned is a different fact from
    // no assignee resolved.
    countRequests({ assignedEmployees: { $size: 0 } }),
    countWorks({ assignedEmployees: { $size: 0 } }),

    canSeeRequests
      ? ServiceRequest.countDocuments(
          withScope<IServiceRequest>(
            { status: 'COMPLETED', completedAt: { $gte: start, $lte: end } },
            requestScope,
          ),
        )
      : Promise.resolve(0),
  ]);

  return {
    date,
    timezone: timeZone,
    dueCount: dueRequests + dueWorks,
    overdueCount: overdueRequests + overdueWorks,
    urgentCount: urgentRequests,
    unassignedCount: unassignedRequests + unassignedWorks,
    completedCount,
    items: items.slice(0, TODAY_ITEM_LIMIT),
  };
}

// -- Entry point ---------------------------------------------------------------

/**
 * The dashboard payload for one caller.
 *
 * TWO GATES, NOT ONE. Permission decides which blocks exist; assignment scope decides
 * which records the surviving blocks are allowed to count. They are different questions
 * and were previously answered by the same check: `service_request.view` is in the
 * technician default, so a technician's dashboard was reporting every request in the
 * company under headings that read as their own. Holding the key to see requests is not
 * the same as being entitled to a company-wide total of them.
 *
 * Blocks that cannot be narrowed to an assignment are OMITTED for a scoped caller rather
 * than sent unscoped: customers, employees, workload, risk and finance count records
 * that have no assignee to match against, so there is no honest scoped version of them.
 * Omitting is the security decision as well as the presentational one — a figure the API
 * withholds cannot be recovered from the response, whereas one merely hidden by the UI
 * is still sitting in the JSON.
 */
export async function buildDashboardSummary(actor: AuthContext): Promise<DashboardSummaryDto> {
  const now = new Date();
  const { start, end } = dayBounds(now, env.APP_TIMEZONE);
  const permissions = actor.permissions as ReadonlySet<string>;

  /**
   * The same predicate that bounds `GET /service-requests` and `GET /planned-work`, so a
   * count on this page can never disagree with the list it links to. Reused rather than
   * restated: a second rule meant to agree with this one would drift the first time
   * either was amended.
   *
   * `includeUnclaimed` differs by collection exactly as it does at those call sites — an
   * open request is work this caller may pick up and belongs in their figures, while an
   * unassigned planned work is not theirs until somebody assigns it.
   */
  const [requestScope, workScope] = await Promise.all([
    resolveAssignedWorkFilter<IServiceRequest>(actor, { includeUnclaimed: true }),
    resolveAssignedWorkFilter<IPlannedWork>(actor, { includeUnclaimed: false }),
  ]);

  /**
   * Both calls consult the same oversight test, so the two agree by construction and
   * either one can answer for the payload as a whole. `head_admin` reaches here holding
   * every permission through `resolveEffectivePermissions`, so it is unscoped without a
   * role check being written anywhere in this file.
   */
  const isScoped = requestScope !== null;

  const summary: DashboardSummaryDto = { isScoped, generatedAt: now.toISOString() };

  if (!isScoped && permissions.has(PERMISSIONS.CUSTOMER_VIEW)) {
    summary.customers = await customerBlock();
  }

  // Headcount and the workload bars are other people's figures by definition: the bar
  // chart names colleagues one by one and how loaded each is.
  if (!isScoped && permissions.has(PERMISSIONS.EMPLOYEE_VIEW)) {
    summary.employees = await employeeBlock();
    summary.workload = await workloadBlock(start, end);
  }

  if (permissions.has(PERMISSIONS.SERVICE_REQUEST_VIEW)) {
    const block = await requestBlock(now, start, end, requestScope);
    summary.requests = block.requests;
    summary.requestsByStatus = block.byStatus;
    summary.trend = await trendBlock(now, requestScope);
    summary.monthlyTrend = await monthlyTrendBlock(now, requestScope);
  }

  if (permissions.has(PERMISSIONS.PLANNED_WORK_VIEW)) {
    summary.plannedWork = await plannedWorkBlock(now, workScope);
  }

  // Risk is counted over object records, which carry no assignment at all; there is no
  // predicate that would make this the reader's own risk rather than the estate's.
  if (!isScoped && permissions.has(PERMISSIONS.OBJECT_MASTER_VIEW)) {
    summary.risk = await riskBlock();
  }

  /**
   * Revenue and receivables are the company's books.
   *
   * The `isScoped` guard is belt and braces rather than the load-bearing check:
   * `invoice.view` is itself one of the READ_OVERSIGHT_PERMISSIONS, so any caller holding
   * it is unscoped and no caller reaching this line scoped could have passed the
   * permission test anyway. It is written out because the guard must survive that key
   * being moved off the oversight list, which is a one-line change elsewhere.
   */
  if (!isScoped && permissions.has(PERMISSIONS.INVOICE_VIEW)) {
    summary.finance = await financeBlock(now);
  }

  if (
    permissions.has(PERMISSIONS.SERVICE_REQUEST_VIEW) ||
    permissions.has(PERMISSIONS.PLANNED_WORK_VIEW)
  ) {
    summary.today = await todayBlock(now, permissions, requestScope, workScope);
  }

  return summary;
}

// -- Layout --------------------------------------------------------------------

/**
 * Stored rows to the shared preference shape.
 *
 * The subdocument holds `customWidgetId` as an ObjectId because it is a real reference;
 * everything above the database speaks in strings, and reconciliation compares ids by
 * value, so the conversion has to happen before the two meet.
 */
function toPreferences(
  stored: readonly IDashboardWidgetPreference[],
): DashboardWidgetPreference[] {
  return stored.map((entry) => ({
    key: entry.key,
    customWidgetId: entry.customWidgetId ? String(entry.customWidgetId) : null,
    visible: entry.visible,
    size: entry.size,
  }));
}

/**
 * The caller's dashboard arrangement.
 *
 * Falls back to the shipped default when nobody has customised, and reconciles a stored
 * layout against the current catalogue on every read: a widget the product has removed is
 * dropped, and one added since the layout was saved is appended rather than silently
 * missing. Without that, the people who customised earliest would never see a new widget.
 */
export async function getDashboardLayout(actor: AuthContext): Promise<DashboardLayoutDto> {
  const [stored, customWidgets] = await Promise.all([
    DashboardLayout.findOne({ user: new Types.ObjectId(actor.userId) }).lean(),
    listCustomWidgets(actor),
  ]);
  const liveIds = customWidgets.map((widget) => widget.id);

  // A caller who never customised still gets their own definitions placed, so a widget
  // built on a default board appears without the board first having to be rearranged.
  if (!stored || stored.widgets.length === 0) {
    return {
      widgets: reconcileDashboardLayout([...DEFAULT_DASHBOARD_LAYOUT], liveIds),
      customWidgets,
      isCustomised: false,
    };
  }

  return {
    widgets: reconcileDashboardLayout(toPreferences(stored.widgets), liveIds),
    customWidgets,
    isCustomised: true,
  };
}

export async function saveDashboardLayout(
  input: DashboardLayoutInput,
  actor: AuthContext,
): Promise<DashboardLayoutDto> {
  const customWidgets = await listCustomWidgets(actor);
  const liveIds = new Set(customWidgets.map((widget) => widget.id));

  // A row naming a definition the caller does not own is refused rather than stored and
  // quietly dropped on the next read: silently discarding part of a save reads as the
  // save having worked.
  const foreign = input.widgets.find(
    (entry) =>
      entry.key === DASHBOARD_CUSTOM_WIDGET_KEY &&
      (entry.customWidgetId == null || !liveIds.has(entry.customWidgetId)),
  );
  if (foreign) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Хэсэг олдсонгүй.', [
      { field: 'widgets', message: 'Байхгүй хэсэг сонгосон байна.' },
    ]);
  }

  await DashboardLayout.findOneAndUpdate(
    { user: new Types.ObjectId(actor.userId) },
    {
      $set: {
        widgets: input.widgets.map((entry) => ({
          key: entry.key,
          customWidgetId: entry.customWidgetId ? new Types.ObjectId(entry.customWidgetId) : null,
          visible: entry.visible,
          size: entry.size,
        })),
      },
    },
    { upsert: true, new: true },
  );

  return {
    widgets: reconcileDashboardLayout(input.widgets, [...liveIds]),
    customWidgets,
    isCustomised: true,
  };
}

/** Discards the preference so the caller returns to the shipped arrangement. */
export async function resetDashboardLayout(actor: AuthContext): Promise<DashboardLayoutDto> {
  await DashboardLayout.deleteOne({ user: new Types.ObjectId(actor.userId) });

  // Reset returns to the shipped arrangement, not to an empty board: the caller's own
  // definitions are theirs until they delete them, so they are placed again here.
  const customWidgets = await listCustomWidgets(actor);
  return {
    widgets: reconcileDashboardLayout(
      [...DEFAULT_DASHBOARD_LAYOUT],
      customWidgets.map((widget) => widget.id),
    ),
    customWidgets,
    isCustomised: false,
  };
}
