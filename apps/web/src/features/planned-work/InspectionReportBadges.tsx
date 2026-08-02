import {
  INSPECTION_REPORT_STATUS_LABELS,
  OVERALL_SAFETY_LABELS,
  type InspectionReportStatus,
  type RiskLevel,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

/**
 * Badges for the consolidated inspection report.
 *
 * Kept beside the report rather than in the shared badge module because both vocabularies
 * are report-specific: the report has a FINALISED state the planned work report never had,
 * and the overall verdict is worded differently from a single object's risk band even
 * though it uses the same five levels.
 */
const BASE =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap';

const GREEN = 'bg-green-50 text-green-700 ring-green-200';
const YELLOW = 'bg-amber-50 text-amber-700 ring-amber-200';
const ORANGE = 'bg-orange-50 text-orange-700 ring-orange-200';
const RED = 'bg-red-50 text-red-700 ring-red-200';
const GREY = 'bg-slate-100 text-slate-600 ring-slate-200';
const VIOLET = 'bg-violet-50 text-violet-700 ring-violet-200';
const BLACK = 'bg-stone-800 text-stone-50 ring-stone-700';

const STATUS_STYLES: Record<InspectionReportStatus, string> = {
  DRAFT: GREY,
  SUBMITTED: YELLOW,
  APPROVED: GREEN,
  RETURNED: RED,
  FINALISED: VIOLET,
};

export function InspectionReportStatusBadge({
  status,
}: {
  status: InspectionReportStatus;
}): ReactElement {
  return (
    <span className={`${BASE} ${STATUS_STYLES[status]}`}>
      {INSPECTION_REPORT_STATUS_LABELS[status]}
    </span>
  );
}

const LEVEL_STYLES: Record<RiskLevel, string> = {
  NORMAL: GREEN,
  ATTENTION: YELLOW,
  SCHEDULE_REPAIR: ORANGE,
  CRITICAL: RED,
  OUT_OF_SERVICE: BLACK,
};

/**
 * The whole inspection's verdict, requirement 9.
 *
 * A report with nothing scored has no verdict, so it is shown as Үнэлгээгүй in a neutral
 * colour. It must never fall back to the safe band, which would let an unassessed
 * inspection read as healthy.
 */
export function OverallSafetyBadge({
  level,
  label,
}: {
  level: RiskLevel | null;
  label: string | null;
}): ReactElement {
  if (level === null) {
    return <span className={`${BASE} ${GREY} px-3 py-1 text-sm`}>Үнэлгээгүй</span>;
  }

  return (
    <span className={`${BASE} ${LEVEL_STYLES[level]} px-3 py-1 text-sm`}>
      {label ?? OVERALL_SAFETY_LABELS[level]}
    </span>
  );
}

/** Level pill used inside the зөрчил list, worded as the overall verdict is. */
export function SafetyLevelPill({ level }: { level: RiskLevel }): ReactElement {
  return <span className={`${BASE} ${LEVEL_STYLES[level]}`}>{OVERALL_SAFETY_LABELS[level]}</span>;
}
