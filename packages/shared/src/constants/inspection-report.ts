import { RISK_LEVELS, type RiskLevel } from './service-request';

/**
 * The consolidated inspection report (Үзлэгийн нэгдсэн тайлан).
 *
 * One report per planned work, assembled from its sub-tasks once every non-skipped one is
 * finished. It is the level at which a Дүгнэлт exists: sub-tasks carry a Тайлбар and a
 * score, and the conclusion is drawn from them here.
 */

export const INSPECTION_REPORT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'RETURNED',
  'FINALISED',
] as const;
export type InspectionReportStatus = (typeof INSPECTION_REPORT_STATUSES)[number];

export const INSPECTION_REPORT_STATUS_LABELS: Record<InspectionReportStatus, string> = {
  DRAFT: 'Ноорог',
  SUBMITTED: 'Админ хянах',
  APPROVED: 'Батлагдсан',
  RETURNED: 'Буцаагдсан',
  FINALISED: 'Эцэслэгдсэн',
};

/**
 * Permitted transitions.
 *
 * FINALISED is terminal for the version it belongs to. Changing a finalised report opens a
 * new version, which is what "шинэ хувилбар үүсгэнэ" means: the version number advances and
 * the report returns to DRAFT. No prior copy of the document is stored, so this is a
 * counter and an audit trail rather than a version archive.
 */
export const INSPECTION_REPORT_TRANSITIONS: Record<
  InspectionReportStatus,
  readonly InspectionReportStatus[]
> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'RETURNED'],
  RETURNED: ['SUBMITTED'],
  APPROVED: ['FINALISED', 'RETURNED'],
  FINALISED: [],
};

export function canTransitionInspectionReport(
  from: InspectionReportStatus,
  to: InspectionReportStatus,
): boolean {
  return INSPECTION_REPORT_TRANSITIONS[from].includes(to);
}

/**
 * The overall safety level, requirement 9.
 *
 * The five levels are the section 10 risk bands read as a verdict on the whole inspection,
 * so they map one to one rather than forming a second vocabulary that would drift.
 */
export const OVERALL_SAFETY_LABELS: Record<RiskLevel, string> = {
  OUT_OF_SERVICE: 'Ашиглах боломжгүй',
  CRITICAL: 'Ноцтой эрсдэлтэй',
  SCHEDULE_REPAIR: 'Засвар шаардлагатай',
  ATTENTION: 'Анхаарах шаардлагатай',
  NORMAL: 'Аюулгүй / Хэвийн',
};

/**
 * Severity order, worst first.
 *
 * `RISK_LEVELS` is declared best-first, and reversing it here keeps a single source for
 * the band list while making the comparison below read the way it is described.
 */
export const SEVERITY_ORDER: readonly RiskLevel[] = [...RISK_LEVELS].reverse();

/**
 * Rolls sub-task results up to one overall level.
 *
 * **Worst wins**, chosen by the product owner over averaging. One unusable panel makes the
 * whole inspection unusable, and an average would let a single dangerous finding disappear
 * behind good results elsewhere. Section 19.2 left this method open; this records the
 * decision rather than inventing one.
 *
 * Returns null when nothing was scored, because an inspection with no evaluations has no
 * verdict and must not be reported as healthy.
 */
export function overallSafetyLevel(
  levels: readonly (RiskLevel | null)[],
): RiskLevel | null {
  const scored = levels.filter((level): level is RiskLevel => level !== null);
  if (scored.length === 0) return null;

  for (const level of SEVERITY_ORDER) {
    if (scored.includes(level)) return level;
  }
  return null;
}

/** States that mean the report may no longer be edited by its author. */
export function isInspectionReportLocked(status: InspectionReportStatus): boolean {
  return status === 'SUBMITTED' || status === 'APPROVED' || status === 'FINALISED';
}

/**
 * Why a report cannot be generated yet.
 *
 * The product owner settled that every sub-task counts unless it was explicitly skipped,
 * so the skipped flag is the only exemption and no new "required" field was introduced.
 */
export const INSPECTION_REPORT_BLOCKERS = [
  'TASKS_INCOMPLETE',
  'NO_TASKS',
  'SCORES_MISSING',
] as const;
export type InspectionReportBlocker = (typeof INSPECTION_REPORT_BLOCKERS)[number];

export const INSPECTION_REPORT_BLOCKER_LABELS: Record<InspectionReportBlocker, string> = {
  TASKS_INCOMPLETE: 'Дуусаагүй дэд ажил байна.',
  NO_TASKS: 'Дэд ажил бүртгэгдээгүй байна.',
  SCORES_MISSING: 'Үнэлгээ оруулаагүй дэд ажил байна.',
};

/**
 * Ил ба далд ажлын актны нэр, requirement 7.
 *
 * The heading names the act the inspection is recorded under. There is one act in use and
 * the product owner named it, so it is a constant rather than a setting: nothing in the
 * system varies it, and a setting nobody changes is a placeholder pretending to be a
 * feature. The operator's own company name is NOT here; that is administrator data and is
 * read from Тохиргоо.
 */
export const INSPECTION_REPORT_DEFAULT_ACT_NAME = 'Цахилгааны үзлэг';

/**
 * Requirement 11: a finalised report that is reopened becomes a new version.
 *
 * No previous copy is kept. The version is a counter, and the change history lives in the
 * audit log with its old and new values, which is where "өмнөх болон шинэ утга" is read
 * from. This is deliberately not a version archive.
 */
export const INSPECTION_REPORT_VERSION_NOTE =
  'Эцэслэгдсэн тайланг нээхэд хувилбарын дугаар нэмэгдэнэ. Өмнөх хуулбар хадгалагдахгүй, өөрчлөлтийн түүх audit log-д бүртгэгдэнэ.';
