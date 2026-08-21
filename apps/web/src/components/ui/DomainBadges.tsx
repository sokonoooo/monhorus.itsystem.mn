import {
  EMPLOYEE_STATUS_LABELS,
  SERVICE_REQUEST_STATUS_LABELS,
  SLA_STATE_LABELS,
  type EmployeeStatus,
  type RiskLevel,
  type ServiceRequestStageRefDto,
  type ServiceRequestStatus,
  type SlaState,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

import { useRiskBands } from '../../hooks/use-risk-bands';
import { riskLabelOf, riskPaletteOf } from './risk-palette';
import { STAGE_BADGE_STYLES } from './stage-palette';

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

/**
 * What a request is, said the way the business says it.
 *
 * The STAGE is what gets painted when the server sent one: fourteen engine statuses are
 * roles the rules are made of, while a stage is the administrator's own name for the step,
 * and a screen that printed the status directly would contradict the naming in Тохиргоо.
 *
 * `status` stays required and stays the fallback, for two kinds of caller: a payload from
 * before stages existed, and a screen that genuinely holds nothing but a status. Neither
 * should render an empty chip, and neither is a reason to make every call site thread a
 * stage through.
 */
export function RequestStatusBadge({
  status,
  stage,
}: {
  status: ServiceRequestStatus;
  stage?: ServiceRequestStageRefDto | null;
}): ReactElement {
  if (stage) {
    return <span className={`${BASE} ${STAGE_BADGE_STYLES[stage.colour]}`}>{stage.label}</span>;
  }

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

/**
 * The band's own chip.
 *
 * The colour comes from the CONFIGURED band rather than from a map keyed on the level: an
 * administrator names and colours the ladder in Тохиргоо, and a chip painted from a
 * hardcoded table would contradict the legend beside it the moment one was recoloured. The
 * floor-plan markers resolve the same way — `riskPaletteOf(...).badge` — so a red pin on a
 * plan is the same red as the badge in the table beside it.
 */
export function RiskBadge({ level, score }: { level: RiskLevel; score?: number | null }): ReactElement {
  const bands = useRiskBands();

  return (
    <span className={`${BASE} ${riskPaletteOf(level, bands).badge}`}>
      {riskLabelOf(level, bands)}
      {typeof score === 'number' ? ` (${score})` : ''}
    </span>
  );
}
