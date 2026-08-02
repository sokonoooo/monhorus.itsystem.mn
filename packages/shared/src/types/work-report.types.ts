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
