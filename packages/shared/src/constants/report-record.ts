/**
 * The canonical report vocabulary.
 *
 * Every technical assessment and conclusion the system produces is one Report with one or
 * more ReportItems, whatever module raised it. Before this the same fact existed in four
 * unrelated shapes — an object assessment, a planned-work report, a service conclusion and
 * an orphaned inspection report — so nothing could be searched or compared across them,
 * and a result recorded against a job never reached the equipment it described.
 *
 * The split matters: a report is written once and says what was concluded overall; a
 * report item says what was found on one piece of equipment. Copying a whole report onto
 * every object it touched is what the item exists to prevent.
 */
export const REPORT_TYPES = [
  /** Raised directly against a piece of equipment, with no job behind it. */
  'OBJECT_ASSESSMENT',
  /** The result of a completed planned work, one item per assessed sub-task object. */
  'PLANNED_WORK',
  /** The conclusion of a service request. */
  'SERVICE_REQUEST',
  /** Several reports or items reviewed together and signed off as one. */
  'CONSOLIDATED',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  OBJECT_ASSESSMENT: 'Тоноглолын үнэлгээ',
  PLANNED_WORK: 'Төлөвлөгөөт ажил',
  SERVICE_REQUEST: 'Үйлчилгээний хүсэлт',
  CONSOLIDATED: 'Нэгдсэн тайлан',
};

/**
 * The review chain, identical for every type.
 *
 * One vocabulary rather than one per module: the predecessors each had their own
 * near-identical set, which meant a reviewer's queue could not be assembled from more than
 * one of them at a time. PUBLISHED sits after APPROVED and is what a customer may see —
 * approval settles the finding internally, publication releases it.
 */
export const REPORT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'RETURNED',
  'PUBLISHED',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  DRAFT: 'Ноорог',
  SUBMITTED: 'Хянуулахаар илгээсэн',
  APPROVED: 'Батлагдсан',
  RETURNED: 'Буцаагдсан',
  PUBLISHED: 'Нийтлэгдсэн',
};

/**
 * The statuses at which a report's findings are believed.
 *
 * A score is a claim until a reviewer signs it off, so nothing below APPROVED moves a
 * piece of equipment's standing or the figures rolled up from it.
 */
export const REPORT_EFFECTIVE_STATUSES: readonly ReportStatus[] = ['APPROVED', 'PUBLISHED'];

/** Only a published report is ever visible to the customer it describes. */
export const REPORT_CUSTOMER_VISIBLE_STATUSES: readonly ReportStatus[] = ['PUBLISHED'];

/**
 * What raised the report.
 *
 * Half of the idempotency key. A planned work that is completed twice must correct its one
 * report rather than write a second, and that is enforced in the database on
 * (customer, sourceType, sourceId) rather than by looking first.
 */
export const REPORT_SOURCE_TYPES = [
  'MANUAL',
  'PLANNED_WORK',
  'SERVICE_REQUEST',
  'CONSOLIDATION',
] as const;
export type ReportSourceType = (typeof REPORT_SOURCE_TYPES)[number];

export const REPORT_SOURCE_TYPE_LABELS: Record<ReportSourceType, string> = {
  MANUAL: 'Гараар бүртгэсэн',
  PLANNED_WORK: 'Төлөвлөгөөт ажлаас',
  SERVICE_REQUEST: 'Хүсэлтээс',
  CONSOLIDATION: 'Нэгтгэлээс',
};

/**
 * How a report's headline score is produced from its items.
 *
 * Worst-case, matching the floor/building/project rollup: a report whose worst panel is
 * critical must not show a comfortable average while the building it feeds shows critical.
 * The two figures are derived by the same rule so they can never disagree.
 */
export function overallScoreOf(scores: readonly (number | null)[]): number | null {
  const scored = scores.filter((score): score is number => score !== null);
  return scored.length === 0 ? null : Math.min(...scored);
}
