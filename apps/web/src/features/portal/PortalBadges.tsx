import {
  PLANNED_WORK_STATUS_LABELS,
  SERVICE_REQUEST_STATUS_LABELS,
  type PlannedWorkEffectiveStatus,
  type ServiceRequestStatus,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

const BASE =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap';

const GREY = 'bg-slate-100 text-slate-600 ring-slate-200';
const BLUE = 'bg-blue-50 text-blue-700 ring-blue-200';
const AMBER = 'bg-amber-50 text-amber-700 ring-amber-200';
const GREEN = 'bg-green-50 text-green-700 ring-green-200';
const RED = 'bg-red-50 text-red-700 ring-red-200';

/**
 * Status colour for the portal.
 *
 * Grouped by what the state means TO THE PERSON WAITING rather than by where it sits in
 * the internal workflow. A dispatcher acts differently on ASSIGNED, ACCEPTED and
 * ON_THE_WAY; a customer reads all three as "somebody is on it".
 *
 * The LABELS are the shared ones, unchanged — only the colour is a portal decision. A
 * second Mongolian vocabulary for the same states is how a customer and a technician end
 * up describing the same request differently to each other on the phone.
 */
const PORTAL_STATUS_STYLES: Record<ServiceRequestStatus, string> = {
  NEW: GREY,
  UNASSIGNED: GREY,
  ASSIGNED: BLUE,
  ACCEPTED: BLUE,
  ON_THE_WAY: BLUE,
  ON_SITE: BLUE,
  IN_PROGRESS: BLUE,
  WAITING: AMBER,
  REPORT_SUBMITTED: AMBER,
  VERIFICATION: AMBER,
  COMPLETED: GREEN,
  REVISIT_REQUIRED: AMBER,
  RETURNED: AMBER,
  CANCELLED: RED,
};

export function PortalStatusBadge({ status }: { status: ServiceRequestStatus }): ReactElement {
  return (
    <span className={`${BASE} ${PORTAL_STATUS_STYLES[status]}`}>
      {SERVICE_REQUEST_STATUS_LABELS[status]}
    </span>
  );
}

export function PortalUrgentBadge(): ReactElement {
  return <span className={`${BASE} ${RED}`}>Яаралтай</span>;
}

/**
 * Planned-work status for the portal.
 *
 * Read from the customer's side of the transaction: PENDING_APPROVAL is amber because it
 * is the state they are waiting on somebody for, and it is the one they will look for.
 * Everything from PLANNED onwards is "we have agreed to do this", which is blue until it
 * is done.
 *
 * Labels come from the shared map unchanged, for the same reason the request badge does —
 * a second vocabulary is how a customer and a planner end up describing the same record
 * differently to each other.
 */
const PORTAL_WORK_STATUS_STYLES: Record<PlannedWorkEffectiveStatus, string> = {
  DRAFT: GREY,
  PENDING_APPROVAL: AMBER,
  REJECTED: RED,
  PLANNED: BLUE,
  STARTED: BLUE,
  PAUSED: AMBER,
  OVERDUE: RED,
  COMPLETED: GREEN,
  ARCHIVED: GREEN,
  CANCELLED: RED,
};

export function PortalWorkStatusBadge({
  status,
}: {
  status: PlannedWorkEffectiveStatus;
}): ReactElement {
  return (
    <span className={`${BASE} ${PORTAL_WORK_STATUS_STYLES[status]}`}>
      {PLANNED_WORK_STATUS_LABELS[status]}
    </span>
  );
}
