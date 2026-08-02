import type { RiskLevelCountDto } from './object-master.types';
import type { ReportRollupDto } from './report-record.types';

/**
 * Risk roll-up for a node in the hierarchy (requirements 10.2).
 *
 * Counts per band and a warning marker. A single rolled-up score used to be refused here
 * because section 19.2 left the aggregation method unapproved; the method has since been
 * chosen — worst-case, stated in ROLLUP_METHOD — and the figure travels separately as
 * `rollup` on each node DTO. The counts deliberately stay: the distribution answers a
 * different question than the worst case, and the screens that read them keep doing so.
 */
export interface RiskSummaryDto {
  /** Non-zero bands only, so an empty array means nothing has been assessed. */
  counts: readonly RiskLevelCountDto[];
  unassessedCount: number;
  /** Section 10.2 requires a warning marker on red and black objects. */
  hasCritical: boolean;
  /** Most recent assessment in the subtree; the prototype's "Сүүлийн үзлэг". */
  lastAssessedAt: string | null;
}

/**
 * Project module hierarchy (requirements 4.2).
 *
 * Project -> Building/Object -> Floor. Each level has its own CRUD; Objects are master
 * data owned by a different module and a Floor only links to them.
 */

export interface ProjectDto {
  id: string;
  code: string;
  name: string;
  customerId: string;
  customerName: string | null;
  contractNumber: string | null;
  responsibleEmployeeId: string | null;
  responsibleEmployeeName: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  isActive: boolean;
  buildingCount: number;
  floorCount: number;
  objectCount: number;
  riskSummary: RiskSummaryDto;
  /** Worst-case standing of the equipment beneath, recalculated on every assessment. */
  rollup: ReportRollupDto;
  createdAt: string;
  updatedAt: string;
  /** Reasons deletion is refused. Empty means deletion is allowed. */
  deleteBlockers: readonly string[];
}

export interface BuildingDto {
  id: string;
  code: string;
  name: string;
  projectId: string;
  projectName: string | null;
  customerId: string;
  address: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  description: string | null;
  isActive: boolean;
  floorCount: number;
  objectCount: number;
  riskSummary: RiskSummaryDto;
  /** Worst-case standing of the equipment beneath, recalculated on every assessment. */
  rollup: ReportRollupDto;
  createdAt: string;
  updatedAt: string;
  deleteBlockers: readonly string[];
}

export interface FloorDto {
  id: string;
  code: string;
  name: string;
  buildingId: string;
  buildingName: string | null;
  projectId: string;
  projectName: string | null;
  customerId: string;
  /** Signed, so a basement level can be -1. */
  floorNumber: number | null;
  areaSqm: number | null;
  purpose: string | null;
  description: string | null;
  isActive: boolean;
  hasPlanImage: boolean;
  objectCount: number;
  riskSummary: RiskSummaryDto;
  /** Worst-case standing of the equipment on this floor, recalculated on every assessment. */
  rollup: ReportRollupDto;
  createdAt: string;
  updatedAt: string;
  deleteBlockers: readonly string[];
}

/**
 * The single current plan image for a floor.
 *
 * There is deliberately no version number, no supersededBy and no migration: section 19.2
 * leaves the plan editor format unapproved, so replacing the image simply replaces it and
 * the change is recorded in the audit log rather than in a version chain.
 */
export interface FloorPlanDto {
  id: string;
  floorId: string;
  fileId: string;
  fileName: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  title: string | null;
  description: string | null;
  uploadedById: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
  updatedAt: string;
}

export interface ProjectListQuery {
  page?: number;
  limit?: number;
  search?: string;
  customerId?: string;
  isActive?: boolean;
  sortBy?: 'name' | 'code' | 'startDate' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}

export interface BuildingListQuery {
  page?: number;
  limit?: number;
  search?: string;
  projectId?: string;
  customerId?: string;
  isActive?: boolean;
}

export interface FloorListQuery {
  page?: number;
  limit?: number;
  search?: string;
  buildingId?: string;
  projectId?: string;
  isActive?: boolean;
  hasPlanImage?: boolean;
}
