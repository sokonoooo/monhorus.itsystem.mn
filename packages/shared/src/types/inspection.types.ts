import type { ReportSourceType, ReportStatus, ReportType } from '../constants/report-record';
import type { RiskLevel } from '../constants/service-request';
import type { RiskLevelCountDto } from './object-master.types';

/**
 * Үзлэг ба дүгнэлт — one row per EQUIPMENT RESULT.
 *
 * The identity of a row is a ReportItem, not a Report. This module is the equipment-result
 * feed: it answers "what has been found on our equipment", so a report covering four
 * objects contributes four independently filterable rows, each carrying its own score and
 * finding and each naming the one report that holds the overall narrative.
 *
 * The corollary is the exclusion rule. A completed planned work or a settled service
 * request that assessed no registered equipment produces no ReportItem, and therefore
 * appears here not at all — it remains a real record in its own module, and a general
 * report may still exist for workflow and audit, but it is not an equipment assessment
 * and this feed must not imply that it is.
 */
export interface InspectionListItemDto {
  /** The ReportItem's id. Stable per equipment result, and unique across the feed. */
  id: string;
  /** The report this finding belongs to, for the link back to the full narrative. */
  reportId: string;
  /** The report's own number, assigned once when it was written. */
  reportNumber: string;
  /** Which activity produced it: assessment, planned work, service request, consolidation. */
  type: ReportType;
  /** What raised it, which a consolidation's copied items need in order to say where from. */
  sourceType: ReportSourceType;
  status: ReportStatus;
  title: string;

  /** Always present. An item with no object is not eligible for this feed at all. */
  objectId: string;
  objectCode: string | null;
  objectName: string;
  objectTypeName: string | null;
  /** How many pieces of equipment the parent report covers, this one included. */
  siblingCount: number;

  /** "Main Tower · 2-р давхар". Null segments are omitted rather than printed as dashes. */
  locationPath: string;
  customerId: string | null;
  customerName: string | null;
  projectId: string | null;
  projectName: string | null;
  buildingId: string | null;
  buildingName: string | null;
  floorId: string | null;
  floorName: string | null;

  /** THIS object's score, not the report's worst. Null when the visit recorded none. */
  score: number | null;
  riskLevel: RiskLevel | null;

  /** What was seen on this object, as opposed to what was concluded about it. */
  observation: string | null;
  conclusion: string | null;
  recommendation: string | null;
  evidenceCount: number;

  createdByName: string | null;
  approvedByName: string | null;
  /** When the work described happened, which is not when the row was written. */
  occurredAt: string;
  /** Where the result came from, for example a service request or planned work. */
  sourceLabel: string | null;
  /** The record that raised it, so the list can link back to the job. */
  sourceId: string | null;
  sourceReference: string | null;
}

/**
 * Header counters for the consolidated report.
 *
 * Counts per band and an unassessed count, never one rolled-up figure: section 19.2 leaves
 * the aggregation method unapproved.
 */
export interface InspectionSummaryDto {
  /** Objects in scope of the current filter, assessed or not. */
  totalObjects: number;
  assessedObjects: number;
  unassessedObjects: number;
  counts: readonly RiskLevelCountDto[];
  repairRequiredCount: number;
  revisitRequiredCount: number;
}

export interface InspectionListQuery {
  page?: number;
  limit?: number;
  search?: string;
  type?: ReportType;
  sourceType?: ReportSourceType;
  status?: ReportStatus;
  customerId?: string;
  projectId?: string;
  buildingId?: string;
  floorId?: string;
  /** Narrows to the results for one piece of equipment. */
  objectId?: string;
  riskLevel?: RiskLevel;
  /** ISO dates bounding `occurredAt`. */
  dateFrom?: string;
  dateTo?: string;
}
