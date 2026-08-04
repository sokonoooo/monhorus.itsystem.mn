import type {
  DashboardInsightChart,
  DashboardInsightDimension,
  DashboardInsightMetric,
  DashboardInsightRange,
  DashboardWidgetPreference,
} from '../constants/dashboard-layout';
import type { RiskLevel } from '../constants/service-request';

/**
 * Single aggregate payload for the dashboard, requirements section 15.1.
 *
 * One request rather than fifteen. Sections the caller lacks permission to see are
 * omitted entirely rather than zero-filled, so the UI can distinguish "no permission"
 * from "the value really is zero".
 */

export interface DashboardCustomerSummary {
  totalCustomers: number;
  activeServiceAgreements: number;
  totalProjects: number;
  totalBuildings: number;
  totalFloors: number;
}

export interface DashboardEmployeeSummary {
  totalActiveEmployees: number;
  availableEmployees: number;
  assignedEmployees: number;
}

/** One employee's live load, for the workload bar chart (section 15.1). */
export interface DashboardWorkloadRow {
  employeeId: string;
  employeeName: string;
  /** Assigned and in-flight work, the section 15.3 "ачаалал" figure. */
  activeCount: number;
  completedToday: number;
}

export interface DashboardRequestSummary {
  newRequests: number;
  unassignedRequests: number;
  urgentRequests: number;
  slaNearBreach: number;
  slaBreached: number;
  inProgress: number;
  dueToday: number;
  completedToday: number;
}

/** A slice of a donut or a bar, carrying its own label so the chart stays generic. */
export interface DashboardSlice {
  key: string;
  label: string;
  count: number;
}

export interface DashboardRiskSummary {
  byLevel: Array<{ level: RiskLevel; count: number }>;
  totalAssessedObjects: number;
  unassessedObjects: number;
}

/** One day of the created-versus-completed trend line. */
export interface DashboardTrendPoint {
  /** `YYYY-MM-DD` in the configured timezone. */
  date: string;
  created: number;
  completed: number;
}

export interface DashboardPlannedWorkSummary {
  total: number;
  inProgress: number;
  overdue: number;
  completed: number;
  /**
   * Quantity-weighted mean progress across non-archived work: summed completed quantity
   * over summed total quantity, the same aggregation a single work's own percent uses.
   *
   * Null when there is nothing to weigh — no work, or no quantity recorded against any of
   * it — following the convention `resolutionHours` uses for a figure that cannot yet be
   * stated. Zero would assert that everything is at 0%.
   */
  averageProgress: number | null;
}

export interface DashboardFinanceSummary {
  monthRevenue: number;
  receivableTotal: number;
  overdueTotal: number;
  byStatus: readonly DashboardSlice[];
  currency: string;
}

/** What kind of record a today row came from. */
export const DASHBOARD_TODAY_KINDS = ['SERVICE_REQUEST', 'PLANNED_WORK'] as const;
export type DashboardTodayKind = (typeof DASHBOARD_TODAY_KINDS)[number];

/**
 * One piece of work that needs attention today.
 *
 * This replaces the audit-log tail that used to sit at the bottom of the dashboard: a
 * list of what was already done answers a different question from what still has to be.
 */
export interface DashboardTodayItem {
  id: string;
  kind: DashboardTodayKind;
  /** Document number, for example SR-202607-0001. */
  reference: string;
  title: string;
  customerName: string | null;
  locationLabel: string | null;
  assigneeNames: readonly string[];
  status: string;
  statusLabel: string;
  /** SLA deadline for a request, planned end date for a planned work. */
  dueAt: string | null;
  isUrgent: boolean;
  /** Past its deadline and not finished. */
  isOverdue: boolean;
  linkPath: string;
}

export interface DashboardTodaySummary {
  /** The day these figures describe, `YYYY-MM-DD` in the configured timezone. */
  date: string;
  timezone: string;
  dueCount: number;
  overdueCount: number;
  urgentCount: number;
  unassignedCount: number;
  completedCount: number;
  items: readonly DashboardTodayItem[];
}

export interface DashboardSummaryDto {
  customers?: DashboardCustomerSummary;
  employees?: DashboardEmployeeSummary;
  workload?: readonly DashboardWorkloadRow[];
  requests?: DashboardRequestSummary;
  requestsByStatus?: readonly DashboardSlice[];
  requestsByType?: readonly DashboardSlice[];
  trend?: readonly DashboardTrendPoint[];
  plannedWork?: DashboardPlannedWorkSummary;
  risk?: DashboardRiskSummary;
  finance?: DashboardFinanceSummary;
  today?: DashboardTodaySummary;
  generatedAt: string;
}

/**
 * One widget the caller built for themselves.
 *
 * Personal, never shared: a definition belongs to the account that created it, so no
 * viewer other than its owner ever asks for it and there is no second permission check to
 * make on somebody else's behalf. The owner's own rights are still checked when the figures
 * are computed — a definition is a saved question, not a licence to answer it.
 */
export interface DashboardCustomWidgetDto {
  id: string;
  title: string;
  metric: DashboardInsightMetric;
  dimension: DashboardInsightDimension;
  range: DashboardInsightRange;
  chart: DashboardInsightChart;
  createdAt: string;
}

/**
 * The figures behind one user-built widget.
 *
 * `slices` is the same shape the shipped distributions use, so a custom widget feeds the
 * existing donut and bar charts without a line of new drawing code.
 */
export interface DashboardInsightDto {
  widget: DashboardCustomWidgetDto;
  /** Window covered, `YYYY-MM-DD` in the configured timezone, both ends inclusive. */
  from: string;
  to: string;
  timezone: string;
  /** Every matching record, including whatever the top-N cut folded into "Бусад". */
  total: number;
  slices: readonly DashboardSlice[];
}

/** The caller's dashboard arrangement, reconciled against the current widget catalogue. */
export interface DashboardLayoutDto {
  widgets: readonly DashboardWidgetPreference[];
  /**
   * The caller's own definitions, carried with the layout so the board can title and draw
   * a custom widget without a second round trip per entry.
   */
  customWidgets: readonly DashboardCustomWidgetDto[];
  /** False while the caller is still on the shipped default. */
  isCustomised: boolean;
}
