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
  REPORT_SUBMITTED: 'Тайлан илгээсэн',
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
  ON_SITE: ['IN_PROGRESS', 'WAITING', 'RETURNED', 'CANCELLED'],
  IN_PROGRESS: ['REPORT_SUBMITTED', 'WAITING', 'REVISIT_REQUIRED', 'CANCELLED'],
  WAITING: ['IN_PROGRESS', 'ON_SITE', 'RETURNED', 'CANCELLED'],
  REPORT_SUBMITTED: ['VERIFICATION', 'RETURNED'],
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

/** Columns rendered by the dispatch board, in workflow order. */
export const DISPATCH_BOARD_COLUMNS: readonly ServiceRequestStatus[] = [
  'UNASSIGNED',
  'ASSIGNED',
  'ACCEPTED',
  'ON_THE_WAY',
  'ON_SITE',
  'IN_PROGRESS',
  'REPORT_SUBMITTED',
  'VERIFICATION',
  'COMPLETED',
  'RETURNED',
  'REVISIT_REQUIRED',
];

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
