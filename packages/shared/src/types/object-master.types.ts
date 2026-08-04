import type { RiskLevel } from '../constants/service-request';
import type { ReportType } from '../constants/report-record';
import type {
  LoadIncompleteReason,
  ObjectCategory,
  ObjectIcon,
  ObjectStatus,
} from '../constants/object-master';
import type {
  LoadMeasurementKind,
  LoadMeasurementPhase,
  LoadMeasurementUnit,
} from '../constants/load-measurement';

/** A load figure plus why it could not be produced (rule 17.18). */
export interface LoadValueDto {
  valueKw: number | null;
  complete: boolean;
  reasons: readonly LoadIncompleteReason[];
}

/**
 * One reading taken during a visit, in the unit it was read in.
 *
 * A recorded observation, never an input to a total: only `measuredLoadKw` is summed. The
 * unit travels with the value rather than being inferred from the kind at read time, so a
 * stored row states in full what it is; the write path checks the pair against
 * `LOAD_MEASUREMENT_KIND_UNIT` so the two can never disagree.
 */
export interface LoadMeasurementDto {
  kind: LoadMeasurementKind;
  value: number;
  unit: LoadMeasurementUnit;
  /** Null for a reading that is not phase-specific: single-phase, or a total. */
  phase: LoadMeasurementPhase | null;
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
  /**
   * The panel enclosure the device is mounted inside, when it is one of the things that
   * live in a panel rather than out on the floor: an RCD, a busbar, a meter, an arrester.
   *
   * A physical location, never a supply. A device may carry this AND a circuit, and only
   * the circuit ever carries load — a panel-mounted device with no circuit contributes
   * nothing to any total.
   */
  panel: ObjectRefDto | null;
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

/**
 * Where the object sits on its floor plan, as a fraction of the plan's width and height.
 *
 * Normalised rather than pixel-based so the placement survives a plan image being replaced
 * at a different resolution or in a different format.
 */
export interface PlanPositionDto {
  x: number;
  y: number;
}

export interface ObjectListItemDto {
  id: string;
  code: string;
  name: string;
  category: ObjectCategory;
  /**
   * The registry entry, inlined.
   *
   * `showOnPlan` rides along because it is what decides whether an object may be drawn
   * as a marker on its floor plan, and every client that draws markers already holds
   * this list. Without it a client would have to fetch the whole type registry — which
   * `object_master.view` alone does not always reach — just to answer a yes/no per row.
   */
  objectType: {
    id: string;
    code: string;
    name: string;
    icon: ObjectIcon;
    showOnPlan: boolean;
  } | null;
  customerId: string;
  customerName: string | null;
  floorId: string | null;
  floorName: string | null;
  buildingName: string | null;
  /** Null when the object has never been placed on the floor's plan. */
  planPosition: PlanPositionDto | null;
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
  /**
   * Devices mounted inside this panel, when the object is a panel.
   *
   * A separate list from `childCircuits` because it answers a different question: what is
   * bolted into the enclosure, rather than what is fed out of it. A device that carries
   * both a circuit and this panel appears in both places, correctly — it is fed by the one
   * and housed by the other. Empty for every other category.
   */
  mountedEquipment: readonly ObjectListItemDto[];
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

/**
 * A free code proposed for a new object under a panel.
 *
 * Derived from the panel's own code plus a sequence (`CT-LDB-1` → `CT-LDB-1-01`), skipping
 * anything the customer already uses. It is a suggestion and nothing more: no reservation
 * is taken, the field stays editable, and two callers asking at the same moment may be
 * offered the same code — the unique index on (customer, code) is what actually decides.
 */
export interface ObjectCodeSuggestionDto {
  code: string;
  /** The panel code the suggestion was derived from, for the hint beside the field. */
  basedOn: string;
}

// -- Assessment history ------------------------------------------------------

export interface ObjectAssessmentDto {
  id: string;
  objectId: string;
  previousScore: number | null;
  newScore: number;
  riskLevel: RiskLevel;
  /**
   * Who SIGNED THE FINDING OFF: the approver of the report it arrived on, or the person
   * who recorded it by hand. Not necessarily the person who wrote the conclusion below.
   */
  assessedById: string | null;
  assessedByName: string | null;
  /**
   * Who WROTE THE JUDGEMENT — the technician whose Дүгнэлт this row carries, where the
   * producer recorded an author per piece of equipment (today: a planned-work sub-task).
   * Null means none was recorded, not that `assessedBy` wrote it; a screen showing one
   * name falls back to `assessedByName` and labels which of the two it is showing.
   */
  judgedById: string | null;
  judgedByName: string | null;
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
  /**
   * Everything else the visit read: amps per phase, volts, and the kW figure when one was
   * given. Empty for every assessment recorded before readings could be logged, and for
   * every one where only the kW box was filled in — the field is additive and its absence
   * means "nothing extra was read", never "not applicable".
   *
   * An ACTIVE_POWER entry here always equals `measuredLoadKw`; the write path refuses a
   * pair that disagrees rather than picking a winner.
   */
  measurements: readonly LoadMeasurementDto[];
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
  /**
   * Equipment on the floor that is neither fed by a panel circuit nor mounted in a panel.
   *
   * A device naming a panel is deliberately placed, not stranded, so it is excluded here
   * even though it carries no load: the figure exists to surface an omission, and a
   * registered mount is not one.
   */
  unattachedEquipmentCount: number;
  unattachedEquipmentKw: LoadValueDto;
  /** Counts by latest risk level, plus how many objects were never assessed. */
  riskCounts: readonly RiskLevelCountDto[];
  unassessedCount: number;
  kvaNote: string;
}
