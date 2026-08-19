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
  effectivePlannedWorkStatus,
  slaConfigOf,
  reconcileDashboardLayout,
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
  type DashboardTrendPoint,
  type DashboardWorkloadRow,
  type RiskLevel,
  type ServiceRequestStatus,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { dayBounds, dayBoundsAgo, localDateString, monthStart } from '../../common/utils/day-bounds.util';
import { env } from '../../config/env';
import { listCustomWidgets } from './dashboard-insight.service';
import { DashboardLayout, type IDashboardWidgetPreference } from './dashboard-layout.model';
import { Employee } from '../employee/employee.model';
import { Invoice } from '../invoice/invoice.model';
import { ObjectRecord } from '../object-master/object-master.models';
import { Customer, ObjectNode } from '../objects/object.models';
import { PlannedWork } from '../planned-work/planned-work.models';
import { ServiceRequest } from '../service-request/service-request.model';
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
const TODAY_ITEM_LIMIT = 40;
const WORKLOAD_ROW_LIMIT = 8;

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
  const nearBreachFilter = {
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
    ServiceRequest.countDocuments({ status: 'NEW' }),
    ServiceRequest.countDocuments({ status: { $in: ['NEW', 'UNASSIGNED'] } }),
    ServiceRequest.countDocuments({ isUrgent: true, ...open }),
    ServiceRequest.countDocuments({
      status: { $in: ['ACCEPTED', 'ON_THE_WAY', 'ON_SITE', 'IN_PROGRESS'] },
    }),
    ServiceRequest.countDocuments({ slaDueAt: { $gte: now, $lte: todayEnd }, ...open }),
    ServiceRequest.countDocuments(nearBreachFilter),
    ServiceRequest.countDocuments({ slaDueAt: { $lt: now }, ...open }),
    ServiceRequest.countDocuments({
      status: 'COMPLETED',
      completedAt: { $gte: todayStart, $lte: todayEnd },
    }),
    ServiceRequest.aggregate<{ _id: ServiceRequestStatus; count: number }>([
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
async function trendBlock(now: Date): Promise<DashboardTrendPoint[]> {
  const timeZone = env.APP_TIMEZONE;
  const from = dayBoundsAgo(now, timeZone, TREND_DAYS - 1).start;

  const [created, completed] = await Promise.all([
    ServiceRequest.find({ createdAt: { $gte: from } })
      .select('createdAt')
      .lean(),
    ServiceRequest.find({ completedAt: { $gte: from } })
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

async function plannedWorkBlock(now: Date): Promise<DashboardPlannedWorkSummary> {
  const works = await PlannedWork.find({ status: { $ne: 'ARCHIVED' } })
    .select('status plannedEndDate totalQuantity completedQuantity')
    .lean();

  let inProgress = 0;
  let overdue = 0;
  let completed = 0;

  for (const work of works) {
    const effective = effectivePlannedWorkStatus(work.status, work.plannedEndDate, now);
    if (effective === 'OVERDUE') overdue += 1;
    else if (effective === 'STARTED') inProgress += 1;
    else if (effective === 'COMPLETED') completed += 1;
  }

  /**
   * Quantity-weighted, through the same aggregation the progress service uses, so the
   * dashboard figure is the one the planned-work module would compute over the same set.
   * The mean of the per-work percentages is a different number: it lets a single-task job
   * outweigh a five-hundred-task one, which is exactly the weighting doctrine this
   * codebase settled.
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
async function todayBlock(now: Date, permissions: ReadonlySet<string>): Promise<DashboardTodaySummary> {
  const timeZone = env.APP_TIMEZONE;
  const { start, end, date } = dayBounds(now, timeZone);

  const canSeeRequests = permissions.has(PERMISSIONS.SERVICE_REQUEST_VIEW);
  const canSeePlannedWork = permissions.has(PERMISSIONS.PLANNED_WORK_VIEW);

  const items: DashboardTodayItem[] = [];

  if (canSeeRequests) {
    /**
     * Anything that lands today: due today, already past due and unfinished, or
     * urgent and still open. An overdue job from last week is today's problem too.
     */
    const requests = await ServiceRequest.find({
      status: { $nin: SETTLED_REQUEST_STATUSES },
      $or: [{ slaDueAt: { $lte: end } }, { isUrgent: true }],
    })
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
    const works = await PlannedWork.find({
      status: { $in: ['PLANNED', 'STARTED', 'PAUSED'] },
      plannedStartDate: { $lte: end },
    })
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
      const effective = effectivePlannedWorkStatus(work.status, work.plannedEndDate, now);
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

  const completedCount = canSeeRequests
    ? await ServiceRequest.countDocuments({
        status: 'COMPLETED',
        completedAt: { $gte: start, $lte: end },
      })
    : 0;

  return {
    date,
    timezone: timeZone,
    dueCount: items.filter((item) => item.dueAt !== null && item.dueAt <= end.toISOString()).length,
    overdueCount: items.filter((item) => item.isOverdue).length,
    urgentCount: items.filter((item) => item.isUrgent).length,
    unassignedCount: items.filter((item) => item.assigneeNames.length === 0).length,
    completedCount,
    items: items.slice(0, TODAY_ITEM_LIMIT),
  };
}

// -- Entry point ---------------------------------------------------------------

export async function buildDashboardSummary(actor: AuthContext): Promise<DashboardSummaryDto> {
  const now = new Date();
  const { start, end } = dayBounds(now, env.APP_TIMEZONE);
  const permissions = actor.permissions as ReadonlySet<string>;

  const summary: DashboardSummaryDto = { generatedAt: now.toISOString() };

  if (permissions.has(PERMISSIONS.CUSTOMER_VIEW)) {
    summary.customers = await customerBlock();
  }

  if (permissions.has(PERMISSIONS.EMPLOYEE_VIEW)) {
    summary.employees = await employeeBlock();
    summary.workload = await workloadBlock(start, end);
  }

  if (permissions.has(PERMISSIONS.SERVICE_REQUEST_VIEW)) {
    const block = await requestBlock(now, start, end);
    summary.requests = block.requests;
    summary.requestsByStatus = block.byStatus;
    summary.trend = await trendBlock(now);
  }

  if (permissions.has(PERMISSIONS.PLANNED_WORK_VIEW)) {
    summary.plannedWork = await plannedWorkBlock(now);
  }

  if (permissions.has(PERMISSIONS.OBJECT_MASTER_VIEW)) {
    summary.risk = await riskBlock();
  }

  if (permissions.has(PERMISSIONS.INVOICE_VIEW)) {
    summary.finance = await financeBlock(now);
  }

  if (
    permissions.has(PERMISSIONS.SERVICE_REQUEST_VIEW) ||
    permissions.has(PERMISSIONS.PLANNED_WORK_VIEW)
  ) {
    summary.today = await todayBlock(now, permissions);
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
