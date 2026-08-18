import type { ObjectAttributeValue } from '../constants/object-type-attribute';
import type {
  ReportSourceType,
  ReportStatus,
  ReportType,
} from '../constants/report-record';
import type { RiskLevel } from '../constants/service-request';

export interface ReportAttachmentDto {
  id: string;
  name: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

/**
 * What was found on one piece of equipment.
 *
 * The item is why a report is stored once rather than copied onto every object it touched:
 * the narrative and approval live on the report, the per-object finding lives here, and the
 * object's history is assembled by reading items rather than duplicated reports.
 */
/**
 * One of the equipment type's own attributes, FROZEN as the report recorded it (4.1).
 *
 * A report is a dated record, so it must keep saying what was true on its date. The answers
 * themselves live on the equipment and move as it is corrected — a breaker refitted in June
 * reads Хайлмалтай from then on — so a report that read them live would silently rewrite its
 * own history, and two printouts of the same document would disagree.
 *
 * THE LABEL IS FROZEN TOO, NOT JUST THE VALUE. An administrator may delete or rename an
 * attribute afterwards; without the label the March report holds the key `fuse` and nothing
 * that can render it. A snapshot has to be able to print itself with no lookup at all.
 */
export interface ReportItemAttributeDto {
  key: string;
  /** The attribute's name as it read when the report was written. */
  label: string;
  /** The raw answer, so a machine reader never has to parse `display`. */
  value: ObjectAttributeValue;
  /** What the document prints: a SELECT's option label, Тийм/Үгүй, or the value itself. */
  display: string;
}

export interface ReportItemDto {
  id: string;
  reportId: string;

  objectId: string;
  objectCode: string | null;
  objectName: string | null;
  floorId: string | null;
  floorName: string | null;

  score: number | null;
  riskLevel: RiskLevel | null;
  observation: string | null;
  conclusion: string | null;
  recommendation: string | null;
  /** Measured load for this piece of equipment, when the visit took one. */
  measuredLoadKw: number | null;
  /**
   * The equipment type's own attributes as this report recorded them, in display order.
   *
   * Empty for a report written before the feature existed, and for equipment whose type
   * declares nothing — nothing is back-filled, because nothing was captured at the time and
   * inventing it would put words in a signed document.
   */
  attributes: readonly ReportItemAttributeDto[];
  evidenceAttachments: readonly ReportAttachmentDto[];

  /** Set on a consolidated report's items: where the finding was carried from. */
  sourceReportId: string | null;
  sourceReportItemId: string | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * The hierarchy a report was written against.
 *
 * Resolved server-side from the equipment its items name, never accepted from the client,
 * and stored so the central module can filter by building without a lookup per row. It
 * also means a report keeps saying where the work happened after equipment is moved.
 */
export interface ReportDto {
  id: string;
  reportNumber: string;
  type: ReportType;
  status: ReportStatus;
  title: string;

  customerId: string | null;
  customerName: string | null;
  projectId: string | null;
  projectName: string | null;
  buildingId: string | null;
  buildingName: string | null;

  sourceType: ReportSourceType;
  /** The record that raised it: a planned work, a service request, or null when manual. */
  sourceId: string | null;
  sourceReference: string | null;

  conclusion: string | null;
  recommendation: string | null;
  /** The worst item's score, so a report and the building it feeds agree by construction. */
  overallScore: number | null;
  riskLevel: RiskLevel | null;

  /** Populated on a consolidated report. */
  sourceReportIds: readonly string[];
  sourceReportItemIds: readonly string[];

  items: readonly ReportItemDto[];
  itemCount: number;

  createdByName: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  publishedByName: string | null;
  publishedAt: string | null;
  returnedByName: string | null;
  returnedAt: string | null;
  returnReason: string | null;

  /** When the work described happened, which is not when the row was written. */
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}

/** List rows omit the items, which are only needed once a report is opened. */
export type ReportListItemDto = Omit<ReportDto, 'items'>;

export interface ReportListQuery {
  page?: number;
  limit?: number;
  search?: string;
  type?: ReportType;
  status?: ReportStatus;
  riskLevel?: RiskLevel;
  customerId?: string;
  projectId?: string;
  buildingId?: string;
  floorId?: string;
  objectId?: string;
  from?: string;
  to?: string;
  sortBy?: 'occurredAt' | 'overallScore' | 'reportNumber';
  sortDir?: 'asc' | 'desc';
}

/**
 * A node's standing, recalculated from the equipment beneath it.
 *
 * `score` is the worst assessed equipment's score and `riskLevel` its band. The counts sit
 * alongside because "42, and eleven of the fourteen panels have never been looked at" is a
 * different statement from "42", and one figure cannot carry both.
 */
export interface ReportRollupDto {
  score: number | null;
  riskLevel: RiskLevel | null;
  assessedCount: number;
  unassessedCount: number;
  worstObjectId: string | null;
  worstObjectName: string | null;
  calculatedAt: string | null;
}
