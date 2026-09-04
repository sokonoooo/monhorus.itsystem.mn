import { DEFAULT_RISK_BANDS } from './risk-band';
import { RISK_LEVELS, type RiskBand, type RiskLevel } from './service-request';

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
  BAND_6: 'Түвшин 6',
  BAND_7: 'Түвшин 7',
  BAND_8: 'Түвшин 8',
};

/**
 * Severity order over the STORAGE KEYS, worst first — the last resort, not the rule.
 *
 * `RISK_LEVELS` is declared best-first and reversing it puts the reserved spares
 * `BAND_6/7/8` at the very top, ahead of `OUT_OF_SERVICE`. That is only harmless while
 * no administrator has named a spare: the moment one does, a *mild* sixth band outranks
 * every real one and every inspection containing it is printed at that band. Keys carry
 * no severity — the band's lower bound does — so prefer `severityOrderOf(bands)` and keep
 * this for callers that genuinely have no ladder to hand.
 */
export const SEVERITY_ORDER: readonly RiskLevel[] = [...RISK_LEVELS].reverse();

/**
 * The configured ladder ranked worst-first, which on this inverted 0-100 scale means
 * ascending `min`. The same rule the web already settled on in `risk-palette.ts`.
 *
 * Reserved keys the ladder does not contain are appended after the configured bands
 * rather than dropped. A total order means `overallSafetyLevel` always produces a
 * verdict, and putting the unrankable keys LAST means a stored level from a ladder that
 * has since changed can never outrank a band the administrator actually configured.
 *
 * Passing no bands reproduces `SEVERITY_ORDER` exactly, so a caller that has not been
 * threaded yet behaves as it did.
 */
export function severityOrderOf(bands?: readonly RiskBand[] | null): readonly RiskLevel[] {
  if (!bands || bands.length === 0) return SEVERITY_ORDER;

  const configured = [...bands]
    .sort((left, right) => left.min - right.min)
    .map((band) => band.level);
  const seen = new Set<RiskLevel>(configured);
  return [...configured, ...RISK_LEVELS.filter((level) => !seen.has(level))];
}

/**
 * Whether a band is a зөрчил — something requirement 8 lists as a finding.
 *
 * Read from the band's own flags, not from its position and not from its name. A band
 * that demands a written conclusion or a recommendation is by definition one the product
 * says needs acting on; that is exactly `{OUT_OF_SERVICE, CRITICAL, SCHEDULE_REPAIR,
 * ATTENTION}` on the shipped ladder, so nothing changes for an installation that has not
 * touched Тохиргоо. Position cannot be used here: on a ladder with a mild sixth band the
 * healthy band is no longer the top one, and "everything below the top" would newly file
 * healthy equipment as a зөрчил.
 *
 * With no ladder to hand it falls back to the old positional rule so the answer is the
 * same as before for a caller that has not been threaded.
 */
export function isRiskFinding(
  level: RiskLevel | null,
  bands?: readonly RiskBand[] | null,
): level is RiskLevel {
  if (level === null) return false;

  const band = bands?.find((entry) => entry.level === level);
  if (band) return band.requiresConclusion || band.requiresRecommendation;

  return SEVERITY_ORDER.indexOf(level) < SEVERITY_ORDER.indexOf('NORMAL');
}

/**
 * The wording printed for a verdict.
 *
 * Two vocabularies genuinely collide here. `OVERALL_SAFETY_LABELS` is the report's own
 * verdict wording — «Аюулгүй / Хэвийн» reads as a judgement on a whole inspection, which
 * is why it was written differently from the ladder's band name «Хэвийн». The configured
 * ladder is the administrator's wording. Neither can simply win: taking the band label
 * always would silently reword every existing report, and ignoring it always would print
 * «Түвшин 6» for a band the administrator named.
 *
 * So the administrator's wording wins WHERE THEY ACTUALLY CHANGED IT. A band still
 * carrying its shipped label has had no wording decision made about it, and keeps the
 * report's verdict phrasing. An unconfigured installation is therefore byte-identical,
 * and a band the administrator renamed — or a spare they named — prints their words.
 */
export function overallSafetyLabelOf(
  level: RiskLevel,
  bands?: readonly RiskBand[] | null,
): string {
  const configured = bands?.find((entry) => entry.level === level)?.labelMn.trim() ?? '';
  if (configured.length === 0) return OVERALL_SAFETY_LABELS[level];

  const shipped = DEFAULT_RISK_BANDS.find((band) => band.key === level);
  return shipped && shipped.label === configured ? OVERALL_SAFETY_LABELS[level] : configured;
}

/**
 * Rolls sub-task results up to one overall level.
 *
 * **Worst wins**, chosen by the product owner over averaging. One unusable panel makes the
 * whole inspection unusable, and an average would let a single dangerous finding disappear
 * behind good results elsewhere. Section 19.2 left this method open; this records the
 * decision rather than inventing one.
 *
 * The ladder is an optional second argument rather than something this reaches for, which
 * keeps the function pure and testable against a ladder no database holds — the same
 * convention `slaConfigOf` and `riskLevelFor` already follow.
 *
 * Returns null when nothing was scored, because an inspection with no evaluations has no
 * verdict and must not be reported as healthy.
 */
export function overallSafetyLevel(
  levels: readonly (RiskLevel | null)[],
  bands?: readonly RiskBand[] | null,
): RiskLevel | null {
  const scored = levels.filter((level): level is RiskLevel => level !== null);
  if (scored.length === 0) return null;

  for (const level of severityOrderOf(bands)) {
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
