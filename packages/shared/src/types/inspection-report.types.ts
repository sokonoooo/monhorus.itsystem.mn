import type {
  InspectionReportBlocker,
  InspectionReportStatus,
} from '../constants/inspection-report';
import type { RiskLevel } from '../constants/service-request';

/** A file attached to a sub-task, surfaced on the report so an admin need not go hunting. */
export interface InspectionReportAttachmentDto {
  id: string;
  name: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  /** Which side of the work it documents. */
  stage: 'BEFORE' | 'AFTER';
}

/**
 * One sub-task as it appears in the report.
 *
 * Carries the sub-task's own Тайлбар and score. There is no Дүгнэлт here: that exists only
 * at report level, which is what separates the two.
 */
export interface InspectionReportTaskDto {
  taskId: string;
  title: string;
  floorName: string | null;
  status: string;
  statusLabel: string;
  skipped: boolean;
  score: number | null;
  riskLevel: RiskLevel | null;
  note: string | null;
  recommendation: string | null;
  totalQuantity: number;
  completedQuantity: number;
  unit: string;
  attachments: readonly InspectionReportAttachmentDto[];
  completedAt: string | null;
  assignedEmployeeName: string | null;
}

/** Sub-tasks grouped by the floor they were carried out on. */
export interface InspectionReportGroupDto {
  floorId: string | null;
  floorName: string;
  tasks: readonly InspectionReportTaskDto[];
}

/**
 * One finding, for the "илэрсэн зөрчил" list.
 *
 * Derived rather than entered: any sub-task scoring below Хэвийн is a finding, and it
 * carries the Тайлбар and Зөвлөмж the performer already wrote. That keeps the finding list
 * in step with the band thresholds in Тохиргоо instead of becoming a third text field the
 * performer has to remember to fill in.
 */
export interface InspectionReportIssueDto {
  taskId: string;
  title: string;
  locationLabel: string | null;
  riskLevel: RiskLevel;
  score: number | null;
  /** The performer's Тайлбар: the condition that was found. */
  condition: string | null;
  /** The performer's Зөвлөмж: what to do about it. */
  advice: string | null;
}

export interface InspectionReportDto {
  id: string;
  plannedWorkId: string;
  status: InspectionReportStatus;
  /** Advances each time a finalised report is reopened. Not a stored archive. */
  version: number;

  // Requirement 7: the report heading. Field names follow the printed report.
  workNumber: string;
  workTitle: string;
  customerName: string | null;
  projectName: string | null;
  buildingName: string | null;
  locationLabel: string | null;
  inspectionStart: string | null;
  inspectionEnd: string | null;
  responsibleEmployeeNames: readonly string[];
  responsibleTeamNames: readonly string[];
  /** Ерөнхий гүйцэтгэгчийн нэр. The operator's own company, read from settings. */
  contractorName: string | null;
  /** Ил ба далд ажлын актны нэр. */
  actName: string | null;
  /** Үзлэгээр шалгасан: what the inspection covered. */
  inspectedScope: string | null;

  // Requirement 8: the sub-tasks and their documents.
  groups: readonly InspectionReportGroupDto[];
  /** Requirement 8: the зөрчил found, derived from the sub-task bands. */
  issues: readonly InspectionReportIssueDto[];

  /**
   * Requirement 9. Derived worst-first from the sub-task bands, never averaged, and null
   * when nothing was scored so an unassessed inspection is not reported as healthy.
   */
  overallLevel: RiskLevel | null;
  overallLabel: string | null;
  /** System-composed summary of what was found, editable by an administrator. */
  issueSummary: string | null;
  conclusion: string | null;
  recommendation: string | null;
  /**
   * Шинэчлэх шаардлагатай самбарууд: what must be replaced. Free text lines so an
   * administrator can write what the printed report says, seeded from the worst findings.
   */
  replacementPanels: readonly string[];
  /**
   * Шинэчлэх шаардлагатай холболт. Never seeded: the sub-task data does not distinguish a
   * самбар from a холболт, so this arrives empty and an administrator writes it.
   */
  replacementConnections: readonly string[];
  /** True while the texts above are still exactly as the system composed them. */
  isAutoDraft: boolean;

  // Requirement 11: who did what, printed at the end of the report.
  createdByName: string | null;
  createdByPosition: string | null;
  createdAt: string;
  submittedByName: string | null;
  submittedAt: string | null;
  /** Хянасан, printed with the position beside the name. */
  approvedByName: string | null;
  approvedByPosition: string | null;
  approvedAt: string | null;
  returnedByName: string | null;
  returnedAt: string | null;
  returnReason: string | null;
  finalisedByName: string | null;
  finalisedAt: string | null;
  updatedAt: string;
}

/** Whether a report can be produced for a planned work yet, and why not. */
export interface InspectionReportReadinessDto {
  canGenerate: boolean;
  blockers: readonly InspectionReportBlocker[];
  /** Sub-tasks that still have to finish, named so the blocker is actionable. */
  outstandingTaskTitles: readonly string[];
  existingReportId: string | null;
}
