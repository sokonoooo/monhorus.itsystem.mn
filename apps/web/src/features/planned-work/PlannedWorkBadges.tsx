import {
  PLANNED_WORK_REPORT_STATUS_LABELS,
  PLANNED_WORK_STATUS_LABELS,
  PLANNED_WORK_TASK_STATUS_LABELS,
  type PlannedWorkEffectiveStatus,
  type PlannedWorkReportStatus,
  type PlannedWorkTaskStatus,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

import { formatMinutes } from '../../lib/duration';

/**
 * Planned work badges.
 *
 * The status rendered here is always the backend-supplied EFFECTIVE status. The client
 * never derives OVERDUE from a date comparison, so a skewed browser clock cannot make a
 * screen disagree with the dashboard or the calendar.
 */
const BASE =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap';

const GREEN = 'bg-green-50 text-green-700 ring-green-200';
const YELLOW = 'bg-amber-50 text-amber-700 ring-amber-200';
const RED = 'bg-red-50 text-red-700 ring-red-200';
const GREY = 'bg-slate-100 text-slate-600 ring-slate-200';
const BLUE = 'bg-blue-50 text-blue-700 ring-blue-200';
const VIOLET = 'bg-violet-50 text-violet-700 ring-violet-200';

const WORK_STATUS_STYLES: Record<PlannedWorkEffectiveStatus, string> = {
  DRAFT: GREY,
  // Amber, like PAUSED and unlike DRAFT: a customer request waiting on a decision is
  // somebody's outstanding item, not a quiet nothing-happening-yet. This map is exhaustive
  // over the status union, so this entry is required for the file to compile — it is the
  // only change the new status forces on any staff screen.
  PENDING_APPROVAL: YELLOW,
  PLANNED: BLUE,
  STARTED: BLUE,
  PAUSED: YELLOW,
  OVERDUE: RED,
  COMPLETED: GREEN,
  ARCHIVED: VIOLET,
  CANCELLED: GREY,
};

export function PlannedWorkStatusBadge({
  status,
}: {
  status: PlannedWorkEffectiveStatus;
}): ReactElement {
  return (
    <span className={`${BASE} ${WORK_STATUS_STYLES[status]}`}>
      {PLANNED_WORK_STATUS_LABELS[status]}
    </span>
  );
}

const TASK_STATUS_STYLES: Record<PlannedWorkTaskStatus, string> = {
  PENDING: GREY,
  IN_PROGRESS: BLUE,
  DONE: GREEN,
  SKIPPED: YELLOW,
};

export function TaskStatusBadge({ status }: { status: PlannedWorkTaskStatus }): ReactElement {
  return (
    <span className={`${BASE} ${TASK_STATUS_STYLES[status]}`}>
      {PLANNED_WORK_TASK_STATUS_LABELS[status]}
    </span>
  );
}

const REPORT_STATUS_STYLES: Record<PlannedWorkReportStatus, string> = {
  DRAFT: GREY,
  SUBMITTED: YELLOW,
  APPROVED: GREEN,
  RETURNED: RED,
};

export function ReportStatusBadge({
  status,
}: {
  status: PlannedWorkReportStatus;
}): ReactElement {
  return (
    <span className={`${BASE} ${REPORT_STATUS_STYLES[status]}`}>
      {PLANNED_WORK_REPORT_STATUS_LABELS[status]}
    </span>
  );
}

/** Marks a work that finished after its deadline. Preserved in reporting history. */
export function LateBadge({ delayMinutes }: { delayMinutes: number | null }): ReactElement {
  const suffix = delayMinutes === null ? '' : ` (${formatMinutes(delayMinutes)})`;
  return <span className={`${BASE} ${RED}`}>Хоцорсон{suffix}</span>;
}

interface ProgressBarProps {
  /** Backend-derived, quantity-weighted percentage. */
  percent: number;
  completedQuantity?: number;
  totalQuantity?: number;
  unitLabel?: string;
}

/**
 * Quantity-weighted progress bar.
 *
 * The percentage is taken verbatim from the backend, never recomputed from the
 * quantities shown beside it, so the number and the bar can never disagree.
 */
export function ProgressBar({
  percent,
  completedQuantity,
  totalQuantity,
  unitLabel,
}: ProgressBarProps): ReactElement {
  const tone = percent >= 100 ? 'bg-green-600' : percent > 0 ? 'bg-blue-600' : 'bg-slate-300';
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className="min-w-[120px]">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-slate-900">{percent}%</span>
        {totalQuantity !== undefined && (
          <span className="text-slate-500">
            {(completedQuantity ?? 0).toLocaleString('mn-MN')} /{' '}
            {totalQuantity.toLocaleString('mn-MN')}
            {unitLabel ? ` ${unitLabel}` : ''}
          </span>
        )}
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Биелэлт"
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
