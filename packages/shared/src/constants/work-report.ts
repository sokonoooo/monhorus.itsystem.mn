/**
 * Work conclusion vocabulary, requirements section 9.2 and 9.4.
 *
 * The conclusion a technician records when finishing a service request: photographs
 * before and after, what was found, what to do next, and a 0-100 score. Section 9.4 puts
 * it through the same draft, submit, approve and return chain the planned-work report
 * already uses, so the two share a status vocabulary.
 */
export const WORK_REPORT_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED'] as const;
export type WorkReportStatus = (typeof WORK_REPORT_STATUSES)[number];

export const WORK_REPORT_STATUS_LABELS: Record<WorkReportStatus, string> = {
  DRAFT: 'Ноорог',
  SUBMITTED: 'Админ хянах',
  APPROVED: 'Батлагдсан',
  RETURNED: 'Буцаагдсан',
};

/**
 * What must be filled in before a request may be finished.
 *
 * Requirements 17.6 and 17.7 tie completion to a conclusion, and the current build lets a
 * request reach COMPLETED with none of this. Each entry is checked separately so the
 * screen can name the missing field rather than refusing with one unhelpful message.
 *
 * Section 9.2 marks the recommendation as depending on the evaluation, but the later
 * requirement list makes evaluation, conclusion and recommendation all mandatory before a
 * request is finished. The stricter rule is applied and the conflict recorded.
 */
export const WORK_REPORT_REQUIREMENTS = [
  'SCORE',
  'CONCLUSION',
  'RECOMMENDATION',
  'BEFORE_PHOTO',
  'AFTER_PHOTO',
] as const;
export type WorkReportRequirement = (typeof WORK_REPORT_REQUIREMENTS)[number];

export const WORK_REPORT_REQUIREMENT_LABELS: Record<WorkReportRequirement, string> = {
  SCORE: 'Үнэлгээ (0-100)',
  CONCLUSION: 'Дүгнэлт',
  RECOMMENDATION: 'Зөвлөмж',
  BEFORE_PHOTO: 'Ажлын өмнөх зураг',
  AFTER_PHOTO: 'Ажлын дараах зураг',
};

/**
 * Materials are reported, not required.
 *
 * Section 9.2's mandatory list does not include them, and a job that legitimately used no
 * material must still be finishable. The count is surfaced so a reviewer can see whether
 * any were recorded.
 */
export const WORK_REPORT_MATERIALS_NOTE =
  'Ашигласан материал заавал биш. Материал зарцуулаагүй ажлыг ч дуусгана.';

export interface WorkReportCompleteness {
  missing: readonly WorkReportRequirement[];
  isComplete: boolean;
}

/** Which mandatory fields are still empty. */
export function workReportCompleteness(report: {
  score: number | null;
  conclusion: string | null;
  recommendation: string | null;
  beforePhotoCount: number;
  afterPhotoCount: number;
}): WorkReportCompleteness {
  const missing: WorkReportRequirement[] = [];

  if (report.score === null) missing.push('SCORE');
  if (!report.conclusion?.trim()) missing.push('CONCLUSION');
  if (!report.recommendation?.trim()) missing.push('RECOMMENDATION');
  if (report.beforePhotoCount === 0) missing.push('BEFORE_PHOTO');
  if (report.afterPhotoCount === 0) missing.push('AFTER_PHOTO');

  return { missing, isComplete: missing.length === 0 };
}
