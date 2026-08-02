import type { RiskLevel } from '../constants/service-request';
import type { ReportType } from '../constants/report-record';
import type {
  LoadIncompleteReason,
  ObjectCategory,
  ObjectIcon,
  ObjectStatus,
} from '../constants/object-master';

/** A load figure plus why it could not be produced (rule 17.18). */
export interface LoadValueDto {
  valueKw: number | null;
  complete: boolean;
  reasons: readonly LoadIncompleteReason[];
}

// -- Section 4.1 type registry ----------------------------------------------

export interface ObjectTypeDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: ObjectCategory;
  /** Section 4.1: план дээр объект болгон байрлуулах боломж. */
  showOnPlan: boolean;
  /** Section 4.1: самбарын бүрэлдэхүүнд нэмэх боломж. */
  insidePanel: boolean;
  /** Section 4.1: тухайн төхөөрөмж дээр үзлэгийн дүгнэлт бүртгэх боломж. */
  generatesConclusion: boolean;
  icon: ObjectIcon;
  isActive: boolean;
  /** Objects currently using this type. A type in use cannot be deleted. */
  objectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectTypeListQuery {
  page?: number;
  limit?: number;
  search?: string;
  category?: ObjectCategory;
  isActive?: boolean;
}

// -- Object master data ------------------------------------------------------

export interface ObjectRefDto {
  id: string;
  code: string;
  name: string;
  category: ObjectCategory;
}

/** Section 4.2 panel fields. */
export interface PanelAttributesDto {
  capacityKw: number | null;
  location: string | null;
  protection: string | null;
}

/** Section 4.2 and 11.4 circuit fields. */
export interface CircuitAttributesDto {
  panel: ObjectRefDto | null;
  startPoint: ObjectRefDto | null;
  endPoint: ObjectRefDto | null;
  breakerRating: string | null;
  cableType: string | null;
  cableSectionMm2: number | null;
  cableLengthM: number | null;
  permittedCapacityKw: number | null;
}

/** Section 4.2 equipment fields. */
export interface EquipmentAttributesDto {
  circuit: ObjectRefDto | null;
  ratedPowerKw: number | null;
  quantity: number | null;
  usageCoefficient: number | null;
  installedAt: string | null;
  warrantyUntil: string | null;
}

export interface ObjectPhotoDto {
  id: string;
  name: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  uploadedAt: string;
}

/** Denormalised head of the append-only assessment history. */
export interface LatestAssessmentDto {
  id: string;
  score: number;
  riskLevel: RiskLevel;
  assessedAt: string;
  assessedByName: string | null;
  conclusion: string | null;
  recommendation: string | null;
  repairRequired: boolean;
  revisitRequired: boolean;
  revisitDate: string | null;
}

export interface ObjectListItemDto {
  id: string;
  code: string;
  name: string;
  category: ObjectCategory;
  objectType: { id: string; code: string; name: string; icon: ObjectIcon } | null;
  customerId: string;
  customerName: string | null;
  floorId: string | null;
  floorName: string | null;
  buildingName: string | null;
  status: ObjectStatus;
  latestAssessment: LatestAssessmentDto | null;
  /** Backend-computed per section 11.5. Null when the inputs are incomplete. */
  calculatedLoad: LoadValueDto;
  measuredLoadKw: number | null;
  loadVariance: LoadValueDto;
  createdAt: string;
}

export interface ObjectDetailDto extends ObjectListItemDto {
  description: string | null;
  notes: string | null;
  updatedAt: string;
  photos: readonly ObjectPhotoDto[];
  panel: PanelAttributesDto | null;
  circuit: CircuitAttributesDto | null;
  equipment: EquipmentAttributesDto | null;
  /** Circuits belonging to this panel, when the object is a panel. */
  childCircuits: readonly ObjectListItemDto[];
  /** Equipment fed by this circuit, when the object is a circuit. */
  childEquipment: readonly ObjectListItemDto[];
  loadPercent: LoadValueDto;
  reserveKw: LoadValueDto;
  /** True when the type registry marks this type as able to carry a conclusion. */
  canAssess: boolean;
  /** Reasons the object cannot be deleted. Empty means deletion is allowed. */
  deleteBlockers: readonly string[];
}

export interface ObjectListQuery {
  page?: number;
  limit?: number;
  search?: string;
  customerId?: string;
  floorId?: string;
  buildingId?: string;
  category?: ObjectCategory;
  objectTypeId?: string;
  status?: ObjectStatus;
  riskLevel?: RiskLevel;
  /** Objects with no floor link yet, for the floor linking picker. */
  unlinkedOnly?: boolean;
  sortBy?: 'code' | 'name' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}

// -- Assessment history ------------------------------------------------------

export interface ObjectAssessmentDto {
  id: string;
  objectId: string;
  previousScore: number | null;
  newScore: number;
  riskLevel: RiskLevel;
  assessedById: string | null;
  assessedByName: string | null;
  assessedAt: string;
  /**
   * Evidence attached to this assessment, in the same shape as the object's own photos.
   * A new assessment always carries at least one; entries recorded before that rule was
   * introduced are grandfathered and come back with an empty list.
   */
  photos: readonly ObjectPhotoDto[];
  conclusion: string | null;
  recommendation: string | null;
  actionTaken: string | null;
  measuredLoadKw: number | null;
  repairRequired: boolean;
  revisitRequired: boolean;
  revisitDate: string | null;
  revisitOwnerName: string | null;
  /** Where the assessment came from, when it was raised during work. */
  sourceLabel: string | null;
  createdAt: string;
}

/**
 * One row of the consolidated object history timeline.
 *
 * Report rows carry the report's own type as their kind, so the four producers read the
 * same way here as everywhere else; audit rows keep their own kind because they are not
 * findings, they are the record of who changed the registration.
 */
export interface ObjectHistoryEntryDto {
  id: string;
  /**
   * A report type, or one of the rows that are not reports themselves: a load reading
   * taken during a visit, and an audit entry.
   */
  kind: ReportType | 'MEASUREMENT' | 'AUDIT';
  occurredAt: string;
  title: string;
  detail: string | null;
  actorName: string | null;
  /** Present for report rows that scored the equipment. */
  previousScore?: number | null;
  newScore?: number | null;
  riskLevel?: RiskLevel | null;
  /** Navigation target in the owning module, when the row came from one. */
  linkPath?: string | null;
}

export interface ObjectHistoryDto {
  assessments: readonly ObjectAssessmentDto[];
  timeline: readonly ObjectHistoryEntryDto[];
}

// -- Floor roll-up -----------------------------------------------------------

export interface RiskLevelCountDto {
  level: RiskLevel;
  count: number;
}

/**
 * Floor load summary.
 *
 * Section 11.5 defines the floor total as the sum of the panel loads, so equipment linked
 * to the floor without a panel is reported in its own figure and is explicitly excluded
 * from `totalKw`. No single aggregate risk score is produced: section 19.2 leaves the
 * aggregation method unapproved.
 */
export interface FloorLoadSummaryDto {
  panelCount: number;
  circuitCount: number;
  equipmentCount: number;
  totalKw: LoadValueDto;
  measuredTotalKw: number | null;
  variance: LoadValueDto;
  /** Equipment on the floor that is not fed by any panel circuit. */
  unattachedEquipmentCount: number;
  unattachedEquipmentKw: LoadValueDto;
  /** Counts by latest risk level, plus how many objects were never assessed. */
  riskCounts: readonly RiskLevelCountDto[];
  unassessedCount: number;
  kvaNote: string;
}
