/**
 * Service request vocabulary.
 *
 * Status codes and Mongolian labels are taken verbatim from requirements section
 * 14.1 (Ажлын нэгдсэн төлөв). The Phase 1 brief lists EN_ROUTE, ARRIVED and
 * PENDING_APPROVAL; the requirements document is authoritative and uses
 * ON_THE_WAY, ON_SITE and VERIFICATION for the same states, so those names win.
 * The conflict is recorded in docs/WEB_ADMIN_PHASE_1.md.
 */
export const SERVICE_REQUEST_STATUSES = [
  'NEW',
  'UNASSIGNED',
  'ASSIGNED',
  'ACCEPTED',
  'ON_THE_WAY',
  'ON_SITE',
  'IN_PROGRESS',
  'WAITING',
  'REPORT_SUBMITTED',
  'VERIFICATION',
  'COMPLETED',
  'REVISIT_REQUIRED',
  'RETURNED',
  'CANCELLED',
] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

export const SERVICE_REQUEST_STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  NEW: 'Шинэ',
  UNASSIGNED: 'Хуваарилагдаагүй',
  ASSIGNED: 'Хуваарилагдсан',
  ACCEPTED: 'Хүлээн авсан',
  ON_THE_WAY: 'Замдаа',
  ON_SITE: 'Очсон',
  IN_PROGRESS: 'Гүйцэтгэж байна',
  WAITING: 'Түр хүлээгдсэн',
  REPORT_SUBMITTED: 'Дүгнэлт илгээсэн',
  VERIFICATION: 'Баталгаажуулах',
  COMPLETED: 'Дууссан',
  REVISIT_REQUIRED: 'Дахин очих',
  RETURNED: 'Буцаасан',
  CANCELLED: 'Цуцалсан',
};

/**
 * Permitted workflow transitions. The backend is the sole authority; the dispatch
 * board consults this map only to avoid offering an action that would be rejected.
 */
export const SERVICE_REQUEST_TRANSITIONS: Record<
  ServiceRequestStatus,
  readonly ServiceRequestStatus[]
> = {
  NEW: ['UNASSIGNED', 'ASSIGNED', 'CANCELLED'],
  UNASSIGNED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['ACCEPTED', 'UNASSIGNED', 'RETURNED', 'CANCELLED'],
  ACCEPTED: ['ON_THE_WAY', 'UNASSIGNED', 'RETURNED', 'CANCELLED'],
  ON_THE_WAY: ['ON_SITE', 'WAITING', 'RETURNED', 'CANCELLED'],
  ON_SITE: ['IN_PROGRESS', 'REPORT_SUBMITTED', 'WAITING', 'RETURNED', 'CANCELLED'],
  IN_PROGRESS: ['REPORT_SUBMITTED', 'WAITING', 'REVISIT_REQUIRED', 'CANCELLED'],
  WAITING: ['IN_PROGRESS', 'ON_SITE', 'RETURNED', 'CANCELLED'],
  REPORT_SUBMITTED: ['VERIFICATION', 'COMPLETED', 'RETURNED'],
  VERIFICATION: ['COMPLETED', 'RETURNED', 'REVISIT_REQUIRED'],
  COMPLETED: [],
  REVISIT_REQUIRED: ['ASSIGNED', 'UNASSIGNED', 'CANCELLED'],
  RETURNED: ['ASSIGNED', 'IN_PROGRESS', 'CANCELLED'],
  CANCELLED: [],
};

export function canTransition(
  from: ServiceRequestStatus,
  to: ServiceRequestStatus,
): boolean {
  return SERVICE_REQUEST_TRANSITIONS[from].includes(to);
}

/**
 * The states `service_request.self_progress` authorises, and nothing else.
 *
 * WHAT THE LINE IS DRAWN ON: every state here is something the person standing at the site
 * is the only honest source for — I have accepted it, I am on my way, I have arrived, I am
 * working, I am blocked, my write-up is in. None of them is a decision ABOUT the job.
 *
 * The six deliberately absent, each for its own reason rather than by omission:
 *   - CANCELLED and UNASSIGNED — planning decisions. Dropping a job is not reporting on it.
 *   - RETURNED — a judgement on somebody's write-up, which is the office's.
 *   - VERIFICATION and COMPLETED — the sign-off rule 17.7 keeps downstream of an approved
 *     conclusion, so that closing a job is never the same act as finishing the work.
 *   - REVISIT_REQUIRED — it creates follow-up work for somebody, i.e. it is dispatch.
 *
 * THIS SET NEVER WIDENS [SERVICE_REQUEST_TRANSITIONS]. It is intersected with it, never
 * substituted for it: a move has to be legal for the request AND permitted for the caller,
 * and this answers only the second half. WAITING keeps its `reason` requirement, which is
 * why it is the one entry here that also appears in [REASON_REQUIRED_STATUSES].
 */
export const SELF_PROGRESS_STATUSES: readonly ServiceRequestStatus[] = [
  'ACCEPTED',
  'ON_THE_WAY',
  'ON_SITE',
  'IN_PROGRESS',
  'WAITING',
  'REPORT_SUBMITTED',
];

export function isSelfProgressStatus(status: ServiceRequestStatus): boolean {
  return SELF_PROGRESS_STATUSES.includes(status);
}

/**
 * The moves a self-progress holder may actually offer from `from`: legal for the request
 * and inside the set above.
 *
 * Exported so the dispatch board, the employee app and the backend all read one answer
 * rather than each intersecting the two lists their own way — which is how a control ends
 * up offering a move the API refuses.
 */
export function selfProgressTransitionsFrom(
  from: ServiceRequestStatus,
): readonly ServiceRequestStatus[] {
  return SERVICE_REQUEST_TRANSITIONS[from].filter(isSelfProgressStatus);
}


/**
 * Statuses that can only be reached once the technician has arrived on site.
 *
 * WAITING IS DELIBERATELY ABSENT. The transition map admits `ON_THE_WAY -> WAITING`, so a
 * technician can be waiting without ever having arrived — treating it as arrival would let a
 * conclusion be written from the road, which is the thing this list exists to prevent.
 *
 * A status is only half the answer: a request that arrived and was later sent back to
 * ASSIGNED has arrived even though its current status is not in this list. Callers that can
 * see `statusHistory` should consult it as well — see `hasArrivedOnSite` on the backend.
 */
export const ARRIVED_STATUSES: readonly ServiceRequestStatus[] = [
  'ON_SITE',
  'IN_PROGRESS',
  'REPORT_SUBMITTED',
  'VERIFICATION',
  'COMPLETED',
];
/** Transitions that require a free-text reason (requirements 8.3, 14.1, 14.4). */
export const REASON_REQUIRED_STATUSES: readonly ServiceRequestStatus[] = [
  'WAITING',
  'RETURNED',
  'CANCELLED',
  'REVISIT_REQUIRED',
];

export function isReasonRequired(status: ServiceRequestStatus): boolean {
  return REASON_REQUIRED_STATUSES.includes(status);
}

/**
 * A dispatch board column.
 *
 * A column is not a status. Most cover exactly one, but the open column covers both
 * NEW and UNASSIGNED, so the shape has to be a set of statuses rather than a single
 * one. `id` is the stable key consumers switch on; the label is display only.
 */
export interface DispatchBoardColumnDef {
  id: string;
  statuses: readonly ServiceRequestStatus[];
  label: string;
}

/**
 * Columns rendered by the dispatch board, in workflow order.
 *
 * NEW and UNASSIGNED are one column. Every request is created NEW and nothing promotes
 * it to UNASSIGNED on its own, so a board that listed only UNASSIGNED showed nothing at
 * all; the two statuses mean the same thing to a dispatcher ("nobody has this yet") and
 * are already paired as CLAIMABLE_STATUSES on the backend model.
 *
 * WAITING is its own column: it is reachable from ON_THE_WAY, ON_SITE and IN_PROGRESS,
 * and without a column a paused job disappears from the board entirely.
 *
 * CANCELLED is deliberately absent — it is terminal and nothing on the board acts on it.
 */
export const DISPATCH_BOARD_COLUMNS = [
  { id: 'OPEN', statuses: ['NEW', 'UNASSIGNED'], label: 'Хуваарилаагүй' },
  { id: 'ASSIGNED', statuses: ['ASSIGNED'], label: SERVICE_REQUEST_STATUS_LABELS.ASSIGNED },
  { id: 'ACCEPTED', statuses: ['ACCEPTED'], label: SERVICE_REQUEST_STATUS_LABELS.ACCEPTED },
  { id: 'ON_THE_WAY', statuses: ['ON_THE_WAY'], label: SERVICE_REQUEST_STATUS_LABELS.ON_THE_WAY },
  { id: 'ON_SITE', statuses: ['ON_SITE'], label: SERVICE_REQUEST_STATUS_LABELS.ON_SITE },
  { id: 'IN_PROGRESS', statuses: ['IN_PROGRESS'], label: SERVICE_REQUEST_STATUS_LABELS.IN_PROGRESS },
  { id: 'WAITING', statuses: ['WAITING'], label: SERVICE_REQUEST_STATUS_LABELS.WAITING },
  {
    id: 'REPORT_SUBMITTED',
    statuses: ['REPORT_SUBMITTED'],
    label: SERVICE_REQUEST_STATUS_LABELS.REPORT_SUBMITTED,
  },
  {
    id: 'VERIFICATION',
    statuses: ['VERIFICATION'],
    label: SERVICE_REQUEST_STATUS_LABELS.VERIFICATION,
  },
  { id: 'COMPLETED', statuses: ['COMPLETED'], label: SERVICE_REQUEST_STATUS_LABELS.COMPLETED },
  { id: 'RETURNED', statuses: ['RETURNED'], label: SERVICE_REQUEST_STATUS_LABELS.RETURNED },
  {
    id: 'REVISIT_REQUIRED',
    statuses: ['REVISIT_REQUIRED'],
    label: SERVICE_REQUEST_STATUS_LABELS.REVISIT_REQUIRED,
  },
] as const satisfies readonly DispatchBoardColumnDef[];

export type DispatchBoardColumnId = (typeof DISPATCH_BOARD_COLUMNS)[number]['id'];

/** Requirements section 8.1. */
export const SERVICE_REQUEST_TYPES = [
  'PLANNED_INSPECTION',
  'REPAIR',
  'STANDARD_CALL',
  'URGENT_CALL',
  'INSTALLATION',
  'REVISIT',
] as const;
export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

export const SERVICE_REQUEST_TYPE_LABELS: Record<ServiceRequestType, string> = {
  PLANNED_INSPECTION: 'Төлөвлөгөөт үзлэг',
  REPAIR: 'Засвар үйлчилгээ',
  STANDARD_CALL: 'Энгийн дуудлага',
  URGENT_CALL: 'Яаралтай дуудлага',
  INSTALLATION: 'Шинэ угсралт/өргөтгөл',
  REVISIT: 'Давтан үзлэг',
};

/** Requirements section 8.4. */
export const SLA_STATES = [
  'STARTED',
  'NEAR_BREACH',
  'AT_RISK',
  'BREACHED',
  'WITHIN_SLA',
  'LATE',
] as const;
export type SlaState = (typeof SLA_STATES)[number];

export const SLA_STATE_LABELS: Record<SlaState, string> = {
  STARTED: 'Эхэлсэн',
  NEAR_BREACH: 'Ойртсон',
  AT_RISK: 'Зөрчих эрсдэлтэй',
  BREACHED: 'Зөрчсөн',
  WITHIN_SLA: 'SLA дотор дууссан',
  LATE: 'Хоцорсон',
};

/**
 * SLA durations in hours. Requirements section 8.1 and rule 17.10:
 * urgent calls 6 hours, standard calls 24 hours.
 */
export const SLA_HOURS_URGENT = 6;
export const SLA_HOURS_STANDARD = 24;

/**
 * Fraction of the SLA window consumed before a request is reported as NEAR_BREACH
 * and then AT_RISK. Requirements 8.4 names the states but sets no thresholds, so
 * these are configuration defaults rather than invented business rules.
 */
export const SLA_NEAR_BREACH_RATIO = 0.75;
export const SLA_AT_RISK_RATIO = 0.9;

/**
 * Device risk levels, requirements section 10. Score bands are configurable per
 * section 10.1 but these are the documented defaults. Never invent other bands.
 */
export const RISK_LEVELS = ['NORMAL', 'ATTENTION', 'SCHEDULE_REPAIR', 'CRITICAL', 'OUT_OF_SERVICE'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export interface RiskBand {
  level: RiskLevel;
  min: number;
  max: number;
  labelMn: string;
  colour: 'green' | 'yellow' | 'orange' | 'red' | 'black';
}

export const RISK_BANDS: readonly RiskBand[] = [
  { level: 'NORMAL', min: 81, max: 100, labelMn: 'Хэвийн', colour: 'green' },
  { level: 'ATTENTION', min: 61, max: 80, labelMn: 'Анхаарах шаардлагатай', colour: 'yellow' },
  { level: 'SCHEDULE_REPAIR', min: 41, max: 60, labelMn: 'Ойрын хугацаанд засварлах', colour: 'orange' },
  { level: 'CRITICAL', min: 21, max: 40, labelMn: 'Ноцтой эрсдэлтэй', colour: 'red' },
  { level: 'OUT_OF_SERVICE', min: 0, max: 20, labelMn: 'Ашиглах боломжгүй', colour: 'black' },
];

export function riskLevelFromScore(score: number): RiskLevel {
  const band = RISK_BANDS.find((entry) => score >= entry.min && score <= entry.max);
  return band?.level ?? 'OUT_OF_SERVICE';
}

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  NORMAL: 'Хэвийн',
  ATTENTION: 'Анхаарах шаардлагатай',
  SCHEDULE_REPAIR: 'Ойрын хугацаанд засварлах',
  CRITICAL: 'Ноцтой эрсдэлтэй',
  OUT_OF_SERVICE: 'Ашиглах боломжгүй',
};
