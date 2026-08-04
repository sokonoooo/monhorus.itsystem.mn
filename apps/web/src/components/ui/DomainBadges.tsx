import {
  EMPLOYEE_STATUS_LABELS,
  RISK_LEVEL_LABELS,
  SERVICE_REQUEST_STATUS_LABELS,
  SLA_STATE_LABELS,
  type EmployeeStatus,
  type RiskLevel,
  type ServiceRequestStatus,
  type SlaState,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

/**
 * Status colour mapping follows the Phase 1 palette:
 * green normal, yellow attention, orange near-term repair, red urgent,
 * black out of service, grey inactive or draft.
 */
const BASE =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap';

const GREEN = 'bg-green-50 text-green-700 ring-green-200';
const YELLOW = 'bg-amber-50 text-amber-700 ring-amber-200';
const ORANGE = 'bg-orange-50 text-orange-700 ring-orange-200';
const RED = 'bg-red-50 text-red-700 ring-red-200';
const BLACK = 'bg-stone-800 text-stone-50 ring-stone-700';
const GREY = 'bg-slate-100 text-slate-600 ring-slate-200';
const BLUE = 'bg-blue-50 text-blue-700 ring-blue-200';

const EMPLOYEE_STATUS_STYLES: Record<EmployeeStatus, string> = {
  DRAFT: GREY,
  ACTIVE: GREEN,
  ON_LEAVE: YELLOW,
  SUSPENDED: ORANGE,
  TERMINATED: GREY,
  INACTIVE: GREY,
};

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }): ReactElement {
  return <span className={`${BASE} ${EMPLOYEE_STATUS_STYLES[status]}`}>{EMPLOYEE_STATUS_LABELS[status]}</span>;
}

const REQUEST_STATUS_STYLES: Record<ServiceRequestStatus, string> = {
  NEW: BLUE,
  UNASSIGNED: YELLOW,
  ASSIGNED: BLUE,
  ACCEPTED: BLUE,
  ON_THE_WAY: BLUE,
  ON_SITE: BLUE,
  IN_PROGRESS: BLUE,
  WAITING: YELLOW,
  REPORT_SUBMITTED: YELLOW,
  VERIFICATION: YELLOW,
  COMPLETED: GREEN,
  REVISIT_REQUIRED: ORANGE,
  RETURNED: ORANGE,
  CANCELLED: GREY,
};

export function RequestStatusBadge({ status }: { status: ServiceRequestStatus }): ReactElement {
  return (
    <span className={`${BASE} ${REQUEST_STATUS_STYLES[status]}`}>
      {SERVICE_REQUEST_STATUS_LABELS[status]}
    </span>
  );
}

const SLA_STYLES: Record<SlaState, string> = {
  STARTED: GREEN,
  NEAR_BREACH: YELLOW,
  AT_RISK: ORANGE,
  BREACHED: RED,
  WITHIN_SLA: GREEN,
  LATE: RED,
};

export function SlaBadge({
  state,
  remainingMinutes,
}: {
  state: SlaState;
  remainingMinutes: number | null;
}): ReactElement {
  const label = SLA_STATE_LABELS[state];

  // Countdown is rendered from the backend-supplied deadline. The backend remains
  // the authority for the state itself; this is display only.
  let suffix = '';
  if (remainingMinutes !== null) {
    const absolute = Math.abs(remainingMinutes);
    const hours = Math.floor(absolute / 60);
    const minutes = absolute % 60;
    const formatted = hours > 0 ? `${hours}ц ${minutes}м` : `${minutes}м`;
    suffix = remainingMinutes < 0 ? ` (${formatted} хэтэрсэн)` : ` (${formatted})`;
  }

  return (
    <span className={`${BASE} ${SLA_STYLES[state]}`}>
      {label}
      {suffix}
    </span>
  );
}

const RISK_STYLES: Record<RiskLevel, string> = {
  NORMAL: GREEN,
  ATTENTION: YELLOW,
  SCHEDULE_REPAIR: ORANGE,
  CRITICAL: RED,
  OUT_OF_SERVICE: BLACK,
};

/**
 * The same five risk colours, for surfaces that are not badges.
 *
 * The floor-plan markers read from this rather than defining a palette of their own, so a
 * red pin on the plan is the same red as the badge in the table beside it. `UNASSESSED` is
 * grey, which is what "no finding yet" is everywhere else in the app.
 */
export const RISK_SURFACE_STYLES: Record<RiskLevel | 'UNASSESSED', string> = {
  ...RISK_STYLES,
  UNASSESSED: GREY,
};

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number | null }): ReactElement {
  return (
    <span className={`${BASE} ${RISK_STYLES[level]}`}>
      {RISK_LEVEL_LABELS[level]}
      {typeof score === 'number' ? ` (${score})` : ''}
    </span>
  );
}

export function UrgentBadge(): ReactElement {
  return <span className={`${BASE} ${RED}`}>Яаралтай</span>;
}
