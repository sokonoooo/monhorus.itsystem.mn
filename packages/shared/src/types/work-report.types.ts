import type { MaterialUnit } from '../constants/material';
import type { RiskLevel } from '../constants/service-request';
import type { WorkReportRequirement, WorkReportStatus } from '../constants/work-report';

export interface WorkReportPhotoDto {
  id: string;
  name: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  uploadedAt: string;
}

/**
 * One material used on the request: a typed name, a quantity and a unit.
 *
 * Requirements 19.2 keeps V1 at "нэр/тоо", so the name is free text rather than a
 * reference to a catalogue, and nothing is deducted from a stock balance.
 */
export interface WorkReportMaterialDto {
  name: string;
  quantity: number;
  unit: MaterialUnit;
}

/**
 * One piece of registered equipment the technician recorded as inspected.
 *
 * The request itself names only the location tree, so this link is the sole bridge from a
 * service result to the object master. Code and name are denormalised for display; a
 * reference the backend did not populate comes back as the id alone.
 */
export interface WorkReportObjectDto {
  id: string;
  code: string | null;
  name: string | null;
}

/**
 * What was found on one piece of equipment during a service visit.
 *
 * Its own finding, not a copy of the visit's: a healthy panel and a failing one inspected
 * on the same call must read differently. `riskLevel` is derived server-side from the
 * score, never chosen.
 */
export interface WorkReportObjectAssessmentDto {
  objectId: string;
  code: string | null;
  name: string | null;
  score: number | null;
  observation: string | null;
  conclusion: string | null;
  recommendation: string | null;
  photoIds: readonly string[];
}

/**
 * The section 9.2 work conclusion for a service request.
 *
 * `riskLevel` is derived from the score against the thresholds in force when it was
 * written, never chosen by hand: section 10.1 makes the band a function of the score.
 */
export interface WorkReportDto {
  id: string;
  serviceRequestId: string;
  status: WorkReportStatus;

  score: number | null;
  riskLevel: RiskLevel | null;
  conclusion: string | null;
  recommendation: string | null;
  actionTaken: string | null;
  repairRequired: boolean;
  revisitRequired: boolean;
  revisitDate: string | null;

  beforePhotos: readonly WorkReportPhotoDto[];
  afterPhotos: readonly WorkReportPhotoDto[];
  materials: readonly WorkReportMaterialDto[];
  /** What was actually inspected, discovered on site rather than known when the request was raised. */
  objects: readonly WorkReportObjectDto[];
  objectAssessments: readonly WorkReportObjectAssessmentDto[];

  /** Mandatory fields still empty. Empty means the request may be finished. */
  missing: readonly WorkReportRequirement[];
  isComplete: boolean;

  createdByName: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  returnedByName: string | null;
  returnedAt: string | null;
  returnReason: string | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * The conclusion as a CUSTOMER may read it — the finished verdict on their own request.
 *
 * A SEPARATE TYPE RATHER THAN A SUBSET OF `WorkReportDto`, because the staff DTO is a
 * working document and this is a published result. Everything omitted here is omitted
 * deliberately:
 *
 *   * `status`, `missing`, `isComplete` — the drafting state. A customer only ever sees an
 *     approved conclusion, so a status field could carry exactly one value and would still
 *     invite a client to render "батлагдсан/ноорог" for a record it can never see in the
 *     other state.
 *   * `returnReason`, `returnedBy*`, `submittedBy*` — the internal review conversation.
 *     "Дүгнэлт дутуу, дахин бич" is a message from one colleague to another and is not the
 *     customer's business.
 *   * `createdBy`/`createdByName` — NOT the author. `getOrCreateWorkReport` stamps whoever
 *     opened the form first, which live data shows is regularly not the person who wrote a
 *     word of it. `approvedByName` is the only name here that is a claim anyone stands
 *     behind, so it is the only name sent.
 *   * `actionTaken`, `materials`, `objects`, `objectAssessments` — the operational detail.
 *     Equipment codes and per-object findings belong to the object master, which the portal
 *     reaches through its own permissions and its own scoping.
 *
 * There is no `id` and no `serviceRequestId` either: the customer read is keyed on the
 * request the caller already named, so neither identifier tells them anything they did not
 * supply, and a conclusion id is a handle onto staff routes.
 */
export interface CustomerWorkReportDto {
  conclusion: string | null;
  recommendation: string | null;
  score: number | null;
  riskLevel: RiskLevel | null;
  repairRequired: boolean;
  revisitRequired: boolean;
  revisitDate: string | null;
  beforePhotos: readonly WorkReportPhotoDto[];
  afterPhotos: readonly WorkReportPhotoDto[];
  approvedAt: string | null;
  approvedByName: string | null;
}
